import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = await readFile(path.join(root, "lib", "mimo-windows-worker.ts"), "utf8");
const config = source.slice(source.indexOf("const userConfirmedNoSubmissionRecoveryBinding"), source.indexOf("export function isExactIsolatedMimoLeaseRecovery"));
const predicate = source.slice(source.indexOf("export function isExactUserConfirmedNoSubmissionRecovery"), source.indexOf("function taskOutputs"));
const recovery = source.slice(source.indexOf("async function recoverConfiguredUserConfirmedNoSubmission"), source.indexOf("async function claimReceiptRecoveryTask"));
const preflightCost = source.slice(source.indexOf("async function recordConfiguredUserConfirmedNoSubmissionPreflightResult"), source.indexOf("export async function acceptMimoTaskResult"));
const preflightClaim = source.slice(source.indexOf("async function claimConfiguredUserConfirmedNoSubmissionPreflight"), source.indexOf("async function recoverExpiredMimoLease"));
const claim = source.slice(source.indexOf("export async function claimMimoTask"), source.indexOf("export async function writeMimoWorkerState"));

test("user-confirmed no-submission recovery is explicit, exact, and disabled by default", () => {
  assert.match(config, /MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_ENABLED !== "true"/);
  for (const binding of [
    "TASK_ID",
    "WORKER_ID",
    "OWNER_EMAIL",
    "DERIVED_REFERENCE_SHA256",
    "PACKET_SHA256",
    "DECISION",
  ]) assert.match(config, new RegExp(`MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_${binding}`));
  assert.match(config, /aPh_FVncAV5fdhK3z8lCrCTv/);
  assert.match(config, /windows-mimo-liulianggmUXHlg/);
  assert.match(config, /liusb0713@qq\.com/);
  assert.match(config, /ad87a15f8ada8cc0da952d0e0cfe754e1f2d539deb9708d30cb3528c89767fee/);
});

test("recovery requires the old blocked state, no receipt, and the exact derived input", () => {
  for (const predicatePart of [
    'input.task.status === "blocked"',
    'input.task.blocker === "mimo_submit_unknown"',
    "input.task.provider_task_id === null",
    "Number(input.task.submit_allowed) === 0",
    "Number(input.task.cost_authorized) === 1",
    'input.task.aspect_ratio === "16:9"',
    "input.receiptObserved === false",
    "hasExactDerivedRecoveryReference",
  ]) assert.match(predicate, new RegExp(predicatePart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(predicate, /input\.ownerEmail\.trim\(\)\.toLowerCase\(\) === input\.configured\.ownerEmail/);
});

test("recovery admits only the immutable preflight binding, while normal claim retains submit-cost enforcement", () => {
  for (const binding of [
    'input.task.model.trim() === "Seedance 2.0"',
    "input.task.duration_seconds === 4",
    'input.task.resolution.toUpperCase() === "720P"',
    'input.spec.generation_type === "image_to_video"',
    'input.spec.model === "Seedance 2.0"',
    "input.spec.duration_seconds === 4",
    'String(input.spec.resolution).toUpperCase() === "720P"',
  ]) assert.match(predicate, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(predicate, /exactSubmitCostAuthorized/);
  assert.match(claim, /exactSubmitCostAuthorized\(await readTaskSpec\(candidate\), candidate\)/);
});

test("missing or non-16:9 task-spec aspect ratio is a closed recovery rejection", () => {
  assert.match(predicate, /input\.spec\.aspect_ratio === "16:9"/);
  assert.ok(predicate.indexOf('input.spec.aspect_ratio === "16:9"') < predicate.indexOf('input.task.status === "blocked"'));
});

test("recovery computes and compares the bound immutable packet SHA before its CAS", () => {
  assert.match(config, /userConfirmedNoSubmissionPacketPath/);
  assert.match(predicate, /hasExactUserConfirmedNoSubmissionPacket/);
  assert.match(predicate, /createHash\("sha256"\)\.update\(packetBytes\)\.digest\("hex"\)/);
  assert.match(predicate, /packetSha256 !== config\.packetSha256/);
  assert.match(predicate, /packet\.task_id === "NIANNIAN-WB-REAL-I2V-4S-20260728-01"/);
  assert.match(predicate, /productionSpec\.aspect_ratio === "16:9"/);
  assert.match(predicate, /costGate\.authorized === true/);
  assert.match(predicate, /Number\(costGate\.maximum\) === 8/);
  assert.match(recovery, /if \(!await hasExactUserConfirmedNoSubmissionPacket\(config\)\) return null;/);
});

test("recovery performs one compare-and-set transition and cannot submit", () => {
  for (const sqlPart of [
    "JOIN users ON users.id = video_tasks.user_id",
    "LOWER(users.email)",
    "provider_task_id IS NULL",
    "submit_allowed = 0",
    "provider_receipt_observed",
    "updated_at = ?",
    '"approved_for_execution"',
    "mimo_user_confirmed_no_submission_recovered",
  ]) assert.match(recovery, new RegExp(sqlPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(recovery, /if \(priorRecovery\) return null;/);
  assert.doesNotMatch(recovery, /Generate|upload|credit_ledger|INSERT INTO video_tasks|provider_task_id =/);
  assert.match(claim, /recoverConfiguredUserConfirmedNoSubmission/);
  assert.match(claim, /return null;/);
});

test("only the exact recovered task can record visible preflight cost before the normal submit claim", () => {
  for (const binding of [
    'input.task.id !== config.taskId',
    'input.task.provider_task_id !== null',
    'channel.model !== "Seedance 2.0"',
    "channel.authenticated !== true",
    "channel.cdpAvailable !== true",
    "actualLiveEstimate > packetCostGate.maximum",
    "mimo_user_confirmed_no_submission_preflight_cost_recorded",
  ]) assert.match(preflightCost, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(preflightClaim, /status = \? AND video_tasks\.provider_task_id IS NULL/);
  assert.match(preflightClaim, /"approved_for_execution"/);
  assert.match(preflightClaim, /mimo_user_confirmed_no_submission_recovered/);
  assert.match(preflightClaim, /spec\.provider_cost !== undefined/);
  assert.match(preflightCost, /recovery: "preflight_only_no_upload_or_generate"/);
  assert.doesNotMatch(preflightCost, /Generate|credit_ledger|INSERT INTO video_tasks\s*\(/);
  assert.ok(claim.indexOf("const preflightOnlyTask") < claim.indexOf("const claimed = await dbTransaction"));
});

test("preflight evidence is required before the unchanged normal submit claim can run", () => {
  const normalClaim = claim.slice(claim.indexOf("const claimed = await dbTransaction"));
  assert.match(normalClaim, /exactSubmitCostAuthorized\(await readTaskSpec\(candidate\), candidate\)/);
  for (const costGate of [
    "Number(cost.live_estimate) <= 8",
    'typeof cost.observed_at === "string"',
    'cost.evidence === "benchmark_20260728_image_to_video_4s_720p_seedance_2_0"',
  ]) assert.match(source, new RegExp(costGate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
