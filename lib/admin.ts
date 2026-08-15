import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId, dbAll, dbOne, dbRun, timestamp } from "@/lib/auth";
import { adminCreditOverview, refundTaskCredits } from "@/lib/credits";
import { validateCompletedOutput, validateOutputDuration, validateOutputFile, validateOutputLedger } from "@/lib/video-output-gate.mjs";
import { createVideoTask } from "@/lib/video-tasks";
import { getMimoReadiness } from "@/lib/mimo-readiness";
import { dolaReferencePlan, getDolaReadiness, validateDolaPrompt } from "@/lib/dola-channel";
import { getMioraReadiness, mioraReferencePlan, mioraSkillChain, runMioraPreflight } from "@/lib/miora-channel";
import { getMioraSession, listMioraHandoffs, resolveMioraHandoffForTask } from "@/lib/miora-session";
import { getMioraLearningProfile } from "@/lib/miora-learning";
import { readMimoWorkerState } from "@/lib/mimo-windows-worker";
import { uploadAndVerifyVideoDelivery } from "@/lib/video-cos";
import { runLegacyMimoDeliveryBackfill, safeLegacyDeliveryError } from "@/lib/legacy-mimo-delivery-backfill.mjs";

const DEFAULT_ADMIN_EMAIL = "1453637677@qq.com";

type AdminTaskRow = {
  id: string; user_id: string; user_email: string; execution_mode: string; channel: string;
  prompt: string; model: string; resolution: string; duration_seconds: number; aspect_ratio: string;
  asset_manifest: string; task_spec_path: string; status: string; blocker: string | null;
  provider_task_id: string | null; output_path: string | null; submit_allowed: number;
  cost_authorized: number; created_at: string; updated_at: string;
};

export function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? DEFAULT_ADMIN_EMAIL).split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(email: string | undefined | null) {
  return Boolean(email && adminEmails().includes(email.toLowerCase()));
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const ACTIVE_AUTOMATIC_STATUSES = new Set([
  "queued_mac", "queued_skill", "queued_server", "approved_for_execution", "running_on_mac",
  "dispatching_skill", "syncing_skill", "dispatching_server", "syncing_server", "running",
]);

function taskOperation(task: AdminTaskRow, nowMs = Date.now()) {
  const updatedMs = Date.parse(task.updated_at || task.created_at);
  const ageMinutes = Math.max(0, Math.floor((nowMs - (Number.isFinite(updatedMs) ? updatedMs : nowMs)) / 60_000));
  let priority: "critical" | "warning" | "normal" | "done" = "normal";
  let nextAction = "继续观察任务状态";
  let slaMinutes = 45;

  if (task.status === "completed") {
    priority = "done";
    nextAction = task.output_path ? "已交付，无需处理" : "核查完成状态与成片路径";
  } else if (task.status === "blocked") {
    priority = "critical";
    nextAction = task.blocker === "awaiting_content_qa" ? "验收成片并交付" : "检查阻塞原因，重试或转人工兜底";
    slaMinutes = task.blocker === "awaiting_content_qa" ? 120 : 30;
  } else if (["awaiting_human_login", "awaiting_human_verification"].includes(task.status)) {
    priority = "critical";
    nextAction = task.status === "awaiting_human_verification"
      ? "等待本人完成 Miora 真人验证后继续"
      : "等待本人完成 Miora 登录或验证码后继续";
    slaMinutes = 24 * 60;
  } else if (task.status === "awaiting_manual_operator") {
    priority = "critical";
    nextAction = "立即接单，开始人工兜底";
    slaMinutes = 30;
  } else if (task.status === "manual_in_progress") {
    priority = ageMinutes >= 24 * 60 ? "critical" : ageMinutes >= 12 * 60 ? "warning" : "normal";
    nextAction = "跟进人工制作，完成质检与交付";
    slaMinutes = 24 * 60;
  } else if (ACTIVE_AUTOMATIC_STATUSES.has(task.status)) {
    priority = ageMinutes >= 60 ? "critical" : ageMinutes >= 30 ? "warning" : "normal";
    nextAction = ageMinutes >= 30 ? "检查自动渠道；必要时转人工兜底" : "等待自动渠道返回";
  }

  const overdue = priority !== "done" && ageMinutes > slaMinutes;
  if (overdue) priority = "critical";
  return {
    ageMinutes,
    priority,
    overdue,
    attention: priority === "critical" || priority === "warning" || task.status === "awaiting_manual_operator",
    nextAction,
    slaMinutes,
  };
}

async function workerStatus() {
  const statePath = path.join(process.cwd(), "data", "video-worker-state.json");
  try {
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      pid?: number; startedAt?: string; heartbeatAt?: string; status?: string; modes?: string[];
      pollMs?: number; codexAvailable?: boolean; lastTaskId?: string | null;
      lastResult?: string | null; lastError?: string | null; mimoDirectConfigured?: boolean;
    };
    const pollMs = Math.max(Number(state.pollMs ?? 5000), 1000);
    const heartbeatAge = state.heartbeatAt ? Date.now() - Date.parse(state.heartbeatAt) : Number.POSITIVE_INFINITY;
    const activeStatus = ["starting", "idle", "working"].includes(state.status ?? "");
    return {
      online: activeStatus && heartbeatAge <= Math.max(30_000, pollMs * 4),
      status: state.status ?? "unknown",
      pid: Number.isInteger(state.pid) ? state.pid : null,
      startedAt: state.startedAt ?? null,
      heartbeatAt: state.heartbeatAt ?? null,
      modes: Array.isArray(state.modes) ? state.modes : [],
      codexAvailable: Boolean(state.codexAvailable),
      mimoDirectConfigured: Boolean(state.mimoDirectConfigured),
      serverConfigured: Boolean(process.env.VIDEO_SERVER_DISPATCH_URL),
      lastTaskId: state.lastTaskId ?? null,
      lastResult: state.lastResult ?? null,
      lastError: state.lastError ?? null,
    };
  } catch {
    return {
      online: false,
      status: "not_started",
      pid: null,
      startedAt: null,
      heartbeatAt: null,
      modes: [],
      codexAvailable: false,
      mimoDirectConfigured: false,
      serverConfigured: Boolean(process.env.VIDEO_SERVER_DISPATCH_URL),
      lastTaskId: null,
      lastResult: null,
      lastError: null,
    };
  }
}

async function macWorkerStatus() {
  const statePath = path.join(process.cwd(), "data", "mac-codex-worker-state.json");
  const heartbeatTtlMs = Math.max(Number(process.env.MAC_CODEX_HEARTBEAT_TTL_SECONDS ?? 120), 30) * 1000;
  try {
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      workerId?: string; status?: string; heartbeatAt?: string; activeTaskId?: string | null;
      summary?: string | null; version?: string | null;
      readiness?: {
        checkedAt?: string; readyToClaim?: boolean; blocker?: string | null;
        computer?: { hostname?: string; platform?: string; arch?: string; workspaceWritable?: boolean; ffprobeAvailable?: boolean };
        skills?: { state?: string; bundleName?: string | null; bundleVersion?: string | null; skills?: number | null; blocker?: string | null };
        channel?: { id?: string; state?: string; checkedAt?: string; reachable?: boolean | null; authenticated?: boolean | null; credits?: string | null; model?: string; blocker?: string | null };
      } | null;
    };
    const heartbeatAge = state.heartbeatAt ? Date.now() - Date.parse(state.heartbeatAt) : Number.POSITIVE_INFINITY;
    const activeStatus = ["idle", "claiming", "running", "blocked"].includes(state.status ?? "");
    const readinessAge = state.readiness?.checkedAt ? Date.now() - Date.parse(state.readiness.checkedAt) : Number.POSITIVE_INFINITY;
    const readinessTtlMs = Math.max(Number(process.env.MAC_CODEX_READINESS_TTL_SECONDS ?? 180), 60) * 1000;
    const online = Boolean(process.env.MAC_CODEX_AGENT_TOKEN) && activeStatus && heartbeatAge <= heartbeatTtlMs;
    const productionReady = online && state.readiness?.readyToClaim === true && readinessAge >= 0 && readinessAge <= readinessTtlMs;
    return {
      configured: Boolean(process.env.MAC_CODEX_AGENT_TOKEN),
      online,
      productionReady,
      status: state.status ?? "not_started",
      workerId: state.workerId ?? null,
      heartbeatAt: state.heartbeatAt ?? null,
      activeTaskId: state.activeTaskId ?? null,
      summary: state.summary ?? null,
      version: state.version ?? null,
      readiness: state.readiness ?? null,
    };
  } catch {
    return {
      configured: Boolean(process.env.MAC_CODEX_AGENT_TOKEN),
      online: false,
      productionReady: false,
      status: "not_started",
      workerId: null,
      heartbeatAt: null,
      activeTaskId: null,
      summary: null,
      version: null,
      readiness: null,
    };
  }
}

async function mimoWindowsWorkerStatus() {
  const heartbeatTtlMs = Math.max(Number(process.env.MIMO_WINDOWS_HEARTBEAT_TTL_SECONDS ?? 120), 30) * 1000;
  const readinessTtlMs = Math.max(Number(process.env.MIMO_WINDOWS_READINESS_TTL_SECONDS ?? 180), 60) * 1000;
  const state = await readMimoWorkerState();
  const heartbeatAge = state?.heartbeatAt ? Date.now() - Date.parse(state.heartbeatAt) : Number.POSITIVE_INFINITY;
  const readinessAge = state?.readiness?.checkedAt ? Date.now() - Date.parse(state.readiness.checkedAt) : Number.POSITIVE_INFINITY;
  const activeStatus = ["idle", "claiming", "running", "blocked"].includes(state?.status ?? "");
  const configured = Boolean(process.env.MIMO_WINDOWS_AGENT_TOKEN);
  const online = configured && activeStatus && heartbeatAge >= 0 && heartbeatAge <= heartbeatTtlMs;
  const readyToClaim = online && state?.readiness?.readyToClaim === true && readinessAge >= 0 && readinessAge <= readinessTtlMs;
  return {
    configured,
    online,
    readyToClaim,
    status: state?.status ?? "not_started",
    workerId: state?.workerId ?? null,
    heartbeatAt: state?.heartbeatAt ?? null,
    activeTaskId: state?.activeTaskId ?? null,
    summary: state?.summary ?? null,
    version: state?.version ?? null,
    readiness: state?.readiness ?? null,
  };
}

export async function getAdminOverview() {
  const [users, tasks, events, counts, worker, macWorker, mimoWindowsWorker, mimoReadiness, dolaReadiness, mioraReadiness, mioraSession, mioraHandoffs, mioraLearning, credits, recentRedemptions] = await Promise.all([
    dbAll<{ id: string; email: string; created_at: string; project_count: string | number; task_count: string | number }>(
      `SELECT users.id, users.email, users.created_at,
        COUNT(DISTINCT projects.id) AS project_count, COUNT(DISTINCT video_tasks.id) AS task_count
       FROM users LEFT JOIN projects ON projects.user_id = users.id
       LEFT JOIN video_tasks ON video_tasks.user_id = users.id
       GROUP BY users.id, users.email, users.created_at ORDER BY users.created_at DESC`,
    ),
    dbAll<AdminTaskRow>(
      `SELECT video_tasks.*, users.email AS user_email FROM video_tasks
       JOIN users ON users.id = video_tasks.user_id ORDER BY video_tasks.created_at DESC LIMIT 100`,
    ),
    dbAll<{ id: string; task_id: string; event: string; detail: string | null; created_at: string; user_email: string }>(
      `SELECT video_task_events.id, video_task_events.task_id, video_task_events.event,
        video_task_events.detail, video_task_events.created_at, users.email AS user_email
       FROM video_task_events JOIN video_tasks ON video_tasks.id = video_task_events.task_id
       JOIN users ON users.id = video_tasks.user_id ORDER BY video_task_events.created_at DESC LIMIT 60`,
    ),
    dbOne<{ users: string | number; projects: string | number; tasks: string | number; pending: string | number; blocked: string | number; completed: string | number }>(
      `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM projects) AS projects,
       (SELECT COUNT(*) FROM video_tasks) AS tasks,
       (SELECT COUNT(*) FROM video_tasks WHERE status IN ('awaiting_manual_operator','manual_in_progress','awaiting_human_login','awaiting_human_verification','queued_mac','queued_skill','queued_server','approved_for_execution','running_on_mac','dispatching_skill','syncing_skill','dispatching_server','syncing_server','running')) AS pending,
       (SELECT COUNT(*) FROM video_tasks WHERE status = 'blocked') AS blocked,
       (SELECT COUNT(*) FROM video_tasks WHERE status = 'completed') AS completed`,
    ),
    workerStatus(),
    macWorkerStatus(),
    mimoWindowsWorkerStatus(),
    getMimoReadiness(),
    getDolaReadiness(),
    getMioraReadiness(),
    getMioraSession(),
    listMioraHandoffs(),
    getMioraLearningProfile(),
    adminCreditOverview(),
    dbOne<{ count: string | number }>(
      "SELECT COUNT(*) AS count FROM credit_redemptions WHERE redeemed_at >= ?",
      [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()],
    ),
  ]);

  const nowMs = Date.now();
  const adminTasks = tasks.map((task) => ({
    id: task.id, userEmail: task.user_email, executionMode: task.execution_mode, channel: task.channel,
    prompt: task.prompt, model: task.model, resolution: task.resolution, durationSeconds: task.duration_seconds,
    aspectRatio: task.aspect_ratio, assets: JSON.parse(task.asset_manifest), status: task.status,
    blocker: task.blocker, providerTaskId: task.provider_task_id, outputPath: task.output_path,
    submitAllowed: Boolean(task.submit_allowed), costAuthorized: Boolean(task.cost_authorized),
    createdAt: task.created_at, updatedAt: task.updated_at, operation: taskOperation(task, nowMs),
  }));
  const operationSummary = {
    critical: adminTasks.filter((task) => task.operation.priority === "critical").length,
    warning: adminTasks.filter((task) => task.operation.priority === "warning").length,
    overdue: adminTasks.filter((task) => task.operation.overdue).length,
    awaitingManual: adminTasks.filter((task) => ["awaiting_manual_operator", "awaiting_human_login", "awaiting_human_verification"].includes(task.status)).length,
    awaitingQa: adminTasks.filter((task) => task.status === "blocked" && task.blocker === "awaiting_content_qa").length,
    recentUsers: users.filter((user) => Date.parse(user.created_at) >= nowMs - 24 * 60 * 60 * 1000).length,
    recentRedemptions: asNumber(recentRedemptions?.count),
  };

  return {
    stats: { users: asNumber(counts?.users), projects: asNumber(counts?.projects), tasks: asNumber(counts?.tasks), pending: asNumber(counts?.pending), blocked: asNumber(counts?.blocked), completed: asNumber(counts?.completed) },
    users: users.map((user) => ({ id: user.id, email: user.email, createdAt: user.created_at, projectCount: asNumber(user.project_count), taskCount: asNumber(user.task_count), isAdmin: isAdminEmail(user.email) })),
    tasks: adminTasks,
    operations: operationSummary,
    events: events.map((event) => ({ id: event.id, taskId: event.task_id, event: event.event, detail: event.detail, createdAt: event.created_at, userEmail: event.user_email })),
    worker,
    macWorker,
    mimoWindowsWorker,
    channels: [
      {
        id: "mimo",
        label: "渠道 M",
        configured: mimoReadiness.configured,
        status: mimoReadiness.state,
        modes: ["windows_skill", "legacy_mac"],
      },
      {
        id: "dola",
        label: "Dola",
        configured: dolaReadiness.configured,
        status: dolaReadiness.state,
        modes: ["windows_skill"],
      },
      {
        id: "miora",
        label: "Miora · 方法13",
        configured: mioraReadiness.configured,
        status: mioraReadiness.state,
        modes: ["server_auto"],
      },
    ],
    mimoReadiness,
    dolaReadiness,
    mioraReadiness,
    mioraSession,
    mioraHandoffs,
    mioraLearning,
    credits,
  };
}

async function updateSpec(task: AdminTaskRow, mutate: (spec: Record<string, unknown>) => void | Promise<void>) {
  const spec = JSON.parse(await readFile(task.task_spec_path, "utf8")) as Record<string, unknown>;
  await mutate(spec);
  const temporary = `${task.task_spec_path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  await rename(temporary, task.task_spec_path);
}

type LegacyDeliveryStage = "validate_output_path" | "validate_ledger" | "ffprobe" | "cos_upload" | "cos_verify" | "final_db_state";

async function recordLegacyDeliveryStage(taskId: string, attemptId: string, detail: {
  stage: LegacyDeliveryStage;
  outcome: "succeeded" | "failed";
  code?: string;
  skipped?: boolean;
  probedDuration?: number;
  durationTolerance?: number | null;
  byteSize?: number;
  sha256?: string;
}) {
  await dbRun(
    "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    [createId(), taskId, "legacy_mimo_delivery_backfill", JSON.stringify({ schema: "legacy_mimo_delivery_backfill.v1", attemptId, ...detail }), timestamp()],
  );
}

export async function updateAdminTask(input: {
  taskId: string;
  action: string;
  note?: string;
  costReadback?: string;
  maxCost?: string;
  outputPath?: string;
  ledgerPath?: string;
  contentQaPassed?: boolean;
  providerTaskId?: string;
  channel?: string;
}) {
  const task = await dbOne<AdminTaskRow>(
    `SELECT video_tasks.*, users.email AS user_email FROM video_tasks
     JOIN users ON users.id = video_tasks.user_id WHERE video_tasks.id = ? LIMIT 1`, [input.taskId],
  );
  if (!task) throw new Error("TASK_NOT_FOUND");
  const now = timestamp();
  let status = task.status;
  let blocker = task.blocker;
  let submitAllowed = task.submit_allowed;
  let costAuthorized = task.cost_authorized;
  let providerTaskId = task.provider_task_id;
  let outputPath = task.output_path;
  let channel = task.channel;
  let executionMode = task.execution_mode;
  const detail: Record<string, unknown> = { note: input.note?.trim() || undefined };
  let legacyBackfillAttemptId: string | null = null;

  if (input.action === "create_automatic_test") {
    if (task.status !== "completed") throw new Error("AUTOMATIC_TEST_SOURCE_NOT_COMPLETED");
    const assetIds = (JSON.parse(task.asset_manifest) as Array<{ id?: unknown }>).map((asset) => String(asset?.id || "")).filter(Boolean);
    if (!assetIds.length) throw new Error("AUTOMATIC_TEST_SOURCE_ASSETS_MISSING");
    const automaticMode = task.channel === "dola" || task.channel === "mimo" ? "codex_skill" : task.channel === "miora" ? "server_auto" : "mac_codex";
    const automaticChannel = task.channel === "dola" ? "dola" : task.channel === "miora" ? "miora" : "mimo";
    const testTask = await createVideoTask({ userId: task.user_id, executionMode: automaticMode, channel: automaticChannel, serviceMode: "automatic", chargeCredits: task.channel !== "miora", prompt: task.prompt, model: task.model, resolution: task.resolution, durationSeconds: task.duration_seconds, aspectRatio: task.aspect_ratio, assetIds });
    await dbRun("INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)", [createId(), task.id, "admin_automatic_test_created", JSON.stringify({ testTaskId: testTask.id }), now]);
    return { ok: true, status: "created", testTaskId: testTask.id };
  }
  if (input.action === "route_channel") {
    const requestedChannel = input.channel?.trim().toLowerCase();
    if (!(["mimo", "dola", "miora"] as const).includes(requestedChannel as "mimo" | "dola" | "miora")) throw new Error("CHANNEL_ROUTE_INVALID");
    const nextChannel = requestedChannel as "mimo" | "dola" | "miora";
    if (task.provider_task_id || task.submit_allowed === 1 || task.cost_authorized === 1 || !["queued_mac", "queued_skill", "queued_server"].includes(task.status)) {
      throw new Error("CHANNEL_ROUTE_STATE_INVALID");
    }
    if (nextChannel === "dola") validateDolaPrompt(task.prompt);
    channel = nextChannel;
    executionMode = nextChannel === "dola" || nextChannel === "mimo" ? "codex_skill" : nextChannel === "miora" ? "server_auto" : "mac_codex";
    status = nextChannel === "dola" || nextChannel === "mimo" ? "queued_skill" : nextChannel === "miora" ? "queued_server" : "queued_mac";
    blocker = "awaiting_cost_readback_and_submit_authorization";
    submitAllowed = 0;
    costAuthorized = 0;
    await updateSpec(task, (spec) => {
      const references = Array.isArray(spec.references) ? spec.references as Array<Record<string, unknown>> : [];
      const existingPlans = spec.channel_reference_plan && typeof spec.channel_reference_plan === "object"
        ? spec.channel_reference_plan as Record<string, unknown>
        : {};
      spec.execution_mode = executionMode;
      spec.allowed_channels = [channel];
      spec.channel_reference_plan = channel === "dola"
        ? { ...existingPlans, dola: dolaReferencePlan(references) }
        : channel === "miora"
          ? { ...existingPlans, miora: mioraReferencePlan(references) }
          : existingPlans;
      spec.status = "prepared";
      spec.blocker = blocker;
      spec.submit_allowed = false;
      spec.cost_gate = { authorized: false, max_cost: "", readback: "pending" };
      spec.skill_route = channel === "dola"
        ? ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "dola-video-channel"]
        : channel === "miora"
          ? [...mioraSkillChain]
        : ["ai-video-production-router", "ai-video-channel-router", "mimo-8001-video-channel"];
    });
    detail.channel = channel;
    detail.executionMode = executionMode;
    detail.submitAllowed = false;
  } else if (input.action === "fallback_manual") {
    if (!["mac_codex", "codex_skill", "server_auto"].includes(task.execution_mode) || task.status === "completed" || task.blocker === "awaiting_content_qa") {
      throw new Error("MANUAL_FALLBACK_STATE_INVALID");
    }
    executionMode = "manual_assist"; status = "awaiting_manual_operator";
    blocker = "administrator_selected_manual_fallback"; submitAllowed = 0; providerTaskId = null;
    await updateSpec(task, (spec) => {
      spec.execution_mode = executionMode; spec.status = status; spec.blocker = blocker; spec.submit_allowed = false;
      spec.fallback = { mode: "manual_assist", surcharge_credits: 0 };
    });
    detail.surchargeCredits = 0;
  } else if (input.action === "retry_automatic") {
    if (task.execution_mode !== "manual_assist" || task.status === "completed") {
      throw new Error("AUTOMATIC_RETRY_STATE_INVALID");
    }
    const canReusePreSubmitAuthorization = task.status === "awaiting_manual_operator"
      && task.blocker === "automatic_generation_failed_manual_fallback"
      && !task.provider_task_id
      && task.cost_authorized === 1;
    executionMode = task.channel === "dola" || task.channel === "mimo" ? "codex_skill" : task.channel === "miora" ? "server_auto" : "mac_codex";
    status = canReusePreSubmitAuthorization ? "approved_for_execution" : task.channel === "dola" || task.channel === "mimo" ? "queued_skill" : task.channel === "miora" ? "queued_server" : "queued_mac";
    blocker = canReusePreSubmitAuthorization ? null : "awaiting_cost_readback_and_submit_authorization";
    submitAllowed = canReusePreSubmitAuthorization ? 1 : 0;
    costAuthorized = canReusePreSubmitAuthorization ? 1 : 0;
    providerTaskId = null;
    await updateSpec(task, (spec) => {
      const existingCostGate = (spec.cost_gate ?? {}) as Record<string, unknown>;
      if (canReusePreSubmitAuthorization && existingCostGate.authorized !== true) {
        throw new Error("PRE_SUBMIT_RETRY_COST_AUTH_MISMATCH");
      }
      spec.execution_mode = executionMode;
      spec.status = canReusePreSubmitAuthorization ? "approved_for_execution" : "prepared";
      spec.blocker = blocker;
      spec.submit_allowed = canReusePreSubmitAuthorization;
      if (!canReusePreSubmitAuthorization) {
        spec.cost_gate = { authorized: false, max_cost: "", readback: "pending" };
      }
      spec.retry = {
        kind: canReusePreSubmitAuthorization ? "pre_submit_failure_same_authorization" : "new_authorization_required",
        requested_at: now,
      };
    });
    detail.retryMode = canReusePreSubmitAuthorization ? "pre_submit_failure_same_authorization" : "new_authorization_required";
  } else if (input.action === "resume_provider_sync") {
    const recoverableProviderSync = Boolean(task.provider_task_id) && (
      (["mac_codex", "codex_skill", "server_auto"].includes(task.execution_mode) && ["blocked", "running_on_mac", "running"].includes(task.status))
      || (task.execution_mode === "manual_assist" && task.status === "awaiting_manual_operator" && task.blocker === "automatic_generation_failed_manual_fallback")
    );
    if (!recoverableProviderSync) {
      throw new Error("PROVIDER_SYNC_RESUME_INVALID");
    }
    executionMode = task.channel === "dola" || task.channel === "mimo" ? "codex_skill" : task.channel === "miora" ? "server_auto" : "mac_codex";
    status = "approved_for_execution";
    blocker = null;
    submitAllowed = 1;
    costAuthorized = 1;
    await updateSpec(task, (spec) => {
      spec.execution_mode = executionMode;
      spec.status = "approved_for_execution";
      spec.blocker = null;
      spec.submit_allowed = true;
      spec.provider_task_id = task.provider_task_id;
      spec.resume = { kind: "provider_sync_only", requested_at: now };
    });
    detail.resumeMode = "provider_sync_only";
  } else if (input.action === "miora_handoff_completed") {
    if (task.channel !== "miora" || !["awaiting_human_login", "awaiting_human_verification"].includes(task.status) || task.cost_authorized !== 1) {
      throw new Error("MIORA_HANDOFF_RESUME_INVALID");
    }
    const handoff = await resolveMioraHandoffForTask(task.id);
    executionMode = "server_auto";
    status = "approved_for_execution";
    blocker = null;
    submitAllowed = 1;
    costAuthorized = 1;
    await updateSpec(task, (spec) => {
      spec.execution_mode = "server_auto";
      spec.status = "approved_for_execution";
      spec.blocker = null;
      spec.submit_allowed = true;
      spec.resume = {
        kind: task.provider_task_id ? "provider_sync_only_after_human_handoff" : "submit_after_human_handoff",
        handoff_id: handoff.id,
        requested_at: now,
      };
    });
    detail.handoffId = handoff.id;
    detail.resumeMode = task.provider_task_id ? "provider_sync_only_after_human_handoff" : "submit_after_human_handoff";
  } else if (input.action === "claim_manual") {
    status = "manual_in_progress"; blocker = null;
    await updateSpec(task, (spec) => { spec.status = status; spec.blocker = null; });
  }
  else if (input.action === "approve_cost") {
    const readback = input.costReadback?.trim();
    if (!readback) throw new Error("COST_READBACK_REQUIRED");
    if (task.channel === "dola") {
      validateDolaPrompt(task.prompt);
      const readiness = await getDolaReadiness({ force: true });
      if (readiness.state !== "ready") throw new Error(`DOLA_PREFLIGHT_REQUIRED:${readiness.state}`);
      detail.dolaPreflightCheckedAt = readiness.checkedAt;
      detail.dolaAdapterIdentity = "dola2api_local_bridge_v1";
    }
    if (task.channel === "miora") {
      const readiness = await runMioraPreflight();
      if (readiness.state !== "ready") throw new Error(`MIORA_PREFLIGHT_REQUIRED:${readiness.state}`);
      detail.mioraPreflightCheckedAt = readiness.checkedAt;
      detail.mioraCredits = readiness.credits;
    }
    status = task.execution_mode === "manual_assist" && task.status === "manual_in_progress"
      ? "manual_in_progress"
      : "approved_for_execution";
    blocker = null; submitAllowed = 1; costAuthorized = 1;
    detail.costReadback = readback; detail.maxCost = input.maxCost?.trim() || "admin-approved";
    await updateSpec(task, (spec) => {
      if (!Array.isArray(spec.allowed_channels) || !spec.allowed_channels.includes(task.channel)) throw new Error("CHANNEL_TASK_SPEC_MISMATCH");
      if (task.channel === "dola") {
        const expectedRoute = ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "dola-video-channel"];
        if (JSON.stringify(spec.skill_route ?? []) !== JSON.stringify(expectedRoute)) throw new Error("DOLA_SKILL_ROUTE_MISMATCH");
      }
      if (task.channel === "miora") {
        if (JSON.stringify(spec.skill_route ?? []) !== JSON.stringify([...mioraSkillChain])) throw new Error("MIORA_SKILL_ROUTE_MISMATCH");
      }
      spec.submit_allowed = true; spec.status = status; spec.blocker = null;
      spec.cost_gate = { authorized: true, max_cost: detail.maxCost, readback };
    });
  } else if (input.action === "mark_running") {
    if (["mac_codex", "codex_skill"].includes(task.execution_mode)) throw new Error("AUTOMATIC_WORKER_OWNS_PROVIDER_STATE");
    status = task.execution_mode === "manual_assist" ? "manual_in_progress" : "running";
    blocker = null; providerTaskId = input.providerTaskId?.trim() || providerTaskId;
    if (!providerTaskId) throw new Error("PROVIDER_TASK_ID_REQUIRED");
    await updateSpec(task, (spec) => {
      spec.status = status; spec.blocker = null; spec.provider_task_id = providerTaskId;
    });
  } else if (input.action === "reconcile_official_frontend") {
    const externalProviderTaskId = input.providerTaskId?.trim() || "";
    if (task.channel !== "mimo" || task.execution_mode !== "manual_assist" || task.status !== "awaiting_manual_operator" || task.provider_task_id) {
      throw new Error("OFFICIAL_FRONTEND_RECONCILIATION_STATE_INVALID");
    }
    if (!/^[A-Za-z0-9._-]{3,240}$/.test(externalProviderTaskId)) throw new Error("PROVIDER_TASK_ID_INVALID");
    executionMode = "codex_skill";
    status = "approved_for_execution";
    blocker = "official_frontend_result_reconciliation";
    submitAllowed = 1;
    costAuthorized = 1;
    providerTaskId = externalProviderTaskId;
    detail.providerTaskId = providerTaskId;
    detail.reconciliationOnly = true;
    await updateSpec(task, (spec) => {
      spec.execution_mode = "codex_skill";
      spec.status = "approved_for_execution";
      spec.blocker = "official_frontend_result_reconciliation";
      spec.submit_allowed = true;
      spec.provider_task_id = providerTaskId;
      spec.reconciliation_only = true;
      spec.allowed_channels = ["mimo"];
      spec.skill_route = ["ai-video-production-router", "ai-video-channel-router", "mimo-8001-video-channel"];
      spec.cost_gate = { authorized: true, max_cost: "0", readback: "administrator authorized reconciliation of an existing official provider task" };
    });
  } else if (input.action === "block") {
    status = "blocked"; blocker = input.note?.trim() || "管理员暂停任务"; submitAllowed = 0;
    await updateSpec(task, (spec) => {
      spec.status = status; spec.blocker = blocker; spec.submit_allowed = false;
    });
  } else if (input.action === "retry") {
    status = task.execution_mode === "manual_assist"
      ? "awaiting_manual_operator"
      : task.execution_mode === "mac_codex"
        ? "queued_mac"
        : task.execution_mode === "codex_skill"
          ? "queued_skill"
          : "queued_server";
    blocker = task.execution_mode === "manual_assist" ? "awaiting_manual_operator" : "awaiting_cost_readback_and_submit_authorization";
    submitAllowed = 0; costAuthorized = 0; providerTaskId = null;
    await updateSpec(task, (spec) => {
      spec.submit_allowed = false; spec.status = "prepared"; spec.blocker = blocker;
      spec.cost_gate = { authorized: false, max_cost: "", readback: "pending" };
    });
  } else if (input.action === "complete") {
    if (task.execution_mode !== "manual_assist" || task.status !== "manual_in_progress") {
      throw new Error("MANUAL_TASK_STATE_INVALID");
    }
    outputPath = input.outputPath?.trim() || outputPath;
    if (!outputPath) throw new Error("OUTPUT_PATH_REQUIRED");
    const verifiedOutputPath = outputPath;
    const ledgerPath = input.ledgerPath?.trim();
    if (!ledgerPath) throw new Error("LEDGER_PATH_REQUIRED");
    if (input.contentQaPassed !== true) throw new Error("CONTENT_QA_REQUIRED");
    status = "completed"; blocker = null; submitAllowed = 0;
    await updateSpec(task, async (spec) => {
      const outputPaths = (spec.output_paths ?? {}) as Record<string, unknown>;
      const expectedDuration = Number(String(spec.duration ?? task.duration_seconds).replace(/[^\d.]/g, ""));
      const evidence = await validateCompletedOutput({
        outputPath: verifiedOutputPath,
        ledgerPath,
        downloadsRoot: String(outputPaths.downloads ?? ""),
        ledgerRoot: String(outputPaths.ledger ?? ""),
        contentQaPassed: true,
        expectedDuration,
      });
      const cosDelivery = await uploadAndVerifyVideoDelivery({ userId: task.user_id, taskId: task.id, outputPath: verifiedOutputPath });
      detail.outputPath = verifiedOutputPath;
      detail.ledgerPath = ledgerPath;
      detail.contentQaPassed = true;
      detail.probedDuration = evidence.probedDuration;
      spec.status = status;
      spec.blocker = null;
      spec.submit_allowed = false;
      spec.output_path = verifiedOutputPath;
      spec.completion_evidence = {
        media_probe_passed: true,
        content_qa_passed: true,
        ledger_path: ledgerPath,
        probed_duration_seconds: evidence.probedDuration,
        ...(cosDelivery ? { cos: cosDelivery } : {}),
      };
    });
  } else if (input.action === "review_output") {
    if (task.status !== "blocked" || task.blocker !== "awaiting_content_qa" || !task.provider_task_id || !task.output_path) {
      throw new Error("PROVIDER_OUTPUT_REVIEW_NOT_AVAILABLE");
    }
    if (input.contentQaPassed !== true) throw new Error("CONTENT_QA_REQUIRED");
    const verifiedOutputPath = task.output_path;
    status = "completed";
    blocker = null;
    submitAllowed = 0;
    const attemptId = createId();
    legacyBackfillAttemptId = attemptId;
    await updateSpec(task, async (spec) => {
      const outputPaths = (spec.output_paths ?? {}) as Record<string, unknown>;
      const ledgerPath = typeof spec.provider_ledger_path === "string" ? spec.provider_ledger_path : "";
      const expectedDuration = Number(String(spec.duration ?? task.duration_seconds).replace(/[^\d.]/g, ""));
      const { evidence, cosDelivery } = await runLegacyMimoDeliveryBackfill({
        recordStage: (stageDetail: any) => recordLegacyDeliveryStage(task.id, attemptId, stageDetail),
        validateOutputPath: () => validateOutputFile({ outputPath: verifiedOutputPath, downloadsRoot: String(outputPaths.downloads ?? "") }),
        validateLedger: () => validateOutputLedger({ ledgerPath, ledgerRoot: String(outputPaths.ledger ?? "") }),
        probeAndValidate: () => validateOutputDuration({ outputPath: verifiedOutputPath, expectedDuration }),
        uploadAndVerify: (onStage: any) => uploadAndVerifyVideoDelivery({
          userId: task.user_id,
          taskId: task.id,
          outputPath: verifiedOutputPath,
          onStage: (stage: any, stageDetail: any) => onStage(stage, stageDetail),
        }),
      });
      detail.outputPath = verifiedOutputPath;
      detail.ledgerPath = ledgerPath;
      detail.contentQaPassed = true;
      detail.probedDuration = evidence.probedDuration;
      spec.status = status;
      spec.blocker = null;
      spec.submit_allowed = false;
      spec.output_path = verifiedOutputPath;
      spec.completion_evidence = {
        media_probe_passed: true,
        content_qa_passed: true,
        ledger_path: ledgerPath,
        probed_duration_seconds: evidence.probedDuration,
        ...(cosDelivery ? { cos: cosDelivery } : {}),
      };
    });
  } else throw new Error("ACTION_INVALID");

  try {
    await dbRun(
      "UPDATE video_tasks SET execution_mode = ?, status = ?, blocker = ?, provider_task_id = ?, output_path = ?, submit_allowed = ?, cost_authorized = ?, channel = ?, updated_at = ? WHERE id = ?",
      [executionMode, status, blocker, providerTaskId, outputPath, submitAllowed, costAuthorized, channel, now, task.id],
    );
    if (legacyBackfillAttemptId) {
      await recordLegacyDeliveryStage(task.id, legacyBackfillAttemptId, { stage: "final_db_state", outcome: "succeeded" });
    }
  } catch (error) {
    if (legacyBackfillAttemptId) {
      const code = safeLegacyDeliveryError(error);
      try {
        await recordLegacyDeliveryStage(task.id, legacyBackfillAttemptId, { stage: "final_db_state", outcome: "failed", code });
      } catch {
        // A database outage can prevent its own diagnostic event; never expose
        // the underlying driver error to the administrator UI.
      }
      throw new Error(code);
    }
    throw error;
  }
  if (input.action === "block") await refundTaskCredits(task.id);
  await dbRun("INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)", [createId(), task.id, `admin_${input.action}`, JSON.stringify(detail), now]);
  return { ok: true, status, blocker, submitAllowed: Boolean(submitAllowed), costAuthorized: Boolean(costAuthorized) };
}
