import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const projectDirectory = path.resolve(import.meta.dirname, "..");
const taskId = `worker-e2e-codex-skill-${Date.now()}`;
const userId = randomUUID();
const root = path.join(projectDirectory, "data", "worker-e2e", taskId);
const queueDirectory = path.join(projectDirectory, "data", "video-handoffs", taskId);
const outputRoot = path.join(projectDirectory, "data", "video-outputs", taskId);
const specPath = path.join(queueDirectory, "video_task_spec.json");
const promptPath = path.join(queueDirectory, "prompt.txt");
const referencePath = path.join(root, "reference.bin");
const mockCodexPath = path.join(root, "mock-bin", "codex.cmd");
const mockCodexScriptPath = path.join(root, "mock-bin", "node_modules", "@openai", "codex", "bin", "codex.js");
const prompt = "严格参考图片作为首帧，小猫看向镜头，画面自然连贯。";
const skillRoute = [
  "ai-video-production-router",
  "sd2-video-generation",
  "prompt-skill-router",
  "ai-video-channel-router",
  "dola-video-channel",
];

async function loadEnvironment() {
  const content = await readFile(path.join(projectDirectory, ".env.local"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function runWorker(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(projectDirectory, "scripts", "video-task-worker.mjs"), "--once"], {
      cwd: projectDirectory,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`CODEX_SKILL_WORKER_FAILED:${stderr.slice(-2000)}`));
    });
  });
}

async function createFixture(client) {
  await mkdir(root, { recursive: true });
  await mkdir(queueDirectory, { recursive: true });
  await mkdir(path.join(outputRoot, "events"), { recursive: true });
  await mkdir(path.dirname(mockCodexScriptPath), { recursive: true });
  await writeFile(referencePath, "codex-skill-worker-reference\n", "utf8");
  await writeFile(promptPath, `${prompt}\n`, "utf8");
  const reference = await readFile(referencePath);
  const now = new Date().toISOString();
  const spec = {
    task_id: taskId,
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
    duration: "15s",
    aspect_ratio: "9:16",
    resolution: "720p",
    model: "test-only",
    execution_mode: "codex_skill",
    allowed_channels: ["dola"],
    skill_route: skillRoute,
    cost_gate: { authorized: true, max_cost: "0", readback: "test-only mock transport" },
    submit_allowed: true,
    output_paths: {
      downloads: path.join(outputRoot, "downloads"),
      qa: path.join(outputRoot, "qa"),
      events: path.join(outputRoot, "events"),
      ledger: path.join(outputRoot, "ledger"),
    },
    qa_requirements: ["download_exists", "media_probe", "duration_check", "content_qa"],
    status: "approved_for_execution",
    blocker: null,
  };
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  await writeFile(mockCodexPath, "@echo off\r\nrem npm-compatible test wrapper; the worker resolves the adjacent codex.js directly.\r\n", "utf8");
  await writeFile(mockCodexScriptPath, `
import { readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const outputIndex = args.indexOf("-o");
if (outputIndex < 0 || !args[outputIndex + 1]) process.exit(41);
let input = "";
for await (const chunk of process.stdin) input += chunk;
const expected = "ai-video-production-router -> sd2-video-generation -> prompt-skill-router -> ai-video-channel-router -> dola-video-channel";
if (!input.includes(expected) || !input.includes("Selected channel: dola")) process.exit(42);
await writeFile(args[outputIndex + 1], JSON.stringify({
  status: "blocked",
  providerTaskId: null,
  outputPath: null,
  blocker: "non_billable_mock_transport",
  summary: "Dola codex_skill routing reached the test-only transport; no provider request was made.",
  mediaProbePassed: false,
  contentQaPassed: false,
  ledgerPath: null
}));
`, "utf8");
  await client.query(
    "INSERT INTO users (id,email,password_hash,password_salt,created_at) VALUES ($1,$2,$3,$4,$5)",
    [userId, `${taskId}@example.invalid`, "test", "test", now],
  );
  await client.query(
    `INSERT INTO video_tasks
     (id,user_id,execution_mode,channel,prompt,model,resolution,duration_seconds,aspect_ratio,
      asset_manifest,task_spec_path,status,blocker,provider_task_id,output_path,
      submit_allowed,cost_authorized,created_at,updated_at)
     VALUES ($1,$2,'codex_skill','dola',$3,'test-only','720P',15,'9:16',$4,$5,
      'approved_for_execution',NULL,NULL,NULL,1,1,$6,$6)`,
    [taskId, userId, prompt, JSON.stringify([{ id: "test-ref", role: "character", name: "reference.bin" }]), specPath, now],
  );
}

async function cleanup(client) {
  await client.query("DELETE FROM video_task_events WHERE task_id=$1", [taskId]);
  await client.query("DELETE FROM video_tasks WHERE id=$1", [taskId]);
  await client.query("DELETE FROM users WHERE id=$1", [userId]);
  const residual = await client.query(
    `SELECT
      (SELECT COUNT(*)::int FROM video_tasks WHERE id=$1) AS tasks,
      (SELECT COUNT(*)::int FROM users WHERE id=$2) AS users`,
    [taskId, userId],
  );
  if (residual.rows[0]?.tasks || residual.rows[0]?.users) throw new Error("CODEX_SKILL_INTEGRATION_CLEANUP_FAILED");
  await rm(root, { recursive: true, force: true });
  await rm(queueDirectory, { recursive: true, force: true });
  await rm(outputRoot, { recursive: true, force: true });
}

await loadEnvironment();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
try {
  await createFixture(client);
  await runWorker({
    ...process.env,
    VIDEO_WORKER_MODES: "codex_skill",
    CODEX_BIN: mockCodexPath,
    CODEX_VIDEO_MODEL: "test-only",
  });
  const task = await client.query(
    "SELECT status,blocker,provider_task_id,output_path,submit_allowed,cost_authorized FROM video_tasks WHERE id=$1",
    [taskId],
  );
  const row = task.rows[0];
  if (row?.status !== "blocked" || row?.blocker !== "non_billable_mock_transport") {
    throw new Error(`CODEX_SKILL_RESULT_INVALID:${row?.status}:${row?.blocker}`);
  }
  if (row.provider_task_id || row.output_path || Number(row.submit_allowed) !== 0) {
    throw new Error("CODEX_SKILL_TEST_RECORDED_PROVIDER_SIDE_EFFECT");
  }
  const events = await client.query(
    "SELECT event FROM video_task_events WHERE task_id=$1 ORDER BY created_at ASC",
    [taskId],
  );
  const names = events.rows.map((event) => event.event);
  if (!names.includes("worker_claimed") || !names.includes("worker_result")) {
    throw new Error(`CODEX_SKILL_EVENTS_MISSING:${names.join(",")}`);
  }
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  if (spec.status !== "blocked" || spec.submit_allowed !== false || spec.provider_task_id !== null) {
    throw new Error("CODEX_SKILL_SPEC_NOT_CLOSED");
  }
  console.log("VIDEO_WORKER_CODEX_SKILL_INTEGRATION_PASS");
} finally {
  await cleanup(client);
  await client.end();
}
