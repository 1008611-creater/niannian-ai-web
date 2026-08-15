import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { exactProductionBinding, hasActiveInternalWork, nextResumeAction, reconcileProductionRecord, userConfirmedNoSubmissionRecoveryEnabled } from "./video-workbench-harness-dispatcher-runner.mjs";
import { nextExternalActionForProductionTruth, resumeNodeForProductionTruth } from "./video-workbench-harness-dispatcher.mjs";

const prompt = "一名年轻男子在未来感便利店里拿起一瓶普通矿泉水，瓶盖打开瞬间，整个便利店像失重空间一样漂浮起来，零食和彩色包装缓慢环绕他旋转。他先惊讶地环顾四周，随后对镜头露出得意微笑，喝下一口水。电影感运镜，真实人物，动作自然，光影清晰，无文字，无水印。";
const promptSha = "5cf55fb95b436768028c3e3e69745a17be8ee87759fbada8329fe6efe181e5af";
const derived = "ad87a15f8ada8cc0da952d0e0cfe754e1f2d539deb9708d30cb3528c89767fee";

function valid() {
  return {
    task: { id: "aPh_FVncAV5fdhK3z8lCrCTv", owner_email: "liusb0713@qq.com", prompt, channel: "mimo", execution_mode: "codex_skill", duration_seconds: 4, aspect_ratio: "16:9", resolution: "720P", status: "running", blocker: null, provider_task_id: null, updated_at: "2026-07-28T16:00:00.000Z" },
    spec: { prompt, prompt_sha256: promptSha, references: [{ sha256: derived }] },
    creditLedger: [{ reason: "video_automatic_reservation", amount: -16 }],
    events: [{ event: "mimo_worker_claimed" }],
    workerState: { workerId: "windows-mimo-liulianggmUXHlg", status: "running", activeTaskId: "aPh_FVncAV5fdhK3z8lCrCTv" },
  };
}

test("read-only reconciliation binds the formal sd2 task and schedules active worker observation", () => {
  const result = reconcileProductionRecord(valid());
  assert.equal(result.website_credit_reservation_amount, -16);
  assert.equal(result.provider_receipt_present, false);
  assert.equal(resumeNodeForProductionTruth(result), "observe_windows_worker_progress");
  const binding = exactProductionBinding("a3aa959e832535d191e4f5c9c184b7b8befb02d015f8e3ee1f2a1c09a90d8fe9");
  assert.equal(binding.packet_task_id, "NIANNIAN-WB-REAL-I2V-4S-20260728-01");
  assert.equal(binding.production_task_id, result.production_task_id);
});

test("read-only reconciliation rejects source/credit drift and receipt remains sync-only", () => {
  const wrongReference = valid();
  wrongReference.spec.references[0].sha256 = "0".repeat(64);
  assert.throws(() => reconcileProductionRecord(wrongReference), /DISPATCHER_PRODUCTION_REFERENCE_MISMATCH/);
  const duplicateCharge = valid();
  duplicateCharge.creditLedger.push({ reason: "video_automatic_reservation", amount: -16 });
  assert.throws(() => reconcileProductionRecord(duplicateCharge), /DISPATCHER_PRODUCTION_CREDIT_RESERVATION_MISMATCH/);
  const receipt = valid();
  receipt.task.provider_task_id = "provider-one";
  receipt.events.push({ event: "provider_receipt_observed" });
  assert.equal(resumeNodeForProductionTruth(reconcileProductionRecord(receipt)), "sync_only_provider_delivery");
});

test("user-confirmed no-submission recovery maps the same blocked task to one explicit no-cost recovery action", () => {
  const blocked = valid();
  blocked.task.status = "blocked";
  blocked.task.blocker = "mimo_submit_unknown";
  blocked.workerState = { workerId: "windows-mimo-liulianggmUXHlg", status: "idle", activeTaskId: null };
  const reconciliation = reconcileProductionRecord(blocked);
  assert.equal(resumeNodeForProductionTruth(reconciliation), "production_task_reconciliation_required");
  assert.equal(resumeNodeForProductionTruth(reconciliation, { userConfirmedNoSubmissionRecovery: true }), "recover_user_confirmed_same_task_no_cost_preflight");
  assert.equal(nextExternalActionForProductionTruth(reconciliation, { userConfirmedNoSubmissionRecovery: true }), "recover_existing_task_then_no_cost_preflight");
  assert.equal(userConfirmedNoSubmissionRecoveryEnabled("true"), true);
  assert.equal(userConfirmedNoSubmissionRecoveryEnabled("false"), false);
});

test("an existing checkpoint still resumes the same node when the persistent controller restarts", () => {
  assert.equal(nextResumeAction({ claimResume: true }), "dispatch_checkpoint_resume");
  assert.equal(nextResumeAction({ claimResume: false }), "none");
});

test("the dispatcher does not overwrite an active child work item's resume node", () => {
  assert.equal(hasActiveInternalWork({ child_work_items: [{ id: "acceptance", state: "active" }], background_work: [] }), true);
  assert.equal(hasActiveInternalWork({ child_work_items: [{ id: "acceptance", state: "completed" }], background_work: [] }), false);
});

test("the completed legacy deployment record without a runtime handle cannot defer the dispatcher", () => {
  const legacyDeployment = { id: "controlled_mimo_preflight_cost_gate_candidate_deployment", state: "active" };
  assert.equal(hasActiveInternalWork({ child_work_items: [], background_work: [legacyDeployment] }), false);
  assert.equal(hasActiveInternalWork({ child_work_items: [], background_work: [{ ...legacyDeployment, runtime_handle: "still-running" }] }), true);
  assert.equal(hasActiveInternalWork({ child_work_items: [], background_work: [{ id: "other-background-work", state: "active" }] }), true);
});

test("persistent dispatcher service restarts the same controller loop instead of a one-shot command", async () => {
  const service = await readFile(path.resolve(import.meta.dirname, "..", "deploy", "niannian-video-workbench-dispatcher.service"), "utf8");
  assert.match(service, /--run-loop --claim-resume/);
  assert.match(service, /Restart=always/);
  assert.doesNotMatch(service, /--once/);
});
