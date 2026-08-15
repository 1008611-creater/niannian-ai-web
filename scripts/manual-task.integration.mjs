import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const projectDirectory = path.resolve(import.meta.dirname, "..");
const baseUrl = process.env.NIANNIAN_TEST_BASE_URL || "http://127.0.0.1:3026";
const requestOrigin = "http://localhost:3026";
const testId = `manual-e2e-${Date.now()}`;
const userId = randomUUID();
const userEmail = `${testId}@example.invalid`;
const userToken = randomBytes(32).toString("base64url");
const adminToken = randomBytes(32).toString("base64url");
const userSessionId = randomUUID();
const adminSessionId = randomUUID();
const assetDirectory = path.join(projectDirectory, "data", "video-assets", userId);
let taskId = "";
let taskSpecPath = "";
let promptPath = "";
let outputRoot = "";
let automaticTaskId = "";
let automaticTaskSpecPath = "";
let automaticPromptPath = "";
let reviewTaskId = "";
let reviewTaskSpecPath = "";
let reviewPromptPath = "";
let reviewOutputRoot = "";

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

function sessionHash(token) {
  if (!process.env.AUTH_SESSION_SECRET) throw new Error("AUTH_SESSION_SECRET_REQUIRED");
  return createHash("sha256").update(`${process.env.AUTH_SESSION_SECRET}:${token}`).digest("hex");
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

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectDirectory,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed: ${stderr}`));
    });
  });
}

async function api(pathname, token, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("origin", requestOrigin);
  headers.set("cookie", `niannian_session=${token}`);
  return fetch(`${baseUrl}${pathname}`, { ...options, headers });
}

async function json(response) {
  return response.json().catch(() => ({}));
}

async function uploadAsset(role, name, type, bytes) {
  const form = new FormData();
  form.set("role", role);
  form.set("file", new File([bytes], name, { type }));
  const response = await api("/api/assets", userToken, { method: "POST", body: form });
  const body = await json(response);
  if (response.status !== 201 || !body.asset?.id) {
    throw new Error(`ASSET_UPLOAD_FAILED:${role}:${response.status}:${body.error ?? ""}`);
  }
  return body.asset.id;
}

async function adminAction(action, body = {}) {
  const response = await api("/api/admin/overview", adminToken, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: body.taskId || taskId, action, ...body }),
  });
  return { response, body: await json(response) };
}

async function cleanup(client) {
  async function removeIfPresent(query, values) {
    try { await client.query(query, values); } catch (error) { if (error?.code !== "42P01") throw error; }
  }
  if (taskId) {
    await client.query("DELETE FROM video_task_events WHERE task_id=$1", [taskId]);
    await client.query("DELETE FROM video_tasks WHERE id=$1", [taskId]);
  }
  if (automaticTaskId) {
    await client.query("DELETE FROM video_task_events WHERE task_id=$1", [automaticTaskId]);
    await client.query("DELETE FROM video_tasks WHERE id=$1", [automaticTaskId]);
  }
  if (reviewTaskId) {
    await client.query("DELETE FROM video_task_events WHERE task_id=$1", [reviewTaskId]);
    await client.query("DELETE FROM video_tasks WHERE id=$1", [reviewTaskId]);
  }
  await client.query("DELETE FROM asset_reference_metadata WHERE asset_id IN (SELECT id FROM uploaded_assets WHERE user_id=$1)", [userId]);
  await client.query("DELETE FROM uploaded_assets WHERE user_id=$1", [userId]);
  await client.query("DELETE FROM sessions WHERE id IN ($1,$2)", [userSessionId, adminSessionId]);
  await removeIfPresent("DELETE FROM credit_ledger WHERE user_id=$1", [userId]);
  await removeIfPresent("DELETE FROM credit_redemptions WHERE user_id=$1", [userId]);
  await removeIfPresent("DELETE FROM credit_recharge_requests WHERE user_id=$1", [userId]);
  await removeIfPresent("DELETE FROM user_credits WHERE user_id=$1", [userId]);
  await client.query("DELETE FROM users WHERE id=$1", [userId]);
  await rm(assetDirectory, { recursive: true, force: true });
  if (outputRoot) await rm(outputRoot, { recursive: true, force: true });
  if (reviewOutputRoot) await rm(reviewOutputRoot, { recursive: true, force: true });
  if (taskSpecPath) await rm(taskSpecPath, { force: true });
  if (promptPath) await rm(promptPath, { force: true });
  if (automaticTaskSpecPath) await rm(automaticTaskSpecPath, { force: true });
  if (automaticPromptPath) await rm(automaticPromptPath, { force: true });
  if (reviewTaskSpecPath) await rm(reviewTaskSpecPath, { force: true });
  if (reviewPromptPath) await rm(reviewPromptPath, { force: true });
}

await loadEnvironment();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
try {
  const adminEmail = (process.env.ADMIN_EMAILS ?? "1453637677@qq.com").split(",")[0].trim().toLowerCase();
  const admin = await client.query("SELECT id FROM users WHERE lower(email)=$1 LIMIT 1", [adminEmail]);
  if (!admin.rows[0]?.id) throw new Error("ADMIN_USER_REQUIRED");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await client.query(
    "INSERT INTO users (id,email,password_hash,password_salt,created_at) VALUES ($1,$2,$3,$4,$5)",
    [userId, userEmail, "integration", "integration", createdAt],
  );
  await client.query(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,revoked_at,created_at) VALUES ($1,$2,$3,$4,NULL,$5)",
    [userSessionId, userId, sessionHash(userToken), expiresAt, createdAt],
  );
  await client.query(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,revoked_at,created_at) VALUES ($1,$2,$3,$4,NULL,$5)",
    [adminSessionId, admin.rows[0].id, sessionHash(adminToken), expiresAt, createdAt],
  );
  const characterId = await uploadAsset("character", "evidence-character.png", "image/png", Buffer.from("evidence-only-character"));
  const motionId = await uploadAsset("reference_video", "evidence-reference.mp4", "video/mp4", Buffer.from("evidence-only-video-reference"));
  await client.query("INSERT INTO user_credits (user_id,balance,updated_at) VALUES ($1,$2,$3)", [userId, 300, createdAt]);
  const unsupportedVideoResponse = await api("/api/video-tasks", userToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Video reference must fail before billing.", durationSeconds: 5, aspectRatio: "9:16", assetIds: [characterId, motionId] }),
  });
  const unsupportedVideo = await json(unsupportedVideoResponse);
  if (unsupportedVideoResponse.status !== 400 || unsupportedVideo.error !== "REFERENCE_VIDEO_UNSUPPORTED") {
    throw new Error(`VIDEO_REFERENCE_GUARD_INVALID:${unsupportedVideoResponse.status}:${unsupportedVideo.error ?? ""}`);
  }
  const createResponse = await api("/api/video-tasks", userToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      // Public attempts to select a premium/manual tier are ignored.
      serviceMode: "manual",
      prompt: "Manual integration test. Evidence only; no provider submission.",
      model: "Seedance 2.0",
      resolution: "720P",
      durationSeconds: 5,
      aspectRatio: "9:16",
      assetIds: [characterId],
    }),
  });
  const created = await json(createResponse);
  if (createResponse.status !== 201 || created.task?.status !== "queued") {
    throw new Error(`PUBLIC_TASK_CREATE_FAILED:${createResponse.status}:${created.error ?? created.task?.status ?? ""}`);
  }
  taskId = created.task.id;
  const taskRow = await client.query("SELECT task_spec_path,submit_allowed,cost_authorized,execution_mode,channel FROM video_tasks WHERE id=$1", [taskId]);
  taskSpecPath = taskRow.rows[0]?.task_spec_path ?? "";
  if (
    !taskSpecPath ||
    Number(taskRow.rows[0]?.submit_allowed) !== 0 ||
    Number(taskRow.rows[0]?.cost_authorized) !== 0 ||
    taskRow.rows[0]?.execution_mode !== "codex_skill" ||
    taskRow.rows[0]?.channel !== "mimo"
  ) {
    throw new Error("PUBLIC_TASK_ROUTING_GUARD_INVALID");
  }
  promptPath = taskSpecPath.replace(/\.json$/i, ".prompt.txt");
  const publicSpec = JSON.parse(await readFile(taskSpecPath, "utf8"));
  if (publicSpec.generation_type !== "reference_guided_video") {
    throw new Error(`REFERENCE_GUIDED_TYPE_INVALID:${publicSpec.generation_type ?? "missing"}`);
  }
  if (publicSpec.references.length !== 1 || publicSpec.channel_reference_plan?.mimo?.selected_reference_keys?.length !== 1) {
    throw new Error("IMAGE_REFERENCE_PROVIDER_INPUT_GUARD_INVALID");
  }
  const balance = await client.query("SELECT balance FROM user_credits WHERE user_id=$1", [userId]);
  const charged = await client.query("SELECT amount,reason FROM credit_ledger WHERE user_id=$1 AND task_id=$2", [userId, taskId]);
  if (Number(balance.rows[0]?.balance) !== 280 || Number(charged.rows[0]?.amount) !== -20 || charged.rows[0]?.reason !== "video_automatic_reservation") {
    throw new Error("PUBLIC_UNIFIED_PRICE_RESERVATION_INVALID");
  }

  const fallback = await adminAction("fallback_manual");
  const fallbackRow = await client.query("SELECT execution_mode,status FROM video_tasks WHERE id=$1", [taskId]);
  if (fallback.response.status !== 200 || fallback.body.status !== "awaiting_manual_operator" || fallbackRow.rows[0]?.execution_mode !== "manual_assist") {
    throw new Error(`MANUAL_FALLBACK_INVALID:${fallback.response.status}:${fallback.body.error ?? fallback.body.status}`);
  }

  const rechargeResponse = await api("/api/credits", userToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create_recharge_request", requestedCredits: 100, note: "integration recharge" }),
  });
  const recharge = await json(rechargeResponse);
  if (rechargeResponse.status !== 201 || !recharge.request?.id || recharge.request?.status !== "pending") {
    throw new Error(`RECHARGE_REQUEST_CREATE_FAILED:${rechargeResponse.status}:${recharge.error ?? ""}`);
  }
  const rechargeApproved = await adminAction("approve_recharge", { rechargeRequestId: recharge.request.id });
  if (rechargeApproved.response.status !== 200 || rechargeApproved.body.recharge?.balance !== 380) {
    throw new Error(`RECHARGE_APPROVAL_FAILED:${rechargeApproved.response.status}:${rechargeApproved.body.error ?? ""}`);
  }
  const duplicateRechargeApproval = await adminAction("approve_recharge", { rechargeRequestId: recharge.request.id });
  const rechargeLedger = await client.query("SELECT amount FROM credit_ledger WHERE recharge_request_id=$1", [recharge.request.id]);
  const rechargeBalance = await client.query("SELECT balance FROM user_credits WHERE user_id=$1", [userId]);
  if (duplicateRechargeApproval.response.status !== 400 || duplicateRechargeApproval.body.error !== "RECHARGE_REQUEST_NOT_PENDING" || rechargeLedger.rowCount !== 1 || Number(rechargeBalance.rows[0]?.balance) !== 380) {
    throw new Error("RECHARGE_APPROVAL_IDEMPOTENCY_INVALID");
  }

  const ldxpSecret = process.env.LDXP_REDEEM_SECRET;
  if (!ldxpSecret || ldxpSecret.length < 32) throw new Error("LDXP_REDEEM_SECRET_REQUIRED");
  const ldxpPayload = `NN-100-${randomBytes(12).toString("hex").toUpperCase()}`;
  const ldxpCode = `${ldxpPayload}-${createHmac("sha256", ldxpSecret).update(ldxpPayload).digest("hex").slice(0, 32).toUpperCase()}`;
  const redeemResponse = await api("/api/credits", userToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "redeem_ldxp_code", code: ldxpCode }) });
  const redeemed = await json(redeemResponse);
  const duplicateRedeemResponse = await api("/api/credits", userToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "redeem_ldxp_code", code: ldxpCode }) });
  const duplicateRedeem = await json(duplicateRedeemResponse);
  if (redeemResponse.status !== 200 || redeemed.redeemedCredits !== 100 || redeemed.balance !== 480 || duplicateRedeemResponse.status !== 400 || duplicateRedeem.error !== "LDXP_REDEEM_CODE_USED") {
    throw new Error(`LDXP_REDEEM_IDEMPOTENCY_INVALID:${redeemResponse.status}:${redeemed.balance}:${duplicateRedeemResponse.status}:${duplicateRedeem.error ?? ""}`);
  }

  const automaticResponse = await api("/api/video-tasks", userToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "Automatic integration test. No provider submission.",
      model: "Seedance 2.0",
      resolution: "720P",
      durationSeconds: 5,
      aspectRatio: "9:16",
      assetIds: [characterId],
    }),
  });
  const automatic = await json(automaticResponse);
  if (automaticResponse.status !== 201 || automatic.task?.status !== "queued") {
    throw new Error(`AUTOMATIC_TASK_CREATE_FAILED:${automaticResponse.status}:${automatic.error ?? ""}`);
  }
  automaticTaskId = automatic.task.id;
  const automaticRow = await client.query("SELECT task_spec_path,execution_mode FROM video_tasks WHERE id=$1", [automaticTaskId]);
  automaticTaskSpecPath = automaticRow.rows[0]?.task_spec_path ?? "";
  automaticPromptPath = automaticTaskSpecPath.replace(/\.json$/i, ".prompt.txt");
  const automaticSpec = JSON.parse(await readFile(automaticTaskSpecPath, "utf8"));
  if (automaticSpec.generation_type !== "reference_guided_video" || automaticSpec.references.some((reference) => reference.reference_type === "video")) {
    throw new Error(`REFERENCE_GUIDED_IMAGE_ONLY_TYPE_INVALID:${automaticSpec.generation_type ?? "missing"}`);
  }
  const automaticBalance = await client.query("SELECT balance FROM user_credits WHERE user_id=$1", [userId]);
  const automaticCharge = await client.query("SELECT amount,reason FROM credit_ledger WHERE user_id=$1 AND task_id=$2", [userId, automaticTaskId]);
  if (automaticRow.rows[0]?.execution_mode !== "codex_skill" || Number(automaticBalance.rows[0]?.balance) !== 460 || Number(automaticCharge.rows[0]?.amount) !== -20 || automaticCharge.rows[0]?.reason !== "video_automatic_reservation") {
    throw new Error(`AUTOMATIC_DEFAULT_CREDIT_ROUTE_INVALID:${automaticRow.rows[0]?.execution_mode}:${automaticBalance.rows[0]?.balance}:${automaticCharge.rows[0]?.amount}:${automaticCharge.rows[0]?.reason}`);
  }
  const firstAutomaticBlock = await adminAction("block", { taskId: automaticTaskId, note: "integration refund verification" });
  const secondAutomaticBlock = await adminAction("block", { taskId: automaticTaskId, note: "integration refund retry" });
  if (firstAutomaticBlock.response.status !== 200 || secondAutomaticBlock.response.status !== 200 || firstAutomaticBlock.body.status !== "blocked" || secondAutomaticBlock.body.status !== "blocked") {
    throw new Error(`AUTOMATIC_REFUND_BLOCK_ACTION_INVALID:${firstAutomaticBlock.response.status}:${firstAutomaticBlock.body.error ?? firstAutomaticBlock.body.status}:${secondAutomaticBlock.response.status}:${secondAutomaticBlock.body.error ?? secondAutomaticBlock.body.status}`);
  }
  const refundedBalance = await client.query("SELECT balance FROM user_credits WHERE user_id=$1", [userId]);
  const refundEntries = await client.query("SELECT amount,reason FROM credit_ledger WHERE user_id=$1 AND task_id=$2 AND reason='video_task_refund'", [userId, automaticTaskId]);
  if (Number(refundedBalance.rows[0]?.balance) !== 480 || refundEntries.rowCount !== 1 || Number(refundEntries.rows[0]?.amount) !== 20) {
    throw new Error(`AUTOMATIC_REFUND_IDEMPOTENCY_INVALID:${refundedBalance.rows[0]?.balance}:${refundEntries.rowCount}:${refundEntries.rows[0]?.amount}`);
  }

  const claimed = await adminAction("claim_manual");
  if (claimed.response.status !== 200 || claimed.body.status !== "manual_in_progress") {
    throw new Error(`MANUAL_CLAIM_FAILED:${claimed.response.status}:${claimed.body.error ?? ""}`);
  }

  const authorized = await adminAction("approve_cost", {
    costReadback: "integration test: zero-cost local output",
    maxCost: "0",
  });
  if (
    authorized.response.status !== 200 ||
    authorized.body.status !== "manual_in_progress" ||
    !authorized.body.submitAllowed ||
    !authorized.body.costAuthorized
  ) {
    throw new Error(`MANUAL_COST_AUTH_FAILED:${authorized.response.status}:${authorized.body.error ?? JSON.stringify(authorized.body)}`);
  }

  const markedRunning = await adminAction("mark_running", { providerTaskId: "manual-e2e-provider" });
  if (markedRunning.response.status !== 200 || markedRunning.body.status !== "manual_in_progress") {
    throw new Error(`MANUAL_PROVIDER_STATE_FAILED:${markedRunning.response.status}:${markedRunning.body.error ?? ""}`);
  }

  const spec = JSON.parse(await readFile(taskSpecPath, "utf8"));
  outputRoot = path.dirname(spec.output_paths.downloads);
  const downloads = spec.output_paths.downloads;
  const ledgerDirectory = spec.output_paths.ledger;
  const outputPath = path.join(downloads, "manual-e2e.mp4");
  const ledgerPath = path.join(ledgerDirectory, "manual-e2e.json");
  await mkdir(downloads, { recursive: true });
  await mkdir(ledgerDirectory, { recursive: true });
  const ffmpeg = await executable("ffmpeg");
  await run(ffmpeg, [
    "-v", "error",
    "-f", "lavfi",
    "-i", "color=c=black:s=160x284:d=5",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-y", outputPath,
  ]);
  await writeFile(ledgerPath, `${JSON.stringify({ taskId, qa: "manual-e2e-passed" }, null, 2)}\n`, "utf8");

  const outside = await adminAction("complete", {
    outputPath: path.resolve(downloads, "..", "outside.mp4"),
    ledgerPath,
    contentQaPassed: true,
  });
  if (outside.response.status !== 400 || outside.body.error !== "OUTPUT_OUTSIDE_TASK_DOWNLOADS") {
    throw new Error(`OUTSIDE_PATH_GATE_FAILED:${outside.response.status}:${outside.body.error ?? ""}`);
  }

  const missingQa = await adminAction("complete", {
    outputPath,
    ledgerPath,
    contentQaPassed: false,
  });
  if (missingQa.response.status !== 400 || missingQa.body.error !== "CONTENT_QA_REQUIRED") {
    throw new Error(`CONTENT_QA_GATE_FAILED:${missingQa.response.status}:${missingQa.body.error ?? ""}`);
  }

  const completed = await adminAction("complete", {
    outputPath,
    ledgerPath,
    contentQaPassed: true,
  });
  if (completed.response.status !== 200 || completed.body.status !== "completed") {
    throw new Error(`MANUAL_COMPLETE_FAILED:${completed.response.status}:${completed.body.error ?? ""}`);
  }
  const finalTask = await client.query(
    "SELECT status,output_path,submit_allowed FROM video_tasks WHERE id=$1",
    [taskId],
  );
  if (
    finalTask.rows[0]?.status !== "completed" ||
    finalTask.rows[0]?.output_path !== outputPath ||
    Number(finalTask.rows[0]?.submit_allowed) !== 0
  ) throw new Error("MANUAL_COMPLETION_NOT_PERSISTED");
  const event = await client.query(
    "SELECT event,detail FROM video_task_events WHERE task_id=$1 AND event='admin_complete' LIMIT 1",
    [taskId],
  );
  if (!event.rows[0]) throw new Error("MANUAL_COMPLETION_EVENT_MISSING");

  const reviewCreateResponse = await api("/api/video-tasks", userToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "Provider review integration test. Evidence only; no provider submission.",
      model: "Seedance 2.0",
      resolution: "720P",
      durationSeconds: 5,
      aspectRatio: "9:16",
      // Provider-output review exercises media/QA/delivery, not reference-video
      // routing. The current public automatic route intentionally rejects video
      // references before billing, which is already asserted above.
      assetIds: [characterId],
    }),
  });
  const reviewCreated = await json(reviewCreateResponse);
  if (reviewCreateResponse.status !== 201 || !reviewCreated.task?.id) {
    throw new Error(`PROVIDER_REVIEW_TASK_CREATE_FAILED:${reviewCreateResponse.status}:${reviewCreated.error ?? ""}`);
  }
  reviewTaskId = reviewCreated.task.id;
  const reviewTaskRow = await client.query("SELECT task_spec_path FROM video_tasks WHERE id=$1", [reviewTaskId]);
  reviewTaskSpecPath = reviewTaskRow.rows[0]?.task_spec_path ?? "";
  reviewPromptPath = reviewTaskSpecPath.replace(/\.json$/i, ".prompt.txt");
  if (!reviewTaskSpecPath) throw new Error("PROVIDER_REVIEW_SPEC_MISSING");
  const reviewSpec = JSON.parse(await readFile(reviewTaskSpecPath, "utf8"));
  reviewOutputRoot = path.dirname(reviewSpec.output_paths.downloads);
  const reviewOutputPath = path.join(reviewSpec.output_paths.downloads, "provider-review.mp4");
  const reviewLedgerPath = path.join(reviewSpec.output_paths.ledger, "mimo-provider-ledger.json");
  await mkdir(reviewSpec.output_paths.downloads, { recursive: true });
  await mkdir(reviewSpec.output_paths.ledger, { recursive: true });
  await run(ffmpeg, [
    "-v", "error",
    "-f", "lavfi",
    "-i", "color=c=black:s=160x284:d=5",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-y", reviewOutputPath,
  ]);
  await writeFile(reviewLedgerPath, `${JSON.stringify({ taskId: reviewTaskId, qa: "provider-review-pending" }, null, 2)}\n`, "utf8");
  reviewSpec.provider_ledger_path = reviewLedgerPath;
  reviewSpec.provider_media_probe_passed = true;
  await writeFile(reviewTaskSpecPath, `${JSON.stringify(reviewSpec, null, 2)}\n`, "utf8");
  await client.query(
    "UPDATE video_tasks SET status='blocked', blocker='awaiting_content_qa', provider_task_id=$1, output_path=$2, submit_allowed=0, cost_authorized=1 WHERE id=$3",
    ["provider-review-e2e", reviewOutputPath, reviewTaskId],
  );

  const reviewMissingQa = await adminAction("review_output", { taskId: reviewTaskId, contentQaPassed: false });
  if (reviewMissingQa.response.status !== 400 || reviewMissingQa.body.error !== "CONTENT_QA_REQUIRED") {
    throw new Error(`PROVIDER_REVIEW_QA_GATE_FAILED:${reviewMissingQa.response.status}:${reviewMissingQa.body.error ?? ""}`);
  }
  const reviewed = await adminAction("review_output", { taskId: reviewTaskId, contentQaPassed: true });
  if (reviewed.response.status !== 200 || reviewed.body.status !== "completed") {
    throw new Error(`PROVIDER_REVIEW_COMPLETE_FAILED:${reviewed.response.status}:${reviewed.body.error ?? ""}`);
  }
  const reviewedTask = await client.query("SELECT status,output_path,submit_allowed FROM video_tasks WHERE id=$1", [reviewTaskId]);
  if (reviewedTask.rows[0]?.status !== "completed" || reviewedTask.rows[0]?.output_path !== reviewOutputPath || Number(reviewedTask.rows[0]?.submit_allowed) !== 0) {
    throw new Error("PROVIDER_REVIEW_COMPLETION_NOT_PERSISTED");
  }
  console.log("MANUAL_TASK_INTEGRATION_PASS");
} finally {
  await cleanup(client);
  await client.end();
}
