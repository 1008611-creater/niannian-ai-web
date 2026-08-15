#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Worker } from "bullmq";
import COS from "cos-nodejs-sdk-v5";
import pg from "pg";
import { imageSize } from "image-size";
import { claimHeartbeatIntervalMs, claimHeartbeatQueryTimeoutMs, createRedrawPlan, downloadImage, firstExecutableAttemptNumber, isClaimHeartbeatExpired, loadSkillBundle, orderedReferenceAssets, pollRunningHub, providerInputAudit, redactError, runVisualQa, sha256, shouldFailClosedAttempt, shouldReconcileAcceptedArtifact, submitRunningHub, uploadRunningHubMedia, validateReferenceAssetIds } from "./redraw-runtime.mjs";
import { cosClientOptions, redrawCosKey } from "./redraw-cos.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queueName = "niannian-redraw-v1";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });

function redisConnection() {
  const parsed = new URL(process.env.REDRAW_REDIS_URL || "");
  if (!/^rediss?:$/.test(parsed.protocol)) throw new Error("REDRAW_REDIS_URL_INVALID");
  return { host: parsed.hostname, port: Number(parsed.port || 6379), username: parsed.username || undefined, password: parsed.password || undefined, tls: parsed.protocol === "rediss:" ? {} : undefined, maxRetriesPerRequest: null };
}
function now() { return new Date().toISOString(); }
function transactionKey(job, attempt) { return createHash("sha256").update([job.id, job.source_sha256, "runninghub", "image_redraw", attempt].join("|")).digest("hex"); }
async function event(client, jobId, name, publicStatus, detail = null) { await client.query("INSERT INTO redraw_job_events (id,job_id,event,public_status,detail_json,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [randomUUID(), jobId, name, publicStatus, detail ? JSON.stringify(detail) : null, now()]); }
async function status(client, jobId, claimToken, value, blocker = null) { const result = await client.query("UPDATE redraw_jobs SET status=$1,blocker=$2,updated_at=$3 WHERE id=$4 AND worker_claim_token=$5", [value, blocker, now(), jobId, claimToken]); if (result.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST"); await event(client, jobId, `status_${value}`, value === "qa_running" ? "qa" : value, blocker ? { blocker } : null); }

function startClaimHeartbeat(jobId, claimToken) {
  const recoveryMs = Number(process.env.REDRAW_CLAIM_RECOVERY_MS || 900000);
  const intervalMs = claimHeartbeatIntervalMs(recoveryMs);
  const queryTimeoutMs = claimHeartbeatQueryTimeoutMs(recoveryMs);
  let timer = null;
  let inFlight = null;
  let stopped = false;
  let fatalError = null;
  let lastSuccessAt = Date.now();

  const schedule = () => {
    if (stopped || fatalError) return;
    timer = setTimeout(tick, intervalMs);
    timer.unref?.();
  };
  const tick = () => {
    if (stopped || fatalError) return;
    inFlight = pool.query({
      text: "UPDATE redraw_jobs SET worker_claimed_at=$1 WHERE id=$2 AND worker_claim_token=$3 AND status IN ('planning','provider_submitted','generating','qa_running')",
      values: [now(), jobId, claimToken],
      query_timeout: queryTimeoutMs,
    })
      .then((result) => {
        if (result.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST");
        lastSuccessAt = Date.now();
      })
      .catch((error) => {
        if (String(error?.message || error) === "REDRAW_WORKER_CLAIM_LOST") fatalError = new Error("REDRAW_WORKER_CLAIM_LOST");
        else if (isClaimHeartbeatExpired(lastSuccessAt, recoveryMs)) fatalError = new Error("REDRAW_WORKER_CLAIM_HEARTBEAT_FAILED");
      })
      .finally(() => {
        inFlight = null;
        schedule();
      });
  };
  schedule();

  return {
    assertHealthy() {
      if (!fatalError && isClaimHeartbeatExpired(lastSuccessAt, recoveryMs)) fatalError = new Error("REDRAW_WORKER_CLAIM_HEARTBEAT_FAILED");
      if (fatalError) throw fatalError;
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
    },
  };
}

function cosClient() {
  return new COS(cosClientOptions());
}
async function cosPut(key, bytes, mimeType) {
  const client = cosClient();
  await new Promise((resolve, reject) => client.putObject({ Bucket: process.env.TENCENT_COS_BUCKET, Region: process.env.TENCENT_COS_REGION, Key: key, Body: bytes, ContentType: mimeType }, (error, data) => error ? reject(error) : resolve(data)));
}
async function cosVerify(key, expectedSha256) {
  const client = cosClient();
  const result = await new Promise((resolve, reject) => client.getObject({ Bucket: process.env.TENCENT_COS_BUCKET, Region: process.env.TENCENT_COS_REGION, Key: key }, (error, data) => error ? reject(error) : resolve(data)));
  const bytes = Buffer.from(result.Body || []);
  if (sha256(bytes) !== expectedSha256) throw new Error("COS_OBJECT_SHA256_MISMATCH");
}

async function reconcileAcceptedArtifact(client, job, claimToken) {
  const result = await client.query(`SELECT a.id,a.object_key,a.mime_type,a.sha256,
    (SELECT r.qa_json FROM redraw_attempts r WHERE r.job_id=a.job_id AND r.status='qa_passed' ORDER BY r.attempt_number DESC LIMIT 1) AS qa_json
    FROM redraw_artifacts a WHERE a.job_id=$1 AND a.user_id=$2 AND a.role='accepted_output'
    ORDER BY a.created_at DESC LIMIT 1`, [job.id, job.user_id]);
  const artifact = result.rows[0];
  if (!shouldReconcileAcceptedArtifact(artifact)) return null;
  await cosVerify(artifact.object_key, artifact.sha256);
  const completed = await client.query("UPDATE redraw_jobs SET status='completed',output_artifact_id=$1,qa_json=COALESCE($2,qa_json),blocker=NULL,worker_claim_token=NULL,worker_claimed_at=NULL,updated_at=$3 WHERE id=$4 AND worker_claim_token=$5", [artifact.id, artifact.qa_json, now(), job.id, claimToken]);
  if (completed.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST");
  await event(client, job.id, "redraw_completed_reconciled", "completed", { artifact_id: artifact.id, sha256: artifact.sha256 });
  return { status: "completed", artifactId: artifact.id, reconciled: true };
}

async function claim(jobId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT j.*,a.id AS source_asset_row_id,a.local_path,a.mime_type AS source_mime,a.sha256 AS source_sha256,a.original_name FROM redraw_jobs j LEFT JOIN uploaded_assets a ON a.id=j.source_asset_id AND a.user_id=j.user_id WHERE j.id=$1 FOR UPDATE OF j`, [jobId]);
    const job = result.rows[0];
    if (!job || ["completed", "cancelled"].includes(job.status)) { await client.query("ROLLBACK"); return null; }
    if (!["queued", "planning", "provider_submitted", "generating", "qa_running"].includes(job.status)) { await client.query("ROLLBACK"); return null; }
    if (!job.source_asset_row_id) {
      const failedAt = now();
      await client.query("UPDATE redraw_jobs SET status='failed',blocker='REDRAW_SOURCE_ASSET_MISSING',worker_claim_token=NULL,worker_claimed_at=NULL,updated_at=$1 WHERE id=$2 AND status IN ('queued','planning','provider_submitted','generating','qa_running')", [failedAt, jobId]);
      await event(client, jobId, "source_asset_missing", "failed", { blocker: "REDRAW_SOURCE_ASSET_MISSING" });
      await client.query("COMMIT");
      return null;
    }
    const claimedAt = job.worker_claimed_at ? Date.parse(job.worker_claimed_at) : 0;
    if (job.worker_claim_token && Number.isFinite(claimedAt) && Date.now() - claimedAt < Number(process.env.REDRAW_CLAIM_RECOVERY_MS || 900000)) { await client.query("ROLLBACK"); return null; }
    const claimToken = randomUUID();
    await client.query("UPDATE redraw_jobs SET worker_claim_token=$1,worker_claimed_at=$2,status=CASE WHEN status='queued' THEN 'planning' ELSE status END,updated_at=$2 WHERE id=$3", [claimToken, now(), jobId]);
    job.worker_claim_token = claimToken;
    job.worker_claimed_at = now();
    if (job.status === "queued") job.status = "planning";
    await client.query("COMMIT");
    return job;
  } finally { client.release(); }
}

async function execute(jobId) {
  let claimedToken = null;
  let heartbeat = null;
  try {
  const job = await claim(jobId);
  if (!job) return { skipped: true };
  const claimToken = job.worker_claim_token;
  claimedToken = claimToken;
  heartbeat = startClaimHeartbeat(job.id, claimToken);
  const sourceBytes = await readFile(job.local_path);
  if (sha256(sourceBytes) !== job.source_sha256) throw new Error("SOURCE_ASSET_HASH_MISMATCH");
  const bundle = await loadSkillBundle(projectRoot, job.skill_bundle_version);
  const referenceAssetIds = validateReferenceAssetIds(JSON.parse(job.reference_asset_ids));
  let plan = job.plan_json ? JSON.parse(job.plan_json) : null;
  const client = await pool.connect();
  try {
    const referenceRows = referenceAssetIds.length
      ? (await client.query("SELECT id,local_path,mime_type,sha256,original_name FROM uploaded_assets WHERE user_id=$1 AND id=ANY($2::text[])", [job.user_id, referenceAssetIds])).rows
      : [];
    const referenceAssets = orderedReferenceAssets(referenceAssetIds, referenceRows);
    const referenceInputs = await Promise.all(referenceAssets.map(async (asset) => {
      const bytes = await readFile(asset.local_path);
      if (sha256(bytes) !== asset.sha256) throw new Error("REDRAW_REFERENCE_ASSET_HASH_MISMATCH");
      return { ...asset, bytes };
    }));
    if (!plan) {
      heartbeat.assertHealthy();
      await status(client, job.id, claimToken, "planning");
      plan = await createRedrawPlan({ bundle, requirements: JSON.parse(job.requirements_json), sourceAssetId: job.source_asset_id, referenceAssetIds });
      heartbeat.assertHealthy();
      const planUpdate = await client.query("UPDATE redraw_jobs SET plan_json=$1,updated_at=$2 WHERE id=$3 AND worker_claim_token=$4", [JSON.stringify(plan), now(), job.id, claimToken]);
      if (planUpdate.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST");
    }
    const reconciled = await reconcileAcceptedArtifact(client, job, claimToken);
    if (reconciled) return reconciled;
    let retryInstruction = null;
    for (let attempt = firstExecutableAttemptNumber(job); attempt <= Number(job.max_attempts); attempt += 1) {
      const txKey = transactionKey(job, attempt);
      await client.query("INSERT INTO redraw_attempts (id,job_id,attempt_number,transaction_key,provider,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'runninghub','preparing',$5,$5) ON CONFLICT (job_id,attempt_number) DO NOTHING", [randomUUID(), job.id, attempt, txKey, now()]);
      const prior = (await client.query("SELECT * FROM redraw_attempts WHERE job_id=$1 AND attempt_number=$2", [job.id, attempt])).rows[0];
      if (shouldFailClosedAttempt(prior)) throw new Error("RUNNINGHUB_SUBMISSION_RECONCILIATION_REQUIRED");
      let taskId = prior.provider_task_id;
      if (!taskId) {
        heartbeat.assertHealthy();
        const imageUrls = [await uploadRunningHubMedia(sourceBytes, job.original_name, job.source_mime)];
        for (const reference of referenceInputs) {
          heartbeat.assertHealthy();
          imageUrls.push(await uploadRunningHubMedia(reference.bytes, reference.original_name, reference.mime_type));
        }
        heartbeat.assertHealthy();
        const prompt = retryInstruction ? `${plan.prompt}\n\n针对上一版失败必须修复：${retryInstruction}` : plan.prompt;
        const preparing = await client.query("UPDATE redraw_attempts SET status='submitting',updated_at=$1 WHERE job_id=$2 AND attempt_number=$3 AND EXISTS (SELECT 1 FROM redraw_jobs WHERE id=$2 AND worker_claim_token=$4)", [now(), job.id, attempt, claimToken]);
        if (preparing.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST");
        taskId = await submitRunningHub({ prompt, imageUrls, aspectRatio: JSON.parse(job.requirements_json).aspect_ratio, transactionKey: txKey });
        heartbeat.assertHealthy();
        // Provider upload URLs may contain temporary signatures. Persist only durable, non-secret input evidence.
        const inputAudit = providerInputAudit(
          { id: job.source_asset_id, sha256: job.source_sha256, mime_type: job.source_mime },
          referenceInputs,
        );
        const submitted = await client.query("UPDATE redraw_attempts SET provider_task_id=$1,status='submitted',input_urls_json=$2,updated_at=$3 WHERE job_id=$4 AND attempt_number=$5 AND EXISTS (SELECT 1 FROM redraw_jobs WHERE id=$4 AND worker_claim_token=$6)", [taskId, JSON.stringify(inputAudit), now(), job.id, attempt, claimToken]);
        if (submitted.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST");
        const providerUpdate = await client.query("UPDATE redraw_jobs SET status='provider_submitted',provider_task_id=$1,attempt_count=$2,updated_at=$3 WHERE id=$4 AND worker_claim_token=$5", [taskId, attempt, now(), job.id, claimToken]);
        if (providerUpdate.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST");
        await event(client, job.id, "provider_task_persisted", "generating", { attempt });
      }
      await status(client, job.id, claimToken, "generating");
      heartbeat.assertHealthy();
      const outputUrl = await pollRunningHub(taskId);
      heartbeat.assertHealthy();
      const output = await downloadImage(outputUrl);
      await status(client, job.id, claimToken, "qa_running");
      heartbeat.assertHealthy();
      const qa = await runVisualQa({ bundle, sourceBytes, sourceMime: job.source_mime, outputBytes: output.bytes, outputMime: output.mimeType, plan });
      heartbeat.assertHealthy();
      const qaUpdate = await client.query("UPDATE redraw_attempts SET status=$1,output_sha256=$2,qa_json=$3,updated_at=$4 WHERE job_id=$5 AND attempt_number=$6 AND EXISTS (SELECT 1 FROM redraw_jobs WHERE id=$5 AND worker_claim_token=$7)", [qa.quality_passed && qa.subject_identity_preserved && !qa.text_drift_detected ? "qa_passed" : "qa_failed", sha256(output.bytes), JSON.stringify(qa), now(), job.id, attempt, claimToken]);
      if (qaUpdate.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST");
      if (!qa.quality_passed || !qa.subject_identity_preserved || qa.text_drift_detected) {
        retryInstruction = qa.retry_instruction;
        if (attempt < Number(job.max_attempts) && retryInstruction) continue;
        const failedQa = await client.query("UPDATE redraw_jobs SET status='qa_failed',qa_json=$1,blocker='VISUAL_QA_FAILED',worker_claim_token=NULL,worker_claimed_at=NULL,updated_at=$2 WHERE id=$3 AND worker_claim_token=$4", [JSON.stringify(qa), now(), job.id, claimToken]);
        if (failedQa.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST");
        await event(client, job.id, "visual_qa_failed", "qa_failed", { attempt });
        return { status: "qa_failed" };
      }
      const dimensions = imageSize(output.bytes);
      const artifactId = `artifact-${randomUUID()}`;
      const extension = output.mimeType === "image/jpeg" ? "jpg" : output.mimeType === "image/webp" ? "webp" : "png";
      const objectKey = redrawCosKey({ userId: job.user_id, jobId: job.id, artifactId, extension });
      heartbeat.assertHealthy();
      await cosPut(objectKey, output.bytes, output.mimeType);
      heartbeat.assertHealthy();
      await cosVerify(objectKey, sha256(output.bytes));
      heartbeat.assertHealthy();
      await client.query("INSERT INTO redraw_artifacts (id,job_id,user_id,role,object_key,mime_type,byte_size,sha256,width,height,created_at) VALUES ($1,$2,$3,'accepted_output',$4,$5,$6,$7,$8,$9,$10)", [artifactId, job.id, job.user_id, objectKey, output.mimeType, output.bytes.length, sha256(output.bytes), dimensions.width || null, dimensions.height || null, now()]);
      const completed = await client.query("UPDATE redraw_jobs SET status='completed',output_artifact_id=$1,qa_json=$2,blocker=NULL,worker_claim_token=NULL,worker_claimed_at=NULL,updated_at=$3 WHERE id=$4 AND worker_claim_token=$5", [artifactId, JSON.stringify(qa), now(), job.id, claimToken]);
      if (completed.rowCount !== 1) throw new Error("REDRAW_WORKER_CLAIM_LOST");
      await event(client, job.id, "redraw_completed", "completed", { artifact_id: artifactId, sha256: sha256(output.bytes) });
      return { status: "completed", artifactId };
    }
  } finally { client.release(); }
  } catch (error) {
    if (claimedToken) {
      await pool.query("UPDATE redraw_jobs SET status='failed',blocker=$1,worker_claim_token=NULL,worker_claimed_at=NULL,updated_at=$2 WHERE id=$3 AND worker_claim_token=$4 AND status NOT IN ('completed','cancelled')", [redactError(error), now(), jobId, claimedToken]).catch(() => undefined);
    }
    throw error;
  } finally {
    if (heartbeat) await heartbeat.stop();
  }
}

const worker = new Worker(queueName, async (bullJob) => {
  try { return await execute(String(bullJob.data.jobId)); }
  catch (error) { throw new Error(redactError(error)); }
}, { connection: redisConnection(), concurrency: Number(process.env.REDRAW_WORKER_CONCURRENCY || 1) });

worker.on("error", (error) => process.stderr.write(`[redraw-worker] ${redactError(error)}\n`));
async function shutdown() { await worker.close(); await pool.end(); process.exit(0); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
