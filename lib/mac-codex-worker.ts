import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId, dbOne, dbRun, dbTransaction, timestamp } from "@/lib/auth";
import { isPathInside, probeVideoDuration } from "@/lib/video-output-gate.mjs";
import type { VideoTaskRecord } from "@/lib/video-tasks";
import { releaseIdentity } from "@/lib/release-version";

const dataRoot = path.join(process.cwd(), "data");
const statePath = path.join(dataRoot, "mac-codex-worker-state.json");
const MAX_RESULT_BYTES = 500 * 1024 * 1024;
const MAX_LEDGER_BYTES = 1024 * 1024;
const resultExtensions = new Set([".mp4", ".mov", ".webm", ".mkv"]);

type AssetRow = {
  id: string;
  user_id: string;
  role: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  local_path: string;
};

type TaskSpec = Record<string, unknown> & {
  references?: Array<Record<string, unknown>>;
  output_paths?: Record<string, unknown>;
};

export type MacWorkerState = {
  workerId: string;
  status: "idle" | "claiming" | "running" | "blocked";
  heartbeatAt: string;
  activeTaskId: string | null;
  summary: string | null;
  version: string | null;
  readiness: MacWorkerReadiness | null;
};

export type MacWorkerReadiness = {
  schemaVersion: 1;
  checkedAt: string;
  readyToClaim: boolean;
  blocker: string | null;
  computer: {
    hostname: string;
    platform: string;
    arch: string;
    workspaceWritable: boolean;
    ffprobeAvailable: boolean;
  };
  skills: {
    state: "ready" | "blocked";
    bundleName: string | null;
    bundleVersion: string | null;
    skills: number | null;
    blocker: string | null;
  };
  channel: {
    id: "mimo";
    state: "ready" | "credentials_missing" | "configuration_invalid" | "authentication_failed" | "unreachable";
    checkedAt: string;
    reachable: boolean | null;
    authenticated: boolean | null;
    credits: string | null;
    model: string;
    blocker: string | null;
  };
};

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeWorkerId(value: unknown) {
  const workerId = cleanText(value, 80);
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(workerId)) throw new Error("MAC_WORKER_ID_INVALID");
  return workerId;
}

function validTimestamp(value: unknown) {
  const text = cleanText(value, 80);
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error("MAC_WORKER_READINESS_TIMESTAMP_INVALID");
  return text;
}

function nullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function sanitizeReadiness(value: unknown): MacWorkerReadiness {
  if (!value || typeof value !== "object") throw new Error("MAC_WORKER_READINESS_INVALID");
  const input = value as Record<string, unknown>;
  const computer = input.computer && typeof input.computer === "object" ? input.computer as Record<string, unknown> : {};
  const skills = input.skills && typeof input.skills === "object" ? input.skills as Record<string, unknown> : {};
  const channel = input.channel && typeof input.channel === "object" ? input.channel as Record<string, unknown> : {};
  const skillState = skills.state === "ready" ? "ready" : "blocked";
  const channelStates = new Set(["ready", "credentials_missing", "configuration_invalid", "authentication_failed", "unreachable"]);
  const channelState = channelStates.has(String(channel.state)) ? channel.state as MacWorkerReadiness["channel"]["state"] : "configuration_invalid";
  const readyToClaim = input.readyToClaim === true;
  if (readyToClaim && (skillState !== "ready" || channelState !== "ready" || computer.workspaceWritable !== true || computer.ffprobeAvailable !== true)) {
    throw new Error("MAC_WORKER_READINESS_CONTRADICTORY");
  }
  return {
    schemaVersion: 1,
    checkedAt: validTimestamp(input.checkedAt),
    readyToClaim,
    blocker: cleanText(input.blocker, 240) || null,
    computer: {
      hostname: cleanText(computer.hostname, 120),
      platform: cleanText(computer.platform, 40),
      arch: cleanText(computer.arch, 40),
      workspaceWritable: computer.workspaceWritable === true,
      ffprobeAvailable: computer.ffprobeAvailable === true,
    },
    skills: {
      state: skillState,
      bundleName: cleanText(skills.bundleName, 120) || null,
      bundleVersion: cleanText(skills.bundleVersion, 40) || null,
      skills: Number.isInteger(skills.skills) && Number(skills.skills) >= 0 && Number(skills.skills) <= 1000 ? Number(skills.skills) : null,
      blocker: cleanText(skills.blocker, 240) || null,
    },
    channel: {
      id: "mimo",
      state: channelState,
      checkedAt: validTimestamp(channel.checkedAt),
      reachable: nullableBoolean(channel.reachable),
      authenticated: nullableBoolean(channel.authenticated),
      credits: cleanText(channel.credits, 80) || null,
      model: cleanText(channel.model, 120) || "Seedance 2.0",
      blocker: cleanText(channel.blocker, 240) || null,
    },
  };
}

function readinessTtlMs() {
  const seconds = Number(process.env.MAC_CODEX_READINESS_TTL_SECONDS ?? 180);
  return (Number.isFinite(seconds) ? Math.min(Math.max(Math.floor(seconds), 60), 900) : 180) * 1000;
}

function configuredToken() {
  const token = process.env.MAC_CODEX_AGENT_TOKEN?.trim();
  if (!token || token.length < 24) throw new Error("MAC_WORKER_NOT_CONFIGURED");
  return token;
}

export function authorizeMacWorker(authorizationHeader: string | null) {
  const token = configuredToken();
  const provided = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const expectedBytes = Buffer.from(token);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

async function atomicJson(target: string, value: unknown) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function leaseSeconds() {
  const seconds = Number(process.env.MAC_CODEX_LEASE_SECONDS ?? 20 * 60);
  return Number.isFinite(seconds) ? Math.min(Math.max(Math.floor(seconds), 120), 4 * 60 * 60) : 20 * 60;
}

function taskOutputs(taskId: string) {
  const root = path.join(dataRoot, "video-outputs", taskId);
  return {
    root,
    downloads: path.join(root, "downloads"),
    ledger: path.join(root, "ledger"),
  };
}

async function taskById(taskId: string) {
  return dbOne<VideoTaskRecord>("SELECT * FROM video_tasks WHERE id = ? LIMIT 1", [taskId]);
}

async function readTaskSpec(task: VideoTaskRecord) {
  const resolved = path.resolve(task.task_spec_path);
  const root = path.resolve(dataRoot);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("TASK_SPEC_OUTSIDE_DATA_DIRECTORY");
  return JSON.parse(await readFile(resolved, "utf8")) as TaskSpec;
}

async function mutateTaskSpec(task: VideoTaskRecord, mutate: (spec: TaskSpec) => void | Promise<void>) {
  const spec = await readTaskSpec(task);
  await mutate(spec);
  await atomicJson(task.task_spec_path, spec);
}

async function addEvent(taskId: string, event: string, detail: Record<string, unknown>) {
  await dbRun(
    "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    [createId(), taskId, event, JSON.stringify(detail), timestamp()],
  );
}

function referencePayload(reference: Record<string, unknown>, taskId: string) {
  const assetId = typeof reference.asset_id === "string" ? reference.asset_id : "";
  if (!assetId) throw new Error("TASK_REFERENCE_ASSET_MISSING");
  return {
    assetId,
    refKey: String(reference.ref_key ?? `asset_${assetId}`),
    sha256: String(reference.sha256 ?? ""),
    role: String(reference.role ?? ""),
    duty: String(reference.chinese_duty ?? ""),
    referenceType: String(reference.reference_type ?? ""),
    referenceIntent: String(reference.reference_intent ?? ""),
    isPrimary: reference.is_primary === true,
    sortOrder: Number(reference.sort_order ?? 0),
    userConfirmation: String(reference.user_confirmation ?? ""),
    actualVideoInput: reference.actual_video_input !== false,
    uploadEligible: reference.upload_eligible === true,
    downloadPath: `/api/internal/mac-codex/tasks/${taskId}/assets/${assetId}`,
  };
}

async function taskPayload(task: VideoTaskRecord, workerId: string) {
  const spec = await readTaskSpec(task);
  const rawReferences = Array.isArray(spec.references) ? spec.references : [];
  const references = rawReferences.map((reference) => referencePayload(reference, task.id));
  if (!references.length) throw new Error("TASK_REFERENCES_MISSING");
  const generationType = spec.generation_type === "image_to_video" || spec.generation_type === "action_transfer" || spec.generation_type === "reference_guided_video"
    ? spec.generation_type
    : rawReferences.some((reference) => reference.role === "support_asset_ref" || reference.chinese_duty === "动作参考视频")
      ? "action_transfer"
      : "image_to_video";
  return {
    id: task.id,
    workerId,
    leaseExpiresAt: new Date(Date.now() + leaseSeconds() * 1000).toISOString(),
    prompt: String(spec.prompt ?? task.prompt),
    promptSha256: String(spec.prompt_sha256 ?? ""),
    generationType,
    generation_type: generationType,
    model: String(spec.model ?? task.model),
    durationSeconds: task.duration_seconds,
    aspectRatio: task.aspect_ratio,
    resolution: task.resolution,
    channel: task.channel,
    providerTaskId: task.provider_task_id,
    reconciliationOnly: spec.reconciliation_only === true,
    reconciliation_only: spec.reconciliation_only === true,
    allowedChannels: Array.isArray(spec.allowed_channels) ? spec.allowed_channels.map(String) : [],
    allowed_channels: Array.isArray(spec.allowed_channels) ? spec.allowed_channels.map(String) : [],
    costGate: spec.cost_gate ?? null,
    cost_gate: spec.cost_gate ?? null,
    submit_allowed: spec.submit_allowed === true,
    references,
    channelReferencePlan: spec.channel_reference_plan ?? null,
    channel_reference_plan: spec.channel_reference_plan ?? null,
    outputContract: {
      status: "report completed only after a downloaded media file and JSON ledger exist locally; the server will probe the media and leave final delivery for admin content QA.",
      reportPath: "/api/internal/mac-codex/tasks/:id/result",
    },
  };
}

async function recoverExpiredMacLease() {
  const staleBefore = new Date(Date.now() - leaseSeconds() * 1000).toISOString();
  const now = timestamp();
  const staleTasks = await dbTransaction(async (transaction) => {
    const rows = await transaction.all<{ id: string }>(
      "SELECT id FROM video_tasks WHERE execution_mode = ? AND status = ? AND updated_at < ?",
      ["mac_codex", "running_on_mac", staleBefore],
    );
    if (!rows.length) return [];
    await transaction.run(
      "UPDATE video_tasks SET status = ?, blocker = ?, updated_at = ? WHERE execution_mode = ? AND status = ? AND updated_at < ?",
      ["approved_for_execution", "mac_worker_lease_expired", now, "mac_codex", "running_on_mac", staleBefore],
    );
    return rows.map((row) => row.id);
  });
  await Promise.all(staleTasks.map((taskId) => addEvent(taskId, "mac_worker_lease_expired", {})));
}

// The parent loop invokes this through claim. It replaces manual database
// resets for a stale running_on_mac lease.
export async function recoverStaleMacTasks() {
  await recoverExpiredMacLease();
}

export async function claimMacTask(workerIdInput: unknown) {
  const workerId = safeWorkerId(workerIdInput);
  const workerState = await readMacWorkerState();
  const readiness = workerState?.readiness;
  const readinessAge = readiness ? Date.now() - Date.parse(readiness.checkedAt) : Number.POSITIVE_INFINITY;
  if (!workerState || workerState.workerId !== workerId || !readiness?.readyToClaim || readinessAge < 0 || readinessAge > readinessTtlMs()) {
    throw new Error("MAC_WORKER_NOT_READY");
  }
  await recoverExpiredMacLease();
  const claimed = await dbTransaction(async (transaction) => {
    const task = await transaction.one<VideoTaskRecord>(
      `SELECT * FROM video_tasks
       WHERE execution_mode = ? AND submit_allowed = 1 AND cost_authorized = 1 AND status = ?
       ORDER BY updated_at ASC LIMIT 1`,
      ["mac_codex", "approved_for_execution"],
    );
    if (!task) return null;
    const updatedAt = timestamp();
    const changed = await transaction.run(
      "UPDATE video_tasks SET status = ?, blocker = NULL, updated_at = ? WHERE id = ? AND status = ?",
      ["running_on_mac", updatedAt, task.id, "approved_for_execution"],
    );
    if (changed !== 1) return null;
    await transaction.run(
      "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      [createId(), task.id, "mac_worker_claimed", JSON.stringify({ workerId, leaseSeconds: leaseSeconds() }), updatedAt],
    );
    return { ...task, status: "running_on_mac", blocker: null, updated_at: updatedAt };
  });
  await writeMacWorkerState({ workerId, status: claimed ? "running" : "idle", activeTaskId: claimed?.id ?? null, summary: claimed ? "task claimed" : "no eligible task" });
  return claimed ? taskPayload(claimed, workerId) : null;
}

export async function writeMacWorkerState(input: {
  workerId: unknown;
  status: unknown;
  activeTaskId?: unknown;
  summary?: unknown;
  version?: unknown;
  readiness?: unknown;
}) {
  const workerId = safeWorkerId(input.workerId);
  const status = input.status;
  if (status !== "idle" && status !== "claiming" && status !== "running" && status !== "blocked") {
    throw new Error("MAC_WORKER_STATUS_INVALID");
  }
  const activeTaskId = typeof input.activeTaskId === "string" && input.activeTaskId.length <= 100 ? input.activeTaskId : null;
  if (activeTaskId) {
    const task = await taskById(activeTaskId);
    if (!task || task.execution_mode !== "mac_codex" || task.status !== "running_on_mac") throw new Error("MAC_WORKER_TASK_NOT_ACTIVE");
    await dbRun("UPDATE video_tasks SET updated_at = ? WHERE id = ? AND status = ?", [timestamp(), task.id, "running_on_mac"]);
  }
  const existing = await readMacWorkerState();
  const state: MacWorkerState = {
    workerId,
    status,
    heartbeatAt: timestamp(),
    activeTaskId,
    summary: cleanText(input.summary, 1000) || null,
    version: cleanText(input.version, 80) || existing?.version || null,
    readiness: input.readiness === undefined ? existing?.readiness || null : sanitizeReadiness(input.readiness),
  };
  await atomicJson(statePath, state);
  return state;
}

export async function readMacWorkerState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as MacWorkerState;
  } catch {
    return null;
  }
}

type CountRow = { count: number | string };

async function taskCount(where: string, values: Array<string | number> = []) {
  const row = await dbOne<CountRow>(`SELECT COUNT(*) AS count FROM video_tasks WHERE ${where}`, values);
  return Number(row?.count ?? 0);
}

export async function readMacWorkerDiagnostics() {
  const staleBefore = new Date(Date.now() - leaseSeconds() * 1000).toISOString();
  const [queuedMac, approvedForExecution, runningOnMac, staleRunningOnMac] = await Promise.all([
    taskCount("execution_mode = ? AND status = ?", ["mac_codex", "queued_mac"]),
    taskCount("execution_mode = ? AND status = ?", ["mac_codex", "approved_for_execution"]),
    taskCount("execution_mode = ? AND status = ?", ["mac_codex", "running_on_mac"]),
    taskCount("execution_mode = ? AND status = ? AND updated_at < ?", ["mac_codex", "running_on_mac", staleBefore]),
  ]);
  return {
    release: releaseIdentity,
    leaseSeconds: leaseSeconds(),
    queue: { queuedMac, approvedForExecution, runningOnMac, staleRunningOnMac },
    recoveryPolicy: {
      strategy: "parent_claim_auto_recovery",
      staleStatus: "running_on_mac",
      recoveredStatus: "approved_for_execution",
      event: "mac_worker_lease_expired",
      mutatesOnStatusRead: false,
    },
  };
}

export async function getMacTaskAsset(taskId: string, assetId: string) {
  const task = await taskById(taskId);
  if (!task || task.execution_mode !== "mac_codex" || task.status !== "running_on_mac") throw new Error("MAC_TASK_NOT_ACTIVE");
  const manifest = JSON.parse(task.asset_manifest) as Array<{ id?: unknown }>;
  if (!manifest.some((asset) => asset.id === assetId)) throw new Error("MAC_TASK_ASSET_NOT_ALLOWED");
  const asset = await dbOne<AssetRow>("SELECT * FROM uploaded_assets WHERE id = ? AND user_id = ? LIMIT 1", [assetId, task.user_id]);
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  const assetRoot = path.join(dataRoot, "video-assets", task.user_id);
  if (!isPathInside(assetRoot, asset.local_path)) throw new Error("ASSET_PATH_INVALID");
  const file = await readFile(asset.local_path);
  if (createHash("sha256").update(file).digest("hex") !== asset.sha256) throw new Error("ASSET_HASH_MISMATCH");
  return { file, mimeType: asset.mime_type, name: asset.original_name, sha256: asset.sha256 };
}

function safeResultFilename(name: string) {
  const extension = path.extname(name).toLowerCase();
  if (!resultExtensions.has(extension)) throw new Error("MAC_RESULT_FORMAT_INVALID");
  return `mac-codex-${Date.now()}${extension}`;
}

function resultStatus(value: unknown) {
  if (value === "running" || value === "completed" || value === "blocked") return value;
  throw new Error("MAC_RESULT_STATUS_INVALID");
}

async function assertActiveMacTask(taskId: string) {
  const task = await taskById(taskId);
  if (!task || task.execution_mode !== "mac_codex") throw new Error("MAC_TASK_NOT_FOUND");
  if (task.status !== "running_on_mac") throw new Error("MAC_TASK_NOT_ACTIVE");
  return task;
}

export async function acceptMacTaskResult(input: {
  taskId: string;
  status: unknown;
  providerTaskId?: unknown;
  summary?: unknown;
  blocker?: unknown;
  output?: File | null;
  ledger?: File | null;
}) {
  const task = await assertActiveMacTask(input.taskId);
  const status = resultStatus(input.status);
  const providerTaskId = cleanText(input.providerTaskId, 240) || null;
  const summary = cleanText(input.summary, 2000) || "Mac Codex worker returned no summary";

  if (status === "running") {
    if (!providerTaskId) throw new Error("PROVIDER_TASK_ID_REQUIRED");
    await dbRun("UPDATE video_tasks SET provider_task_id = ?, updated_at = ? WHERE id = ?", [providerTaskId, timestamp(), task.id]);
    await mutateTaskSpec(task, (spec) => {
      spec.status = "running_on_mac";
      spec.provider_task_id = providerTaskId;
      spec.mac_worker_summary = summary;
    });
    await addEvent(task.id, "mac_worker_provider_running", { providerTaskId, summary });
    return { status: "running_on_mac", blocker: null };
  }

  if (status === "blocked") {
    const automaticBlocker = cleanText(input.blocker, 1000) || "mac_worker_blocked";
    if (providerTaskId) {
      await dbRun(
        "UPDATE video_tasks SET status = ?, blocker = ?, submit_allowed = 1, cost_authorized = 1, provider_task_id = ?, updated_at = ? WHERE id = ?",
        ["blocked", "provider_sync_failed", providerTaskId, timestamp(), task.id],
      );
      await mutateTaskSpec(task, (spec) => {
        spec.status = "blocked";
        spec.blocker = "provider_sync_failed";
        spec.submit_allowed = true;
        spec.provider_task_id = providerTaskId;
        spec.mac_worker_summary = summary;
        spec.automatic_failure = automaticBlocker;
      });
      await addEvent(task.id, "mac_worker_provider_sync_blocked", { automaticBlocker, providerTaskId, summary });
      return { status: "blocked", blocker: "provider_sync_failed" };
    }
    const blocker = "automatic_generation_failed_manual_fallback";
    await dbRun(
      "UPDATE video_tasks SET execution_mode = 'manual_assist', status = ?, blocker = ?, submit_allowed = 0, updated_at = ? WHERE id = ?",
      ["awaiting_manual_operator", blocker, timestamp(), task.id],
    );
    await mutateTaskSpec(task, (spec) => {
      spec.execution_mode = "manual_assist";
      spec.status = "awaiting_manual_operator";
      spec.blocker = blocker;
      spec.submit_allowed = false;
      spec.mac_worker_summary = summary;
      spec.automatic_failure = automaticBlocker;
      spec.fallback = { mode: "manual_assist", surcharge_credits: 0 };
    });
    await addEvent(task.id, "automatic_fallback_manual", { automaticBlocker, blocker, summary, surchargeCredits: 0 });
    return { status: "awaiting_manual_operator", blocker };
  }

  if (!input.output || !(input.output instanceof File) || input.output.size < 1 || input.output.size > MAX_RESULT_BYTES) {
    throw new Error("MAC_RESULT_FILE_INVALID");
  }
  if (!providerTaskId) throw new Error("PROVIDER_TASK_ID_REQUIRED");
  if (!input.ledger || !(input.ledger instanceof File) || input.ledger.size < 2 || input.ledger.size > MAX_LEDGER_BYTES) {
    throw new Error("MAC_LEDGER_FILE_INVALID");
  }
  const outputs = taskOutputs(task.id);
  const outputPath = path.join(outputs.downloads, safeResultFilename(input.output.name));
  const ledgerPath = path.join(outputs.ledger, "mac-codex-ledger.json");
  await mkdir(outputs.downloads, { recursive: true });
  await mkdir(outputs.ledger, { recursive: true });
  const ledgerText = await input.ledger.text();
  try {
    JSON.parse(ledgerText);
  } catch {
    throw new Error("MAC_LEDGER_JSON_INVALID");
  }
  await writeFile(outputPath, Buffer.from(await input.output.arrayBuffer()));
  await writeFile(ledgerPath, ledgerText, "utf8");
  let probedDuration: number;
  try {
    probedDuration = await probeVideoDuration(outputPath);
  } catch (error) {
    await rm(outputPath, { force: true });
    await rm(ledgerPath, { force: true });
    throw error;
  }
  const expectedDuration = task.duration_seconds;
  const durationTolerance = Math.max(1, expectedDuration * 0.2);
  if (Math.abs(probedDuration - expectedDuration) > durationTolerance) {
    await rm(outputPath, { force: true });
    await rm(ledgerPath, { force: true });
    throw new Error("MEDIA_DURATION_MISMATCH");
  }
  const outputHash = createHash("sha256").update(await readFile(outputPath)).digest("hex");
  await dbRun(
    "UPDATE video_tasks SET status = ?, blocker = ?, provider_task_id = ?, output_path = ?, submit_allowed = 0, updated_at = ? WHERE id = ?",
    ["blocked", "awaiting_content_qa", providerTaskId, outputPath, timestamp(), task.id],
  );
  await mutateTaskSpec(task, (spec) => {
    spec.status = "blocked";
    spec.blocker = "awaiting_content_qa";
    spec.submit_allowed = false;
    spec.provider_task_id = providerTaskId;
    spec.output_path = outputPath;
    spec.provider_ledger_path = ledgerPath;
    spec.provider_media_probe_passed = true;
    spec.provider_content_qa_passed = false;
    spec.mac_codex_receipt = { summary, outputSha256: outputHash, probedDuration, reportedAt: timestamp() };
  });
  await addEvent(task.id, "mac_worker_output_received", { providerTaskId, outputPath, ledgerPath, outputSha256: outputHash, probedDuration, summary });
  return { status: "blocked", blocker: "awaiting_content_qa", outputPath, ledgerPath, probedDuration };
}

export async function macTaskHasResult(taskId: string) {
  const outputs = taskOutputs(taskId);
  try {
    return (await stat(outputs.downloads)).isDirectory();
  } catch {
    return false;
  }
}
