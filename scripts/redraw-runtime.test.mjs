import assert from "node:assert/strict";
import test from "node:test";
import { canCancelRedrawStatus, providerReconciliationDecision, publicRedrawBlocker, redrawArtifactUrls, redrawRetryTarget, requiresProviderSubmissionReconciliation } from "../lib/redraw-contract.ts";
import { redrawQueueDispatchId } from "../lib/redraw-queue.ts";
import { claimHeartbeatIntervalMs, claimHeartbeatQueryTimeoutMs, createRedrawPlan, extractResponseText, firstExecutableAttemptNumber, hasRunningHubFailure, isClaimHeartbeatExpired, loadSkillBundle, orderedReferenceAssets, parseJsonObject, providerInputAudit, redactError, redrawPlanJsonSchema, shouldFailClosedAttempt, shouldReconcileAcceptedArtifact, validatePlan, validateQa, visualQaJsonSchema } from "./redraw-runtime.mjs";
import { cosClientOptions, redrawCosKey } from "./redraw-cos.mjs";

test("parses a strict redraw plan", () => {
  const plan = validatePlan(parseJsonObject('{"schema_version":"image_redraw_plan_v2","subject_mode":"product","transformation_type":"product_preserving_scene_transfer","provider_route":"runninghub_image2_image","prompt":"中文商品图提示词","negative_prompt":"不要文字漂移","reference_bindings":[],"subject_truth_constraints":["保留包装"],"qa_requirements":["身份一致"]}'));
  assert.equal(plan.provider_route, "runninghub_image2_image");
});
test("rejects an unapproved provider route", () => {
  assert.throws(() => validatePlan({ schema_version: "image_redraw_plan_v2", subject_mode: "product", transformation_type: "background_replacement", provider_route: "shell", prompt: "x", negative_prompt: "", reference_bindings: [], subject_truth_constraints: [], qa_requirements: [] }));
});
test("accepts only strict reference bindings to authorized job assets", () => {
  const base = { schema_version: "image_redraw_plan_v2", subject_mode: "product", transformation_type: "background_replacement", provider_route: "runninghub_image2_image", prompt: "x", negative_prompt: "", subject_truth_constraints: [], qa_requirements: [] };
  assert.equal(validatePlan({ ...base, reference_bindings: [{ asset_id: "source-1", role: "product" }] }, ["source-1"]).reference_bindings[0].asset_id, "source-1");
  assert.throws(() => validatePlan({ ...base, reference_bindings: [{ asset_id: "other-user-asset", role: "scene" }] }, ["source-1"]), /REDRAW_PLAN_REFERENCE_ASSET_NOT_ALLOWED/);
  assert.throws(() => validatePlan({ ...base, reference_bindings: [{ asset_id: "source-1" }] }, ["source-1"]), /REDRAW_PLAN_REFERENCE_BINDINGS_INVALID/);
});
test("keeps product, character, scene and first_frame inside one image_redraw contract", () => {
  const plan = { schema_version: "image_redraw_plan_v2", subject_mode: "character", transformation_type: "character_style_transfer", provider_route: "runninghub_image2_image", prompt: "preserve character", negative_prompt: "", reference_bindings: [{ asset_id: "source-1", role: "character" }], subject_truth_constraints: ["same character identity"], qa_requirements: ["identity match"] };
  assert.equal(validatePlan(plan, ["source-1"]).subject_mode, "character");
  assert.throws(() => validatePlan({ ...plan, subject_mode: "novel_video" }, ["source-1"]), /REDRAW_PLAN_SCHEMA_INVALID/);
  assert.equal(validateQa({ schema_version: "image_redraw_visual_qa_v2", subject_mode: "character", subject_identity_preserved: true, composition_passed: true, text_drift_detected: false, quality_passed: true, evidence: ["角色一致"], retry_instruction: null }).subject_mode, "character");
});
test("orders every owner-scoped reference for the provider and rejects missing assets", () => {
  const rows = [
    { id: "reference-2", local_path: "two.png", mime_type: "image/png", sha256: "sha-2", original_name: "two.png" },
    { id: "reference-1", local_path: "one.jpg", mime_type: "image/jpeg", sha256: "sha-1", original_name: "one.jpg" },
  ];
  assert.deepEqual(orderedReferenceAssets(["reference-1", "reference-2"], rows).map((asset) => asset.id), ["reference-1", "reference-2"]);
  assert.throws(() => orderedReferenceAssets(["reference-1", "reference-missing"], rows), /REDRAW_REFERENCE_ASSET_MISSING/);
  assert.throws(() => orderedReferenceAssets("reference-1", rows), /REDRAW_REFERENCE_ASSETS_INVALID/);
  assert.throws(() => orderedReferenceAssets(["reference-1", "reference-1"], rows), /REDRAW_REFERENCE_ASSETS_INVALID/);
});
test("persists provider input evidence without temporary upload URLs or filenames", () => {
  const audit = providerInputAudit(
    { id: "source-1", sha256: "sha-source", mime_type: "image/png", original_name: "private-product-name.png", provider_url: "https://provider.invalid/input?token=secret" },
    [{ id: "reference-1", sha256: "sha-reference", mime_type: "image/jpeg", original_name: "customer-reference.jpg", provider_url: "https://provider.invalid/reference?signature=secret" }],
  );
  assert.deepEqual(audit, {
    schema_version: "redraw_provider_input_audit_v1",
    assets: [
      { asset_id: "source-1", role: "source", ordinal: 0, sha256: "sha-source", mime_type: "image/png" },
      { asset_id: "reference-1", role: "reference", ordinal: 1, sha256: "sha-reference", mime_type: "image/jpeg" },
    ],
  });
  assert.doesNotMatch(JSON.stringify(audit), /provider\.invalid|token|signature|private-product-name|customer-reference/);
  assert.throws(() => providerInputAudit({ id: "source-1", sha256: "sha-source", mime_type: "text/plain" }), /REDRAW_PROVIDER_INPUT_AUDIT_INVALID/);
});
test("declares complete strict schemas for planning and visual QA", () => {
  const planSchema = redrawPlanJsonSchema();
  const bindingSchema = planSchema.properties.reference_bindings.items;
  assert.equal(planSchema.additionalProperties, false);
  assert.equal(bindingSchema.additionalProperties, false);
  assert.deepEqual(bindingSchema.required, ["asset_id", "role"]);
  assert.deepEqual(bindingSchema.properties.role.enum, ["subject", "product", "character", "first_frame", "composition", "style", "lighting", "scene"]);
  const qaSchema = visualQaJsonSchema();
  assert.equal(qaSchema.additionalProperties, false);
  assert.deepEqual(qaSchema.properties.schema_version.enum, ["image_redraw_visual_qa_v2"]);
  assert.equal(qaSchema.properties.evidence.maxItems, 24);
});
test("sends the complete strict plan schema through the Responses request", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.NIANNIAN_GPT_API_BASE_URL;
  const originalApiKey = process.env.NIANNIAN_GPT_API_KEY;
  let requestBody;
  try {
    process.env.NIANNIAN_GPT_API_BASE_URL = "https://mcgrox.invalid";
    process.env.NIANNIAN_GPT_API_KEY = "test-only-key";
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: JSON.stringify({ schema_version: "image_redraw_plan_v2", subject_mode: "product", transformation_type: "product_preserving_scene_transfer", provider_route: "runninghub_image2_image", prompt: "preserve product", negative_prompt: "", reference_bindings: [{ asset_id: "source-1", role: "product" }], subject_truth_constraints: ["same product"], qa_requirements: ["identity match"] }) }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const plan = await createRedrawPlan({ bundle: { instructions: ["reviewed bundle"] }, requirements: { aspect_ratio: "1:1" }, sourceAssetId: "source-1", referenceAssetIds: ["reference-1"] });
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.text.format.strict, true);
    assert.equal(requestBody.text.format.schema.properties.reference_bindings.items.additionalProperties, false);
    assert.equal(plan.reference_bindings[0].asset_id, "source-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.NIANNIAN_GPT_API_BASE_URL; else process.env.NIANNIAN_GPT_API_BASE_URL = originalBaseUrl;
    if (originalApiKey === undefined) delete process.env.NIANNIAN_GPT_API_KEY; else process.env.NIANNIAN_GPT_API_KEY = originalApiKey;
  }
});
test("accepts only a complete visual QA result", () => {
  assert.equal(validateQa({ schema_version: "image_redraw_visual_qa_v2", subject_mode: "product", subject_identity_preserved: true, composition_passed: true, text_drift_detected: false, quality_passed: true, evidence: ["主体一致"], retry_instruction: null }).quality_passed, true);
  assert.throws(() => validateQa({ schema_version: "image_redraw_visual_qa_v2", quality_passed: true }));
});
test("fails closed after a provider submit crash window", () => {
  assert.equal(shouldFailClosedAttempt({ status: "submitting", provider_task_id: null }), true);
  assert.equal(shouldFailClosedAttempt({ status: "submitting", provider_task_id: "rh-task-1" }), false);
  assert.equal(shouldFailClosedAttempt({ status: "preparing", provider_task_id: null }), false);
  const uncertainJob = { status: "failed", attempt_count: 0, max_attempts: 2, provider_task_id: null, blocker: "RUNNINGHUB_SUBMISSION_RECONCILIATION_REQUIRED" };
  assert.equal(requiresProviderSubmissionReconciliation(uncertainJob), true);
  assert.equal(redrawRetryTarget(uncertainJob), null);
});
test("reconciles only the exact uncertain provider submission binding", () => {
  const job = { status: "failed", attempt_count: 0, max_attempts: 2, provider_task_id: null, blocker: "RUNNINGHUB_SUBMISSION_RECONCILIATION_REQUIRED" };
  const attempt = { attempt_number: 1, transaction_key: "tx-1", provider_task_id: null, status: "submitting" };
  const input = { attemptNumber: 1, transactionKey: "tx-1", providerTaskId: "rh-task-1" };
  assert.equal(providerReconciliationDecision(job, attempt, input), "apply");
  assert.equal(providerReconciliationDecision(job, attempt, { ...input, transactionKey: "tx-other" }), null);
  assert.equal(providerReconciliationDecision({ ...job, blocker: "REDRAW_QUEUE_DISPATCH_FAILED" }, attempt, input), null);
  assert.equal(providerReconciliationDecision({ ...job, blocker: `legacy: ${job.blocker}` }, attempt, input), null);
  assert.equal(providerReconciliationDecision({ ...job, status: "provider_submitted", attempt_count: 1, provider_task_id: "rh-task-1", blocker: null }, { ...attempt, status: "submitted", provider_task_id: "rh-task-1" }, input), "idempotent");
  assert.equal(providerReconciliationDecision({ ...job, status: "provider_submitted", attempt_count: 1, provider_task_id: "rh-task-other", blocker: null }, { ...attempt, status: "submitted", provider_task_id: "rh-task-other" }, input), null);
});
test("recognizes only complete accepted artifacts for crash recovery", () => {
  assert.equal(shouldReconcileAcceptedArtifact({ id: "artifact-1", object_key: "private/key.png", mime_type: "image/png", sha256: "abc" }), true);
  assert.equal(shouldReconcileAcceptedArtifact({ id: "artifact-1", object_key: "private/key.png", mime_type: "image/png", sha256: null }), false);
});
test("reconciles a persisted provider task before creating another attempt", () => {
  assert.equal(firstExecutableAttemptNumber({ status: "provider_submitted", attempt_count: 1 }), 1);
  assert.equal(firstExecutableAttemptNumber({ status: "generating", attempt_count: 2 }), 2);
  assert.equal(firstExecutableAttemptNumber({ status: "qa_running", attempt_count: 2 }), 2);
  assert.equal(firstExecutableAttemptNumber({ status: "queued", attempt_count: 1 }), 2);
  assert.throws(() => firstExecutableAttemptNumber({ status: "queued", attempt_count: -1 }), /REDRAW_ATTEMPT_COUNT_INVALID/);
});
test("retries a persisted provider task without consuming another attempt", () => {
  const resumeStatus = redrawRetryTarget({ status: "failed", attempt_count: 2, max_attempts: 2, provider_task_id: "task-2" });
  assert.equal(resumeStatus, "provider_submitted");
  assert.equal(firstExecutableAttemptNumber({ status: resumeStatus, attempt_count: 2 }), 2);
  assert.equal(redrawRetryTarget({ status: "qa_failed", attempt_count: 1, max_attempts: 2, provider_task_id: "task-1" }), "queued");
  assert.equal(redrawRetryTarget({ status: "qa_failed", attempt_count: 2, max_attempts: 2, provider_task_id: "task-2" }), null);
  assert.equal(redrawRetryTarget({ status: "queued", attempt_count: 1, max_attempts: 2, provider_task_id: null }), null);
});
test("only active redraw states are cancellable", () => {
  assert.equal(canCancelRedrawStatus("queued"), true);
  assert.equal(canCancelRedrawStatus("planning"), true);
  assert.equal(canCancelRedrawStatus("provider_submitted"), false);
  assert.equal(canCancelRedrawStatus("generating"), false);
  assert.equal(canCancelRedrawStatus("qa_running"), false);
  assert.equal(canCancelRedrawStatus("completed"), false);
  assert.equal(canCancelRedrawStatus("failed"), false);
  assert.equal(canCancelRedrawStatus("cancelled"), false);
});
test("keeps protected redraw preview inline and download explicit", () => {
  const urls = redrawArtifactUrls("redraw/job?1", "artifact/one");
  assert.equal(urls.previewUrl, "/api/redraw/jobs/redraw%2Fjob%3F1/artifacts/artifact%2Fone/download");
  assert.equal(urls.downloadUrl, `${urls.previewUrl}?download=1`);
});
test("uses a stable queue dispatch id per durable job revision", () => {
  const first = redrawQueueDispatchId("redraw-job", "2026-07-21T05:00:00.000Z");
  assert.equal(first, redrawQueueDispatchId("redraw-job", "2026-07-21T05:00:00.000Z"));
  assert.notEqual(first, redrawQueueDispatchId("redraw-job", "2026-07-21T05:01:00.000Z"));
  assert.match(first, /^redraw-[a-f0-9]{32}$/);
});
test("stores and exposes only stable redraw failure codes", () => {
  assert.equal(extractResponseText({ output: [{ content: [{ text: "{}" }] }] }), "{}");
  assert.equal(redactError(new Error("ENOENT: open '/app/data/uploads/private-product.png'")), "REDRAW_WORKER_FAILED");
  assert.equal(redactError("request https://provider.invalid/output?signature=private failed with RUNNINGHUB_TASK_ERROR"), "RUNNINGHUB_TASK_ERROR");
  assert.equal(redactError("Bearer 12345678901234567890"), "REDRAW_WORKER_FAILED");
  assert.equal(publicRedrawBlocker("SOURCE_ASSET_HASH_MISMATCH: /private/customer.png"), "SOURCE_ASSET_HASH_MISMATCH");
  assert.equal(publicRedrawBlocker("database failed at /app/private/path"), "REDRAW_JOB_FAILED");
  assert.equal(publicRedrawBlocker(null), null);
});
test("renews worker claims well before the recovery window", () => {
  assert.equal(claimHeartbeatIntervalMs(3000), 1000);
  assert.equal(claimHeartbeatIntervalMs(90000), 30000);
  assert.equal(claimHeartbeatIntervalMs(900000), 30000);
  assert.equal(claimHeartbeatQueryTimeoutMs(3000), 500);
  assert.equal(claimHeartbeatQueryTimeoutMs(90000), 10000);
  assert.equal(isClaimHeartbeatExpired(1000, 3000, 3999), false);
  assert.equal(isClaimHeartbeatExpired(1000, 3000, 4000), true);
  assert.throws(() => claimHeartbeatIntervalMs(2999), /REDRAW_CLAIM_RECOVERY_MS_INVALID/);
  assert.throws(() => isClaimHeartbeatExpired(Number.NaN, 3000, 4000), /REDRAW_CLAIM_HEARTBEAT_TIME_INVALID/);
});
test("loads the checked-in immutable image_redraw runtime bundle", async () => {
  const bundle = await loadSkillBundle(process.cwd(), "image-redraw-runtime-2");
  assert.equal(bundle.manifest.bundle_version, "image-redraw-runtime-2");
  assert.equal(bundle.manifest.runtime_kind, "image_redraw");
  assert.deepEqual(bundle.manifest.allowed_tools, ["cos_read", "gpt_plan", "runninghub_image2_image", "gpt_vision_qa", "cos_write"]);
});

test("supports short-lived COS credentials without requiring a long-lived server key", () => {
  const env = {
    TENCENT_COS_SECRET_ID: "temporary-id",
    TENCENT_COS_SECRET_KEY: "temporary-key",
    TENCENT_COS_SECURITY_TOKEN: "temporary-token",
    TENCENT_COS_BUCKET: "bucket-123",
    TENCENT_COS_REGION: "ap-beijing",
  };
  assert.deepEqual(cosClientOptions(env), {
    SecretId: "temporary-id",
    SecretKey: "temporary-key",
    SecurityToken: "temporary-token",
  });
  delete env.TENCENT_COS_SECURITY_TOKEN;
  assert.deepEqual(cosClientOptions(env), { SecretId: "temporary-id", SecretKey: "temporary-key" });
  delete env.TENCENT_COS_SECRET_KEY;
  assert.throws(() => cosClientOptions(env), /COS_NOT_CONFIGURED/);
});
test("writes redraw outputs only below the configured COS prefix", () => {
  const input = { userId: "user-1", jobId: "job-1", artifactId: "artifact-1", extension: "webp" };
  assert.equal(redrawCosKey(input, { TENCENT_COS_PREFIX: "redraw" }), "redraw/user-1/job-1/artifact-1.webp");
  assert.equal(redrawCosKey(input, { TENCENT_COS_PREFIX: "/redraw/" }), "redraw/user-1/job-1/artifact-1.webp");
  assert.throws(() => redrawCosKey(input, { TENCENT_COS_PREFIX: "../outside" }), /COS_PREFIX_INVALID/);
  assert.throws(() => redrawCosKey({ ...input, userId: "../other" }), /COS_OBJECT_KEY_INVALID/);
});

test("keeps polling RunningHub when failedReason is structurally empty", () => {
  assert.equal(hasRunningHubFailure(null), false);
  assert.equal(hasRunningHubFailure(""), false);
  assert.equal(hasRunningHubFailure({}), false);
  assert.equal(hasRunningHubFailure({ code: "", message: "" }), false);
  assert.equal(hasRunningHubFailure({ nested: { code: "" } }), false);
  assert.equal(hasRunningHubFailure({ code: "1007", message: "provider rejected" }), true);
  assert.equal(hasRunningHubFailure([{}, { message: "generation failed" }]), true);
});
