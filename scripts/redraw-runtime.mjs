import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const PLAN_SCHEMA_VERSION = "image_redraw_plan_v2";
export const QA_SCHEMA_VERSION = "image_redraw_visual_qa_v2";
const SUBJECT_MODES = new Set(["product", "character", "scene", "first_frame"]);
const TRANSFORMS = new Set(["product_preserving_style_transfer", "product_preserving_scene_transfer", "product_preserving_lighting_transfer", "product_preserving_composition_transfer", "background_replacement", "character_style_transfer", "first_frame_regeneration", "image_to_video_reference"]);
const REFERENCE_ROLES = new Set(["subject", "product", "character", "first_frame", "composition", "style", "lighting", "scene"]);

export function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export function claimHeartbeatIntervalMs(recoveryMs) {
  const parsed = Number(recoveryMs);
  if (!Number.isFinite(parsed) || parsed < 3000) throw new Error("REDRAW_CLAIM_RECOVERY_MS_INVALID");
  return Math.max(1000, Math.min(30000, Math.floor(parsed / 3)));
}

export function claimHeartbeatQueryTimeoutMs(recoveryMs) {
  const intervalMs = claimHeartbeatIntervalMs(recoveryMs);
  return Math.max(500, Math.min(10000, Math.floor(intervalMs / 2)));
}

export function isClaimHeartbeatExpired(lastSuccessAt, recoveryMs, currentTime = Date.now()) {
  const lastSuccess = Number(lastSuccessAt);
  const recovery = Number(recoveryMs);
  const current = Number(currentTime);
  if (![lastSuccess, recovery, current].every(Number.isFinite) || recovery < 3000) throw new Error("REDRAW_CLAIM_HEARTBEAT_TIME_INVALID");
  return current - lastSuccess >= recovery;
}

export function validateReferenceAssetIds(referenceAssetIds) {
  if (!Array.isArray(referenceAssetIds) || referenceAssetIds.length > 8 || new Set(referenceAssetIds).size !== referenceAssetIds.length || referenceAssetIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9._:-]{1,180}$/.test(id))) throw new Error("REDRAW_REFERENCE_ASSETS_INVALID");
  return referenceAssetIds;
}

export function orderedReferenceAssets(referenceAssetIds, assetRows) {
  validateReferenceAssetIds(referenceAssetIds);
  const byId = new Map((assetRows || []).map((asset) => [asset?.id, asset]));
  const ordered = referenceAssetIds.map((id) => byId.get(id));
  if (ordered.some((asset) => !asset?.local_path || !asset?.mime_type?.startsWith("image/") || !asset?.sha256 || !asset?.original_name)) throw new Error("REDRAW_REFERENCE_ASSET_MISSING");
  return ordered;
}

export function providerInputAudit(sourceAsset, referenceAssets = []) {
  const assets = [sourceAsset, ...referenceAssets].map((asset, index) => {
    if (!asset?.id || !asset?.sha256 || !asset?.mime_type?.startsWith("image/")) throw new Error("REDRAW_PROVIDER_INPUT_AUDIT_INVALID");
    return {
      asset_id: asset.id,
      role: index === 0 ? "source" : "reference",
      ordinal: index,
      sha256: asset.sha256,
      mime_type: asset.mime_type,
    };
  });
  return { schema_version: "redraw_provider_input_audit_v1", assets };
}

export function redactError(error) {
  const message = String(error instanceof Error ? error.message : error);
  const stableCode = message.match(/\b(?:REDRAW|RUNNINGHUB|MCGROX|COS|VISUAL_QA|PROVIDER_OUTPUT|SOURCE_ASSET|SKILL_BUNDLE|MODEL)_[A-Z0-9_]+\b/i)?.[0];
  return stableCode ? stableCode.toUpperCase() : "REDRAW_WORKER_FAILED";
}

export function parseJsonObject(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MODEL_JSON_OBJECT_REQUIRED");
  return parsed;
}

export function validatePlan(plan, allowedAssetIds = null) {
  if (plan?.schema_version !== PLAN_SCHEMA_VERSION || !SUBJECT_MODES.has(plan.subject_mode) || !TRANSFORMS.has(plan.transformation_type) || plan.provider_route !== "runninghub_image2_image") throw new Error("REDRAW_PLAN_SCHEMA_INVALID");
  if (typeof plan.prompt !== "string" || !plan.prompt.trim() || plan.prompt.length > 8000 || typeof plan.negative_prompt !== "string" || plan.negative_prompt.length > 4000) throw new Error("REDRAW_PLAN_PROMPT_INVALID");
  if (!Array.isArray(plan.reference_bindings) || plan.reference_bindings.length > 12) throw new Error("REDRAW_PLAN_REFERENCE_BINDINGS_INVALID");
  const allowed = allowedAssetIds ? new Set(allowedAssetIds) : null;
  for (const binding of plan.reference_bindings) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error("REDRAW_PLAN_REFERENCE_BINDINGS_INVALID");
    if (typeof binding.asset_id !== "string" || !binding.asset_id || binding.asset_id.length > 180 || !REFERENCE_ROLES.has(binding.role)) throw new Error("REDRAW_PLAN_REFERENCE_BINDINGS_INVALID");
    if (allowed && !allowed.has(binding.asset_id)) throw new Error("REDRAW_PLAN_REFERENCE_ASSET_NOT_ALLOWED");
  }
  for (const key of ["subject_truth_constraints", "qa_requirements"]) {
    const values = plan[key];
    if (!Array.isArray(values) || values.length > 24 || values.some((value) => typeof value !== "string" || !value.trim() || value.length > 500)) throw new Error(`REDRAW_PLAN_${key.toUpperCase()}_INVALID`);
  }
  return plan;
}

export function validateQa(qa) {
  if (qa?.schema_version !== QA_SCHEMA_VERSION || !SUBJECT_MODES.has(qa?.subject_mode)) throw new Error("VISUAL_QA_SCHEMA_INVALID");
  for (const key of ["subject_identity_preserved", "composition_passed", "text_drift_detected", "quality_passed"]) if (typeof qa[key] !== "boolean") throw new Error(`VISUAL_QA_${key.toUpperCase()}_INVALID`);
  if (!Array.isArray(qa.evidence) || (qa.retry_instruction !== null && typeof qa.retry_instruction !== "string")) throw new Error("VISUAL_QA_DETAIL_INVALID");
  return qa;
}

export function redrawPlanJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "subject_mode", "transformation_type", "provider_route", "prompt", "negative_prompt", "reference_bindings", "subject_truth_constraints", "qa_requirements"],
    properties: {
      schema_version: { type: "string", enum: [PLAN_SCHEMA_VERSION] },
      subject_mode: { type: "string", enum: [...SUBJECT_MODES] },
      transformation_type: { type: "string", enum: [...TRANSFORMS] },
      provider_route: { type: "string", enum: ["runninghub_image2_image"] },
      prompt: { type: "string", minLength: 1, maxLength: 8000 },
      negative_prompt: { type: "string", maxLength: 4000 },
      reference_bindings: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["asset_id", "role"], properties: { asset_id: { type: "string", minLength: 1, maxLength: 180 }, role: { type: "string", enum: [...REFERENCE_ROLES] } } } },
      subject_truth_constraints: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 500 } },
      qa_requirements: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 500 } },
    },
  };
}

export function visualQaJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "subject_mode", "subject_identity_preserved", "composition_passed", "text_drift_detected", "quality_passed", "evidence", "retry_instruction"],
    properties: {
      schema_version: { type: "string", enum: [QA_SCHEMA_VERSION] },
      subject_mode: { type: "string", enum: [...SUBJECT_MODES] },
      subject_identity_preserved: { type: "boolean" },
      composition_passed: { type: "boolean" },
      text_drift_detected: { type: "boolean" },
      quality_passed: { type: "boolean" },
      evidence: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 500 } },
      retry_instruction: { type: ["string", "null"], maxLength: 2000 },
    },
  };
}

export function shouldFailClosedAttempt(attempt) {
  return attempt?.status === "submitting" && !attempt?.provider_task_id;
}

export function shouldReconcileAcceptedArtifact(artifact) {
  return Boolean(artifact?.id && artifact?.object_key && artifact?.mime_type && artifact?.sha256);
}

export function firstExecutableAttemptNumber(job) {
  const attemptCount = Number(job?.attempt_count);
  if (!Number.isInteger(attemptCount) || attemptCount < 0) throw new Error("REDRAW_ATTEMPT_COUNT_INVALID");
  const resumesPersistedProviderTask = ["provider_submitted", "generating", "qa_running"].includes(job?.status);
  return resumesPersistedProviderTask && attemptCount > 0 ? attemptCount : attemptCount + 1;
}

export function extractResponseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  const texts = [];
  for (const item of response?.output || []) for (const content of item?.content || []) if (typeof content?.text === "string") texts.push(content.text);
  if (!texts.length) throw new Error("MODEL_RESPONSE_TEXT_MISSING");
  return texts.join("\n");
}

export async function loadSkillBundle(projectRoot, version) {
  const root = path.join(projectRoot, "runtime", "skill-bundles", version);
  const manifestBytes = await readFile(path.join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.bundle_version !== version || manifest.schema_version !== "niannian_server_skill_bundle_v1" || manifest.runtime_kind !== "image_redraw" || manifest.plan_schema !== PLAN_SCHEMA_VERSION || manifest.qa_schema !== QA_SCHEMA_VERSION || JSON.stringify(manifest.subject_modes) !== JSON.stringify([...SUBJECT_MODES])) throw new Error("SKILL_BUNDLE_IDENTITY_INVALID");
  const instructions = [];
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(root, ...file.path.split("/")));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`SKILL_BUNDLE_FILE_HASH_MISMATCH:${file.path}`);
    if (file.path.endsWith("SKILL.md")) instructions.push(bytes.toString("utf8"));
  }
  return { manifest, manifestSha256: sha256(manifestBytes), instructions };
}

function modelEndpoint() {
  const base = String(process.env.NIANNIAN_GPT_API_BASE_URL || "").replace(/\/+$/, "");
  const requestPath = process.env.NIANNIAN_GPT_RESPONSES_PATH || "/responses";
  if (!base.startsWith("https://") || !requestPath.startsWith("/") || requestPath.includes("..")) throw new Error("MCGROX_PROFILE_NOT_CONFIGURED");
  return `${base}${requestPath}`;
}

async function callResponses(body) {
  const key = process.env.NIANNIAN_GPT_API_KEY;
  if (!key) throw new Error("MCGROX_CREDENTIAL_NOT_CONFIGURED");
  const response = await fetch(modelEndpoint(), { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.NIANNIAN_GPT_TIMEOUT_MS || 120000)) });
  if (!response.ok) throw new Error(`MCGROX_RESPONSES_HTTP_${response.status}`);
  return response.json();
}

export async function createRedrawPlan({ bundle, requirements, sourceAssetId, referenceAssetIds }) {
  const response = await callResponses({
    model: process.env.NIANNIAN_GPT56_MODEL || "gpt-5.6",
    store: false,
    instructions: [
      "你是念念AI服务器转绘规划器。只输出一个严格JSON对象，不调用工具，不输出Markdown。",
      "禁止本地像素编辑。必须根据 subject_mode 保持被保护主体的身份、结构、关键特征和已验证文字；仅 product mode 额外要求保持商品、包装和标识。",
      ...bundle.instructions,
    ].join("\n\n"),
    input: JSON.stringify({ action: "image_redraw", source_asset_id: sourceAssetId, reference_asset_ids: referenceAssetIds, requirements }),
    text: { format: { type: "json_schema", name: "image_redraw_plan_v2", strict: true, schema: redrawPlanJsonSchema() } },
  });
  return validatePlan(parseJsonObject(extractResponseText(response)), [sourceAssetId, ...referenceAssetIds]);
}

function dataUrl(bytes, mimeType) { return `data:${mimeType};base64,${bytes.toString("base64")}`; }

export async function runVisualQa({ bundle, sourceBytes, sourceMime, outputBytes, outputMime, plan }) {
  const response = await callResponses({
    model: process.env.NIANNIAN_GPT56_MODEL || "gpt-5.6",
    store: false,
    instructions: "你是念念AI独立视觉QA。对比原图与结果图，只输出严格JSON。不得因生成成功而默认通过。",
    input: [{ role: "user", content: [
      { type: "input_text", text: JSON.stringify({ plan, qa_schema: QA_SCHEMA_VERSION, required: ["subject_mode", "subject_identity_preserved", "composition_passed", "text_drift_detected", "quality_passed", "evidence", "retry_instruction"] }) },
      { type: "input_image", image_url: dataUrl(sourceBytes, sourceMime) },
      { type: "input_image", image_url: dataUrl(outputBytes, outputMime) },
    ] }],
    text: { format: { type: "json_schema", name: "image_redraw_visual_qa_v2", strict: true, schema: visualQaJsonSchema() } },
  });
  return validateQa(parseJsonObject(extractResponseText(response)));
}

function runningHubBase() { return String(process.env.RUNNINGHUB_BASE_URL || "https://www.runninghub.cn").replace(/\/+$/, ""); }
async function runningHubFetch(pathname, options) {
  const key = process.env.RUNNINGHUB_API_KEY;
  if (!key) throw new Error("RUNNINGHUB_CREDENTIAL_NOT_CONFIGURED");
  const response = await fetch(`${runningHubBase()}${pathname}`, { ...options, headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(options.headers || {}) }, signal: AbortSignal.timeout(Number(process.env.RUNNINGHUB_REQUEST_TIMEOUT_MS || 120000)) });
  if (!response.ok) throw new Error(`RUNNINGHUB_HTTP_${response.status}`);
  return response.json();
}

export async function uploadRunningHubMedia(bytes, name, mimeType) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: mimeType }), name);
  const response = await runningHubFetch("/openapi/v2/media/upload/binary", { method: "POST", body: form });
  const data = response.data || {};
  const url = response.download_url || response.downloadUrl || response.url || data.download_url || data.downloadUrl || data.url;
  if (typeof url !== "string" || !url.startsWith("http")) throw new Error("RUNNINGHUB_UPLOAD_URL_MISSING");
  return url;
}

export async function submitRunningHub({ prompt, imageUrls, aspectRatio, transactionKey }) {
  const response = await runningHubFetch("/openapi/v2/rhart-image-g-2/image-to-image", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": transactionKey }, body: JSON.stringify({ prompt, imageUrls, aspectRatio, resolution: "4k", request_id: transactionKey }) });
  const taskId = response.taskId || response.task_id || response.id || response.data?.taskId || response.data?.task_id || response.data?.id;
  if (!taskId) throw new Error("RUNNINGHUB_TASK_ID_MISSING");
  return String(taskId);
}

function imageUrls(value, found = []) {
  if (typeof value === "string" && /^https?:\/\//.test(value) && /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(value)) found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => imageUrls(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => imageUrls(item, found));
  return [...new Set(found)];
}

export function hasRunningHubFailure(value) {
  if (value == null || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasRunningHubFailure);
  if (typeof value === "object") return Object.values(value).some(hasRunningHubFailure);
  return true;
}

export async function pollRunningHub(taskId) {
  const deadline = Date.now() + Number(process.env.RUNNINGHUB_POLL_TIMEOUT_MS || 900000);
  while (Date.now() < deadline) {
    const response = await runningHubFetch("/openapi/v2/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId }) });
    const urls = imageUrls(response);
    if (urls.length) return urls[0];
    const status = String(response.status || response.taskStatus || response.data?.status || "").toLowerCase();
    if (["failed", "failure", "error", "rejected", "cancelled", "canceled"].includes(status) || hasRunningHubFailure(response.failedReason)) throw new Error(`RUNNINGHUB_TASK_${status || "FAILED"}`);
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.RUNNINGHUB_POLL_MS || 5000)));
  }
  throw new Error("RUNNINGHUB_TASK_TIMEOUT");
}

export async function downloadImage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`PROVIDER_OUTPUT_DOWNLOAD_HTTP_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const mimeType = String(response.headers.get("content-type") || "image/png").split(";")[0];
  if (!mimeType.startsWith("image/") || bytes.length < 1000 || bytes.length > 30 * 1024 * 1024) throw new Error("PROVIDER_OUTPUT_MEDIA_INVALID");
  return { bytes, mimeType };
}
