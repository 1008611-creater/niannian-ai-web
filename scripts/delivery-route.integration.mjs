import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const projectDirectory = path.resolve(import.meta.dirname, "..");
const taskId = `delivery-e2e-${Date.now()}`;
const ownerId = randomUUID();
const outsiderId = randomUUID();
const ownerSessionId = randomUUID();
const outsiderSessionId = randomUUID();
const ownerToken = randomBytes(32).toString("base64url");
const outsiderToken = randomBytes(32).toString("base64url");
const outputRoot = path.join(projectDirectory, "data", "video-outputs", taskId);
const downloadsRoot = path.join(outputRoot, "downloads");
const outputPath = path.join(downloadsRoot, "delivery-e2e.mp4");

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

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectDirectory, stdio: "ignore", windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`COMMAND_FAILED:${code}`)));
  });
}

function sessionHash(token) {
  return createHash("sha256").update(`${process.env.AUTH_SESSION_SECRET}:${token}`).digest("hex");
}

async function createFixture(client) {
  await mkdir(downloadsRoot, { recursive: true });
  await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=160x284:d=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", outputPath]);
  const createdAt = new Date().toISOString();
  await client.query(
    "INSERT INTO users (id,email,password_hash,password_salt,created_at) VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)",
    [ownerId, `${taskId}-owner@example.invalid`, "test", "test", createdAt, outsiderId, `${taskId}-outsider@example.invalid`, "test", "test", createdAt],
  );
  await client.query(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,revoked_at,created_at) VALUES ($1,$2,$3,$4,NULL,$5),($6,$7,$8,$9,NULL,$10)",
    [ownerSessionId, ownerId, sessionHash(ownerToken), new Date(Date.now() + 60 * 60 * 1000).toISOString(), createdAt, outsiderSessionId, outsiderId, sessionHash(outsiderToken), new Date(Date.now() + 60 * 60 * 1000).toISOString(), createdAt],
  );
  await client.query(
    `INSERT INTO video_tasks
     (id,user_id,execution_mode,channel,prompt,model,resolution,duration_seconds,aspect_ratio,asset_manifest,task_spec_path,status,blocker,provider_task_id,output_path,submit_allowed,cost_authorized,created_at,updated_at)
     VALUES ($1,$2,'codex_skill','auto','Delivery route integration test','mock','720P',5,'9:16','[]',$3,'completed',NULL,'mock-task',$4,0,1,$5,$5)`,
    [taskId, ownerId, path.join(projectDirectory, "data", "video-handoffs", "pending", `${taskId}.json`), outputPath, createdAt],
  );
}

async function cleanup(client) {
  await client.query("DELETE FROM video_task_events WHERE task_id=$1", [taskId]);
  await client.query("DELETE FROM video_tasks WHERE id=$1", [taskId]);
  await client.query("DELETE FROM sessions WHERE id = ANY($1)", [[ownerSessionId, outsiderSessionId]]);
  await client.query("DELETE FROM users WHERE id = ANY($1)", [[ownerId, outsiderId]]);
  await rm(outputRoot, { recursive: true, force: true });
}

await loadEnvironment();
if (!process.env.DATABASE_URL || !process.env.AUTH_SESSION_SECRET) throw new Error("DELIVERY_INTEGRATION_ENV_REQUIRED");
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
await client.connect();
try {
  await createFixture(client);
  const endpoint = `http://127.0.0.1:3026/api/video-tasks/${taskId}/download`;
  const ownerResponse = await fetch(endpoint, { headers: { cookie: `niannian_session=${ownerToken}` } });
  assert.equal(ownerResponse.status, 200);
  assert.match(ownerResponse.headers.get("content-type") ?? "", /^video\/mp4/);
  assert.match(ownerResponse.headers.get("content-disposition") ?? "", /^inline/);
  assert.equal(ownerResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(ownerResponse.headers.get("accept-ranges"), "bytes");
  assert.ok((await ownerResponse.arrayBuffer()).byteLength > 1000);
  const rangeResponse = await fetch(endpoint, { headers: { cookie: `niannian_session=${ownerToken}`, range: "bytes=0-1023" } });
  assert.equal(rangeResponse.status, 206);
  assert.match(rangeResponse.headers.get("content-range") ?? "", /^bytes 0-1023\/\d+$/);
  assert.equal((await rangeResponse.arrayBuffer()).byteLength, 1024);
  const invalidRangeResponse = await fetch(endpoint, { headers: { cookie: `niannian_session=${ownerToken}`, range: "bytes=999999999-" } });
  assert.equal(invalidRangeResponse.status, 416);
  const downloadResponse = await fetch(`${endpoint}?download=1`, { headers: { cookie: `niannian_session=${ownerToken}` } });
  assert.equal(downloadResponse.status, 200);
  assert.match(downloadResponse.headers.get("content-disposition") ?? "", /^attachment/);
  const outsiderResponse = await fetch(endpoint, { headers: { cookie: `niannian_session=${outsiderToken}` } });
  assert.equal(outsiderResponse.status, 404);
  console.log("DELIVERY_ROUTE_INTEGRATION_PASS");
} finally {
  await cleanup(client);
  await client.end();
}
