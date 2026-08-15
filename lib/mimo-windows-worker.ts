import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId, dbAll, dbOne, dbRun, dbTransaction, timestamp } from "@/lib/auth";
import { isPathInside, probeVideoDuration } from "@/lib/video-output-gate.mjs";
import { uploadAndVerifyVideoDelivery, videoCosConfigured } from "@/lib/video-cos";
import type { VideoTaskRecord } from "@/lib/video-tasks";
import { releaseIdentity } from "@/lib/release-version";
import { mimoDownstreamRecoveryState } from "@/lib/video-task-execution-stage";

const dataRoot = path.join(process.cwd(), "data");
const statePath = path.join(dataRoot, "mimo-windows-worker-state.json");
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

export type MimoWorkerState = {
  workerId: string;
  status: "idle" | "claiming" | "running" | "blocked";
  heartbeatAt: string;
  activeTaskId: string | null;
  summary: string | null;
  version: string | null;
  readiness: MimoWorkerReadiness | null;
};

export type MimoWorkerReadiness = {
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
    proxyConfigured: boolean;
    cdpAvailable: boolean;
    extensionCount: number;
    credits: string | null;
    unitCreditsPerSecond: string | null;
    pricingObservedAt: string | null;
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
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(workerId)) throw new Error("MIMO_WINDOWS_WORKER_ID_INVALID");
  return workerId;
}

function validTimestamp(value: unknown) {
  const text = cleanText(value, 80);
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error("MIMO_WINDOWS_READINESS_TIMESTAMP_INVALID");
  return text;
}

function nullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function sanitizeReadiness(value: unknown): MimoWorkerReadiness {
  if (!value || typeof value !== "object") throw new Error("MIMO_WINDOWS_READINESS_INVALID");
  const input = value as Record<string, unknown>;
  const computer = input.computer && typeof input.computer === "object" ? input.computer as Record<string, unknown> : {};
  const skills = input.skills && typeof input.skills === "object" ? input.skills as Record<string, unknown> : {};
  const channel = input.channel && typeof input.channel === "object" ? input.channel as Record<string, unknown> : {};
  const skillState = skills.state === "ready" ? "ready" : "blocked";
  const channelStates = new Set(["ready", "credentials_missing", "configuration_invalid", "authentication_failed", "unreachable"]);
  const channelState = channelStates.has(String(channel.state)) ? channel.state as MimoWorkerReadiness["channel"]["state"] : "configuration_invalid";
  const readyToClaim = input.readyToClaim === true;
  if (readyToClaim && (skillState !== "ready" || channelState !== "ready" || computer.workspaceWritable !== true || computer.ffprobeAvailable !== true)) {
    throw new Error("MIMO_WINDOWS_READINESS_CONTRADICTORY");
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
      proxyConfigured: channel.proxyConfigured === true,
      cdpAvailable: channel.cdpAvailable === true,
      extensionCount: Number.isInteger(channel.extensionCount) && Number(channel.extensionCount) >= 0 ? Number(channel.extensionCount) : 0,
      credits: cleanText(channel.credits, 80) || null,
      unitCreditsPerSecond: cleanText(channel.unitCreditsPerSecond, 40) || null,
      pricingObservedAt: channel.pricingObservedAt ? validTimestamp(channel.pricingObservedAt) : null,
      model: cleanText(channel.model, 120) || "Dreamina Seedance 2.0 Fast",
      blocker: cleanText(channel.blocker, 240) || null,
    },
  };
}

function readinessTtlMs() {
  const seconds = Number(process.env.MIMO_WINDOWS_READINESS_TTL_SECONDS ?? 180);
  return (Number.isFinite(seconds) ? Math.min(Math.max(Math.floor(seconds), 60), 900) : 180) * 1000;
}

function configuredToken() {
  const token = process.env.MIMO_WINDOWS_AGENT_TOKEN?.trim();
  if (!token || token.length < 24) throw new Error("MIMO_WINDOWS_WORKER_NOT_CONFIGURED");
  return token;
}

export function authorizeMimoWorker(authorizationHeader: string | null) {
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
  const seconds = Number(process.env.MIMO_WINDOWS_LEASE_SECONDS ?? 20 * 60);
  return Number.isFinite(seconds) ? Math.min(Math.max(Math.floor(seconds), 120), 4 * 60 * 60) : 20 * 60;
}

type IsolatedLeaseRecoveryConfig = {
  taskId: string;
  workerId: string;
};

const userConfirmedNoSubmissionRecoveryBinding = {
  taskId: "aPh_FVncAV5fdhK3z8lCrCTv",
  workerId: "windows-mimo-liulianggmUXHlg",
  ownerEmail: "liusb0713@qq.com",
  derivedReferenceSha256: "ad87a15f8ada8cc0da952d0e0cfe754e1f2d539deb9708d30cb3528c89767fee",
  packetSha256: "a3aa959e832535d191e4f5c9c184b7b8befb02d015f8e3ee1f2a1c09a90d8fe9",
  decision: "history_to_earliest_no_matching_convenience_store_floating_task",
} as const;

type UserConfirmedNoSubmissionRecoveryConfig = typeof userConfirmedNoSubmissionRecoveryBinding;
const userConfirmedNoSubmissionPacketPath = path.join(
  process.cwd(),
  "docs",
  "agent-team",
  "video-workbench-harness-v1",
  "task-packets",
  "NIANNIAN-WB-REAL-I2V-4S-20260728-01.json",
);

// This is deliberately an opt-in, one-task recovery brake.  A stale Mimo
// lease without a receipt is normally terminal because it is not safe to
// assume that Generate was never clicked.  The controller can enable this
// path only for a named task after independently reconciling the old claim.
function isolatedLeaseRecoveryConfig() : IsolatedLeaseRecoveryConfig | null {
  if (process.env.MIMO_WINDOWS_ISOLATED_LEASE_RECOVERY_ENABLED !== "true") return null;
  const taskId = cleanText(process.env.MIMO_WINDOWS_ISOLATED_LEASE_RECOVERY_TASK_ID, 100);
  const workerId = cleanText(process.env.MIMO_WINDOWS_ISOLATED_LEASE_RECOVERY_WORKER_ID, 80);
  if (!taskId || !workerId || !/^[a-zA-Z0-9._-]{3,80}$/.test(workerId)) return null;
  return { taskId, workerId };
}

// This is a separate, deliberately narrower recovery authority. It can only
// reopen the one user-confirmed no-submission task for normal preflight; the
// ordinary claim path remains responsible for any later execution.
function userConfirmedNoSubmissionRecoveryConfig(): UserConfirmedNoSubmissionRecoveryConfig | null {
  if (process.env.MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_ENABLED !== "true") return null;
  const configured = {
    taskId: cleanText(process.env.MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_TASK_ID, 100),
    workerId: cleanText(process.env.MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_WORKER_ID, 80),
    ownerEmail: cleanText(process.env.MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_OWNER_EMAIL, 240).toLowerCase(),
    derivedReferenceSha256: cleanText(process.env.MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_DERIVED_REFERENCE_SHA256, 64).toLowerCase(),
    packetSha256: cleanText(process.env.MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_PACKET_SHA256, 64).toLowerCase(),
    decision: cleanText(process.env.MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_DECISION, 160),
  };
  for (const key of Object.keys(userConfirmedNoSubmissionRecoveryBinding) as Array<keyof UserConfirmedNoSubmissionRecoveryConfig>) {
    if (configured[key] !== userConfirmedNoSubmissionRecoveryBinding[key]) return null;
  }
  return userConfirmedNoSubmissionRecoveryBinding;
}

export function isExactIsolatedMimoLeaseRecovery(input: {
  task: Pick<VideoTaskRecord, "id" | "execution_mode" | "channel" | "status" | "provider_task_id" | "submit_allowed" | "cost_authorized" | "updated_at">;
  requestedWorkerId: string;
  configuredTaskId: string;
  configuredWorkerId: string;
  nowMs?: number;
  leaseMs?: number;
}) {
  const updatedAt = Date.parse(input.task.updated_at);
  const nowMs = input.nowMs ?? Date.now();
  const leaseMs = input.leaseMs ?? leaseSeconds() * 1000;
  return input.task.id === input.configuredTaskId
    && input.requestedWorkerId === input.configuredWorkerId
    && input.task.execution_mode === "codex_skill"
    && input.task.channel === "mimo"
    && input.task.status === "running"
    && input.task.provider_task_id === null
    && Number(input.task.submit_allowed) === 1
    && Number(input.task.cost_authorized) === 1
    && Number.isFinite(updatedAt)
    && nowMs - updatedAt >= leaseMs;
}

function hasExactDerivedRecoveryReference(spec: TaskSpec, expectedSha256: string) {
  const manifest = spec.face_preprocess_manifest;
  const output = manifest && typeof manifest === "object" ? (manifest as Record<string, unknown>).output : null;
  const outputSha256 = output && typeof output === "object" ? cleanText((output as Record<string, unknown>).sha256, 64).toLowerCase() : "";
  const references = Array.isArray(spec.references) ? spec.references : [];
  return outputSha256 === expectedSha256
    && references.some((reference) => reference && typeof reference === "object"
      && cleanText((reference as Record<string, unknown>).sha256, 64).toLowerCase() === expectedSha256
      && (reference as Record<string, unknown>).is_primary === true);
}

export function isExactUserConfirmedNoSubmissionRecovery(input: {
  task: Pick<VideoTaskRecord, "id" | "execution_mode" | "channel" | "model" | "resolution" | "duration_seconds" | "status" | "blocker" | "provider_task_id" | "submit_allowed" | "cost_authorized" | "aspect_ratio">;
  requestedWorkerId: string;
  ownerEmail: string;
  spec: TaskSpec;
  receiptObserved: boolean;
  configured: UserConfirmedNoSubmissionRecoveryConfig;
}) {
  return input.task.id === input.configured.taskId
    && input.requestedWorkerId === input.configured.workerId
    && input.ownerEmail.trim().toLowerCase() === input.configured.ownerEmail
    && input.task.execution_mode === "codex_skill"
    && input.task.channel === "mimo"
    && input.task.model.trim() === "Seedance 2.0"
    && input.task.duration_seconds === 4
    && input.task.resolution.toUpperCase() === "720P"
    && input.task.aspect_ratio === "16:9"
    && input.spec.generation_type === "image_to_video"
    && input.spec.model === "Seedance 2.0"
    && input.spec.duration_seconds === 4
    && String(input.spec.resolution).toUpperCase() === "720P"
    && input.spec.aspect_ratio === "16:9"
    && input.task.status === "blocked"
    && input.task.blocker === "mimo_submit_unknown"
    && input.task.provider_task_id === null
    && Number(input.task.submit_allowed) === 0
    && Number(input.task.cost_authorized) === 1
    && input.receiptObserved === false
    && hasExactDerivedRecoveryReference(input.spec, input.configured.derivedReferenceSha256);
}

async function readExactUserConfirmedNoSubmissionPacketCostGate(config: UserConfirmedNoSubmissionRecoveryConfig) {
  try {
    const packetBytes = await readFile(userConfirmedNoSubmissionPacketPath);
    const packetSha256 = createHash("sha256").update(packetBytes).digest("hex");
    if (packetSha256 !== config.packetSha256) return false;
    const packet = JSON.parse(packetBytes.toString("utf8")) as Record<string, unknown>;
    const userBinding = packet.user_binding && typeof packet.user_binding === "object" ? packet.user_binding as Record<string, unknown> : {};
    const productionSpec = packet.production_spec && typeof packet.production_spec === "object" ? packet.production_spec as Record<string, unknown> : {};
    const costGate = packet.cost_gate && typeof packet.cost_gate === "object" ? packet.cost_gate as Record<string, unknown> : {};
    if (!(packet.task_id === "NIANNIAN-WB-REAL-I2V-4S-20260728-01"
      && userBinding.owner_account === config.ownerEmail
      && productionSpec.generation_type === "image_to_video"
      && productionSpec.model === "Seedance 2.0"
      && productionSpec.duration_seconds === 4
      && productionSpec.aspect_ratio === "16:9"
      && String(productionSpec.resolution).toUpperCase() === "720P"
      && costGate.authorized === true
      && Number(costGate.expected) === 8
      && Number(costGate.maximum) === 8)) return null;
    return { expected: Number(costGate.expected), maximum: Number(costGate.maximum) };
  } catch {
    return null;
  }
}

async function hasExactUserConfirmedNoSubmissionPacket(config: UserConfirmedNoSubmissionRecoveryConfig) {
  return Boolean(await readExactUserConfirmedNoSubmissionPacketCostGate(config));
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

const progressEventNames = new Set(["provider_receipt_observed", "provider_progress_observed", "provider_completed_observed", "download_started"]);

async function addProgressEventOnce(taskId: string, event: string, providerTaskId: string, detail: Record<string, unknown>) {
  if (!progressEventNames.has(event)) throw new Error("MIMO_PROGRESS_EVENT_INVALID");
  const existing = await dbOne<{ id: string; detail: string }>("SELECT id, detail FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1", [taskId, event]);
  if (existing) {
    let existingProviderTaskId = "";
    try { existingProviderTaskId = String((JSON.parse(existing.detail) as Record<string, unknown>).providerTaskId ?? ""); } catch { throw new Error("MIMO_PROGRESS_EVENT_DETAIL_INVALID"); }
    if (existingProviderTaskId !== providerTaskId) throw new Error("PROVIDER_TASK_ID_MISMATCH");
    return false;
  }
  await addEvent(taskId, event, { ...detail, providerTaskId });
  return true;
}

function nullableCost(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("MIMO_PROVIDER_COST_EVIDENCE_INVALID");
  return parsed;
}

function sanitizeProviderCostEvidence(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const generationType = input.generationType === "image_to_video" ? "image_to_video" : input.generationType === "text_to_video" ? "text_to_video" : null;
  if (!generationType) throw new Error("MIMO_PROVIDER_COST_GENERATION_TYPE_INVALID");
  return {
    generation_type: generationType,
    currency: "Mimo credits",
    expected_cost: nullableCost(input.expectedCost),
    maximum_cost: nullableCost(input.maximumCost),
    live_estimate: nullableCost(input.liveEstimate),
    balance_before: nullableCost(input.balanceBefore),
    balance_after: nullableCost(input.balanceAfter),
    actual_cost: nullableCost(input.actualCost),
  };
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
    downloadPath: `/api/internal/windows-mimo/tasks/${taskId}/assets/${assetId}`,
  };
}

async function taskPayload(task: VideoTaskRecord, workerId: string, preflightOnly = false) {
  const spec = await readTaskSpec(task);
  const rawReferences = Array.isArray(spec.references) ? spec.references : [];
  const references = rawReferences.map((reference) => referencePayload(reference, task.id));
  const generationType = spec.generation_type === "text_to_video" || spec.generation_type === "image_to_video" || spec.generation_type === "action_transfer" || spec.generation_type === "reference_guided_video"
    ? spec.generation_type
    : rawReferences.some((reference) => reference.role === "support_asset_ref" || reference.chinese_duty === "动作参考视频")
      ? "action_transfer"
      : "image_to_video";
  if (generationType !== "text_to_video" && !references.length) throw new Error("TASK_REFERENCES_MISSING");
  if (generationType === "text_to_video" && references.length) throw new Error("TEXT_TO_VIDEO_REFERENCES_INVALID");
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
    preflightOnly,
    preflight_only: preflightOnly,
    reconciliationOnly: spec.reconciliation_only === true,
    reconciliation_only: spec.reconciliation_only === true,
    allowedChannels: Array.isArray(spec.allowed_channels) ? spec.allowed_channels.map(String) : [],
    allowed_channels: Array.isArray(spec.allowed_channels) ? spec.allowed_channels.map(String) : [],
    skillRoute: Array.isArray(spec.skill_route) ? spec.skill_route.map(String) : [],
    skill_route: Array.isArray(spec.skill_route) ? spec.skill_route.map(String) : [],
    costGate: spec.cost_gate ?? null,
    cost_gate: spec.cost_gate ?? null,
    // The database row is the current execution authority. The JSON spec is
    // immutable input plus a resume snapshot and may still contain the prior
    // blocked value when the same task is explicitly resumed.
    submit_allowed: task.submit_allowed === 1,
    references,
    channelReferencePlan: spec.channel_reference_plan ?? null,
    channel_reference_plan: spec.channel_reference_plan ?? null,
    facePreprocessManifest: spec.face_preprocess_manifest ?? null,
    face_preprocess_manifest: spec.face_preprocess_manifest ?? null,
    outputContract: {
      status: "report completed only after downloaded media and a valid JSON ledger exist locally; the server then requires ffprobe and COS upload/readback before automatic delivery.",
      reportPath: "/api/internal/windows-mimo/tasks/:id/result",
    },
  };
}

function exactSubmitCostAuthorized(spec: TaskSpec, task: VideoTaskRecord) {
  const gate = spec.cost_gate && typeof spec.cost_gate === "object" ? spec.cost_gate as Record<string, unknown> : {};
  const cost = spec.provider_cost && typeof spec.provider_cost === "object" ? spec.provider_cost as Record<string, unknown> : {};
  const generationType = spec.generation_type === "image_to_video" ? "image_to_video" : spec.generation_type === "text_to_video" ? "text_to_video" : null;
  const expectedCost = Number(gate.expected_cost);
  const maximumCost = Number(gate.maximum_cost ?? gate.max_cost);
  return generationType !== null
    && task.duration_seconds >= 4 && task.duration_seconds <= 15
    && task.resolution.toUpperCase() === "720P"
    && task.model.trim() === "Seedance 2.0"
    && gate.authorized === true
    && Number.isFinite(expectedCost) && expectedCost > 0
    && Number.isFinite(maximumCost) && maximumCost >= expectedCost
    && cost.generation_type === generationType
    && Number(cost.duration_seconds) === task.duration_seconds
    && Number(cost.expected_cost) === expectedCost
    && Number(cost.maximum_cost) === maximumCost;
}

function isExactUserConfirmedNoSubmissionPreflightTask(input: {
  task: Pick<VideoTaskRecord, "id" | "execution_mode" | "channel" | "model" | "resolution" | "duration_seconds" | "status" | "provider_task_id" | "submit_allowed" | "cost_authorized" | "aspect_ratio">;
  requestedWorkerId: string;
  ownerEmail: string;
  spec: TaskSpec;
  receiptObserved: boolean;
  recovered: boolean;
  configured: UserConfirmedNoSubmissionRecoveryConfig;
}) {
  return input.recovered === true
    && input.task.id === input.configured.taskId
    && input.requestedWorkerId === input.configured.workerId
    && input.ownerEmail.trim().toLowerCase() === input.configured.ownerEmail
    && input.task.execution_mode === "codex_skill"
    && input.task.channel === "mimo"
    && input.task.model.trim() === "Seedance 2.0"
    && input.task.duration_seconds === 4
    && input.task.resolution.toUpperCase() === "720P"
    && input.task.aspect_ratio === "16:9"
    && input.spec.generation_type === "image_to_video"
    && input.spec.model === "Seedance 2.0"
    && input.spec.duration_seconds === 4
    && String(input.spec.resolution).toUpperCase() === "720P"
    && input.spec.aspect_ratio === "16:9"
    && input.task.status === "approved_for_execution"
    && input.task.provider_task_id === null
    && Number(input.task.submit_allowed) === 1
    && Number(input.task.cost_authorized) === 1
    && input.receiptObserved === false
    && hasExactDerivedRecoveryReference(input.spec, input.configured.derivedReferenceSha256);
}

async function claimConfiguredUserConfirmedNoSubmissionPreflight(workerId: string) {
  const config = userConfirmedNoSubmissionRecoveryConfig();
  if (!config || config.workerId !== workerId || !await hasExactUserConfirmedNoSubmissionPacket(config)) return null;
  return dbTransaction(async (transaction) => {
    const task = await transaction.one<VideoTaskRecord & { user_email: string }>(
      `SELECT video_tasks.*, users.email AS user_email FROM video_tasks
       JOIN users ON users.id = video_tasks.user_id
       WHERE video_tasks.id = ? AND LOWER(users.email) = ? AND video_tasks.execution_mode = ?
         AND video_tasks.channel = ? AND video_tasks.status = ? AND video_tasks.provider_task_id IS NULL
         AND video_tasks.submit_allowed = 1 AND video_tasks.cost_authorized = 1`,
      [config.taskId, config.ownerEmail, "codex_skill", "mimo", "approved_for_execution"],
    );
    if (!task) return null;
    const [receipt, recovered, priorPreflight] = await Promise.all([
      transaction.one<{ id: string }>("SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1", [task.id, "provider_receipt_observed"]),
      transaction.one<{ id: string }>("SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1", [task.id, "mimo_user_confirmed_no_submission_recovered"]),
      transaction.one<{ id: string }>("SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1", [task.id, "mimo_user_confirmed_no_submission_preflight_claimed"]),
    ]);
    if (priorPreflight) return null;
    const spec = await readTaskSpec(task);
    if (!isExactUserConfirmedNoSubmissionPreflightTask({
      task,
      requestedWorkerId: workerId,
      ownerEmail: task.user_email,
      spec,
      receiptObserved: Boolean(receipt),
      recovered: Boolean(recovered),
      configured: config,
    }) || spec.provider_cost !== undefined) return null;
    const updatedAt = timestamp();
    const changed = await transaction.run(
      `UPDATE video_tasks SET status = ?, blocker = NULL, updated_at = ? WHERE id = ? AND execution_mode = ?
       AND channel = ? AND status = ? AND provider_task_id IS NULL AND submit_allowed = 1
       AND cost_authorized = 1 AND updated_at = ?`,
      ["running", updatedAt, task.id, "codex_skill", "mimo", "approved_for_execution", task.updated_at],
    );
    if (changed !== 1) return null;
    await transaction.run(
      "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      [createId(), task.id, "mimo_user_confirmed_no_submission_preflight_claimed", JSON.stringify({ workerId, recovery: "preflight_only_no_upload_or_generate" }), updatedAt],
    );
    return { ...task, status: "running", blocker: null, updated_at: updatedAt };
  });
}

async function recoverExpiredMimoLease() {
  const staleBefore = new Date(Date.now() - leaseSeconds() * 1000).toISOString();
  const now = timestamp();
  const staleTasks = await dbAll<VideoTaskRecord>(
      "SELECT * FROM video_tasks WHERE execution_mode = ? AND channel = ? AND status = ? AND updated_at < ?",
      ["codex_skill", "mimo", "running", staleBefore],
    );
  for (const task of staleTasks) {
    const blocker = task.provider_task_id ? "provider_sync_failed" : "mimo_submit_unknown";
    await dbRun("UPDATE video_tasks SET status = ?, blocker = ?, submit_allowed = ?, updated_at = ? WHERE id = ? AND status = ?", ["blocked", blocker, task.provider_task_id ? 1 : 0, now, task.id, "running"]);
    await mutateTaskSpec(task, (spec) => {
      spec.status = "blocked";
      spec.blocker = blocker;
      spec.submit_allowed = Boolean(task.provider_task_id);
      spec.reconciliation_only = Boolean(task.provider_task_id);
    });
    await addEvent(task.id, "mimo_worker_lease_expired", { providerTaskId: task.provider_task_id, recovery: task.provider_task_id ? "sync_only" : "submit_unknown_no_retry" });
  }
}

async function claimConfiguredIsolatedLeaseRecovery(workerId: string) {
  const config = isolatedLeaseRecoveryConfig();
  if (!config || config.workerId !== workerId) return null;

  return dbTransaction(async (transaction) => {
    const task = await transaction.one<VideoTaskRecord>(
      `SELECT * FROM video_tasks
       WHERE id = ? AND execution_mode = ? AND channel = ? AND status = ?
         AND provider_task_id IS NULL AND submit_allowed = 1 AND cost_authorized = 1`,
      [config.taskId, "codex_skill", "mimo", "running"],
    );
    if (!task || !isExactIsolatedMimoLeaseRecovery({
      task,
      requestedWorkerId: workerId,
      configuredTaskId: config.taskId,
      configuredWorkerId: config.workerId,
    })) return null;

    // A receipt event is stronger evidence than a stale database projection.
    // Its presence permanently keeps the task on the sync-only path.
    const receipt = await transaction.one<{ id: string }>(
      "SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1",
      [task.id, "provider_receipt_observed"],
    );
    if (receipt) return null;

    const priorClaim = await transaction.one<{ detail: string | null }>(
      "SELECT detail FROM video_task_events WHERE task_id = ? AND event = ? ORDER BY created_at DESC LIMIT 1",
      [task.id, "mimo_worker_claimed"],
    );
    let priorWorkerId = "";
    try { priorWorkerId = cleanText(JSON.parse(priorClaim?.detail ?? "{}").workerId, 80); } catch { return null; }
    if (!priorWorkerId || priorWorkerId === workerId) return null;

    const updatedAt = timestamp();
    const changed = await transaction.run(
      `UPDATE video_tasks SET status = ?, blocker = NULL, updated_at = ?
       WHERE id = ? AND execution_mode = ? AND channel = ? AND status = ?
         AND provider_task_id IS NULL AND submit_allowed = 1 AND cost_authorized = 1 AND updated_at = ?`,
      ["running", updatedAt, task.id, "codex_skill", "mimo", "running", task.updated_at],
    );
    if (changed !== 1) return null;
    await transaction.run(
      "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      [createId(), task.id, "mimo_worker_isolated_lease_recovered", JSON.stringify({ workerId, priorWorkerId, leaseSeconds: leaseSeconds(), recovery: "no_provider_receipt_exact_task_only" }), updatedAt],
    );
    return { ...task, status: "running", blocker: null, updated_at: updatedAt };
  });
}

async function recoverConfiguredUserConfirmedNoSubmission(workerId: string) {
  const config = userConfirmedNoSubmissionRecoveryConfig();
  if (!config || config.workerId !== workerId) return null;
  if (!await hasExactUserConfirmedNoSubmissionPacket(config)) return null;

  const recovered = await dbTransaction(async (transaction) => {
    const task = await transaction.one<VideoTaskRecord & { user_email: string }>(
      `SELECT video_tasks.*, users.email AS user_email FROM video_tasks
       JOIN users ON users.id = video_tasks.user_id
       WHERE video_tasks.id = ? AND LOWER(users.email) = ?
         AND video_tasks.execution_mode = ? AND video_tasks.channel = ?
         AND video_tasks.status = ? AND video_tasks.blocker = ?
         AND video_tasks.provider_task_id IS NULL AND video_tasks.submit_allowed = 0
         AND video_tasks.cost_authorized = 1`,
      [config.taskId, config.ownerEmail, "codex_skill", "mimo", "blocked", "mimo_submit_unknown"],
    );
    if (!task) return null;

    const receipt = await transaction.one<{ id: string }>(
      "SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1",
      [task.id, "provider_receipt_observed"],
    );
    const priorRecovery = await transaction.one<{ id: string }>(
      "SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1",
      [task.id, "mimo_user_confirmed_no_submission_recovered"],
    );
    if (priorRecovery) return null;
    const spec = await readTaskSpec(task);
    if (!isExactUserConfirmedNoSubmissionRecovery({
      task,
      requestedWorkerId: workerId,
      ownerEmail: task.user_email,
      spec,
      receiptObserved: Boolean(receipt),
      configured: config,
    })) return null;

    const updatedAt = timestamp();
    const changed = await transaction.run(
      `UPDATE video_tasks SET status = ?, blocker = NULL, submit_allowed = 1, updated_at = ?
       WHERE id = ? AND execution_mode = ? AND channel = ? AND status = ? AND blocker = ?
         AND provider_task_id IS NULL AND submit_allowed = 0 AND cost_authorized = 1 AND updated_at = ?`,
      ["approved_for_execution", updatedAt, task.id, "codex_skill", "mimo", "blocked", "mimo_submit_unknown", task.updated_at],
    );
    if (changed !== 1) return null;
    await transaction.run(
      "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      [createId(), task.id, "mimo_user_confirmed_no_submission_recovered", JSON.stringify({
        workerId,
        ownerEmail: config.ownerEmail,
        derivedReferenceSha256: config.derivedReferenceSha256,
        packetSha256: config.packetSha256,
        decision: config.decision,
        recovery: "approved_for_execution_preflight_required",
      }), updatedAt],
    );
    return { task, updatedAt };
  });
  if (!recovered) return null;

  await mutateTaskSpec(recovered.task, (spec) => {
    spec.status = "approved_for_execution";
    spec.blocker = null;
    spec.submit_allowed = true;
    spec.reconciliation_only = false;
  });
  return { ...recovered.task, status: "approved_for_execution", blocker: null, submit_allowed: 1, updated_at: recovered.updatedAt };
}

async function claimReceiptRecoveryTask(workerId: string) {
  const candidates = await dbAll<VideoTaskRecord>(
    `SELECT * FROM video_tasks WHERE execution_mode = ? AND channel = ? AND status = ?
     AND blocker = ? AND provider_task_id IS NOT NULL ORDER BY updated_at ASC LIMIT 20`,
    ["codex_skill", "mimo", "blocked", "provider_sync_failed"],
  );
  for (const task of candidates) {
    const spec = await readTaskSpec(task);
    const receiptObservedAt = typeof spec.provider_receipt_observed_at === "string" ? spec.provider_receipt_observed_at : null;
    const recovery = mimoDownstreamRecoveryState(receiptObservedAt);
    if (recovery.expired) {
      await dbRun("UPDATE video_tasks SET blocker = ?, submit_allowed = 0, updated_at = ? WHERE id = ? AND status = ? AND blocker = ?", [recovery.blocker, timestamp(), task.id, "blocked", "provider_sync_failed"]);
      await mutateTaskSpec(task, (current) => { current.blocker = recovery.blocker; current.submit_allowed = false; current.reconciliation_only = true; });
      await addEvent(task.id, "mimo_provider_sync_recovery_expired", { providerTaskId: task.provider_task_id, receiptObservedAt });
      continue;
    }
    if (!recovery.eligible) continue;
    const updatedAt = timestamp();
    const changed = await dbTransaction(async (transaction) => transaction.run(
      "UPDATE video_tasks SET status = ?, blocker = NULL, submit_allowed = 1, updated_at = ? WHERE id = ? AND status = ? AND blocker = ? AND provider_task_id = ?",
      ["running", updatedAt, task.id, "blocked", "provider_sync_failed", task.provider_task_id],
    ));
    if (changed !== 1) continue;
    await mutateTaskSpec(task, (current) => { current.status = "running"; current.blocker = null; current.submit_allowed = true; current.reconciliation_only = true; });
    await addEvent(task.id, "mimo_provider_sync_recovery_claimed", { workerId, providerTaskId: task.provider_task_id, receiptObservedAt, recoveryWindowMinutes: 30 });
    return { ...task, status: "running", blocker: null, submit_allowed: 1, updated_at: updatedAt };
  }
  return null;
}

// The parent loop invokes this through claim. It replaces manual database
// resets for a stale running lease.
export async function recoverStaleMimoTasks() {
  await recoverExpiredMimoLease();
}

export async function claimMimoTask(workerIdInput: unknown) {
  const workerId = safeWorkerId(workerIdInput);
  const workerState = await readMimoWorkerState();
  const readiness = workerState?.readiness;
  const readinessAge = readiness ? Date.now() - Date.parse(readiness.checkedAt) : Number.POSITIVE_INFINITY;
  if (!workerState || workerState.workerId !== workerId || !readiness?.readyToClaim || readinessAge < 0 || readinessAge > readinessTtlMs()) {
    throw new Error("MIMO_WINDOWS_WORKER_NOT_READY");
  }
  const isolatedRecovery = await claimConfiguredIsolatedLeaseRecovery(workerId);
  if (isolatedRecovery) {
    await writeMimoWorkerState({ workerId, status: "running", activeTaskId: isolatedRecovery.id, summary: "isolated stale Mimo lease recovered" });
    return taskPayload(isolatedRecovery, workerId);
  }
  const userConfirmedRecovery = await recoverConfiguredUserConfirmedNoSubmission(workerId);
  if (userConfirmedRecovery) {
    await writeMimoWorkerState({ workerId, status: "idle", summary: "user-confirmed no-submission task restored for normal preflight" });
    return null;
  }
  await recoverExpiredMimoLease();
  const preflightOnlyTask = await claimConfiguredUserConfirmedNoSubmissionPreflight(workerId);
  if (preflightOnlyTask) {
    await writeMimoWorkerState({ workerId, status: "running", activeTaskId: preflightOnlyTask.id, summary: "user-confirmed no-submission task claimed for visible cost preflight only" });
    return taskPayload(preflightOnlyTask, workerId, true);
  }
  const claimed = await dbTransaction(async (transaction) => {
    const tasks = await transaction.all<VideoTaskRecord>(
      `SELECT * FROM video_tasks
       WHERE execution_mode = ? AND channel = ? AND submit_allowed = 1 AND cost_authorized = 1 AND status IN (?, ?)
       AND provider_task_id IS NULL ORDER BY updated_at ASC LIMIT 20`,
      ["codex_skill", "mimo", "queued_skill", "approved_for_execution"],
    );
    let task: VideoTaskRecord | null = null;
    for (const candidate of tasks) {
      if (exactSubmitCostAuthorized(await readTaskSpec(candidate), candidate)) { task = candidate; break; }
    }
    if (!task) return null;
    const updatedAt = timestamp();
    const changed = await transaction.run(
      "UPDATE video_tasks SET status = ?, blocker = NULL, updated_at = ? WHERE id = ? AND status = ? AND submit_allowed = 1 AND cost_authorized = 1",
      ["running", updatedAt, task.id, task.status],
    );
    if (changed !== 1) return null;
    await transaction.run(
      "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      [createId(), task.id, "mimo_worker_claimed", JSON.stringify({ workerId, leaseSeconds: leaseSeconds() }), updatedAt],
    );
    return { ...task, status: "running", blocker: null, updated_at: updatedAt };
  });
  const activeTask = claimed ?? await claimReceiptRecoveryTask(workerId);
  await writeMimoWorkerState({ workerId, status: activeTask ? "running" : "idle", activeTaskId: activeTask?.id ?? null, summary: activeTask ? "task claimed" : "no eligible task" });
  return activeTask ? taskPayload(activeTask, workerId) : null;
}

export async function writeMimoWorkerState(input: {
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
    throw new Error("MIMO_WINDOWS_WORKER_STATUS_INVALID");
  }
  const activeTaskId = typeof input.activeTaskId === "string" && input.activeTaskId.length <= 100 ? input.activeTaskId : null;
  if (activeTaskId) {
    const task = await taskById(activeTaskId);
    if (!task || task.execution_mode !== "codex_skill" || task.channel !== "mimo" || task.status !== "running") throw new Error("MIMO_WINDOWS_TASK_NOT_ACTIVE");
    await dbRun("UPDATE video_tasks SET updated_at = ? WHERE id = ? AND status = ?", [timestamp(), task.id, "running"]);
  }
  const existing = await readMimoWorkerState();
  const state: MimoWorkerState = {
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

export async function readMimoWorkerState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as MimoWorkerState;
  } catch {
    return null;
  }
}

export async function publicMimoWorkerAvailability() {
  const state = await readMimoWorkerState();
  const heartbeatAge = state?.heartbeatAt ? Date.now() - Date.parse(state.heartbeatAt) : Number.POSITIVE_INFINITY;
  const readinessAge = state?.readiness?.checkedAt ? Date.now() - Date.parse(state.readiness.checkedAt) : Number.POSITIVE_INFINITY;
  const heartbeatTtlMs = Math.max(Number(process.env.MIMO_WINDOWS_HEARTBEAT_TTL_SECONDS ?? 120), 30) * 1000;
  const activeStatus = ["idle", "claiming", "running", "blocked"].includes(state?.status ?? "");
  const readyToClaim = activeStatus
    && heartbeatAge >= 0 && heartbeatAge <= heartbeatTtlMs
    && state?.readiness?.readyToClaim === true
    && readinessAge >= 0 && readinessAge <= readinessTtlMs();
  return { readyToClaim, state: readyToClaim ? "ready" : "unavailable" };
}

export async function currentMimoCostReadback() {
  const state = await readMimoWorkerState();
  const availability = await publicMimoWorkerAvailability();
  const balance = Number(state?.readiness?.channel.credits ?? NaN);
  const unitCreditsPerSecond = Number(state?.readiness?.channel.unitCreditsPerSecond ?? NaN);
  const observedAt = state?.readiness?.channel.pricingObservedAt ?? null;
  const observedAge = observedAt ? Date.now() - Date.parse(observedAt) : Number.POSITIVE_INFINITY;
  const fresh = availability.readyToClaim && observedAge >= 0 && observedAge <= readinessTtlMs()
    && Number.isFinite(balance) && balance >= 0 && Number.isFinite(unitCreditsPerSecond) && unitCreditsPerSecond > 0;
  return { fresh, balance: fresh ? balance : null, unitCreditsPerSecond: fresh ? unitCreditsPerSecond : null, observedAt: fresh ? observedAt : null };
}

type CountRow = { count: number | string };

async function taskCount(where: string, values: Array<string | number> = []) {
  const row = await dbOne<CountRow>(`SELECT COUNT(*) AS count FROM video_tasks WHERE ${where}`, values);
  return Number(row?.count ?? 0);
}

export async function readMimoWorkerDiagnostics() {
  const staleBefore = new Date(Date.now() - leaseSeconds() * 1000).toISOString();
  const [queuedMimo, approvedForExecution, runningOnMimo, staleRunningOnMimo] = await Promise.all([
    taskCount("execution_mode = ? AND channel = ? AND status = ?", ["codex_skill", "mimo", "queued_skill"]),
    taskCount("execution_mode = ? AND channel = ? AND status = ?", ["codex_skill", "mimo", "approved_for_execution"]),
    taskCount("execution_mode = ? AND channel = ? AND status = ?", ["codex_skill", "mimo", "running"]),
    taskCount("execution_mode = ? AND channel = ? AND status = ? AND updated_at < ?", ["codex_skill", "mimo", "running", staleBefore]),
  ]);
  return {
    release: releaseIdentity,
    leaseSeconds: leaseSeconds(),
    queue: { queuedMimo, approvedForExecution, runningOnMimo, staleRunningOnMimo },
    recoveryPolicy: {
      strategy: "parent_claim_auto_recovery",
      staleStatus: "running",
      recoveredStatus: "blocked_provider_sync_failed_then_receipt_bound_sync_only",
      event: "mimo_worker_lease_expired",
      downstreamRecoveryWindowMinutes: 30,
      mutatesOnStatusRead: false,
    },
  };
}

export async function getMimoTaskAsset(taskId: string, assetId: string) {
  const task = await taskById(taskId);
  if (!task || task.execution_mode !== "codex_skill" || task.channel !== "mimo" || task.status !== "running") throw new Error("MIMO_WINDOWS_TASK_NOT_ACTIVE");
  const manifest = JSON.parse(task.asset_manifest) as Array<{ id?: unknown }>;
  if (!manifest.some((asset) => asset.id === assetId)) throw new Error("MIMO_WINDOWS_TASK_ASSET_NOT_ALLOWED");
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
  if (!resultExtensions.has(extension)) throw new Error("MIMO_WINDOWS_RESULT_FORMAT_INVALID");
  return `mimo-windows-${Date.now()}${extension}`;
}

function resultStatus(value: unknown) {
  if (value === "preflight" || value === "running" || value === "completed" || value === "blocked") return value;
  throw new Error("MIMO_WINDOWS_RESULT_STATUS_INVALID");
}

async function assertMimoTaskAcceptingResult(taskId: string, status: ReturnType<typeof resultStatus>, providerTaskId: string | null) {
  const task = await taskById(taskId);
  if (!task || task.execution_mode !== "codex_skill" || task.channel !== "mimo") throw new Error("MIMO_WINDOWS_TASK_NOT_FOUND");
  if (task.status === "running") return task;
  // A completed file can outlive the Provider receipt polling window. This is a
  // delivery-only recovery: the same trusted worker may upload the existing
  // artifact once, but cannot submit or poll a Provider task from this branch.
  const localDeliveryRecovery = status === "completed"
    && task.status === "blocked"
    && task.blocker === "MIMO_PROVIDER_SYNC_RECOVERY_WINDOW_EXPIRED"
    && Boolean(task.provider_task_id)
    && providerTaskId === task.provider_task_id;
  if (!localDeliveryRecovery) throw new Error("MIMO_WINDOWS_TASK_NOT_ACTIVE");
  return task;
}

async function recordConfiguredUserConfirmedNoSubmissionPreflightResult(input: {
  task: VideoTaskRecord;
  workerId: string;
  providerCostEvidence: ReturnType<typeof sanitizeProviderCostEvidence>;
  summary: string;
}) {
  const config = userConfirmedNoSubmissionRecoveryConfig();
  const packetCostGate = config ? await readExactUserConfirmedNoSubmissionPacketCostGate(config) : null;
  const workerState = await readMimoWorkerState();
  const channel = workerState?.readiness?.channel;
  const observedAt = channel?.pricingObservedAt ?? null;
  const observedAge = observedAt ? Date.now() - Date.parse(observedAt) : Number.POSITIVE_INFINITY;
  const unitCreditsPerSecond = Number(channel?.unitCreditsPerSecond ?? NaN);
  const actualLiveEstimate = unitCreditsPerSecond * input.task.duration_seconds;
  const evidence = input.providerCostEvidence;
  if (!config || !packetCostGate || config.workerId !== input.workerId || !evidence
    || input.task.id !== config.taskId || input.task.provider_task_id !== null
    || workerState?.workerId !== input.workerId || workerState.status !== "running" || workerState.activeTaskId !== input.task.id
    || workerState.readiness?.readyToClaim !== true || channel?.state !== "ready" || channel.authenticated !== true
    || channel.cdpAvailable !== true || channel.model !== "Seedance 2.0" || observedAge < 0 || observedAge > readinessTtlMs()
    || !Number.isFinite(unitCreditsPerSecond) || unitCreditsPerSecond <= 0
    || !Number.isFinite(actualLiveEstimate) || actualLiveEstimate <= 0 || actualLiveEstimate > packetCostGate.maximum
    || evidence.generation_type !== "image_to_video" || evidence.live_estimate !== actualLiveEstimate) {
    throw new Error("MIMO_PREFLIGHT_COST_READBACK_INVALID");
  }

  const task = await dbOne<VideoTaskRecord & { user_email: string }>(
    `SELECT video_tasks.*, users.email AS user_email FROM video_tasks
     JOIN users ON users.id = video_tasks.user_id WHERE video_tasks.id = ? AND LOWER(users.email) = ?`,
    [input.task.id, config.ownerEmail],
  );
  if (!task) throw new Error("MIMO_PREFLIGHT_TASK_BINDING_INVALID");
  const [receipt, recovery, preflightClaim, priorPreflight] = await Promise.all([
    dbOne<{ id: string }>("SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1", [task.id, "provider_receipt_observed"]),
    dbOne<{ id: string }>("SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1", [task.id, "mimo_user_confirmed_no_submission_recovered"]),
    dbOne<{ id: string }>("SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1", [task.id, "mimo_user_confirmed_no_submission_preflight_claimed"]),
    dbOne<{ id: string }>("SELECT id FROM video_task_events WHERE task_id = ? AND event = ? LIMIT 1", [task.id, "mimo_user_confirmed_no_submission_preflight_cost_recorded"]),
  ]);
  const spec = await readTaskSpec(task);
  if (priorPreflight || !preflightClaim || !isExactUserConfirmedNoSubmissionPreflightTask({
    task: { ...task, status: "approved_for_execution" },
    requestedWorkerId: input.workerId,
    ownerEmail: task.user_email,
    spec,
    receiptObserved: Boolean(receipt),
    recovered: Boolean(recovery),
    configured: config,
  }) || spec.provider_cost !== undefined) throw new Error("MIMO_PREFLIGHT_TASK_BINDING_INVALID");

  const providerCost = {
    generation_type: "image_to_video",
    duration_seconds: input.task.duration_seconds,
    currency: "Mimo credits",
    expected_cost: packetCostGate.expected,
    maximum_cost: packetCostGate.maximum,
    live_estimate: actualLiveEstimate,
    observed_at: observedAt,
    evidence: "benchmark_20260728_image_to_video_4s_720p_seedance_2_0",
    source: "windows_mimo_visible_preflight",
  };
  const changed = await dbTransaction((transaction) => transaction.run(
    `UPDATE video_tasks SET status = ?, blocker = NULL, updated_at = ? WHERE id = ? AND status = ?
     AND provider_task_id IS NULL AND submit_allowed = 1 AND cost_authorized = 1`,
    ["approved_for_execution", timestamp(), task.id, "running"],
  ));
  if (changed !== 1) throw new Error("MIMO_PREFLIGHT_STATE_CONFLICT");
  await mutateTaskSpec(task, (current) => {
    current.status = "approved_for_execution";
    current.blocker = null;
    current.cost_gate = {
      ...(current.cost_gate && typeof current.cost_gate === "object" ? current.cost_gate as Record<string, unknown> : {}),
      authorized: true,
      expected_cost: packetCostGate.expected,
      maximum_cost: packetCostGate.maximum,
    };
    current.provider_cost = providerCost;
    current.mimo_preflight = {
      worker_id: input.workerId,
      provider_generated_audio: true,
      reference_audio_required: false,
      reference_audio_count: 0,
      unit_credits_per_second: unitCreditsPerSecond,
      live_estimate: actualLiveEstimate,
      observed_at: observedAt,
    };
  });
  await addEvent(task.id, "mimo_user_confirmed_no_submission_preflight_cost_recorded", {
    workerId: input.workerId,
    liveEstimate: actualLiveEstimate,
    unitCreditsPerSecond,
    observedAt,
    recovery: "preflight_only_no_upload_or_generate",
  });
  return { status: "approved_for_execution", blocker: null };
}

export async function acceptMimoTaskResult(input: {
  taskId: string;
  status: unknown;
  workerId?: unknown;
  providerTaskId?: unknown;
  summary?: unknown;
  blocker?: unknown;
  output?: File | null;
  ledger?: File | null;
  providerCostEvidence?: unknown;
  progressEvents?: unknown;
}) {
  const status = resultStatus(input.status);
  const providerTaskId = cleanText(input.providerTaskId, 240) || null;
  const task = await assertMimoTaskAcceptingResult(input.taskId, status, providerTaskId);
  const summary = cleanText(input.summary, 2000) || "Windows Mimo worker returned no summary";
  const workerId = input.workerId === undefined ? null : safeWorkerId(input.workerId);
  if (task.provider_task_id && providerTaskId && task.provider_task_id !== providerTaskId) throw new Error("PROVIDER_TASK_ID_MISMATCH");
  const providerCostEvidence = sanitizeProviderCostEvidence(input.providerCostEvidence);
  if (status === "preflight") {
    if (providerTaskId || !workerId) throw new Error("MIMO_PREFLIGHT_RESULT_INVALID");
    return recordConfiguredUserConfirmedNoSubmissionPreflightResult({ task, workerId, providerCostEvidence, summary });
  }
  if (providerCostEvidence) {
    const lockedSpec = await readTaskSpec(task);
    const locked = lockedSpec.provider_cost && typeof lockedSpec.provider_cost === "object" ? lockedSpec.provider_cost as Record<string, unknown> : {};
    if (providerCostEvidence.generation_type !== locked.generation_type
      || providerCostEvidence.expected_cost !== nullableCost(locked.expected_cost)
      || providerCostEvidence.maximum_cost !== nullableCost(locked.maximum_cost)) {
      throw new Error("MIMO_PROVIDER_COST_CONTRACT_MISMATCH");
    }
  }
  const requestedProgressEvents = Array.isArray(input.progressEvents)
    ? input.progressEvents.map((event) => cleanText(event, 80)).filter((event) => progressEventNames.has(event))
    : [];

  if (status === "running") {
    if (!providerTaskId) throw new Error("PROVIDER_TASK_ID_REQUIRED");
    await dbRun("UPDATE video_tasks SET provider_task_id = ?, updated_at = ? WHERE id = ?", [providerTaskId, timestamp(), task.id]);
    await mutateTaskSpec(task, (spec) => {
      spec.status = "running";
      spec.provider_task_id = providerTaskId;
      spec.mimo_worker_summary = summary;
      if (providerCostEvidence) spec.provider_cost = providerCostEvidence;
      if (requestedProgressEvents.includes("provider_receipt_observed") && !spec.provider_receipt_observed_at) spec.provider_receipt_observed_at = timestamp();
      if (task.provider_task_id || requestedProgressEvents.includes("provider_receipt_observed")) spec.reconciliation_only = true;
    });
    for (const event of requestedProgressEvents) await addProgressEventOnce(task.id, event, providerTaskId, { summary });
    await addEvent(task.id, "mimo_worker_provider_running", { providerTaskId, summary });
    return { status: "running", blocker: null };
  }

  if (status === "blocked") {
    const automaticBlocker = cleanText(input.blocker, 1000) || "mimo_worker_blocked";
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
        spec.mimo_worker_summary = summary;
        spec.automatic_failure = automaticBlocker;
      });
      await addEvent(task.id, "mimo_worker_provider_sync_blocked", { automaticBlocker, providerTaskId, summary });
      return { status: "blocked", blocker: "provider_sync_failed" };
    }
    const blocker = automaticBlocker || "mimo_worker_blocked";
    await dbRun(
      "UPDATE video_tasks SET execution_mode = ?, status = ?, blocker = ?, submit_allowed = 0, updated_at = ? WHERE id = ? AND execution_mode = ? AND channel = ? AND provider_task_id IS NULL",
      ["codex_skill", "blocked", blocker, timestamp(), task.id, "codex_skill", "mimo"],
    );
    await mutateTaskSpec(task, (spec) => {
      spec.execution_mode = "codex_skill";
      spec.status = "blocked";
      spec.blocker = blocker;
      spec.submit_allowed = false;
      spec.mimo_worker_summary = summary;
      spec.automatic_failure = automaticBlocker;
      spec.provider_task_id = null;
      spec.retry_policy = "no_automatic_retry_without_new_owner_authorization";
    });
    await addEvent(task.id, "mimo_worker_blocked_no_provider", { automaticBlocker, blocker, summary, retryPolicy: "no_automatic_retry_without_new_owner_authorization" });
    return { status: "blocked", blocker };
  }

  if (!input.output || !(input.output instanceof File) || input.output.size < 1 || input.output.size > MAX_RESULT_BYTES) {
    throw new Error("MIMO_WINDOWS_RESULT_FILE_INVALID");
  }
  if (!providerTaskId) throw new Error("PROVIDER_TASK_ID_REQUIRED");
  if (!input.ledger || !(input.ledger instanceof File) || input.ledger.size < 2 || input.ledger.size > MAX_LEDGER_BYTES) {
    throw new Error("MIMO_WINDOWS_LEDGER_FILE_INVALID");
  }
  const outputs = taskOutputs(task.id);
  const outputPath = path.join(outputs.downloads, safeResultFilename(input.output.name));
  const ledgerPath = path.join(outputs.ledger, "mimo-windows-ledger.json");
  await mkdir(outputs.downloads, { recursive: true });
  await mkdir(outputs.ledger, { recursive: true });
  const ledgerText = await input.ledger.text();
  let ledger: Record<string, unknown>;
  try {
    ledger = JSON.parse(ledgerText) as Record<string, unknown>;
  } catch {
    throw new Error("MIMO_WINDOWS_LEDGER_JSON_INVALID");
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
  const ledgerCostEvidence = sanitizeProviderCostEvidence(ledger.providerCost ?? input.providerCostEvidence);
  for (const event of ["provider_completed_observed", "download_started"]) {
    await addProgressEventOnce(task.id, event, providerTaskId, { summary });
  }
  // The authenticated site route can safely serve a task-scoped local output.
  // COS remains the preferred verified delivery when it is configured; a missing
  // COS configuration must not strand an already-probed Provider result.
  const cosDelivery = videoCosConfigured()
    ? await uploadAndVerifyVideoDelivery({ userId: task.user_id, taskId: task.id, outputPath })
    : null;
  const localDelivery = cosDelivery ? null : {
    provider: "local_private",
    output_path: outputPath,
    sha256: outputHash,
    byte_size: input.output.size,
    verified_at: timestamp(),
  };
  await dbRun(
    "UPDATE video_tasks SET status = ?, blocker = NULL, provider_task_id = ?, output_path = ?, submit_allowed = 0, updated_at = ? WHERE id = ?",
    ["completed", providerTaskId, outputPath, timestamp(), task.id],
  );
  await mutateTaskSpec(task, (spec) => {
    spec.status = "completed";
    spec.blocker = null;
    spec.submit_allowed = false;
    spec.provider_task_id = providerTaskId;
    spec.output_path = outputPath;
    spec.provider_ledger_path = ledgerPath;
    if (ledgerCostEvidence) spec.provider_cost = ledgerCostEvidence;
    spec.provider_media_probe_passed = true;
    spec.provider_content_qa_passed = null;
    spec.completion_evidence = {
      media_probe_passed: true,
      content_qa_passed: null,
      ledger_path: ledgerPath,
      probed_duration_seconds: probedDuration,
      ...(cosDelivery ? { cos: cosDelivery } : { local: localDelivery }),
    };
    spec.mimo_worker_receipt = { summary, outputSha256: outputHash, probedDuration, reportedAt: timestamp() };
  });
  if (cosDelivery) {
    await addEvent(task.id, "cos_verified", { providerTaskId, outputSha256: outputHash });
  } else {
    await addEvent(task.id, "local_delivery_verified", { providerTaskId, outputSha256: outputHash, byteSize: input.output.size });
  }
  await addEvent(task.id, "mimo_worker_output_auto_delivered", {
    providerTaskId,
    outputPath,
    ledgerPath,
    outputSha256: outputHash,
    probedDuration,
    summary,
    deliveryProvider: cosDelivery ? "tencent_cos" : "local_private",
  });
  return { status: "completed", blocker: null, outputPath, ledgerPath, probedDuration };
}

export async function mimoTaskHasResult(taskId: string) {
  const outputs = taskOutputs(taskId);
  try {
    return (await stat(outputs.downloads)).isDirectory();
  } catch {
    return false;
  }
}

