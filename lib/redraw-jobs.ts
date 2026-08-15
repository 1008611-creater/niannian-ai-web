import { createHash } from "node:crypto";
import { dbAll, dbOne, dbTransaction, createId, timestamp } from "@/lib/auth";
import { canCancelRedrawStatus, imageRedrawSubjectModes, providerReconciliationDecision, providerSubmissionReconciliationCode, publicRedrawBlocker, publicRedrawStatus, redrawArtifactUrls, redrawCancellableStatuses, redrawRetryTarget, redrawStatuses, requiresProviderSubmissionReconciliation, type RedrawStatus } from "@/lib/redraw-contract";

type Asset = { id: string; user_id: string; mime_type: string; byte_size: number; sha256: string; local_path: string };
export type RedrawJobRecord = {
  id: string; user_id: string; project_id: string | null; idempotency_key: string;
  source_asset_id: string; reference_asset_ids: string; requirements_json: string;
  skill_bundle_version: string; status: RedrawStatus; attempt_count: number; max_attempts: number;
  plan_json: string | null; provider_transaction_key: string; provider_task_id: string | null;
  output_artifact_id: string | null; qa_json: string | null; blocker: string | null;
  created_at: string; updated_at: string;
};

type RedrawAttemptRecord = {
  job_id: string; attempt_number: number; transaction_key: string;
  provider_task_id: string | null; status: string;
};

function cleanId(value: unknown, max = 180) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,180}$/.test(value) && value.length <= max ? value : null;
}

function parseRequirements(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const subjectMode = imageRedrawSubjectModes.includes(source.subject_mode as never) ? source.subject_mode as (typeof imageRedrawSubjectModes)[number] : "product";
  const targetStyle = typeof source.target_style === "string" ? source.target_style.trim().slice(0, 500) : "";
  const scene = typeof source.scene === "string" ? source.scene.trim().slice(0, 500) : "";
  return {
    subject_mode: subjectMode,
    // preserve_product remains accepted for existing browser clients; new callers use preserve_subject.
    preserve_subject: source.preserve_subject !== false && source.preserve_product !== false,
    change_scene: source.change_scene === true,
    target_style: targetStyle,
    scene,
    aspect_ratio: ["1:1", "4:3", "3:4", "16:9", "9:16"].includes(String(source.aspect_ratio)) ? String(source.aspect_ratio) : "1:1",
  };
}

async function ownedImage(userId: string, assetId: string) {
  const asset = await dbOne<Asset>("SELECT id,user_id,mime_type,byte_size,sha256,local_path FROM uploaded_assets WHERE id = ? AND user_id = ? LIMIT 1", [assetId, userId]);
  if (!asset || !asset.mime_type.startsWith("image/") || asset.byte_size < 1 || asset.byte_size > 20 * 1024 * 1024) throw new Error("REDRAW_ASSET_INVALID");
  return asset;
}

export async function createRedrawJob(input: { userId: string; projectId?: unknown; idempotencyKey: string; sourceAssetId: unknown; referenceAssetIds?: unknown; requirements: unknown }) {
  const sourceAssetId = cleanId(input.sourceAssetId);
  const projectId = input.projectId == null || input.projectId === "" ? null : cleanId(input.projectId);
  const idempotencyKey = cleanId(input.idempotencyKey, 180);
  const referenceIds = Array.isArray(input.referenceAssetIds) ? [...new Set(input.referenceAssetIds.map((item) => cleanId(item)).filter(Boolean) as string[])] : [];
  const requirements = parseRequirements(input.requirements);
  if (!sourceAssetId || !idempotencyKey || referenceIds.length > 8 || !requirements || (input.projectId && !projectId)) throw new Error("REDRAW_REQUEST_INVALID");
  if (!projectId) throw new Error("REDRAW_PROJECT_REQUIRED");
  const project = await dbOne<{ id: string }>("SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1", [projectId, input.userId]);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const source = await ownedImage(input.userId, sourceAssetId);
  await Promise.all(referenceIds.map((assetId) => ownedImage(input.userId, assetId)));
  const existing = await dbOne<RedrawJobRecord>("SELECT * FROM redraw_jobs WHERE user_id = ? AND idempotency_key = ? LIMIT 1", [input.userId, idempotencyKey]);
  if (existing) return { job: existing, created: false };
  const now = timestamp();
  const id = `redraw-${createId()}`;
  const transactionKey = createHash("sha256").update([id, source.sha256, "runninghub", "image_redraw"].join("|")).digest("hex");
  const job: RedrawJobRecord = {
    id, user_id: input.userId, project_id: projectId, idempotency_key: idempotencyKey,
    source_asset_id: sourceAssetId, reference_asset_ids: JSON.stringify(referenceIds), requirements_json: JSON.stringify(requirements),
    skill_bundle_version: process.env.REDRAW_SKILL_BUNDLE_VERSION || "redraw-runtime-1", status: "queued",
    attempt_count: 0, max_attempts: 2, plan_json: null, provider_transaction_key: transactionKey,
    provider_task_id: null, output_artifact_id: null, qa_json: null, blocker: null, created_at: now, updated_at: now,
  };
  const created = await dbTransaction(async (tx) => {
    const concurrent = await tx.one<RedrawJobRecord>("SELECT * FROM redraw_jobs WHERE user_id = ? AND idempotency_key = ? LIMIT 1", [input.userId, idempotencyKey]);
    if (concurrent) return false;
    await tx.run("INSERT INTO redraw_jobs (id,user_id,project_id,idempotency_key,source_asset_id,reference_asset_ids,requirements_json,skill_bundle_version,status,attempt_count,max_attempts,plan_json,provider_transaction_key,provider_task_id,output_artifact_id,qa_json,blocker,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", Object.values(job));
    await tx.run("INSERT INTO redraw_job_events (id,job_id,event,public_status,detail_json,created_at) VALUES (?,?,?,?,?,?)", [createId(), id, "job_queued", "queued", null, now]);
    return true;
  });
  const persisted = await dbOne<RedrawJobRecord>("SELECT * FROM redraw_jobs WHERE user_id = ? AND idempotency_key = ? LIMIT 1", [input.userId, idempotencyKey]);
  if (!persisted) throw new Error("REDRAW_JOB_PERSIST_FAILED");
  return { job: persisted, created };
}

export async function getRedrawJob(userId: string, id: string) {
  return dbOne<RedrawJobRecord>("SELECT * FROM redraw_jobs WHERE id = ? AND user_id = ? LIMIT 1", [id, userId]);
}

export async function listRedrawJobs(userId: string) {
  return dbAll<RedrawJobRecord>("SELECT * FROM redraw_jobs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100", [userId]);
}

export async function cancelRedrawJob(userId: string, id: string) {
  const job = await getRedrawJob(userId, id);
  if (!job) throw new Error("REDRAW_JOB_NOT_FOUND");
  if (!canCancelRedrawStatus(job.status)) return job;
  const now = timestamp();
  const cancellableSql = redrawCancellableStatuses.map(() => "?").join(",");
  const cancelled = await dbTransaction(async (tx) => {
    const changed = await tx.run(`UPDATE redraw_jobs SET status = 'cancelled', blocker = NULL, worker_claim_token = NULL, worker_claimed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND status IN (${cancellableSql}) AND NOT EXISTS (SELECT 1 FROM redraw_attempts WHERE job_id = redraw_jobs.id AND (status = 'submitting' OR provider_task_id IS NOT NULL))`, [now, id, userId, ...redrawCancellableStatuses]);
    if (changed !== 1) return false;
    await tx.run("INSERT INTO redraw_job_events (id,job_id,event,public_status,detail_json,created_at) VALUES (?,?,?,?,?,?)", [createId(), id, "job_cancelled", "cancelled", null, now]);
    return true;
  });
  const latest = await getRedrawJob(userId, id);
  if (!latest) throw new Error("REDRAW_JOB_NOT_FOUND");
  if (!cancelled && canCancelRedrawStatus(latest.status)) throw new Error("REDRAW_CANCEL_NOT_ALLOWED");
  return latest;
}

export async function retryRedrawJob(userId: string, id: string) {
  const job = await getRedrawJob(userId, id);
  if (!job) throw new Error("REDRAW_JOB_NOT_FOUND");
  const targetStatus = redrawRetryTarget(job);
  if (!targetStatus) throw new Error("REDRAW_RETRY_NOT_ALLOWED");
  const now = timestamp();
  await dbTransaction(async (tx) => {
    // Fence the retry against a worker or another retry that advanced the row after the read above.
    const changed = await tx.run("UPDATE redraw_jobs SET status = ?, blocker = NULL, worker_claim_token = NULL, worker_claimed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND status = ? AND attempt_count = ? AND updated_at = ?", [targetStatus, now, id, userId, job.status, job.attempt_count, job.updated_at]);
    if (changed !== 1) throw new Error("REDRAW_RETRY_NOT_ALLOWED");
    await tx.run("INSERT INTO redraw_job_events (id,job_id,event,public_status,detail_json,created_at) VALUES (?,?,?,?,?,?)", [createId(), id, targetStatus === "provider_submitted" ? "provider_task_requeued" : "job_requeued", targetStatus === "provider_submitted" ? "generating" : "queued", JSON.stringify(targetStatus === "provider_submitted" ? { resume_attempt: job.attempt_count } : { next_attempt: job.attempt_count + 1 }), now]);
  });
  return getRedrawJob(userId, id);
}

export async function reconcileRedrawProviderTask(input: { jobId: unknown; attemptNumber: unknown; transactionKey: unknown; providerTaskId: unknown }) {
  const jobId = cleanId(input.jobId);
  const transactionKey = cleanId(input.transactionKey);
  const providerTaskId = cleanId(input.providerTaskId);
  const attemptNumber = Number(input.attemptNumber);
  if (!jobId || !transactionKey || !providerTaskId || !Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("REDRAW_PROVIDER_RECONCILIATION_INVALID");
  }
  const reconciledAt = timestamp();
  const result = await dbTransaction(async (tx) => {
    const job = await tx.one<RedrawJobRecord>("SELECT * FROM redraw_jobs WHERE id = ? LIMIT 1", [jobId]);
    if (!job) throw new Error("REDRAW_JOB_NOT_FOUND");
    const attempt = await tx.one<RedrawAttemptRecord>("SELECT job_id,attempt_number,transaction_key,provider_task_id,status FROM redraw_attempts WHERE job_id = ? AND attempt_number = ? LIMIT 1", [jobId, attemptNumber]);
    if (!attempt) throw new Error("REDRAW_PROVIDER_RECONCILIATION_INVALID");
    const decision = providerReconciliationDecision(job, attempt, { attemptNumber, transactionKey, providerTaskId });
    if (decision === "idempotent") return { job, reconciled: false };
    if (decision !== "apply") throw new Error("REDRAW_PROVIDER_RECONCILIATION_NOT_ALLOWED");
    const attemptChanged = await tx.run("UPDATE redraw_attempts SET provider_task_id = ?, status = 'submitted', updated_at = ? WHERE job_id = ? AND attempt_number = ? AND transaction_key = ? AND status = 'submitting' AND provider_task_id IS NULL", [providerTaskId, reconciledAt, jobId, attemptNumber, transactionKey]);
    if (attemptChanged !== 1) {
      const currentJob = await tx.one<RedrawJobRecord>("SELECT * FROM redraw_jobs WHERE id = ? LIMIT 1", [jobId]);
      const currentAttempt = await tx.one<RedrawAttemptRecord>("SELECT job_id,attempt_number,transaction_key,provider_task_id,status FROM redraw_attempts WHERE job_id = ? AND attempt_number = ? LIMIT 1", [jobId, attemptNumber]);
      if (currentJob && currentAttempt && providerReconciliationDecision(currentJob, currentAttempt, { attemptNumber, transactionKey, providerTaskId }) === "idempotent") {
        return { job: currentJob, reconciled: false };
      }
      throw new Error("REDRAW_PROVIDER_RECONCILIATION_CONFLICT");
    }
    const jobChanged = await tx.run("UPDATE redraw_jobs SET status = 'provider_submitted', provider_task_id = ?, attempt_count = ?, blocker = NULL, worker_claim_token = NULL, worker_claimed_at = NULL, updated_at = ? WHERE id = ? AND status = 'failed' AND blocker = ? AND provider_task_id IS NULL AND worker_claim_token IS NULL", [providerTaskId, attemptNumber, reconciledAt, jobId, providerSubmissionReconciliationCode]);
    if (jobChanged !== 1) throw new Error("REDRAW_PROVIDER_RECONCILIATION_CONFLICT");
    await tx.run("INSERT INTO redraw_job_events (id,job_id,event,public_status,detail_json,created_at) VALUES (?,?,?,?,?,?)", [createId(), jobId, "provider_task_reconciled", "generating", JSON.stringify({ attempt: attemptNumber }), reconciledAt]);
    const updated = await tx.one<RedrawJobRecord>("SELECT * FROM redraw_jobs WHERE id = ? LIMIT 1", [jobId]);
    if (!updated) throw new Error("REDRAW_JOB_NOT_FOUND");
    return { job: updated, reconciled: true };
  });
  return result;
}

export async function markRedrawQueueDispatchFailed(userId: string, id: string, revision: string) {
  const now = timestamp();
  return dbTransaction(async (tx) => {
    const changed = await tx.run("UPDATE redraw_jobs SET status = 'failed', blocker = 'REDRAW_QUEUE_DISPATCH_FAILED', updated_at = ? WHERE id = ? AND user_id = ? AND updated_at = ? AND worker_claim_token IS NULL AND status IN ('queued','provider_submitted')", [now, id, userId, revision]);
    if (changed !== 1) return false;
    await tx.run("INSERT INTO redraw_job_events (id,job_id,event,public_status,detail_json,created_at) VALUES (?,?,?,?,?,?)", [createId(), id, "queue_dispatch_failed", "failed", null, now]);
    return true;
  });
}

export function publicRedrawJob(job: RedrawJobRecord) {
  const status = redrawStatuses.includes(job.status) ? job.status : "failed";
  const artifactUrls = status === "completed" && job.output_artifact_id ? redrawArtifactUrls(job.id, job.output_artifact_id) : null;
  const blocker = publicRedrawBlocker(job.blocker);
  return {
    id: job.id,
    projectId: job.project_id,
    status: publicRedrawStatus(status),
    internalStatus: status,
    attempt: job.attempt_count,
    canRetry: redrawRetryTarget(job) !== null,
    outputReady: status === "completed" && Boolean(job.output_artifact_id),
    // outputUrl remains the inline-safe preview URL for existing clients.
    outputUrl: artifactUrls?.previewUrl ?? null,
    previewUrl: artifactUrls?.previewUrl ?? null,
    downloadUrl: artifactUrls?.downloadUrl ?? null,
    blocker,
    requiresProviderReconciliation: requiresProviderSubmissionReconciliation({ status, blocker }),
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}
