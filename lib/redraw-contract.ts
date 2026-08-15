export const redrawStatuses = [
  "created", "queued", "planning", "provider_submitted", "generating",
  "qa_running", "completed", "qa_failed", "failed", "cancelled",
] as const;

export const redrawCancellableStatuses = [
  "created", "queued", "planning",
] as const;

export type RedrawStatus = (typeof redrawStatuses)[number];

export const transformationTypes = [
  "product_preserving_style_transfer",
  "product_preserving_scene_transfer",
  "product_preserving_lighting_transfer",
  "product_preserving_composition_transfer",
  "background_replacement",
  "character_style_transfer",
  "first_frame_regeneration",
  "image_to_video_reference",
] as const;

export const imageRedrawSubjectModes = ["product", "character", "scene", "first_frame"] as const;
export type ImageRedrawSubjectMode = (typeof imageRedrawSubjectModes)[number];

export type RedrawPlan = {
  schema_version: "image_redraw_plan_v2";
  subject_mode: ImageRedrawSubjectMode;
  transformation_type: (typeof transformationTypes)[number];
  provider_route: "runninghub_image2_image";
  prompt: string;
  negative_prompt: string;
  reference_bindings: Array<{ asset_id: string; role: "subject" | "product" | "character" | "first_frame" | "composition" | "style" | "lighting" | "scene" }>;
  subject_truth_constraints: string[];
  qa_requirements: string[];
};

export type VisualQaResult = {
  schema_version: "image_redraw_visual_qa_v2";
  subject_mode: ImageRedrawSubjectMode;
  subject_identity_preserved: boolean;
  composition_passed: boolean;
  text_drift_detected: boolean;
  quality_passed: boolean;
  evidence: string[];
  retry_instruction: string | null;
};

type RedrawRetryState = {
  status: RedrawStatus;
  attempt_count: number;
  max_attempts: number;
  provider_task_id: string | null;
  blocker?: string | null;
};

export const providerSubmissionReconciliationCode = "RUNNINGHUB_SUBMISSION_RECONCILIATION_REQUIRED";

type ProviderReconciliationAttempt = {
  attempt_number: number;
  transaction_key: string;
  provider_task_id: string | null;
  status: string;
};

export function providerReconciliationDecision(
  job: Pick<RedrawRetryState, "status" | "attempt_count" | "max_attempts" | "provider_task_id" | "blocker">,
  attempt: ProviderReconciliationAttempt,
  input: { attemptNumber: number; transactionKey: string; providerTaskId: string },
): "apply" | "idempotent" | null {
  const exactBinding = attempt.attempt_number === input.attemptNumber
    && attempt.transaction_key === input.transactionKey;
  if (!exactBinding || input.attemptNumber < 1 || input.attemptNumber > Number(job.max_attempts)) return null;
  if (job.status === "provider_submitted"
    && Number(job.attempt_count) === input.attemptNumber
    && job.provider_task_id === input.providerTaskId
    && attempt.status === "submitted"
    && attempt.provider_task_id === input.providerTaskId) return "idempotent";
  if (job.status !== "failed"
    || job.blocker !== providerSubmissionReconciliationCode
    || job.provider_task_id
    || attempt.status !== "submitting"
    || attempt.provider_task_id) return null;
  return "apply";
}

export function requiresProviderSubmissionReconciliation(job: Pick<RedrawRetryState, "status" | "blocker">) {
  return job.status === "failed" && publicRedrawBlocker(job.blocker ?? null) === providerSubmissionReconciliationCode;
}

export function redrawRetryTarget(job: RedrawRetryState): "queued" | "provider_submitted" | null {
  const attemptCount = Number(job.attempt_count);
  const maxAttempts = Number(job.max_attempts);
  if (!Number.isInteger(attemptCount) || !Number.isInteger(maxAttempts) || attemptCount < 0 || maxAttempts < 1 || attemptCount > maxAttempts) return null;
  if (!["failed", "qa_failed"].includes(job.status)) return null;
  // The Provider may already have accepted a paid request. Only reconciliation may advance this state.
  if (requiresProviderSubmissionReconciliation(job)) return null;
  if (job.status === "failed" && attemptCount > 0 && Boolean(job.provider_task_id)) return "provider_submitted";
  return attemptCount < maxAttempts ? "queued" : null;
}

function strings(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const normalized = value.map((item) => typeof item === "string" ? item.trim() : "");
  return normalized.every((item) => item && item.length <= maxLength) ? normalized : null;
}

export function parseRedrawPlan(value: unknown): RedrawPlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Record<string, unknown>;
  const constraints = strings(plan.subject_truth_constraints, 24, 500);
  const qa = strings(plan.qa_requirements, 24, 500);
  const bindings = Array.isArray(plan.reference_bindings) ? plan.reference_bindings : null;
  if (plan.schema_version !== "image_redraw_plan_v2" || !imageRedrawSubjectModes.includes(plan.subject_mode as never) || !transformationTypes.includes(plan.transformation_type as never)) return null;
  if (plan.provider_route !== "runninghub_image2_image" || typeof plan.prompt !== "string" || !plan.prompt.trim() || plan.prompt.length > 8000) return null;
  if (typeof plan.negative_prompt !== "string" || plan.negative_prompt.length > 4000 || !constraints || !qa || !bindings || bindings.length > 12) return null;
  const validBindings = bindings.every((item) => {
    if (!item || typeof item !== "object") return false;
    const binding = item as Record<string, unknown>;
    return typeof binding.asset_id === "string" && binding.asset_id.length <= 180 && ["subject", "product", "character", "first_frame", "composition", "style", "lighting", "scene"].includes(String(binding.role));
  });
  return validBindings ? plan as RedrawPlan : null;
}

export function parseVisualQa(value: unknown): VisualQaResult | null {
  if (!value || typeof value !== "object") return null;
  const qa = value as Record<string, unknown>;
  const evidence = strings(qa.evidence, 24, 500);
  const retry = qa.retry_instruction;
  if (qa.schema_version !== "image_redraw_visual_qa_v2" || !imageRedrawSubjectModes.includes(qa.subject_mode as never) || !evidence) return null;
  if (![qa.subject_identity_preserved, qa.composition_passed, qa.text_drift_detected, qa.quality_passed].every((item) => typeof item === "boolean")) return null;
  if (retry !== null && (typeof retry !== "string" || retry.length > 2000)) return null;
  return qa as VisualQaResult;
}

export function publicRedrawStatus(status: RedrawStatus) {
  if (["created", "queued"].includes(status)) return "queued";
  if (status === "planning") return "planning";
  if (["provider_submitted", "generating"].includes(status)) return "generating";
  if (status === "qa_running") return "qa";
  return status;
}

export function redrawArtifactUrls(jobId: string, artifactId: string) {
  const artifactRoute = `/api/redraw/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}/download`;
  return { previewUrl: artifactRoute, downloadUrl: `${artifactRoute}?download=1` };
}

export function publicRedrawBlocker(value: string | null) {
  if (!value) return null;
  const stableCode = value.match(/\b(?:REDRAW|RUNNINGHUB|MCGROX|COS|VISUAL_QA|PROVIDER_OUTPUT|SOURCE_ASSET|SKILL_BUNDLE|MODEL)_[A-Z0-9_]+\b/i)?.[0];
  return stableCode ? stableCode.toUpperCase() : "REDRAW_JOB_FAILED";
}

export function canCancelRedrawStatus(status: RedrawStatus) {
  return redrawCancellableStatuses.includes(status as (typeof redrawCancellableStatuses)[number]);
}
