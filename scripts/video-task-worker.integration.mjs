import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const projectDirectory = path.resolve(import.meta.dirname, "..");
const taskId = `worker-e2e-${Date.now()}`;
const userId = randomUUID();
const adminSessionId = randomUUID();
const adminToken = randomBytes(32).toString("base64url");
const root = path.join(projectDirectory, "data", "worker-e2e", taskId);
const queueDirectory = path.join(projectDirectory, "data", "video-server-queue", "pending");
const specPath = path.join(queueDirectory, `${taskId}.json`);
const promptPath = path.join(queueDirectory, `${taskId}.prompt.txt`);
const outputRoot = path.join(projectDirectory, "data", "video-outputs", taskId);
const downloads = path.join(outputRoot, "downloads");
const ledgerDirectory = path.join(outputRoot, "ledger");
const outputPath = path.join(downloads, "worker-e2e.mp4");
const ledgerPath = path.join(ledgerDirectory, "worker-e2e.json");
const referencePath = path.join(root, "reference.bin");
const prompt = "Worker integration test. No real provider submission.";

function sessionHash(token) {
  if (!process.env.AUTH_SESSION_SECRET) throw new Error("AUTH_SESSION_SECRET_REQUIRED");
  return createHash("sha256").update(`${process.env.AUTH_SESSION_SECRET}:${token}`).digest("hex");
}

async function loadEnvironment() {
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
}

async function executable(name) {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  throw new Error(`${name.toUpperCase()}_NOT_FOUND`);
}

async function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectDirectory,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(command)} failed: ${stderr.slice(-2000)}`));
    });
  });
}

async function createFixture(client) {
  await mkdir(root, { recursive: true });
  await mkdir(queueDirectory, { recursive: true });
  await mkdir(downloads, { recursive: true });
  await mkdir(ledgerDirectory, { recursive: true });
  await writeFile(referencePath, "worker-e2e-reference\n", "utf8");
  await writeFile(promptPath, `${prompt}\n`, "utf8");
  const reference = await readFile(referencePath);
  const spec = {
    task_id: taskId,
    series_id: "niannian-worker-test",
    episode_id: "",
    video_group_id: taskId,
    prompt,
    prompt_path: promptPath,
    prompt_sha256: createHash("sha256").update(prompt).digest("hex"),
    references: [{
      path: referencePath,
      sha256: createHash("sha256").update(reference).digest("hex"),
      chinese_duty: "测试参考",
      user_confirmation: "confirmed",
      upload_eligible: true,
    }],
    duration: "5s",
    aspect_ratio: "9:16",
    resolution: "720p",
    model: "mock",
    execution_mode: "server_auto",
    allowed_channels: ["mimo"],
    cost_gate: { authorized: false, max_cost: "", readback: "pending" },
    submit_allowed: false,
    output_paths: {
      downloads,
      qa: path.join(outputRoot, "qa"),
      events: path.join(outputRoot, "events"),
      ledger: ledgerDirectory,
    },
    qa_requirements: ["download_exists", "media_probe", "duration_check", "content_qa"],
    status: "prepared",
    blocker: "awaiting_cost_readback_and_submit_authorization",
  };
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  const createdAt = new Date().toISOString();
  await client.query(
    "INSERT INTO users (id,email,password_hash,password_salt,created_at) VALUES ($1,$2,$3,$4,$5)",
    [userId, `${taskId}@example.invalid`, "test", "test", createdAt],
  );
  const adminEmail = (process.env.ADMIN_EMAILS ?? "1453637677@qq.com").split(",")[0].trim().toLowerCase();
  const admin = await client.query("SELECT id FROM users WHERE lower(email)=$1 LIMIT 1", [adminEmail]);
  if (!admin.rows[0]?.id) throw new Error("ADMIN_USER_REQUIRED");
  await client.query(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,revoked_at,created_at) VALUES ($1,$2,$3,$4,NULL,$5)",
    [adminSessionId, admin.rows[0].id, sessionHash(adminToken), new Date(Date.now() + 60 * 60 * 1000).toISOString(), createdAt],
  );
  await client.query(
    `INSERT INTO video_tasks
     (id,user_id,execution_mode,channel,prompt,model,resolution,duration_seconds,aspect_ratio,
      asset_manifest,task_spec_path,status,blocker,provider_task_id,output_path,
      submit_allowed,cost_authorized,created_at,updated_at)
     VALUES ($1,$2,'server_auto','mimo',$3,'mock','720P',5,'9:16',$4,$5,
      'queued_server','awaiting_cost_readback_and_submit_authorization',NULL,NULL,0,0,$6,$6)`,
    [taskId, userId, prompt, JSON.stringify([{ id: "test-ref", role: "character", name: "reference.bin" }]), specPath, createdAt],
  );
}

async function cleanup(client) {
  await client.query("DELETE FROM video_task_events WHERE task_id=$1", [taskId]);
  await client.query("DELETE FROM video_tasks WHERE id=$1", [taskId]);
  await client.query("DELETE FROM sessions WHERE id=$1", [adminSessionId]);
  await client.query("DELETE FROM users WHERE id=$1", [userId]);
  const residual = await client.query(
    `SELECT
      (SELECT COUNT(*)::int FROM video_tasks WHERE id=$1) AS tasks,
      (SELECT COUNT(*)::int FROM users WHERE id=$2) AS users,
      (SELECT COUNT(*)::int FROM sessions WHERE id=$3) AS sessions`,
    [taskId, userId, adminSessionId],
  );
  if (residual.rows[0]?.tasks || residual.rows[0]?.users || residual.rows[0]?.sessions) {
    throw new Error("WORKER_INTEGRATION_CLEANUP_FAILED");
  }
  await rm(root, { recursive: true, force: true });
  await rm(outputRoot, { recursive: true, force: true });
  await rm(specPath, { force: true });
  await rm(promptPath, { force: true });
}

async function approveCost(client) {
  const response = await fetch("http://127.0.0.1:3026/api/admin/overview", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3026",
      cookie: `niannian_session=${adminToken}`,
    },
    body: JSON.stringify({
      taskId,
      action: "approve_cost",
      costReadback: "Local mock quota, no real provider cost",
      maxCost: "0",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 200 || body.status !== "approved_for_execution" || !body.submitAllowed || !body.costAuthorized) {
    throw new Error(`ADMIN_COST_APPROVAL_FAILED:${response.status}:${body.error ?? body.status ?? ""}`);
  }
  const task = await client.query(
    "SELECT status,submit_allowed,cost_authorized FROM video_tasks WHERE id=$1",
    [taskId],
  );
  if (
    task.rows[0]?.status !== "approved_for_execution" ||
    Number(task.rows[0]?.submit_allowed) !== 1 ||
    Number(task.rows[0]?.cost_authorized) !== 1
  ) throw new Error("ADMIN_COST_APPROVAL_NOT_PERSISTED");
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  if (!spec.submit_allowed || !spec.cost_gate?.authorized) throw new Error("TASK_SPEC_COST_GATE_NOT_OPENED");
}

await loadEnvironment();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
let server;
try {
  await createFixture(client);
  await approveCost(client);
  const ffmpeg = await executable("ffmpeg");
  server = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      if (payload.operation !== "submit" || payload.taskId !== taskId || payload.channel !== "mimo") {
        throw new Error("MOCK_REQUEST_INVALID");
      }
      await run(ffmpeg, [
        "-v", "error",
        "-f", "lavfi",
        "-i", "color=c=black:s=160x284:d=5",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-y", outputPath,
      ]);
      await writeFile(ledgerPath, `${JSON.stringify({
        taskId,
        providerTaskId: "mock-provider-task",
        qa: "verified",
        generatedAt: new Date().toISOString(),
      }, null, 2)}\n`, "utf8");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "completed",
        providerTaskId: "mock-provider-task",
        outputPath,
        blocker: null,
        summary: "Local mock generation, probe, QA and ledger completed.",
        mediaProbePassed: true,
        contentQaPassed: true,
        ledgerPath,
      }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "MOCK_FAILED" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const environment = {
    ...process.env,
    VIDEO_WORKER_MODES: "server_auto",
    VIDEO_SERVER_DISPATCH_URL: `http://127.0.0.1:${address.port}`,
  };
  await run(process.execPath, [path.join(projectDirectory, "scripts", "video-task-worker.mjs"), "--once"], environment);
  const task = await client.query(
    "SELECT status,provider_task_id,output_path,submit_allowed FROM video_tasks WHERE id=$1",
    [taskId],
  );
  if (task.rows[0]?.status !== "completed") throw new Error(`TASK_NOT_COMPLETED:${task.rows[0]?.status}`);
  if (task.rows[0]?.provider_task_id !== "mock-provider-task") throw new Error("PROVIDER_TASK_ID_NOT_SAVED");
  if (task.rows[0]?.output_path !== outputPath) throw new Error("OUTPUT_PATH_NOT_SAVED");
  if (Number(task.rows[0]?.submit_allowed) !== 0) throw new Error("COMPLETED_TASK_STILL_SUBMITTABLE");
  const event = await client.query(
    "SELECT event FROM video_task_events WHERE task_id=$1 AND event='worker_result' LIMIT 1",
    [taskId],
  );
  if (!event.rows[0]) throw new Error("WORKER_RESULT_EVENT_MISSING");
  console.log("VIDEO_WORKER_INTEGRATION_PASS");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await cleanup(client);
  await client.end();
}
