#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VERSION = "1.4.12";
const SKILL_BUNDLE_NAME = "niannian-dola-windows-production-skills";
const REQUIRED_SKILLS = [
  "ai-video-production-router",
  "sd2-video-generation",
  "prompt-skill-router",
  "ai-video-channel-router",
  "dola-video-channel",
  "post-coding-review",
];
const REQUIRED_SKILL_ROUTE = REQUIRED_SKILLS.slice(0, 5);

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function command() {
  return process.argv[2] || "help";
}

function safeWorkerId(value) {
  const workerId = String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  if (workerId.length < 3) throw new Error("NIANNIAN_DOLA_WORKER_ID_INVALID");
  return workerId;
}

function settings() {
  const origin = String(process.env.NIANNIAN_ORIGIN || "").replace(/\/$/, "");
  const token = String(process.env.NIANNIAN_DOLA_AGENT_TOKEN || "").trim();
  if (!origin) throw new Error("NIANNIAN_ORIGIN_REQUIRED");
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("NIANNIAN_ORIGIN_HTTPS_REQUIRED");
  }
  if (token.length < 24) throw new Error("NIANNIAN_DOLA_AGENT_TOKEN_REQUIRED");
  const workspace = path.resolve(process.env.NIANNIAN_DOLA_WORKSPACE || path.join(os.homedir(), "niannian-dola-windows-worker"));
  const workerId = safeWorkerId(process.env.NIANNIAN_DOLA_WORKER_ID || `dola-windows-${os.hostname()}`);
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const skillRoot = path.resolve(process.env.NIANNIAN_SKILL_ROOT || path.join(codexHome, "skills"));
  const codexAuthPath = path.resolve(process.env.NIANNIAN_CODEX_AUTH_PATH || path.join(codexHome, "auth.json"));
  const ffprobeBin = path.resolve(process.env.NIANNIAN_FFPROBE_BIN || "/usr/local/bin/ffprobe");
  const pollMs = Math.min(Math.max(Number(process.env.NIANNIAN_DOLA_POLL_MS || 15_000), 5_000), 5 * 60_000);
  return { origin, token, workspace, workerId, codexHome, skillRoot, codexAuthPath, ffprobeBin, pollMs };
}

async function verifySkillBundle(config) {
  for (const name of REQUIRED_SKILLS) {
    await access(path.join(config.skillRoot, name, "SKILL.md")).catch(() => {
      throw new Error(`REQUIRED_SKILL_MISSING:${name}`);
    });
  }
  try {
    const auth = JSON.parse(await readFile(config.codexAuthPath, "utf8"));
    if (!auth || typeof auth !== "object" || !Object.keys(auth).length) throw new Error("empty");
  } catch {
    throw new Error("CODEX_AUTH_MISSING_OR_INVALID");
  }
  await findCodex();
  return { bundleName: SKILL_BUNDLE_NAME, bundleVersion: VERSION, skills: REQUIRED_SKILLS.length };
}

async function workspaceWritable(workspace) {
  const target = path.join(workspace, `.readiness-write-${process.pid}.tmp`);
  try {
    await mkdir(workspace, { recursive: true });
    await writeFile(target, "ok", { encoding: "utf8", mode: 0o600 });
    await rm(target, { force: true });
    return true;
  } catch {
    await rm(target, { force: true }).catch(() => undefined);
    return false;
  }
}

async function dolaReadiness() {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch("http://127.0.0.1:9190/api/v1/capabilities", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    const capability = await response.json().catch(() => ({}));
    const allowed = Array.isArray(capability.allowed_actions) ? capability.allowed_actions.map(String) : [];
    const contractValid = response.ok
      && capability.schema_version === "dola2api_capabilities_v1"
      && capability.adapter_identity === "dola2api_local_bridge_v1"
      && JSON.stringify(allowed) === JSON.stringify(["preflight", "prepare_route"])
      && capability.provider_submit_enabled === false
      && capability.provider_upload_enabled === false
      && capability.spend_enabled === false;
    const ready = contractValid && capability.ready === true && capability.proxy_configured === true
      && capability.region_restricted !== true && capability.cdp_available === true
      && Number(capability.extension_count) >= 2 && capability.login_state === "authenticated";
    return {
      id: "dola", state: ready ? "ready" : "configuration_invalid", checkedAt,
      reachable: true, authenticated: capability.login_state === "authenticated", credits: null,
      proxyConfigured: capability.proxy_configured === true,
      cdpAvailable: capability.cdp_available === true,
      extensionCount: Number.isInteger(Number(capability.extension_count)) ? Number(capability.extension_count) : 0,
      model: "Dreamina Seedance 2.0 Fast",
      blocker: ready ? null : contractValid ? "DOLA_SESSION_NOT_READY" : "DOLA_CAPABILITY_CONTRACT_INVALID",
    };
  } catch {
    return { id: "dola", state: "unreachable", checkedAt, reachable: false, authenticated: false, credits: null, proxyConfigured: false, cdpAvailable: false, extensionCount: 0, model: "Dreamina Seedance 2.0 Fast", blocker: "DOLA_BRIDGE_UNREACHABLE" };
  }
}

function validateDolaPrompt(promptValue) {
  const prompt = String(promptValue || "").trim();
  if (!prompt) throw new Error("DOLA_PROMPT_EMPTY");
  if (/(?:第\s*)?\d+(?:\.\d+)?\s*(?:秒|s\b)|前\s*\d+(?:\.\d+)?\s*秒/i.test(prompt)) {
    throw new Error("DOLA_PROMPT_SECONDS_FORBIDDEN");
  }
  if (/[“”"【】]/.test(prompt)) throw new Error("DOLA_PROMPT_DIALOGUE_QUOTES_FORBIDDEN");
  if (/\[[^\]]+\]/.test(prompt) && !prompt.startsWith("全程使用中国中文普通话对话，")) {
    throw new Error("DOLA_PROMPT_DIALOGUE_PREFIX_REQUIRED");
  }
}

function selectedDolaReferences(task) {
  const plan = task.channelReferencePlan?.dola || task.channel_reference_plan?.dola;
  if (!plan || plan.channel !== "dola" || plan.max_upload_references !== 1 || plan.supports_multi_reference !== false) {
    throw new Error("DOLA_REFERENCE_PLAN_INVALID");
  }
  const selectedKeys = Array.isArray(plan.selected_reference_keys) ? plan.selected_reference_keys.map(String) : [];
  const selectedRows = Array.isArray(plan.selections) ? plan.selections.filter((entry) => entry?.selected === true) : [];
  if (selectedKeys.length !== 1 || selectedRows.length !== 1 || String(selectedRows[0]?.ref_key || "") !== selectedKeys[0]) {
    throw new Error("DOLA_PRIMARY_REFERENCE_REQUIRED");
  }
  const selected = (task.references || []).filter((reference) => String(reference.refKey || reference.ref_key || "") === selectedKeys[0]);
  if (selected.length !== 1 || selected[0].uploadEligible !== true || selected[0].userConfirmation !== "confirmed") {
    throw new Error("DOLA_PRIMARY_REFERENCE_NOT_AUTHORIZED");
  }
  return selected;
}

function validateDolaTaskContract(task) {
  if (task.channel !== "dola" || !Array.isArray(task.allowedChannels) || task.allowedChannels.length !== 1 || task.allowedChannels[0] !== "dola") {
    throw new Error("DOLA_TASK_CHANNEL_NOT_AUTHORIZED");
  }
  const route = Array.isArray(task.skillRoute) ? task.skillRoute : task.skill_route;
  if (!Array.isArray(route) || JSON.stringify(route) !== JSON.stringify(REQUIRED_SKILL_ROUTE)) {
    throw new Error("DOLA_SKILL_ROUTE_INVALID");
  }
  if (task.submit_allowed !== true || task.costGate?.authorized !== true) throw new Error("DOLA_COST_AUTHORIZATION_REQUIRED");
  validateDolaPrompt(task.prompt);
  return selectedDolaReferences(task);
}

function runContractSelfTest() {
  const prompt = "严格参考图片作为首帧，妙脆角小猫在桌面前开心展示零食，画面稳定，竖屏运镜。";
  const valid = {
    channel: "dola",
    allowedChannels: ["dola"],
    skillRoute: [...REQUIRED_SKILL_ROUTE],
    submit_allowed: true,
    costGate: { authorized: true },
    prompt,
    references: [{ refKey: "asset_primary", uploadEligible: true, userConfirmation: "confirmed" }],
    channelReferencePlan: {
      dola: {
        channel: "dola",
        max_upload_references: 1,
        supports_multi_reference: false,
        selected_reference_keys: ["asset_primary"],
        selections: [{ ref_key: "asset_primary", selected: true }],
      },
    },
  };
  if (validateDolaTaskContract(valid).length !== 1) throw new Error("DOLA_CONTRACT_SELF_TEST_VALID_FAILED");
  const rejected = [
    { ...valid, channel: "mimo" },
    { ...valid, skillRoute: ["dola-video-channel"] },
    { ...valid, submit_allowed: false },
    { ...valid, prompt: "第 1 秒小猫出场" },
    { ...valid, prompt: "全程使用中国中文普通话对话，小猫说“你好”" },
    { ...valid, prompt: "小猫说[你好]" },
    { ...valid, channelReferencePlan: { dola: { ...valid.channelReferencePlan.dola, selected_reference_keys: ["asset_primary", "asset_other"] } } },
  ];
  for (const candidate of rejected) {
    let failedClosed = false;
    try { validateDolaTaskContract(candidate); } catch { failedClosed = true; }
    if (!failedClosed) throw new Error("DOLA_CONTRACT_SELF_TEST_REJECTION_FAILED");
  }
  process.stdout.write("DOLA_AGENT_CONTRACT_SELF_TEST_PASS\n");
}

async function preflight(config, reportHeartbeat = true) {
  const checkedAt = new Date().toISOString();
  let skillResult = null;
  let skillBlocker = null;
  try { skillResult = await verifySkillBundle(config); } catch (error) { skillBlocker = error instanceof Error ? error.message : String(error); }
  let ffprobeAvailable = true;
  try { await access(config.ffprobeBin); } catch { ffprobeAvailable = false; }
  const writable = await workspaceWritable(config.workspace);
  const channel = await dolaReadiness();
  const blockers = [skillBlocker, ffprobeAvailable ? null : "FFPROBE_NOT_AVAILABLE", writable ? null : "DOLA_WORKSPACE_NOT_WRITABLE", channel.blocker].filter(Boolean);
  const readiness = {
    schemaVersion: 1,
    checkedAt,
    readyToClaim: blockers.length === 0,
    blocker: blockers[0] || null,
    computer: { hostname: os.hostname(), platform: process.platform, arch: process.arch, workspaceWritable: writable, ffprobeAvailable },
    skills: skillResult ? { state: "ready", ...skillResult } : { state: "blocked", blocker: skillBlocker },
    channel,
  };
  if (reportHeartbeat) {
    const summary = readiness.readyToClaim
      ? `production ready; skills ${skillResult.bundleVersion}; dola authenticated`
      : `preflight blocked: ${readiness.blocker}`;
    await heartbeat(config, readiness.readyToClaim ? "idle" : "blocked", null, summary, readiness).catch(() => undefined);
  }
  return { ok: readiness.readyToClaim, status: readiness.readyToClaim ? "ready" : "blocked", blocker: readiness.blocker, readiness };
}

async function api(config, pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${config.token}`);
  const response = await fetch(new URL(pathname, config.origin), { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`${body.error || "NIANNIAN_WORKER_REQUEST_FAILED"}:${response.status}`);
  }
  return response;
}

async function atomicJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function heartbeat(config, status, activeTaskId = null, summary = "", readiness = undefined) {
  await api(config, "/api/internal/dola-windows/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerId: config.workerId,
      status,
      activeTaskId,
      summary,
      version: VERSION,
      ...(readiness ? { readiness } : {}),
    }),
  });
}

function filenameFromResponse(response, reference) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename="([^"]+)"/i)?.[1];
  if (encoded) {
    try {
      const decoded = decodeURIComponent(encoded);
      const extension = path.extname(decoded).toLowerCase();
      if (/^\.[a-z0-9]{1,8}$/.test(extension)) return `${reference.assetId}${extension}`;
    } catch {
      // Fall back to MIME type.
    }
  }
  const mime = response.headers.get("content-type") || "";
  const extension = mime.includes("png") ? ".png" : mime.includes("jpeg") ? ".jpg" : mime.includes("webp") ? ".webp" : mime.includes("quicktime") ? ".mov" : ".mp4";
  return `${reference.assetId}${extension}`;
}

async function downloadReference(config, task, reference, inputDirectory) {
  const response = await api(config, reference.downloadPath);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!reference.sha256 || sha256 !== reference.sha256) throw new Error(`REFERENCE_HASH_MISMATCH:${reference.assetId}`);
  const filename = filenameFromResponse(response, reference);
  const target = path.join(inputDirectory, filename);
  await writeFile(target, bytes);
  return { ...reference, localPath: target, bytes: bytes.length };
}

async function resetTaskAttemptDirectory(taskDirectory, providerTaskId) {
  // A newly claimed task with no provider ID must never inherit an earlier local
  // result, ledger, output, or reference file from a previous failed attempt.
  if (providerTaskId) return;
  await Promise.all([
    rm(path.join(taskDirectory, "worker-result.json"), { force: true }),
    rm(path.join(taskDirectory, "worker-result.template.json"), { force: true }),
    rm(path.join(taskDirectory, "input"), { recursive: true, force: true }),
    rm(path.join(taskDirectory, "output"), { recursive: true, force: true }),
    rm(path.join(taskDirectory, "ledger"), { recursive: true, force: true }),
  ]);
}

function instructions(task, taskDirectory, stagedReferences) {
  const resultPath = path.join(taskDirectory, "worker-result.json");
  const references = stagedReferences.map((reference) => `- ${reference.duty || reference.role}: ${reference.localPath} · SHA256 ${reference.sha256}${reference.referenceIntent ? ` · intent=${reference.referenceIntent}` : ""}${reference.isPrimary ? " · primary" : ""}`).join("\n");
  return `# 念念 AI · Windows Dola 正式员工任务\n\n任务 ID：${task.id}\n渠道：${task.channel}\n时长：${task.durationSeconds}s\n比例：${task.aspectRatio}\n分辨率：${task.resolution}\n\n## 权威提示词\n\n${task.prompt}\n\n## 已校验素材\n\n${references}\n\n## 参考语义\n\n视频参考是可选的表达参考，不自动等同于动作迁移。只能根据每份素材的 intent、锁定任务单与渠道能力决定执行方式；不得因为存在视频文件擅自改写为动作迁移。\n\n## 执行约束\n\n1. 必须严格按 task.json 的固定技能链执行：ai-video-production-router -> sd2-video-generation -> prompt-skill-router -> ai-video-channel-router -> dola-video-channel。\n2. 只使用 task.json 中的锁定提示词、已下载素材、允许渠道和已授权成本门。\n3. 父级 Windows Dola Worker 已完成 preflight、heartbeat、claim、租约恢复和 run-once 编排；子员工不得再次执行这些父级操作，也不得用沙盒检查替代它们。\n4. 如果已有 providerTaskId，不得重复提交，只能同步、下载、探测并形成账本。\n5. 不得输出密码、Cookie、token、验证码或任何会话秘密。\n6. 真实提交后立即把 providerTaskId 写入 worker-result.json，并先用 status=running 回报。\n7. 下载真实视频后运行媒体探测并写 JSON 账本；不要自行把客户交付标记为完成。服务器复检通过后只会进入 awaiting_content_qa，仍需管理员内容验收。\n8. 本任务不授权本地修图。\n9. 由 run-once 启动时，只写 worker-result.json，不要自行调用 report；父级工作器会上传一次。只有人工 claim 模式才手工执行下面的 report 命令。\n\n## 回执文件\n\n把以下结构写到：${resultPath}\n\n\`\`\`json\n{\n  "taskId": "${task.id}",\n  "status": "completed",\n  "providerTaskId": "真实渠道任务 ID",\n  "summary": "真实执行摘要",\n  "blocker": null,\n  "outputPath": "${path.join(taskDirectory, "output", "result.mp4")}",\n  "ledgerPath": "${path.join(taskDirectory, "ledger", "execution-ledger.json")}"\n}\n\`\`\`\n\n人工 claim 模式完成后执行：\n\n\`\`\`bash\nnode "${process.argv[1]}" report --result "${resultPath}"\n\`\`\`\n`;
}

async function claim(config, emit = true) {
  const readiness = await preflight(config, true);
  if (!readiness.ok) {
    const blocked = { ok: false, task: null, status: "blocked", blocker: readiness.blocker };
    if (emit) process.stdout.write(`${JSON.stringify(blocked)}\n`);
    return { preflightBlocked: true, blocker: readiness.blocker };
  }
  await heartbeat(config, "claiming", null, "checking for eligible task");
  const response = await api(config, "/api/internal/dola-windows/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerId: config.workerId }),
  });
  const { task } = await response.json();
  if (!task) {
    await heartbeat(config, "idle", null, "no eligible task");
    if (emit) process.stdout.write(`${JSON.stringify({ ok: true, task: null })}\n`);
    return null;
  }
  if (!task.promptSha256 || createHash("sha256").update(String(task.prompt || "")).digest("hex") !== task.promptSha256) {
    throw new Error("LOCKED_PROMPT_HASH_MISMATCH");
  }
  const authorizedReferences = validateDolaTaskContract(task);
  const taskDirectory = path.join(config.workspace, "jobs", task.id);
  const inputDirectory = path.join(taskDirectory, "input");
  await resetTaskAttemptDirectory(taskDirectory, task.providerTaskId);
  await mkdir(inputDirectory, { recursive: true });
  await mkdir(path.join(taskDirectory, "output"), { recursive: true });
  await mkdir(path.join(taskDirectory, "ledger"), { recursive: true });
  const references = [];
  for (const reference of authorizedReferences) {
    references.push(await downloadReference(config, task, reference, inputDirectory));
  }
  const stagedTask = { ...task, references };
  await atomicJson(path.join(taskDirectory, "task.json"), stagedTask);
  await atomicJson(path.join(taskDirectory, "worker-result.template.json"), {
    taskId: task.id,
    status: "completed",
    providerTaskId: null,
    summary: "",
    blocker: null,
    outputPath: path.join(taskDirectory, "output", "result.mp4"),
    ledgerPath: path.join(taskDirectory, "ledger", "execution-ledger.json"),
  });
  await writeFile(path.join(taskDirectory, "INSTRUCTIONS.md"), instructions(task, taskDirectory, references), "utf8");
  await heartbeat(config, "running", task.id, "task staged for Windows Dola employee");
  const staged = { ok: true, taskId: task.id, taskDirectory, instructions: path.join(taskDirectory, "INSTRUCTIONS.md") };
  if (emit) process.stdout.write(`${JSON.stringify(staged)}\n`);
  return staged;
}

async function report(config, resultFileInput = null, emit = true) {
  const resultFile = resultFileInput || argument("--result");
  if (!resultFile) throw new Error("RESULT_FILE_REQUIRED");
  const result = JSON.parse(await readFile(path.resolve(resultFile), "utf8"));
  if (!result.taskId || !["running", "completed", "blocked"].includes(result.status)) throw new Error("RESULT_CONTRACT_INVALID");
  const form = new FormData();
  form.set("status", result.status);
  form.set("providerTaskId", String(result.providerTaskId || ""));
  form.set("summary", String(result.summary || ""));
  form.set("blocker", String(result.blocker || ""));
  if (result.status === "completed") {
    if (!path.isAbsolute(result.outputPath || "") || !path.isAbsolute(result.ledgerPath || "")) throw new Error("RESULT_PATHS_MUST_BE_ABSOLUTE");
    const outputBytes = await readFile(result.outputPath);
    const ledgerBytes = await readFile(result.ledgerPath);
    JSON.parse(ledgerBytes.toString("utf8"));
    form.set("output", new Blob([outputBytes]), path.basename(result.outputPath));
    form.set("ledger", new Blob([ledgerBytes], { type: "application/json" }), path.basename(result.ledgerPath));
  }
  const response = await api(config, `/api/internal/dola-windows/tasks/${encodeURIComponent(result.taskId)}/result`, { method: "POST", body: form });
  const body = await response.json();
  const active = result.status === "running" ? result.taskId : null;
  await heartbeat(config, result.status === "blocked" ? "blocked" : active ? "running" : "idle", active, `result reported: ${body.result?.status || result.status}`);
  const reported = { ok: true, server: body };
  if (emit) process.stdout.write(`${JSON.stringify(reported)}\n`);
  return reported;
}

async function findCodex() {
  const configured = process.env.NIANNIAN_CODEX_BIN?.trim();
  if (configured) {
    await access(configured);
    return configured;
  }
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const directory of String(process.env.PATH || "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `codex${extension}`);
      try { await access(candidate); return candidate; } catch { /* Continue. */ }
    }
  }
  throw new Error("CODEX_CLI_NOT_FOUND");
}

async function runCodexEmployee(config, staged) {
  const codex = await findCodex();
  const resultPath = path.join(staged.taskDirectory, "worker-result.json");
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "windows-dola-worker-result.schema.json");
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "-C",
    staged.taskDirectory,
    "--output-schema",
    schemaPath,
    "-o",
    resultPath,
  ];
  if (process.env.NIANNIAN_CODEX_MODEL?.trim()) args.push("-m", process.env.NIANNIAN_CODEX_MODEL.trim());
  args.push("-s", process.env.NIANNIAN_CODEX_SANDBOX?.trim() || "danger-full-access");
  args.push("-");
  const prompt = [
    "You are the dedicated Windows Dola production employee for one authorized 念念 AI customer task.",
    `Read and follow this exact instruction file: ${staged.instructions}`,
    "Use the exact ordered Skill route from task.json; the final channel Skill must be $dola-video-channel.",
    "The parent Windows Dola worker has already completed the authoritative production readiness check. Do not run its preflight, heartbeat, claim, or run-once commands again from this Codex child, and do not replace that result with sandbox-local checks.",
    "Execute the real provider path. Do not modify website source code.",
    "Return only the worker-result JSON object required by the output schema.",
  ].join("\n");
  const npmCodexScript = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(codex)
    ? path.join(path.dirname(codex), "node_modules", "@openai", "codex", "bin", "codex.js")
    : null;
  if (npmCodexScript) await access(npmCodexScript);
  await new Promise((resolve, reject) => {
    const child = spawn(npmCodexScript ? process.execPath : codex, npmCodexScript ? [npmCodexScript, ...args] : args, {
      cwd: staged.taskDirectory,
      env: process.env,
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let diagnostic = "";
    child.stderr.on("data", (chunk) => { diagnostic = `${diagnostic}${chunk}`.slice(-6000); });
    const timeoutMs = Math.max(Number(process.env.NIANNIAN_CODEX_TIMEOUT_MS || 45 * 60 * 1000), 60_000);
    const heartbeatMs = Math.min(Math.max(Number(process.env.NIANNIAN_DOLA_HEARTBEAT_MS || 30_000), 15_000), 120_000);
    let settled = false;
    let timeout;
    let heartbeatTimer;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      error ? reject(error) : resolve();
    };
    timeout = setTimeout(() => {
      child.kill();
      finish(new Error("DOLA_CODEX_EMPLOYEE_TIMEOUT"));
    }, timeoutMs);
    heartbeatTimer = setInterval(() => {
      heartbeat(config, "running", staged.taskId, "Windows Dola employee executing").catch(() => undefined);
    }, heartbeatMs);
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      finish(code === 0 ? null : new Error(`DOLA_CODEX_EMPLOYEE_FAILED:${code}:${diagnostic.replace(/\s+/g, " ").trim()}`));
    });
    child.stdin.end(prompt);
  });
  return resultPath;
}

async function runOnce(config) {
  const staged = await claim(config, false);
  if (staged?.preflightBlocked) {
    process.stdout.write(`${JSON.stringify({ ok: false, task: null, status: "blocked", blocker: staged.blocker })}\n`);
    return;
  }
  if (!staged) {
    process.stdout.write(`${JSON.stringify({ ok: true, task: null })}\n`);
    return;
  }
  try {
    const maxCycles = Math.min(Math.max(Number(process.env.NIANNIAN_CODEX_MAX_CYCLES || 6), 1), 60);
    const delayMs = Math.min(Math.max(Number(process.env.NIANNIAN_CODEX_SYNC_DELAY_MS || 15_000), 1_000), 60_000);
    let reported = null;
    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      const stagedTask = JSON.parse(await readFile(path.join(staged.taskDirectory, "task.json"), "utf8"));
      validateDolaTaskContract(stagedTask);
      const resultPath = await runCodexEmployee(config, staged);
      const localResult = JSON.parse(await readFile(resultPath, "utf8"));
      reported = await report(config, resultPath, false);
      if (localResult.status !== "running") break;
      if (!localResult.providerTaskId) throw new Error("RUNNING_RESULT_PROVIDER_TASK_ID_REQUIRED");
      const taskPath = path.join(staged.taskDirectory, "task.json");
      const task = JSON.parse(await readFile(taskPath, "utf8"));
      task.providerTaskId = localResult.providerTaskId;
      await atomicJson(taskPath, task);
      if (cycle === maxCycles) throw new Error("DOLA_CODEX_SYNC_CYCLE_LIMIT");
      await heartbeat(config, "running", staged.taskId, `provider running; sync cycle ${cycle}/${maxCycles}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    process.stdout.write(`${JSON.stringify({ ok: true, taskId: staged.taskId, taskDirectory: staged.taskDirectory, server: reported?.server ?? null })}\n`);
  } catch (error) {
    await heartbeat(config, "blocked", staged.taskId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    throw error;
  }
}

async function runLoop(config) {
  let stopRequested = false;
  const stop = () => { stopRequested = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  while (!stopRequested) {
    try {
      await runOnce(config);
    } catch (error) {
      // The parent remains responsible for observable readiness and recovery;
      // an individual child failure must not require a manual SQL reset.
      await heartbeat(config, "blocked", null, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    }
    if (!stopRequested) await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
}

function help() {
  process.stdout.write(`念念 AI Windows Dola worker ${VERSION}\n\nCommands:\n  run-once                  Preflight, claim, execute with a fresh Windows Dola employee, and report\n  run-loop                  Continuously run the parent preflight, claim, recovery, and report loop\n  claim                     Preflight, claim, and stage one authorized task without launching Codex\n  preflight                 Verify Codex auth and the versioned production Skill bundle\n  heartbeat                 Preflight and report ready or blocked heartbeat\n  report --result <json>    Report provider state or upload output + ledger\n\nRequired environment:\n  NIANNIAN_ORIGIN\n  NIANNIAN_DOLA_AGENT_TOKEN\nOptional:\n  NIANNIAN_DOLA_WORKER_ID\n  NIANNIAN_DOLA_WORKSPACE\n  NIANNIAN_DOLA_POLL_MS\n  NIANNIAN_CODEX_BIN\n  NIANNIAN_CODEX_MODEL\n  NIANNIAN_CODEX_SANDBOX\n  NIANNIAN_CODEX_TIMEOUT_MS\n  NIANNIAN_DOLA_HEARTBEAT_MS\n  NIANNIAN_CODEX_MAX_CYCLES\n  NIANNIAN_CODEX_SYNC_DELAY_MS\n  NIANNIAN_SKILL_ROOT\n  NIANNIAN_SKILL_BUNDLE_MANIFEST\n  NIANNIAN_CODEX_AUTH_PATH\n`);
}

try {
  const selected = command();
  if (selected === "help" || selected === "--help" || selected === "-h") {
    help();
  } else if (selected === "contract-self-test") {
    runContractSelfTest();
  } else {
    const config = settings();
    if (selected === "run-once") await runOnce(config);
    else if (selected === "run-loop") await runLoop(config);
    else if (selected === "claim") await claim(config);
    else if (selected === "preflight") {
      const result = await preflight(config, true);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
    else if (selected === "heartbeat") {
      const result = await preflight(config, true);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (selected === "report") await report(config);
    else throw new Error("COMMAND_INVALID");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}



