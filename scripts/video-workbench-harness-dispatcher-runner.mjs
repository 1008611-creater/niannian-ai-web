import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkpointProductionTruth, dispatchCheckpointResume, nextExternalActionForProductionTruth, reconstructHarness } from "./video-workbench-harness-dispatcher.mjs";

const PACKET_TASK_ID = "NIANNIAN-WB-REAL-I2V-4S-20260728-01";
const PRODUCTION_TASK_ID = "aPh_FVncAV5fdhK3z8lCrCTv";
const OWNER_ACCOUNT = "liusb0713@qq.com";
const DERIVED_REFERENCE_SHA256 = "ad87a15f8ada8cc0da952d0e0cfe754e1f2d539deb9708d30cb3528c89767fee";
const LOCKED_PROMPT = "一名年轻男子在未来感便利店里拿起一瓶普通矿泉水，瓶盖打开瞬间，整个便利店像失重空间一样漂浮起来，零食和彩色包装缓慢环绕他旋转。他先惊讶地环顾四周，随后对镜头露出得意微笑，喝下一口水。电影感运镜，真实人物，动作自然，光影清晰，无文字，无水印。";
const LOCKED_PROMPT_SHA256 = createHash("sha256").update(LOCKED_PROMPT, "utf8").digest("hex");
const COMPLETED_LEGACY_BACKGROUND_WORK_ID = "controlled_mimo_preflight_cost_gate_candidate_deployment";

function fail(code) { throw new Error(code); }

function value(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 5_000 && parsed <= 300_000 ? parsed : fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function parseJson(value, code) {
  try { return JSON.parse(value); } catch { fail(code); }
}

function referencesFromSpec(spec) {
  return Array.isArray(spec.references) ? spec.references : [];
}

export function exactProductionBinding(packetSha256) {
  return {
    packet_task_id: PACKET_TASK_ID,
    packet_sha256: packetSha256,
    production_task_id: PRODUCTION_TASK_ID,
    owner_account: OWNER_ACCOUNT,
    locked_prompt_sha256: LOCKED_PROMPT_SHA256,
    derived_reference_sha256: DERIVED_REFERENCE_SHA256,
    duration_seconds: 4,
    aspect_ratio: "16:9",
    resolution: "720P",
    website_credit_reservation: 16,
  };
}

// This has no write capability. Its result deliberately excludes raw prompt,
// asset paths, cookies, connection strings, and provider credentials.
export function reconcileProductionRecord({ task, spec, creditLedger, events, workerState, observedAt }) {
  if (!task || task.id !== PRODUCTION_TASK_ID) fail("DISPATCHER_PRODUCTION_TASK_MISMATCH");
  if (task.owner_email !== OWNER_ACCOUNT) fail("DISPATCHER_PRODUCTION_OWNER_MISMATCH");
  if (createHash("sha256").update(String(task.prompt || ""), "utf8").digest("hex") !== LOCKED_PROMPT_SHA256) fail("DISPATCHER_PRODUCTION_PROMPT_MISMATCH");
  if (task.channel !== "mimo" || task.execution_mode !== "codex_skill") fail("DISPATCHER_PRODUCTION_ROUTE_MISMATCH");
  if (Number(task.duration_seconds) !== 4 || String(task.aspect_ratio) !== "16:9" || String(task.resolution).toUpperCase() !== "720P") fail("DISPATCHER_PRODUCTION_SPEC_MISMATCH");
  const references = referencesFromSpec(spec);
  if (references.length !== 1 || references[0]?.sha256 !== DERIVED_REFERENCE_SHA256) fail("DISPATCHER_PRODUCTION_REFERENCE_MISMATCH");
  if (String(spec.prompt_sha256 || "") !== LOCKED_PROMPT_SHA256 || String(spec.prompt || "") !== LOCKED_PROMPT) fail("DISPATCHER_PRODUCTION_TASK_SPEC_PROMPT_MISMATCH");
  const reservationEntries = (creditLedger ?? []).filter((entry) => entry.reason === "video_automatic_reservation");
  if (reservationEntries.length !== 1 || Number(reservationEntries[0].amount) !== -16) fail("DISPATCHER_PRODUCTION_CREDIT_RESERVATION_MISMATCH");
  const receiptEvent = (events ?? []).some((event) => event.event === "provider_receipt_observed");
  const providerTaskId = typeof task.provider_task_id === "string" && task.provider_task_id ? task.provider_task_id : null;
  if (receiptEvent && !providerTaskId) fail("DISPATCHER_RECEIPT_PROJECTION_MISMATCH");
  const workerActive = workerState?.activeTaskId === task.id && workerState?.status === "running";
  return {
    production_task_id: task.id,
    updated_at: String(task.updated_at),
    status: String(task.status),
    blocker: task.blocker ? String(task.blocker) : null,
    provider_task_id: providerTaskId,
    provider_receipt_present: receiptEvent || Boolean(providerTaskId),
    worker_state: workerActive ? "running" : workerState?.status === "blocked" ? "blocked" : "not_running",
    worker_id: workerActive ? String(workerState.workerId || "") : null,
    website_credit_reservation_count: reservationEntries.length,
    website_credit_reservation_amount: Number(reservationEntries[0].amount),
    locked_prompt_sha256: LOCKED_PROMPT_SHA256,
    derived_reference_sha256: DERIVED_REFERENCE_SHA256,
    observed_at: observedAt ?? new Date().toISOString(),
  };
}

async function readTaskSpecSafely(taskSpecPath, dataRoot) {
  const [root, candidate] = await Promise.all([realpath(dataRoot), realpath(taskSpecPath)]);
  if (!isInside(root, candidate)) fail("DISPATCHER_TASK_SPEC_OUTSIDE_DATA_ROOT");
  return parseJson(await readFile(candidate, "utf8"), "DISPATCHER_TASK_SPEC_JSON_INVALID");
}

export async function readWorkerStateSafely(workerStatePath, dataRoot) {
  if (!workerStatePath) return null;
  const [root, candidate] = await Promise.all([realpath(dataRoot), realpath(workerStatePath)]);
  if (!isInside(root, candidate)) fail("DISPATCHER_WORKER_STATE_OUTSIDE_DATA_ROOT");
  return parseJson(await readFile(candidate, "utf8"), "DISPATCHER_WORKER_STATE_JSON_INVALID");
}

async function productionReadback(databaseUrl, dataRoot, workerStatePath) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  try {
    const [taskResult, ledgerResult, eventsResult] = await Promise.all([
      client.query(`SELECT t.*, u.email AS owner_email FROM video_tasks t JOIN users u ON u.id = t.user_id WHERE t.id = $1 LIMIT 1`, [PRODUCTION_TASK_ID]),
      client.query(`SELECT amount, reason FROM credit_ledger WHERE task_id = $1 ORDER BY created_at ASC`, [PRODUCTION_TASK_ID]),
      client.query(`SELECT event FROM video_task_events WHERE task_id = $1 ORDER BY created_at ASC`, [PRODUCTION_TASK_ID]),
    ]);
    const task = taskResult.rows[0] ?? null;
    if (!task) fail("DISPATCHER_PRODUCTION_TASK_NOT_FOUND");
    const spec = await readTaskSpecSafely(task.task_spec_path, dataRoot);
    let workerState = null;
    if (workerStatePath) {
      try { workerState = await readWorkerStateSafely(workerStatePath, dataRoot); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return reconcileProductionRecord({ task, spec, creditLedger: ledgerResult.rows, events: eventsResult.rows, workerState, observedAt: new Date().toISOString() });
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

export function nextResumeAction({ claimResume }) {
  return claimResume ? "dispatch_checkpoint_resume" : "none";
}

export function userConfirmedNoSubmissionRecoveryEnabled(value) {
  return value === "true";
}

export function isBlockingBackgroundWork(item) {
  if (item?.state !== "active") return false;
  // This historical deployment record predates runtime handles and its release
  // was already completed. It must not keep the current task deferred forever.
  if (item.id === COMPLETED_LEGACY_BACKGROUND_WORK_ID
    && !item.runtime_handle
    && !item.runtimeHandle
    && !item.process_id
    && !item.pid
    && !item.job_id
    && !item.jobId) return false;
  return true;
}

export function hasActiveInternalWork(state) {
  return (state.child_work_items ?? []).some((item) => item.state === "active")
    || (state.background_work ?? []).some(isBlockingBackgroundWork);
}

export async function runOnce({ controllerId, harnessRoot, databaseUrl, dataRoot, workerStatePath, claimResume, userConfirmedNoSubmissionRecovery = false }) {
  if (!controllerId || !harnessRoot || !databaseUrl) fail("DISPATCHER_RUNTIME_CONFIG_MISSING");
  const initial = await reconstructHarness(harnessRoot);
  const item = initial.state.queue.find((entry) => entry.task_id === PACKET_TASK_ID);
  if (!item || initial.state.active_claim?.task_id !== PACKET_TASK_ID) fail("DISPATCHER_PARENT_CLAIM_MISSING");
  if (hasActiveInternalWork(initial.state)) {
    return { checkpoint: "deferred_active_internal_work", resume: "deferred", reconciliation: null };
  }
  const binding = exactProductionBinding(item.packet_sha256);
  const reconciliation = await productionReadback(databaseUrl, dataRoot, workerStatePath);
  const now = new Date();
  const nextCheckAt = new Date(now.getTime() + 30_000).toISOString();
  const checkpoint = await checkpointProductionTruth({
    harnessRoot, controllerId, expectedRevision: initial.revision, at: now.toISOString(),
    productionTaskBinding: binding, reconciliation, nextCheckAt,
    nextExternalAction: nextExternalActionForProductionTruth(reconciliation, { userConfirmedNoSubmissionRecovery }),
    userConfirmedNoSubmissionRecovery,
  });
  const result = { checkpoint: checkpoint.idempotent ? "idempotent" : "appended", reconciliation };
  if (nextResumeAction({ claimResume }) === "dispatch_checkpoint_resume") {
    // The append result is not a substitute for the authoritative pair of
    // ledger/state files. Reconstruct after every checkpoint before claiming.
    const current = await reconstructHarness(harnessRoot);
    const claimed = await dispatchCheckpointResume({ harnessRoot, controllerId, expectedRevision: current.revision, at: new Date().toISOString() });
    result.resume = claimed.idempotent ? "idempotent" : "claimed";
  }
  return result;
}

export async function runLoop(config) {
  const pollMilliseconds = positiveInteger(process.env.NIANNIAN_DISPATCHER_POLL_MS, 30_000);
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  while (!stopped) {
    try {
      const result = await runOnce(config);
      process.stdout.write(`${JSON.stringify({ mode: "run_loop", ...result })}\n`);
    } catch (error) {
      // A transient readback or lease race must not end the sole controller.
      // The next iteration re-reads the authoritative state before acting.
      process.stderr.write(`DISPATCHER_LOOP_RETRY:${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (!stopped) await sleep(pollMilliseconds);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const loop = args.includes("--run-loop");
  if (once === loop) fail("DISPATCHER_MODE_REQUIRED");
  const controllerId = value(args, "--controller-id");
  const harnessRoot = value(args, "--harness-root");
  const databaseUrl = process.env.NIANNIAN_DISPATCHER_READONLY_DATABASE_URL;
  const dataRoot = process.env.NIANNIAN_DISPATCHER_DATA_ROOT || path.join(process.cwd(), "data");
  const workerStatePath = process.env.NIANNIAN_DISPATCHER_WORKER_STATE_PATH || path.join(dataRoot, "mimo-windows-worker-state.json");
  const config = {
    controllerId, harnessRoot, databaseUrl, dataRoot, workerStatePath,
    claimResume: args.includes("--claim-resume"),
    userConfirmedNoSubmissionRecovery: userConfirmedNoSubmissionRecoveryEnabled(process.env.NIANNIAN_DISPATCHER_USER_CONFIRMED_NO_SUBMISSION_RECOVERY),
  };
  if (loop) {
    await runLoop(config);
    return;
  }
  const result = await runOnce(config);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
