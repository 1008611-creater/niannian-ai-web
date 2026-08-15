import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const projectDirectory = path.resolve(import.meta.dirname, "..");
const baseUrl = process.env.NIANNIAN_TEST_BASE_URL || "http://127.0.0.1:3032";
const requestOrigin = process.env.NIANNIAN_TEST_ORIGIN || baseUrl;
let dolaToken = "";
const testId = `dola-api-e2e-${Date.now()}`;
const dolaWorkerId = `dola-${testId}`;
const userId = randomUUID();
const adminId = randomUUID();
const userEmail = `${testId}@example.invalid`;
const adminEmail = process.env.NIANNIAN_TEST_ADMIN_EMAIL || `${testId}-admin@example.invalid`;
const userToken = randomBytes(32).toString("base64url");
const adminToken = randomBytes(32).toString("base64url");
const userSessionId = randomUUID();
const adminSessionId = randomUUID();
const temporary = path.join(os.tmpdir(), testId);
let taskId = "";
let taskSpecPath = "";
let promptPath = "";
let assetDirectory = "";
let outputRoot = "";

async function loadEnvironment() {
  const content = await readFile(path.join(projectDirectory, ".env.local"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function sessionHash(token) {
  if (!process.env.AUTH_SESSION_SECRET) throw new Error("AUTH_SESSION_SECRET_REQUIRED");
  return createHash("sha256").update(`${process.env.AUTH_SESSION_SECRET}:${token}`).digest("hex");
}

async function executable(name) {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try { await access(candidate); return candidate; } catch { /* Continue. */ }
    }
  }
  throw new Error(`${name.toUpperCase()}_NOT_FOUND`);
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectDirectory, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed: ${stderr}`)));
  });
}

async function sessionApi(pathname, token, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("origin", requestOrigin);
  headers.set("cookie", `niannian_session=${token}`);
  return fetch(`${baseUrl}${pathname}`, { ...options, headers });
}

async function dolaApi(pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("authorization", `Bearer ${dolaToken}`);
  return fetch(`${baseUrl}${pathname}`, { ...options, headers });
}

async function body(response) {
  return response.json().catch(() => ({}));
}

async function cleanup(client) {
  if (taskId) {
    await client.query("DELETE FROM video_task_events WHERE task_id=$1", [taskId]);
    await client.query("DELETE FROM credit_ledger WHERE task_id=$1", [taskId]);
    await client.query("DELETE FROM video_tasks WHERE id=$1", [taskId]);
  }
  await client.query("DELETE FROM asset_reference_metadata WHERE asset_id IN (SELECT id FROM uploaded_assets WHERE user_id=$1)", [userId]);
  await client.query("DELETE FROM uploaded_assets WHERE user_id=$1", [userId]);
  await client.query("DELETE FROM sessions WHERE id IN ($1,$2)", [userSessionId, adminSessionId]);
  await client.query("DELETE FROM credit_recharge_requests WHERE user_id=$1", [userId]);
  await client.query("DELETE FROM user_credits WHERE user_id=$1", [userId]);
  await client.query("DELETE FROM users WHERE id IN ($1,$2)", [userId, adminId]);
  if (assetDirectory) await rm(assetDirectory, { recursive: true, force: true });
  if (outputRoot) await rm(outputRoot, { recursive: true, force: true });
  if (taskSpecPath) await rm(taskSpecPath, { force: true });
  if (promptPath) await rm(promptPath, { force: true });
  await rm(temporary, { recursive: true, force: true });
}

await loadEnvironment();
dolaToken = process.env.NIANNIAN_DOLA_AGENT_TOKEN || "";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
if (dolaToken.length < 24) throw new Error("NIANNIAN_DOLA_AGENT_TOKEN_REQUIRED");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
try {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await client.query(
    "INSERT INTO users (id,email,password_hash,password_salt,created_at) VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$5)",
    [userId, userEmail, "integration", "integration", createdAt, adminId, adminEmail, "integration", "integration"],
  );
  await client.query(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,revoked_at,created_at) VALUES ($1,$2,$3,$4,NULL,$5),($6,$7,$8,$4,NULL,$5)",
    [userSessionId, userId, sessionHash(userToken), expiresAt, createdAt, adminSessionId, adminId, sessionHash(adminToken)],
  );
  await client.query("INSERT INTO user_credits (user_id,balance,updated_at) VALUES ($1,$2,$3)", [userId, 100, createdAt]);

  async function upload(role, name, type, bytes) {
    const form = new FormData();
    form.set("role", role);
    form.set("file", new Blob([bytes], { type }), name);
    const response = await sessionApi("/api/assets", userToken, { method: "POST", body: form });
    const data = await body(response);
    if (response.status !== 201 || !data.asset?.id) throw new Error(`ASSET_UPLOAD_FAILED:${role}:${response.status}:${data.error ?? ""}`);
    return data.asset;
  }

  const character = await upload("character", "character.png", "image/png", Buffer.from("integration-character-reference"));
  const motion = await upload("reference_video", "reference.mp4", "video/mp4", Buffer.from("integration-video-reference"));
  const unsupportedVideoResponse = await sessionApi("/api/video-tasks", userToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Video reference must fail before billing.", durationSeconds: 5, aspectRatio: "9:16", assetIds: [character.id, motion.id] }),
  });
  const unsupportedVideo = await body(unsupportedVideoResponse);
  if (unsupportedVideoResponse.status !== 400 || unsupportedVideo.error !== "REFERENCE_VIDEO_UNSUPPORTED") {
    throw new Error(`VIDEO_REFERENCE_GUARD_INVALID:${unsupportedVideoResponse.status}:${unsupportedVideo.error ?? ""}`);
  }
  const extraReferences = [];
  for (let index = 0; index < 12; index += 1) {
    extraReferences.push(await upload("scene", `extra-${index}.png`, "image/png", Buffer.from(`integration-extra-${index}`)));
  }
  const overLimitResponse = await sessionApi("/api/video-tasks", userToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Reference limit must fail before billing.", durationSeconds: 5, aspectRatio: "9:16", assetIds: [character.id, ...extraReferences.map((asset) => asset.id)] }),
  });
  const overLimit = await body(overLimitResponse);
  if (overLimitResponse.status !== 400 || overLimit.error !== "ASSET_LIMIT_EXCEEDED") {
    throw new Error(`REFERENCE_LIMIT_GUARD_INVALID:${overLimitResponse.status}:${overLimit.error ?? ""}`);
  }
  const unchangedBalance = await client.query("SELECT balance FROM user_credits WHERE user_id=$1", [userId]);
  if (Number(unchangedBalance.rows[0]?.balance) !== 100) throw new Error("PRE_SUBMISSION_GUARDS_CHARGED_CREDITS");
  const createResponse = await sessionApi("/api/video-tasks", userToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      serviceMode: "automatic",
      prompt: "Dola worker API integration task. No real provider submission.",
      model: "Seedance 2.0",
      resolution: "720P",
      durationSeconds: 5,
      aspectRatio: "9:16",
      assetIds: [character.id],
    }),
  });
  const created = await body(createResponse);
  if (createResponse.status !== 201 || !created.task?.id) throw new Error(`TASK_CREATE_FAILED:${createResponse.status}:${created.error ?? ""}`);
  taskId = created.task.id;
  const routeResponse = await sessionApi("/api/admin/overview", adminToken, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId, action: "route_channel", channel: "dola" }),
  });
  const routed = await body(routeResponse);
  if (routeResponse.status !== 200) throw new Error(`DOLA_ROUTE_FAILED:${routeResponse.status}:${routed.error ?? ""}`);
  const taskRow = await client.query("SELECT * FROM video_tasks WHERE id=$1", [taskId]);
  const task = taskRow.rows[0];
  if (task?.execution_mode !== "codex_skill" || task?.channel !== "dola" || task?.status !== "queued_skill" || Number(task?.submit_allowed) !== 0) throw new Error("DOLA_EXCLUSIVE_ROUTE_INVALID");
  taskSpecPath = task.task_spec_path;
  promptPath = taskSpecPath.replace(/\.json$/i, ".prompt.txt");
  assetDirectory = path.dirname((await client.query("SELECT local_path FROM uploaded_assets WHERE user_id=$1 LIMIT 1", [userId])).rows[0].local_path);
  outputRoot = path.join(projectDirectory, "data", "video-outputs", taskId);

  const checkedAtForRouting = new Date().toISOString();
  const routingHeartbeat = await dolaApi("/api/internal/dola-windows/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerId: dolaWorkerId, status: "idle", activeTaskId: null, summary: "integration ready", version: "1.4.12",
      readiness: {
        schemaVersion: 1, checkedAt: checkedAtForRouting, readyToClaim: true, blocker: null,
        computer: { hostname: "integration-dola", platform: "win32", arch: "x64", workspaceWritable: true, ffprobeAvailable: true },
        skills: { state: "ready", bundleName: "niannian-dola-windows-production-skills", bundleVersion: "1.4.12", skills: 6, blocker: null },
        channel: { id: "dola", state: "ready", checkedAt: checkedAtForRouting, reachable: true, authenticated: true, credits: "integration", model: "Dreamina Seedance 2.0 Fast", blocker: null },
      },
    }),
  });
  if (routingHeartbeat.status !== 200) throw new Error(`DOLA_ROUTING_HEARTBEAT_FAILED:${routingHeartbeat.status}`);

  const approveResponse = await sessionApi("/api/admin/overview", adminToken, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId, action: "approve_cost", costReadback: "integration authorized zero-cost mock", maxCost: "0" }),
  });
  const approved = await body(approveResponse);
  if (approveResponse.status !== 200 || approved.status !== "approved_for_execution") throw new Error(`ADMIN_APPROVE_FAILED:${approveResponse.status}:${approved.error ?? ""}`);

  const prematureClaim = await dolaApi("/api/internal/dola-windows/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerId: `${dolaWorkerId}-unknown` }),
  });
  if (prematureClaim.status !== 409) throw new Error(`DOLA_READINESS_GATE_NOT_ENFORCED:${prematureClaim.status}`);

  const checkedAt = new Date().toISOString();
  const heartbeatResponse = await dolaApi("/api/internal/dola-windows/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerId: dolaWorkerId,
      status: "idle",
      activeTaskId: null,
      summary: "integration production ready",
      version: "1.4.0",
      readiness: {
        schemaVersion: 1,
        checkedAt,
        readyToClaim: true,
        blocker: null,
        computer: { hostname: "integration-dola", platform: "darwin", arch: "arm64", workspaceWritable: true, ffprobeAvailable: true },
        skills: { state: "ready", bundleName: "niannian-dola-production-skills", bundleVersion: "1.0.0", skills: 6, blocker: null },
        channel: { id: "dola", state: "ready", checkedAt, reachable: true, authenticated: true, credits: "integration", model: "Seedance 2.0", blocker: null },
      },
    }),
  });
  if (heartbeatResponse.status !== 200) throw new Error(`MAC_READY_HEARTBEAT_FAILED:${heartbeatResponse.status}`);

  // A parent claim must recover an abandoned running lease without an
  // operator manually editing the task row.
  await client.query(
    "UPDATE video_tasks SET status='running', blocker=NULL, updated_at=$1 WHERE id=$2",
    ["2020-01-01T00:00:00.000Z", taskId],
  );

  const claimResponse = await dolaApi("/api/internal/dola-windows/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerId: dolaWorkerId }),
  });
  const claimed = await body(claimResponse);
  if (claimResponse.status !== 200 || claimed.task?.id !== taskId || claimed.task?.references?.length !== 1) throw new Error(`MAC_CLAIM_FAILED:${claimResponse.status}:${claimed.error ?? ""}`);
  const leaseRecovery = await client.query("SELECT event FROM video_task_events WHERE task_id=$1 AND event='dola_worker_lease_expired'", [taskId]);
  if (leaseRecovery.rowCount !== 1) throw new Error("MAC_STALE_LEASE_RECOVERY_MISSING");
  if (
    claimed.task?.generationType !== "reference_guided_video" ||
    claimed.task?.generation_type !== "reference_guided_video" ||
    claimed.task?.submit_allowed !== true ||
    claimed.task?.cost_gate?.authorized !== true ||
    !claimed.task?.allowed_channels?.includes("dola")
  ) {
    throw new Error("MAC_CLAIM_CONTRACT_FIELDS_INVALID");
  }
  for (const reference of claimed.task.references) {
    const response = await dolaApi(reference.downloadPath);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status !== 200 || createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw new Error("MAC_ASSET_DOWNLOAD_HASH_FAILED");
  }

  const runningForm = new FormData();
  runningForm.set("status", "running");
  runningForm.set("providerTaskId", "dola-api-provider-test-001");
  runningForm.set("summary", "provider accepted integration job");
  const runningResponse = await dolaApi(`/api/internal/dola-windows/tasks/${taskId}/result`, { method: "POST", body: runningForm });
  const running = await body(runningResponse);
  if (runningResponse.status !== 200 || running.result?.status !== "running") throw new Error(`MAC_RUNNING_REPORT_FAILED:${runningResponse.status}:${running.error ?? ""}`);

  await mkdir(temporary, { recursive: true });
  const localOutput = path.join(temporary, "dola-api-result.mp4");
  const localLedger = path.join(temporary, "dola-api-ledger.json");
  await run(await executable("ffmpeg"), ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=160x284:d=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", localOutput]);
  await writeFile(localLedger, `${JSON.stringify({ taskId, providerTaskId: "dola-api-provider-test-001", status: "downloaded", mediaProbePassed: true }, null, 2)}\n`, "utf8");
  const completedForm = new FormData();
  completedForm.set("status", "completed");
  completedForm.set("providerTaskId", "dola-api-provider-test-001");
  completedForm.set("summary", "downloaded real media fixture and wrote ledger");
  completedForm.set("output", new Blob([await readFile(localOutput)], { type: "video/mp4" }), "dola-api-result.mp4");
  completedForm.set("ledger", new Blob([await readFile(localLedger)], { type: "application/json" }), "dola-api-ledger.json");
  const completedResponse = await dolaApi(`/api/internal/dola-windows/tasks/${taskId}/result`, { method: "POST", body: completedForm });
  const completed = await body(completedResponse);
  if (completedResponse.status !== 200 || completed.result?.blocker !== "awaiting_content_qa") throw new Error(`MAC_OUTPUT_UPLOAD_FAILED:${completedResponse.status}:${completed.error ?? ""}`);

  const reviewResponse = await sessionApi("/api/admin/overview", adminToken, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId, action: "review_output", contentQaPassed: true }),
  });
  const reviewed = await body(reviewResponse);
  if (reviewResponse.status !== 200 || reviewed.status !== "completed") throw new Error(`ADMIN_REVIEW_FAILED:${reviewResponse.status}:${reviewed.error ?? ""}`);

  const tasksResponse = await sessionApi("/api/video-tasks", userToken);
  const tasks = await body(tasksResponse);
  const publicTask = tasks.tasks?.find((candidate) => candidate.id === taskId);
  if (tasksResponse.status !== 200 || publicTask?.status !== "completed" || publicTask?.outputReady !== true) throw new Error("CUSTOMER_COMPLETION_NOT_VISIBLE");
  const deliveryResponse = await sessionApi(`/api/video-tasks/${taskId}/download`, userToken, { headers: { range: "bytes=0-1023" } });
  if (deliveryResponse.status !== 206 || (await deliveryResponse.arrayBuffer()).byteLength < 1) throw new Error("CUSTOMER_DELIVERY_FAILED");

  const final = await client.query("SELECT status,blocker,output_path,provider_task_id FROM video_tasks WHERE id=$1", [taskId]);
  if (final.rows[0]?.status !== "completed" || final.rows[0]?.blocker !== null || !final.rows[0]?.output_path || final.rows[0]?.provider_task_id !== "dola-api-provider-test-001") {
    throw new Error("MAC_FINAL_STATE_INVALID");
  }
  console.log("DOLA_WORKER_API_INTEGRATION_PASS");
} finally {
  await cleanup(client);
  await client.end();
}

