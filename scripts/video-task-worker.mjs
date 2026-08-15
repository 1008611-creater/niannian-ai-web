#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { validateCompletedOutput } from "../lib/video-output-gate.mjs";
import { mimoDirectConfigured, runMimoDirectTask } from "./mimo-direct.mjs";
import { mioraDirectConfigured, runMioraDirectTask } from "./miora-direct.mjs";
import { higgsfieldDirectConfigured, runHiggsfieldDirectTask } from "./higgsfield-direct.mjs";

const { Client } = pg;
const currentFile = fileURLToPath(import.meta.url);
const projectDirectory = path.resolve(path.dirname(currentFile), "..");
const dataDirectory = path.join(projectDirectory, "data");
function workerStatePath() {
  const configured = String(process.env.VIDEO_WORKER_STATE_PATH ?? "").trim();
  if (!configured) return path.join(dataDirectory, "video-worker-state.json");
  const candidate = path.resolve(projectDirectory, configured);
  if (!candidate.startsWith(`${path.resolve(dataDirectory)}${path.sep}`)) throw new Error("VIDEO_WORKER_STATE_PATH_OUTSIDE_DATA_DIRECTORY");
  return candidate;
}
const statePath = workerStatePath();
const lockPath = path.join(dataDirectory, "video-worker.lock");
const resultSchemaPath = path.join(projectDirectory, "scripts", "video-task-result.schema.json");
const disabledChannels = new Set(["artflash", "tensor", "tensorart", "tensor.art", "echoon"]);
let activeLockToken = null;
const channelSkills = {
  mimo: "mimo-8001-video-channel",
  dola: "dola-video-channel",
  miora: "miora-seedance2-channel",
  astorie: "astorie-seedance2-channel",
  higgsfield: "higgsfield-cinema-studio-cli",
  tmlab: "tmlab-video-channel",
  djpsd: "djpsd-video-channel",
  freebeat: "ai-video-channel-router",
  runninghub: "ai-video-channel-router",
};
const dolaSkillChain = ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "dola-video-channel"];
const mioraSkillChain = ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "miora-seedance2-channel"];
const astorieSkillChain = ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "astorie-seedance2-channel"];
const higgsfieldSkillChain = ["ai-video-production-router", "ai-video-channel-router", "higgsfield-cinema-studio-cli"];

function now() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value ?? "")
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/bearer\s+[a-zA-Z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(password|token|secret|cookie)=\S+/gi, "$1=[redacted]")
    .slice(0, 4000);
}

async function loadEnvironment() {
  try {
    const content = await readFile(path.join(projectDirectory, ".env.local"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch {
    // Deployment environments can provide variables without a local env file.
  }
}

function configuredModes() {
  const modes = (process.env.VIDEO_WORKER_MODES ?? "server_auto")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value === "codex_skill" || value === "server_auto");
  return modes.length ? [...new Set(modes)] : ["server_auto"];
}

function configuredPollMs() {
  const value = Number(process.env.VIDEO_WORKER_POLL_MS ?? 5000);
  return Number.isFinite(value) && value >= 1000 ? value : 5000;
}

async function atomicJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock() {
  await mkdir(dataDirectory, { recursive: true });
  try {
    const existing = JSON.parse(await readFile(lockPath, "utf8"));
    // Docker restarts commonly reuse the container's worker PID. A lock written
    // by the immediately preceding container must not make this new process
    // reject itself as a second worker.
    if (Number(existing.pid) === process.pid) {
      await rm(lockPath, { force: true });
    } else if (processAlive(Number(existing.pid))) {
      throw new Error(`VIDEO_WORKER_ALREADY_RUNNING:${existing.pid}`);
    } else {
      await rm(lockPath, { force: true });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VIDEO_WORKER_ALREADY_RUNNING")) throw error;
  }
  const token = randomUUID();
  const handle = await open(lockPath, "wx");
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, startedAt: now() })}\n`, "utf8");
  await handle.close();
  return token;
}

async function releaseLock(token) {
  try {
    const existing = JSON.parse(await readFile(lockPath, "utf8"));
    if (existing.pid === process.pid && existing.token === token) {
      await rm(lockPath, { force: true });
    }
  } catch {
    // A stale or replaced lock must never be removed by this worker.
  }
}

async function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED_FOR_VIDEO_WORKER");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  return client;
}

export function validateTaskSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") return ["task_spec_invalid"];
  if (!spec.task_id) errors.push("task_id_missing");
  if (!spec.prompt_sha256) errors.push("prompt_sha256_missing");
  if (!Array.isArray(spec.references)) errors.push("references_invalid");
  if (!Array.isArray(spec.allowed_channels) || !spec.allowed_channels.length) errors.push("allowed_channels_missing");
  if (spec.submit_allowed !== true) errors.push("submit_not_authorized");
  if (!spec.cost_gate || spec.cost_gate.authorized !== true) errors.push("cost_not_authorized");
  if (spec.allowed_channels?.includes("dola")) {
    const prompt = String(spec.prompt ?? "").trim();
    if (/(?:第\s*)?\d+(?:\.\d+)?\s*(?:秒|s\b)|前\s*\d+(?:\.\d+)?\s*秒/i.test(prompt)) errors.push("dola_prompt_seconds_forbidden");
    if (/[“”"【】]/.test(prompt)) errors.push("dola_prompt_dialogue_quotes_forbidden");
    if (/\[[^\]]+\]/.test(prompt) && !prompt.startsWith("全程使用中国中文普通话对话，")) errors.push("dola_prompt_dialogue_prefix_required");
    if (JSON.stringify(spec.skill_route ?? []) !== JSON.stringify(dolaSkillChain)) errors.push("dola_skill_route_invalid");
  }
  if (spec.allowed_channels?.includes("miora")) {
    if (JSON.stringify(spec.skill_route ?? []) !== JSON.stringify(mioraSkillChain)) errors.push("miora_skill_route_invalid");
    if (String(spec.resolution ?? "").toLowerCase() !== "720p") errors.push("miora_resolution_720p_required");
    if (String(spec.duration ?? "") !== "15s") errors.push("miora_duration_15s_required");
  }
  if (spec.allowed_channels?.includes("astorie")) {
    if (JSON.stringify(spec.skill_route ?? []) !== JSON.stringify(astorieSkillChain)) errors.push("astorie_skill_route_invalid");
    if (String(spec.resolution ?? "").toLowerCase() !== "720p") errors.push("astorie_resolution_720p_required");
    const duration = Number(String(spec.duration ?? "").replace(/[^\d]/g, ""));
    if (!Number.isInteger(duration) || duration < 4 || duration > 15) errors.push("astorie_duration_4_15s_required");
    if (String(spec.model ?? "") !== "Seedance 2.0 Mini") errors.push("astorie_model_invalid");
    if ((spec.references ?? []).length > 1) errors.push("astorie_max_one_reference_required");
  }
  if (spec.allowed_channels?.includes("higgsfield")) {
    if (JSON.stringify(spec.skill_route ?? []) !== JSON.stringify(higgsfieldSkillChain)) errors.push("higgsfield_skill_route_invalid");
    if (String(spec.model ?? "") !== "Cinematic Studio Video 3.5") errors.push("higgsfield_model_invalid");
    if (String(spec.resolution ?? "").toLowerCase() !== "720p") errors.push("higgsfield_resolution_720p_required");
    if ((spec.references ?? []).length > 1) errors.push("higgsfield_max_one_reference_required");
  }
  return errors;
}

export function selectTaskChannel(task, spec) {
  const candidates = task.channel === "auto" ? spec.allowed_channels : [task.channel];
  const selected = candidates.find((channel) => !disabledChannels.has(String(channel).toLowerCase()));
  if (!selected) throw new Error("NO_ALLOWED_ACTIVE_CHANNEL");
  if (!spec.allowed_channels.includes(selected)) throw new Error("CHANNEL_OUTSIDE_TASK_SPEC");
  return selected;
}

export function isExecutableReference(reference) {
  return reference?.actual_video_input !== false;
}

export function normalizeWorkerResult(value) {
  let result = value;
  if (typeof result === "string") {
    result = JSON.parse(result.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  }
  if (!result || typeof result !== "object") throw new Error("WORKER_RESULT_INVALID");
  const status = String(result.status ?? "");
  if (!["completed", "running", "blocked", "failed"].includes(status)) {
    throw new Error("WORKER_RESULT_STATUS_INVALID");
  }
  return {
    status,
    providerTaskId: typeof result.providerTaskId === "string" && result.providerTaskId.trim()
      ? result.providerTaskId.trim()
      : null,
    outputPath: typeof result.outputPath === "string" && result.outputPath.trim()
      ? result.outputPath.trim()
      : null,
    blocker: typeof result.blocker === "string" && result.blocker.trim()
      ? result.blocker.trim()
      : null,
    summary: clean(result.summary || "worker returned no summary"),
    mediaProbePassed: result.mediaProbePassed === true,
    contentQaPassed: result.contentQaPassed === true,
    ledgerPath: typeof result.ledgerPath === "string" && result.ledgerPath.trim()
      ? result.ledgerPath.trim()
      : null,
  };
}

export function buildCodexPrompt(task, specPath, spec, channel) {
  const skill = channelSkills[channel] ?? "ai-video-channel-router";
  const orderedSkillChain = channel === "dola"
    ? dolaSkillChain
    : channel === "miora"
      ? mioraSkillChain
      : channel === "astorie"
        ? astorieSkillChain
    : ["ai-video-production-router", "ai-video-channel-router", skill];
  const operation = task.provider_task_id ? "sync_download_and_qa_only" : "submit_poll_download_and_qa";
  const authorizationChecksum = createHash("sha256")
    .update(JSON.stringify({
      submit_allowed: spec.submit_allowed,
      cost_gate: spec.cost_gate,
      allowed_channels: spec.allowed_channels,
    }))
    .digest("hex");
  return [
    "Execute one approved 念念AI video task. Do not modify application source code.",
    "Use the ai-video-channel-router skill and the named channel skill.",
    `Ordered Skill route: ${orderedSkillChain.join(" -> ")}`,
    `Channel skill: ${skill}`,
    `Selected channel: ${channel}`,
    `Operation: ${operation}`,
    `Authoritative video_task_spec.json: ${specPath}`,
    `Task id: ${task.id}`,
    `Existing provider task id: ${task.provider_task_id ?? "none"}`,
    "Read the exact task spec from disk. Use only its locked prompt, references, allowed channels, output paths, QA requirements, and cost gate.",
    "Real provider submission is allowed only because this exact spec has submit_allowed=true and cost_gate.authorized=true. Never use a different channel.",
    "If a provider task id already exists, do not submit again. Only sync, download, probe, QA, and update evidence.",
    ...(channel === "astorie" ? [
      "AStorie route: use only a configured, already authenticated AStorie browser/CDP session. Do not read or export browser cookies.",
      "Use the authenticated project canvas, open Add Node, search for Seedance 2.0 Mini, and configure the newly created video node. Do not use the standard AStorie video-hub unlock route.",
      "Before one Generate click, read back the selected model, 720P, duration, aspect ratio, visible balance, and the visible charge for this exact task. If the exact price is not already authorized in the task cost gate, return blocked with ASTORIE_LIVE_COST_AUTHORIZATION_REQUIRED and do not submit.",
      "Completion evidence is the same node changing to 1 / 1 plus an actual rendered player. If the node download action remains disabled, obtain only the currently rendered video asset from the page, then download and probe that exact file; do not guess provider endpoints or resubmit.",
    ] : []),
    "Do not expose passwords, API keys, cookies, bearer tokens, OTP codes, proxy credentials, or session data.",
    "Return completed only after a real local video exists, media probe and content QA pass, and a ledger file exists.",
    "Return only the JSON object required by the output schema.",
    `Authorization checksum: ${authorizationChecksum}`,
  ].join("\n");
}

async function ensurePromptSidecar(task, spec) {
  if (typeof spec.prompt_path === "string" && spec.prompt_path) return;
  if (typeof spec.prompt !== "string" || !spec.prompt.trim()) throw new Error("LOCKED_PROMPT_MISSING");
  const promptPath = task.task_spec_path.replace(/\.json$/i, ".prompt.txt");
  const prompt = spec.prompt.trim();
  await writeFile(promptPath, `${prompt}\n`, "utf8");
  spec.prompt_path = promptPath;
  spec.prompt_sha256 = createHash("sha256").update(prompt).digest("hex");
  await atomicJson(task.task_spec_path, spec);
}

async function verifyTaskFiles(task, spec) {
  const resolvedSpec = path.resolve(task.task_spec_path);
  if (!resolvedSpec.startsWith(`${path.resolve(dataDirectory)}${path.sep}`)) {
    throw new Error("TASK_SPEC_OUTSIDE_DATA_DIRECTORY");
  }
  await ensurePromptSidecar(task, spec);
  const prompt = (await readFile(spec.prompt_path, "utf8")).trim();
  if (createHash("sha256").update(prompt).digest("hex") !== spec.prompt_sha256) {
    throw new Error("LOCKED_PROMPT_HASH_MISMATCH");
  }
  for (const reference of spec.references ?? []) {
    if (isExecutableReference(reference) && (reference.upload_eligible !== true || reference.user_confirmation !== "confirmed")) {
      throw new Error("REFERENCE_NOT_CONFIRMED");
    }
    const bytes = await readFile(reference.path);
    if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) {
      throw new Error("REFERENCE_HASH_MISMATCH");
    }
  }
}

async function executable(name) {
  const pathCandidates = String(process.env.PATH ?? "")
    .split(path.delimiter)
    .flatMap((directory) => process.platform === "win32"
      ? [path.join(directory, `${name}.exe`), path.join(directory, `${name}.cmd`), path.join(directory, name)]
      : [path.join(directory, name)]);
  const candidates = [
    name === "codex" ? process.env.CODEX_BIN : null,
    process.platform === "win32" && process.env.APPDATA && name === "codex"
      ? path.join(process.env.APPDATA, "npm", "codex.cmd")
      : null,
    ...pathCandidates,
  ];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue checking configured executable locations.
    }
  }
  return null;
}

async function codexInvocation(command, args) {
  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args };
  }
  const script = path.join(path.dirname(command), "node_modules", "@openai", "codex", "bin", "codex.js");
  await access(script).catch(() => {
    throw new Error("CODEX_WINDOWS_NPM_WRAPPER_INVALID");
  });
  return { command: process.execPath, args: [script, ...args] };
}

async function runCodex(task, spec, channel) {
  const codex = await executable("codex");
  if (!codex) {
    return normalizeWorkerResult({
      status: "blocked",
      providerTaskId: task.provider_task_id,
      outputPath: null,
      blocker: "codex_cli_not_available",
      summary: "本机没有可用的 Codex CLI，Skill 自动任务未提交。",
      mediaProbePassed: false,
      contentQaPassed: false,
      ledgerPath: null,
    });
  }
  const eventDirectory = spec.output_paths?.events;
  if (!eventDirectory) throw new Error("EVENT_OUTPUT_PATH_MISSING");
  await mkdir(eventDirectory, { recursive: true });
  const resultPath = path.join(eventDirectory, `codex-result-${Date.now()}.json`);
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "-C",
    projectDirectory,
    "-s",
    "workspace-write",
    "-a",
    "never",
    "-m",
    process.env.CODEX_VIDEO_MODEL ?? "gpt-5.5",
    "--output-schema",
    resultSchemaPath,
    "-o",
    resultPath,
    "-",
  ];
  const timeoutMs = Number(process.env.VIDEO_CODEX_TIMEOUT_MS ?? 45 * 60 * 1000);
  const prompt = buildCodexPrompt(task, task.task_spec_path, spec, channel);
  const invocation = await codexInvocation(codex, args);
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: projectDirectory,
      env: process.env,
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
      diagnostic = `${diagnostic}${chunk}`.slice(-8000);
    });
    child.on("error", reject);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("CODEX_VIDEO_TASK_TIMEOUT"));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(new Error(`CODEX_VIDEO_TASK_FAILED:${code}:${clean(diagnostic)}`));
    });
    child.stdin.end(prompt);
  });
  return normalizeWorkerResult(await readFile(resultPath, "utf8"));
}

async function runServer(task, spec, channel) {
  if (!process.env.VIDEO_SERVER_DISPATCH_URL) {
    return normalizeWorkerResult({
      status: "blocked",
      providerTaskId: task.provider_task_id,
      outputPath: null,
      blocker: "server_dispatch_not_configured",
      summary: "服务器自动执行地址尚未配置，任务未提交。",
      mediaProbePassed: false,
      contentQaPassed: false,
      ledgerPath: null,
    });
  }
  const response = await fetch(process.env.VIDEO_SERVER_DISPATCH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.VIDEO_SERVER_DISPATCH_TOKEN
        ? { authorization: `Bearer ${process.env.VIDEO_SERVER_DISPATCH_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      operation: task.provider_task_id ? "sync" : "submit",
      channel,
      taskId: task.id,
      providerTaskId: task.provider_task_id,
      taskSpecPath: task.task_spec_path,
      taskSpec: spec,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`SERVER_DISPATCH_FAILED:${response.status}:${clean(data.error)}`);
  return normalizeWorkerResult(data);
}

async function runApprovedTask(task, spec, channel) {
  if (channel === "higgsfield" && higgsfieldDirectConfigured()) return runHiggsfieldDirectTask({ task, spec });
  if (channel === "miora" && mioraDirectConfigured()) {
    return runMioraDirectTask({ task, spec });
  }
  if (task.execution_mode === "codex_skill" && channel === "mimo" && mimoDirectConfigured()) {
    return runMimoDirectTask({ task, spec });
  }
  return task.execution_mode === "codex_skill"
    ? runCodex(task, spec, channel)
    : runServer(task, spec, channel);
}

async function addEvent(client, taskId, event, detail) {
  await client.query(
    "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES ($1, $2, $3, $4, $5)",
    [randomUUID(), taskId, event, JSON.stringify(detail), now()],
  );
}

async function recoverStaleClaims(client) {
  const result = await client.query(
    `UPDATE video_tasks
     SET status = CASE WHEN provider_task_id IS NULL THEN 'approved_for_execution' ELSE 'running' END,
         blocker = 'worker_recovered_stale_claim', updated_at = $1
     WHERE status IN ('dispatching_skill','syncing_skill','dispatching_server','syncing_server')
       AND updated_at < $2 RETURNING id`,
    [now(), new Date(Date.now() - 10 * 60 * 1000).toISOString()],
  );
  for (const row of result.rows) {
    await addEvent(client, row.id, "worker_recovered_stale_claim", {});
  }
}

async function findEligibleTask(client, modes, lock) {
  const suffix = lock ? "FOR UPDATE SKIP LOCKED" : "";
  const result = await client.query(
    `SELECT * FROM video_tasks
     WHERE execution_mode = ANY($1)
       AND submit_allowed = 1 AND cost_authorized = 1
       AND (status = 'approved_for_execution' OR (status = 'running' AND updated_at < $2))
     ORDER BY updated_at ASC LIMIT 1 ${suffix}`,
    [modes, new Date(Date.now() - 30 * 1000).toISOString()],
  );
  return result.rows[0] ?? null;
}

async function claimTask(client, modes) {
  await client.query("BEGIN");
  try {
    const task = await findEligibleTask(client, modes, true);
    if (!task) {
      await client.query("COMMIT");
      return null;
    }
    const previousStatus = task.status;
    const status = previousStatus === "running"
      ? task.execution_mode === "codex_skill" ? "syncing_skill" : "syncing_server"
      : task.execution_mode === "codex_skill" ? "dispatching_skill" : "dispatching_server";
    await client.query(
      "UPDATE video_tasks SET status = $1, blocker = NULL, updated_at = $2 WHERE id = $3",
      [status, now(), task.id],
    );
    await addEvent(client, task.id, "worker_claimed", {
      previousStatus,
      executionMode: task.execution_mode,
    });
    await client.query("COMMIT");
    return { ...task, previous_status: previousStatus, status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function refundReservedCredits(client, taskId) {
  await client.query("BEGIN");
  try {
    const alreadyRefunded = await client.query(
      "SELECT id FROM credit_ledger WHERE task_id = $1 AND reason LIKE 'video_task_%_refund' LIMIT 1",
      [taskId],
    );
    if (alreadyRefunded.rows[0]) {
      await client.query("COMMIT");
      return false;
    }
    const reservation = await client.query(
      "SELECT user_id, amount FROM credit_ledger WHERE task_id = $1 AND reason IN ('video_automatic_reservation', 'video_manual_reservation') LIMIT 1",
      [taskId],
    );
    const row = reservation.rows[0];
    const amount = Math.abs(Number(row?.amount ?? 0));
    if (!row?.user_id || !Number.isInteger(amount) || amount <= 0) {
      await client.query("COMMIT");
      return false;
    }
    const refundId = randomUUID();
    const claimed = await client.query(
      "INSERT INTO credit_ledger (id, user_id, amount, balance_after, reason, task_id, recharge_request_id, created_at) VALUES ($1, $2, $3, 0, 'video_task_refund', $4, NULL, $5) ON CONFLICT DO NOTHING RETURNING id",
      [refundId, row.user_id, amount, taskId, now()],
    );
    if (!claimed.rows[0]) {
      await client.query("COMMIT");
      return false;
    }
    await client.query("UPDATE user_credits SET balance = balance + $1, updated_at = $2 WHERE user_id = $3", [amount, now(), row.user_id]);
    const wallet = await client.query("SELECT balance FROM user_credits WHERE user_id = $1 LIMIT 1", [row.user_id]);
    await client.query(
      "UPDATE credit_ledger SET balance_after = $1 WHERE id = $2",
      [Number(wallet.rows[0]?.balance ?? 0), refundId],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function mioraHumanHandoff(blocker) {
  const normalized = String(blocker ?? "").toLowerCase();
  if (!normalized || !/miora/.test(normalized)) return null;
  if (/terms|agreement|privacy|服务协议|隐私/.test(normalized)) {
    return {
      action: "terms",
      taskStatus: "awaiting_human_login",
      instructions: "请在已打开的 Miora 浏览器本人阅读并确认平台服务协议或隐私条款。系统不会把该条款伪装成普通登录，也不会代替你接受；完成后在工作台点击“我已完成，继续任务”。",
    };
  }
  if (/captcha|human|真人|验证/.test(normalized)) {
    return {
      action: "captcha",
      taskStatus: "awaiting_human_verification",
      instructions: "请在已打开的 Miora 浏览器完成平台真人验证或 CAPTCHA。系统不会尝试绕过验证；完成后在工作台点击“我已完成，继续任务”。",
    };
  }
  if (/authentication|required|login|登录|登陆|email|邮箱|otp|phone|手机|短信/.test(normalized)) {
    return {
      action: /email|邮箱|otp/.test(normalized) ? "email_otp" : /phone|手机|短信/.test(normalized) ? "phone_otp" : "login",
      taskStatus: "awaiting_human_login",
      instructions: "请在已打开的 Miora 浏览器完成登录或验证码。系统不会保存账号、密码、Cookie 或验证码；完成后在工作台点击“我已完成，继续任务”。",
    };
  }
  return null;
}

async function ensureMioraHandoffTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS channel_sessions (
    channel TEXT PRIMARY KEY, state TEXT NOT NULL, visible_project_url TEXT, credit_readback TEXT,
    model_readback TEXT, last_preflight_at TEXT, last_success_at TEXT, last_blocker TEXT, updated_at TEXT NOT NULL
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS channel_handoffs (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, channel TEXT NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL,
    instructions TEXT NOT NULL, browser_url TEXT, resume_from TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT
  )`);
  await client.query("CREATE INDEX IF NOT EXISTS channel_handoffs_task_state ON channel_handoffs(task_id, state, created_at DESC)");
  await client.query(`CREATE TABLE IF NOT EXISTS channel_execution_receipts (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, channel TEXT NOT NULL, provider_task_id TEXT, status TEXT NOT NULL,
    ledger_path TEXT, output_path TEXT, media_probe_passed INTEGER NOT NULL DEFAULT 0,
    content_qa_passed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
}

async function ensureMioraHumanHandoff(client, task, blocker) {
  const definition = mioraHumanHandoff(blocker);
  if (!definition) return null;
  const existing = await client.query(
    "SELECT id FROM channel_handoffs WHERE task_id = $1 AND channel = 'miora' AND state IN ('awaiting_user','acknowledged') ORDER BY created_at DESC LIMIT 1",
    [task.id],
  );
  if (existing.rows[0]?.id) return { ...definition, id: existing.rows[0].id };
  const handoff = {
    id: randomUUID(),
    browserUrl: String(process.env.MIORA_BASE_URL || "https://miora.design/").trim() || "https://miora.design/",
    createdAt: now(),
  };
  await client.query(
    "INSERT INTO channel_handoffs (id, task_id, channel, action, state, instructions, browser_url, resume_from, created_at, resolved_at) VALUES ($1, $2, 'miora', $3, 'awaiting_user', $4, $5, $6, $7, NULL)",
    [handoff.id, task.id, definition.action, definition.instructions, handoff.browserUrl, task.provider_task_id ? "provider_sync" : "provider_submit", handoff.createdAt],
  );
  return { ...definition, id: handoff.id };
}

async function saveExecutionReceipt(client, task, result, status) {
  const createdAt = now();
  await client.query(
    `INSERT INTO channel_execution_receipts (id, task_id, channel, provider_task_id, status, ledger_path, output_path, media_probe_passed, content_qa_passed, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (task_id) DO UPDATE SET provider_task_id = excluded.provider_task_id, status = excluded.status,
       ledger_path = excluded.ledger_path, output_path = excluded.output_path, media_probe_passed = excluded.media_probe_passed,
       content_qa_passed = excluded.content_qa_passed, updated_at = excluded.updated_at`,
    [randomUUID(), task.id, task.channel, result.providerTaskId, status, result.ledgerPath, result.outputPath,
      result.mediaProbePassed ? 1 : 0, result.contentQaPassed ? 1 : 0, createdAt],
  );
}

async function saveResult(client, task, spec, result) {
  let normalized = result;
  if (normalized.status === "completed") {
    try {
      if (!normalized.mediaProbePassed) throw new Error("MEDIA_PROBE_EVIDENCE_REQUIRED");
      const expectedDuration = Number(String(spec.duration ?? task.duration_seconds ?? "").replace(/[^\d.]/g, ""));
      await validateCompletedOutput({
        outputPath: normalized.outputPath,
        ledgerPath: normalized.ledgerPath,
        downloadsRoot: spec.output_paths?.downloads ?? "",
        ledgerRoot: spec.output_paths?.ledger ?? "",
        contentQaPassed: normalized.contentQaPassed,
        expectedDuration,
      });
    } catch {
      normalized = {
        ...normalized,
        status: "blocked",
        blocker: "verified_output_probe_qa_ledger_required",
        summary: `${normalized.summary} 成片、媒体探测、内容 QA 或账本证据不完整，未标记完成。`,
      };
    }
  }
  if (normalized.status === "running" && !normalized.providerTaskId) {
    normalized = {
      ...normalized,
      status: "blocked",
      blocker: "provider_task_id_required_for_running",
      summary: `${normalized.summary} 缺少渠道任务 ID，无法继续轮询。`,
    };
  }
  const directBlocker = normalized.blocker || "worker_execution_blocked";
  const handoff = normalized.status === "blocked" && task.channel === "miora"
    ? await ensureMioraHumanHandoff(client, task, directBlocker)
    : null;
  const status = handoff?.taskStatus ?? (normalized.status === "failed" ? "blocked" : normalized.status);
  const blocker = status === "blocked" || handoff ? directBlocker : null;
  const submitAllowed = status === "running" || Boolean(handoff) ? 1 : 0;
  await client.query(
    `UPDATE video_tasks SET status = $1, blocker = $2, provider_task_id = $3,
     output_path = $4, submit_allowed = $5, updated_at = $6 WHERE id = $7`,
    [status, blocker, normalized.providerTaskId, normalized.outputPath, submitAllowed, now(), task.id],
  );
  Object.assign(spec, {
    status,
    blocker,
    submit_allowed: Boolean(submitAllowed),
    provider_task_id: normalized.providerTaskId,
    output_path: normalized.outputPath,
  });
  if (normalized.ledgerPath) {
    spec.provider_ledger_path = normalized.ledgerPath;
    spec.provider_media_probe_passed = normalized.mediaProbePassed;
  }
  await atomicJson(task.task_spec_path, spec);
  await saveExecutionReceipt(client, task, normalized, status);
  await addEvent(client, task.id, "worker_result", {
    status,
    blocker,
    providerTaskId: normalized.providerTaskId,
    outputPath: normalized.outputPath,
    mediaProbePassed: normalized.mediaProbePassed,
    contentQaPassed: normalized.contentQaPassed,
    ledgerPath: normalized.ledgerPath,
    summary: normalized.summary,
  });
  if (handoff) {
    await addEvent(client, task.id, "miora_human_handoff_requested", { handoffId: handoff.id, action: handoff.action, resumeFrom: task.provider_task_id ? "provider_sync" : "provider_submit" });
  }
  // Once Miora (or any provider) has yielded a task id, the external provider
  // may already have consumed its own quota.  A later sync/download error must
  // preserve that task for recovery and must not silently refund the website
  // reservation as though no submission happened.
  if (status === "blocked" && blocker !== "awaiting_content_qa" && !normalized.providerTaskId && !task.provider_task_id) {
    await refundReservedCredits(client, task.id);
  }
  return { ...normalized, status, blocker };
}

async function blockTask(client, task, error) {
  const blocker = clean(error instanceof Error ? error.message : error);
  await client.query(
    "UPDATE video_tasks SET status = 'blocked', blocker = $1, submit_allowed = 0, updated_at = $2 WHERE id = $3",
    [blocker, now(), task.id],
  );
  await addEvent(client, task.id, "worker_failed", { blocker });
  if (!task.provider_task_id) await refundReservedCredits(client, task.id);
  return blocker;
}

async function writeState(state) {
  await atomicJson(statePath, {
    pid: process.pid,
    startedAt: state.startedAt,
    heartbeatAt: now(),
    status: state.status,
    modes: state.modes,
    pollMs: state.pollMs,
    codexAvailable: state.codexAvailable,
    mimoDirectConfigured: state.mimoDirectConfigured,
    lastTaskId: state.lastTaskId ?? null,
    lastResult: state.lastResult ?? null,
    lastError: state.lastError ?? null,
  });
}

async function cycle(client, options, state) {
  if (options.dryRun) {
    const task = await findEligibleTask(client, state.modes, false);
    state.status = "dry_run";
    state.lastTaskId = task?.id ?? null;
    state.lastResult = task ? `eligible:${task.execution_mode}:${task.status}` : "no_eligible_task";
    await writeState(state);
    return;
  }
  const task = await claimTask(client, state.modes);
  state.status = task ? "working" : "idle";
  state.lastTaskId = task?.id ?? state.lastTaskId;
  state.lastError = null;
  await writeState(state);
  if (!task) return;
  try {
    const spec = JSON.parse(await readFile(task.task_spec_path, "utf8"));
    const errors = validateTaskSpec(spec);
    if (errors.length) throw new Error(`TASK_SPEC_PREFLIGHT_FAILED:${errors.join(",")}`);
    await verifyTaskFiles(task, spec);
    const channel = selectTaskChannel(task, spec);
    const rawResult = await runApprovedTask(task, spec, channel);
    const result = await saveResult(client, task, spec, rawResult);
    state.status = "idle";
    state.lastResult = `${result.status}:${result.summary}`;
  } catch (error) {
    state.status = "idle";
    state.lastError = await blockTask(client, task, error);
    state.lastResult = "blocked";
  }
  await writeState(state);
}

async function main() {
  const options = {
    once: process.argv.includes("--once"),
    dryRun: process.argv.includes("--dry-run"),
  };
  await loadEnvironment();
  const lockToken = await acquireLock();
  activeLockToken = lockToken;
  const state = {
    startedAt: now(),
    status: options.dryRun ? "dry_run" : "starting",
    modes: configuredModes(),
    pollMs: configuredPollMs(),
    codexAvailable: Boolean(await executable("codex")),
    mimoDirectConfigured: mimoDirectConfigured(),
  };
  const client = await database();
  let stopping = false;
  const heartbeat = setInterval(() => {
    writeState(state).catch(() => undefined);
  }, Math.min(state.pollMs, 5000));
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  try {
    await ensureMioraHandoffTables(client);
    await recoverStaleClaims(client);
    await writeState(state);
    do {
      await cycle(client, options, state);
      if (options.once || stopping) break;
      await new Promise((resolve) => setTimeout(resolve, state.pollMs));
    } while (!stopping);
    state.status = options.dryRun ? "dry_run_complete" : "stopped";
    await writeState(state);
  } finally {
    clearInterval(heartbeat);
    await client.end();
    await releaseLock(lockToken);
    activeLockToken = null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch(async (error) => {
    const message = clean(error instanceof Error ? error.message : error);
    try {
      await atomicJson(statePath, {
        pid: process.pid,
        heartbeatAt: now(),
        status: "failed",
        lastError: message,
      });
      if (activeLockToken) await releaseLock(activeLockToken);
    } catch {
      // Preserve the original failure.
    }
    console.error(message);
    process.exit(1);
  });
}
