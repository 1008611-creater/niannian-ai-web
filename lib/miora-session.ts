import { createId, dbAll, dbOne, dbRun, timestamp } from "@/lib/auth";

export const mioraHandoffActions = ["login", "email_otp", "phone_otp", "captcha", "terms", "cost_authorization"] as const;
export type MioraHandoffAction = (typeof mioraHandoffActions)[number];
export const mioraHandoffStates = ["awaiting_user", "acknowledged", "resolved", "expired"] as const;
export type MioraHandoffState = (typeof mioraHandoffStates)[number];

export type MioraSessionSnapshot = {
  channel: "miora";
  state: string;
  visibleProjectUrl: string | null;
  creditReadback: string | null;
  modelReadback: string | null;
  lastPreflightAt: string | null;
  lastSuccessAt: string | null;
  lastBlocker: string | null;
  updatedAt: string;
};

export type MioraHumanHandoff = {
  id: string;
  taskId: string;
  channel: "miora";
  action: MioraHandoffAction;
  state: MioraHandoffState;
  instructions: string;
  browserUrl: string | null;
  resumeFrom: string;
  createdAt: string;
  resolvedAt: string | null;
};

type MioraReadback = {
  state: string;
  entryUrl: string;
  credits: string | null;
  model: string;
  checkedAt: string | null;
  blocker: string | null;
};

type SessionRow = {
  channel: string; state: string; visible_project_url: string | null; credit_readback: string | null;
  model_readback: string | null; last_preflight_at: string | null; last_success_at: string | null;
  last_blocker: string | null; updated_at: string;
};
type HandoffRow = {
  id: string; task_id: string; channel: string; action: string; state: string; instructions: string;
  browser_url: string | null; resume_from: string; created_at: string; resolved_at: string | null;
};

function sessionFromRow(row: SessionRow | null): MioraSessionSnapshot | null {
  if (!row || row.channel !== "miora") return null;
  return {
    channel: "miora", state: row.state, visibleProjectUrl: row.visible_project_url,
    creditReadback: row.credit_readback, modelReadback: row.model_readback,
    lastPreflightAt: row.last_preflight_at, lastSuccessAt: row.last_success_at,
    lastBlocker: row.last_blocker, updatedAt: row.updated_at,
  };
}

function handoffFromRow(row: HandoffRow): MioraHumanHandoff {
  return {
    id: row.id, taskId: row.task_id, channel: "miora",
    action: mioraHandoffActions.includes(row.action as MioraHandoffAction) ? row.action as MioraHandoffAction : "login",
    state: mioraHandoffStates.includes(row.state as MioraHandoffState) ? row.state as MioraHandoffState : "awaiting_user",
    instructions: row.instructions, browserUrl: row.browser_url, resumeFrom: row.resume_from,
    createdAt: row.created_at, resolvedAt: row.resolved_at,
  };
}

export async function recordMioraSessionReadback(readback: MioraReadback) {
  const now = timestamp();
  const successful = readback.state === "ready";
  const previous = await dbOne<SessionRow>("SELECT * FROM channel_sessions WHERE channel = ? LIMIT 1", ["miora"]);
  const lastSuccessAt = successful ? now : previous?.last_success_at ?? null;
  await dbRun(
    `INSERT INTO channel_sessions (channel, state, visible_project_url, credit_readback, model_readback, last_preflight_at, last_success_at, last_blocker, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel) DO UPDATE SET state = excluded.state, visible_project_url = excluded.visible_project_url,
       credit_readback = excluded.credit_readback, model_readback = excluded.model_readback,
       last_preflight_at = excluded.last_preflight_at, last_success_at = excluded.last_success_at,
       last_blocker = excluded.last_blocker, updated_at = excluded.updated_at`,
    ["miora", readback.state, readback.entryUrl, readback.credits, readback.model, readback.checkedAt, lastSuccessAt, readback.blocker, now],
  );
  return getMioraSession();
}

export async function getMioraSession() {
  return sessionFromRow(await dbOne<SessionRow>("SELECT * FROM channel_sessions WHERE channel = ? LIMIT 1", ["miora"]));
}

export async function listMioraHandoffs(activeOnly = true) {
  const rows = await dbAll<HandoffRow>(
    `SELECT * FROM channel_handoffs WHERE channel = ? ${activeOnly ? "AND state IN ('awaiting_user','acknowledged')" : ""} ORDER BY created_at DESC LIMIT 100`,
    ["miora"],
  );
  return rows.map(handoffFromRow);
}

export function mioraHandoffForBlocker(blocker: string) {
  const normalized = blocker.toLowerCase();
  if (/terms|agreement|privacy|服务协议|隐私/.test(normalized)) {
    return { action: "terms" as const, taskStatus: "awaiting_human_login", instructions: "请在已打开的 Miora 浏览器本人阅读并确认平台服务协议或隐私条款。系统不会把该条款伪装成普通登录，也不会代替你接受；完成后点击“我已完成，继续任务”。" };
  }
  if (/captcha|human|真人|验证/.test(normalized)) {
    return { action: "captcha" as const, taskStatus: "awaiting_human_verification", instructions: "请在已打开的 Miora 浏览器完成平台真人验证或 CAPTCHA。系统不会尝试绕过验证；完成后回到工作台点击“我已完成，继续任务”。" };
  }
  if (/email|邮箱|otp/.test(normalized)) {
    return { action: "email_otp" as const, taskStatus: "awaiting_human_login", instructions: "请在已打开的 Miora 浏览器完成邮箱验证码登录。不要把验证码交给工作台；完成后点击“我已完成，继续任务”。" };
  }
  if (/phone|手机|短信/.test(normalized)) {
    return { action: "phone_otp" as const, taskStatus: "awaiting_human_login", instructions: "请在已打开的 Miora 浏览器完成手机验证码登录。完成后点击“我已完成，继续任务”。" };
  }
  return { action: "login" as const, taskStatus: "awaiting_human_login", instructions: "请在已打开的 Miora 浏览器完成登录。系统没有保存账号、密码、Cookie 或验证码；完成后点击“我已完成，继续任务”。" };
}

export async function ensureMioraHandoff(input: { taskId: string; blocker: string; browserUrl: string | null; resumeFrom: string }) {
  const existing = await dbOne<HandoffRow>(
    "SELECT * FROM channel_handoffs WHERE task_id = ? AND channel = ? AND state IN ('awaiting_user','acknowledged') ORDER BY created_at DESC LIMIT 1",
    [input.taskId, "miora"],
  );
  if (existing) return handoffFromRow(existing);
  const definition = mioraHandoffForBlocker(input.blocker);
  const row: HandoffRow = {
    id: createId(), task_id: input.taskId, channel: "miora", action: definition.action, state: "awaiting_user",
    instructions: definition.instructions, browser_url: input.browserUrl, resume_from: input.resumeFrom,
    created_at: timestamp(), resolved_at: null,
  };
  await dbRun(
    "INSERT INTO channel_handoffs (id, task_id, channel, action, state, instructions, browser_url, resume_from, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [row.id, row.task_id, row.channel, row.action, row.state, row.instructions, row.browser_url, row.resume_from, row.created_at, row.resolved_at],
  );
  return handoffFromRow(row);
}

export async function resolveMioraHandoffForTask(taskId: string) {
  const handoff = await dbOne<HandoffRow>(
    "SELECT * FROM channel_handoffs WHERE task_id = ? AND channel = ? AND state IN ('awaiting_user','acknowledged') ORDER BY created_at DESC LIMIT 1",
    [taskId, "miora"],
  );
  if (!handoff) throw new Error("MIORA_HANDOFF_NOT_FOUND");
  const resolvedAt = timestamp();
  await dbRun("UPDATE channel_handoffs SET state = ?, resolved_at = ? WHERE id = ?", ["resolved", resolvedAt, handoff.id]);
  return { ...handoffFromRow(handoff), state: "resolved" as const, resolvedAt };
}
