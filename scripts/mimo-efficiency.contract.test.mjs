import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  MIMO_DOWNSTREAM_RECOVERY_WINDOW_MS,
  compatibleEtaSeconds,
  enforceMimoProviderCostMaximum,
  executionStageStartedAt,
  mimoDownstreamRecoveryState,
  mimoProviderCostContract,
  publicTaskExecutionStage,
} from "../lib/video-task-execution-stage.ts";

const root = path.resolve(import.meta.dirname, "..");
const source = (...parts) => readFile(path.join(root, ...parts), "utf8");
const exactInput = { generationType: "image_to_video", durationSeconds: 4, resolution: "720P", model: "Seedance 2.0" };

test("AC-R01 exact benchmark contract is 8/8 and every other combination is unavailable", async () => {
  assert.deepEqual(mimoProviderCostContract(exactInput), {
    generationType: "image_to_video", durationSeconds: 4, currency: "Mimo credits", expectedCost: 8, maximumCost: 8,
    evidence: "benchmark_20260728_image_to_video_4s_720p_seedance_2_0",
  });
  for (const input of [
    { ...exactInput, generationType: "text_to_video" },
    { ...exactInput, durationSeconds: 5 },
    { ...exactInput, resolution: "1080P" },
    { ...exactInput, model: "Seedance 1.5" },
  ]) assert.equal(mimoProviderCostContract(input), null);
  const execution = await source("lib", "video-task-execution-stage.ts");
  const worker = await source("lib", "mimo-windows-worker.ts");
  assert.doesNotMatch(execution, /creditsPerSecond|unitCreditsPerSecond|durationSeconds\s*\*/);
  assert.match(worker, /spec\.generation_type === "image_to_video"/);
  assert.match(worker, /task\.duration_seconds === 4/);
  assert.match(worker, /task\.resolution\.toUpperCase\(\) === "720P"/);
  assert.match(worker, /task\.model\.trim\(\) === "Seedance 2\.0"/);
});

test("AC-R02 missing and excessive visible cost both stop before Generate", async () => {
  assert.deepEqual(enforceMimoProviderCostMaximum(null, 8), { allowed: false, blocker: "MIMO_PROVIDER_COST_ESTIMATE_UNAVAILABLE" });
  assert.deepEqual(enforceMimoProviderCostMaximum(9, 8), { allowed: false, blocker: "MIMO_PROVIDER_COST_ESTIMATE_EXCEEDS_MAXIMUM" });
  assert.deepEqual(enforceMimoProviderCostMaximum(8, 8), { allowed: true, blocker: null });
  const [submitter, agent] = await Promise.all([source("windows-mimo-agent", "mimo-chrome-cdp-submit.mjs"), source("scripts", "niannian-windows-mimo-agent.mjs")]);
  const beforeGenerate = submitter.slice(0, submitter.indexOf("Generate"));
  assert.match(beforeGenerate, /MIMO_PROVIDER_COST_ESTIMATE_UNAVAILABLE/);
  assert.match(beforeGenerate, /MIMO_PROVIDER_COST_ESTIMATE_EXCEEDS_MAXIMUM/);
  assert.match(agent, /if \(!providerTaskId\) \{/);
});

test("AC-R03 customer projections omit server evidence and upload SHA", async () => {
  const tasks = await source("lib", "video-tasks.ts");
  const reusable = tasks.slice(tasks.indexOf("export async function listReusableImageAssets"), tasks.indexOf("async function ownedReusableImage"));
  const uploadReturn = tasks.slice(tasks.indexOf("export async function saveUploadedAsset"), tasks.indexOf("async function loadAssets"));
  const projection = tasks.slice(tasks.indexOf("export async function publicVideoTask"));
  const publicReturn = projection.slice(projection.indexOf("return {"));
  for (const text of [reusable, uploadReturn, projection]) assert.doesNotMatch(text, /sha256:\s*(?:asset|record|task)\./);
  assert.doesNotMatch(publicReturn, /providerTaskId:\s*task\.|provider_cost|balance_before|balance_after|local_path|task_spec_path/);
  assert.match(tasks, /prompt_sha256: promptSha256/);
  assert.match(tasks, /sha256: asset\.sha256/);
});

test("AC-R04 submit receipt and later progress are distinct events", async () => {
  const agent = await source("scripts", "niannian-windows-mimo-agent.mjs");
  const submitBlock = agent.slice(agent.indexOf("if (!providerTaskId) {"), agent.indexOf("for (let cycle = 1"));
  const syncBlock = agent.slice(agent.indexOf("for (let cycle = 1"), agent.indexOf("MIMO_SYNC_WINDOW_EXHAUSTED"));
  assert.match(submitBlock, /provider_receipt_observed/);
  assert.doesNotMatch(submitBlock, /provider_progress_observed/);
  assert.match(syncBlock, /provider_progress_observed/);
  const worker = await source("lib", "mimo-windows-worker.ts");
  const eventWriter = worker.slice(worker.indexOf("async function addProgressEventOnce"), worker.indexOf("function nullableCost"));
  assert.match(eventWriter, /SELECT id, detail FROM video_task_events WHERE task_id = \? AND event = \?/);
  assert.match(eventWriter, /existingProviderTaskId !== providerTaskId/);
  const events = [{ event: "provider_progress_observed", createdAt: "2026-07-28T00:00:02Z" }, { event: "provider_receipt_observed", createdAt: "2026-07-28T00:00:01Z" }];
  assert.equal(executionStageStartedAt(events, "fallback"), "2026-07-28T00:00:02Z");
});

test("AC-R05 receipt-bound downstream recovery includes exactly 30 minutes and then expires", async () => {
  const now = Date.parse("2026-07-28T01:00:00.000Z");
  assert.equal(mimoDownstreamRecoveryState(new Date(now - MIMO_DOWNSTREAM_RECOVERY_WINDOW_MS + 1).toISOString(), now).eligible, true);
  assert.equal(mimoDownstreamRecoveryState(new Date(now - MIMO_DOWNSTREAM_RECOVERY_WINDOW_MS).toISOString(), now).eligible, true);
  assert.deepEqual(mimoDownstreamRecoveryState(new Date(now - MIMO_DOWNSTREAM_RECOVERY_WINDOW_MS - 1).toISOString(), now), {
    eligible: false, expired: true, blocker: "MIMO_PROVIDER_SYNC_RECOVERY_WINDOW_EXPIRED", ageMs: MIMO_DOWNSTREAM_RECOVERY_WINDOW_MS + 1,
  });
  const [worker, agent] = await Promise.all([source("lib", "mimo-windows-worker.ts"), source("scripts", "niannian-windows-mimo-agent.mjs")]);
  const recovery = worker.slice(worker.indexOf("async function claimReceiptRecoveryTask"), worker.indexOf("export async function recoverStaleMimoTasks"));
  assert.match(recovery, /provider_task_id IS NOT NULL/);
  assert.match(recovery, /reconciliation_only = true/);
  assert.doesNotMatch(recovery, /runHelper\(submitter|Generate|provider_task_id = NULL/);
  assert.ok(agent.indexOf("if (!providerTaskId) {") < agent.indexOf("for (let cycle = 1"));
});

test("AC-R06/R07 owner-only hide and reuse are non-destructive and use authenticated previews", async () => {
  const [tasks, route, home, migration] = await Promise.all([source("lib", "video-tasks.ts"), source("app", "api", "assets", "route.ts"), source("app", "home", "page.tsx"), source("deploy", "migrations", "20260728_asset_library_visibility.sql")]);
  assert.match(tasks, /WHERE id = \? AND user_id = \?/);
  assert.match(tasks, /INSERT INTO asset_library_visibility/);
  assert.doesNotMatch(tasks.slice(tasks.indexOf("export async function setOwnedReusableAssetHidden"), tasks.indexOf("function queueDirectory")), /DELETE/i);
  const migrationStatements = migration.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(migrationStatements, /(^|;)\s*(?:DELETE\s+FROM|DROP|TRUNCATE|ALTER)\b/i);
  assert.match(migrationStatements, /ON DELETE RESTRICT/i);
  assert.match(route, /getOwnedReusableAssetPreview\(user\.id, assetId\)/);
  assert.match(route, /setOwnedReusableAssetHidden\(user\.id, assetId, body\.hidden\)/);
  assert.match(home, /url: asset\.previewUrl/);
  assert.doesNotMatch(home, /src=\{["']{2}\}/);
  assert.match(home, /if \(asset\.assetId\) \{ assetIds\.push\(asset\.assetId\); continue; \}/);
});

test("AC-R08 pricing, cadence, delivery, historical QA, and ETA gates remain intact", async () => {
  const [credits, agent, worker] = await Promise.all([source("lib", "credits.ts"), source("scripts", "niannian-windows-mimo-agent.mjs"), source("lib", "mimo-windows-worker.ts")]);
  for (let duration = 4; duration <= 15; duration += 1) assert.match(credits, new RegExp(`\\b${duration}: ${duration * 4},`));
  assert.match(agent, /NIANNIAN_MIMO_CLAIM_POLL_MS[^\n]+5_000/);
  assert.match(agent, /NIANNIAN_MIMO_SYNC_POLL_MS \|\| 10_000/);
  for (const gate of ["probeVideoDuration", "MIMO_WINDOWS_LEDGER_JSON_INVALID", "uploadAndVerifyVideoDelivery", "VIDEO_COS_DELIVERY_REQUIRED"]) assert.match(worker, new RegExp(gate));
  assert.doesNotMatch(worker.slice(worker.indexOf("export async function claimMimoTask"), worker.indexOf("export async function writeMimoWorkerState")), /awaiting_content_qa/);
  const identity = { generationType: "image_to_video", durationSeconds: 4, resolution: "720P", channel: "mimo" };
  const sample = (elapsedSeconds) => ({ ...identity, elapsedSeconds });
  assert.equal(compatibleEtaSeconds(identity, [sample(1), sample(2), sample(3), sample(4)]), null);
  assert.equal(compatibleEtaSeconds(identity, [sample(1), sample(2), sample(3), sample(4), sample(5)]), 3);
  assert.match(publicTaskExecutionStage({ status: "completed", blocker: null, channel: "mimo", providerTaskId: "p" })?.detail ?? "", /自动交付/);
});

test("AC-R09 release identity and migration are included without secret material", async () => {
  const [config, build, audit] = await Promise.all([source("scripts", "release-candidate-config.mjs"), source("scripts", "build-release-candidate.mjs"), source("scripts", "release-candidate-audit.mjs")]);
  assert.match(config, /niannian-mimo-efficiency-20260728-rc1/);
  assert.match(config, /2026\.07\.28-mimo-efficiency-rc1/);
  assert.match(config, /1\.4\.13-windows-mimo\.3/);
  assert.match(build, /20260728_asset_library_visibility\.sql/);
  assert.match(audit, /20260728_asset_library_visibility\.sql/);
  assert.match(audit, /name\.startsWith\("\.env"\)/);
  assert.match(audit, /FORBIDDEN_RELEASE_ENTRY/);
  assert.match(config, /"runtime"/);
  assert.match(config, /"\.codex_tmp"/);
});
