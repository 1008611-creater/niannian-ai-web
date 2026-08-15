export type PublicTaskExecutionStage = {
  id: "authorization" | "waiting_worker" | "preparing" | "generating" | "downloading" | "quality_review" | "recovery" | "delivered";
  label: string;
  detail: string;
  recoverable: boolean;
};

export type MimoGenerationType = "text_to_video" | "image_to_video";

export type MimoProviderCostContract = {
  generationType: MimoGenerationType;
  durationSeconds: number;
  currency: "Mimo credits";
  expectedCost: number;
  maximumCost: number;
  evidence: "benchmark_20260728_image_to_video_4s_720p_seedance_2_0" | "mimo_visible_unit_price_1_credit_per_second";
};

export function mimoProviderCostContract(input: { generationType: MimoGenerationType; durationSeconds: number; resolution: string; model: string }): MimoProviderCostContract | null {
  if (input.resolution.toUpperCase() !== "720P" || input.model.trim() !== "Seedance 2.0") return null;
  if (input.generationType === "image_to_video" && input.durationSeconds === 4) {
    return { generationType: input.generationType, durationSeconds: input.durationSeconds, currency: "Mimo credits", expectedCost: 8, maximumCost: 8, evidence: "benchmark_20260728_image_to_video_4s_720p_seedance_2_0" };
  }
  if (input.generationType === "text_to_video" && input.durationSeconds >= 4 && input.durationSeconds <= 15) {
    return { generationType: input.generationType, durationSeconds: input.durationSeconds, currency: "Mimo credits", expectedCost: input.durationSeconds, maximumCost: input.durationSeconds, evidence: "mimo_visible_unit_price_1_credit_per_second" };
  }
  return null;
}

export function enforceMimoProviderCostMaximum(liveEstimate: number | null, maximumCost: number) {
  if (!Number.isFinite(maximumCost) || maximumCost <= 0) throw new Error("MIMO_PROVIDER_COST_MAXIMUM_INVALID");
  if (liveEstimate === null) return { allowed: false, blocker: "MIMO_PROVIDER_COST_ESTIMATE_UNAVAILABLE" as const };
  if (!Number.isFinite(liveEstimate) || liveEstimate < 0) throw new Error("MIMO_PROVIDER_LIVE_ESTIMATE_INVALID");
  return liveEstimate > maximumCost
    ? { allowed: false, blocker: "MIMO_PROVIDER_COST_ESTIMATE_EXCEEDS_MAXIMUM" as const }
    : { allowed: true, blocker: null };
}

export const MIMO_DOWNSTREAM_RECOVERY_WINDOW_MS = 30 * 60 * 1000;

export function mimoDownstreamRecoveryState(receiptObservedAt: string | null, nowMs = Date.now()) {
  const receiptMs = receiptObservedAt ? Date.parse(receiptObservedAt) : Number.NaN;
  if (!Number.isFinite(receiptMs) || receiptMs > nowMs) return { eligible: false, expired: false, blocker: "MIMO_PROVIDER_RECEIPT_TIMESTAMP_INVALID" as const };
  const ageMs = nowMs - receiptMs;
  return ageMs <= MIMO_DOWNSTREAM_RECOVERY_WINDOW_MS
    ? { eligible: true, expired: false, blocker: null, ageMs }
    : { eligible: false, expired: true, blocker: "MIMO_PROVIDER_SYNC_RECOVERY_WINDOW_EXPIRED" as const, ageMs };
}

type EtaIdentity = { generationType: string; durationSeconds: number; resolution: string; channel: string };
type EtaSample = EtaIdentity & { elapsedSeconds: number };

export function compatibleEtaSeconds(identity: EtaIdentity, samples: EtaSample[]) {
  const valid = samples
    .filter((sample) => sample.generationType === identity.generationType
      && sample.durationSeconds === identity.durationSeconds
      && sample.resolution === identity.resolution
      && sample.channel === identity.channel
      && Number.isFinite(sample.elapsedSeconds)
      && sample.elapsedSeconds > 0)
    .map((sample) => sample.elapsedSeconds)
    .sort((left, right) => left - right);
  if (valid.length < 5) return null;
  return Math.round(valid[Math.floor(valid.length / 2)]);
}

export function executionStageStartedAt(events: Array<{ event: string; createdAt: string }>, fallback: string) {
  const priority: Record<string, number> = {
    task_prepared: 1,
    owner_mimo_execution_authorized: 2,
    mimo_worker_claimed: 3,
    provider_receipt_observed: 4,
    provider_progress_observed: 5,
    provider_completed_observed: 6,
    download_started: 7,
    cos_verified: 8,
  };
  const ordered = events
    .filter((event) => priority[event.event] && Number.isFinite(Date.parse(event.createdAt)))
    .sort((left, right) => priority[left.event] - priority[right.event] || Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return ordered.at(-1)?.createdAt ?? fallback;
}

export function publicTaskExecutionStage(input: { status: string; blocker: string | null; channel: string; providerTaskId: string | null }): PublicTaskExecutionStage | null {
  if (input.channel !== "mimo") return null;
  if (input.status === "queued_skill" && input.blocker === "awaiting_cost_readback_and_submit_authorization") return { id: "authorization", label: "等待你的确认", detail: "尚未提交生成，也不会重复扣除网站积分。", recoverable: false };
  if (input.status === "approved_for_execution") return { id: "waiting_worker", label: "等待执行器领取", detail: "Windows 执行器会在就绪后领取这条已确认的任务。", recoverable: false };
  if (input.status === "running" && !input.providerTaskId) return { id: "preparing", label: "正在准备素材", detail: "执行器正在校验锁定的素材和提示词。", recoverable: false };
  if (input.status === "running" && input.providerTaskId) return { id: "generating", label: "正在生成", detail: "已取得生成回执，正在等待结果并安全同步。", recoverable: false };
  if (input.status === "blocked" && input.blocker === "awaiting_content_qa") return { id: "quality_review", label: "正在内容验收", detail: "成片已回传并通过媒体检查，验收后即可播放和下载。", recoverable: false };
  if (input.status === "blocked" && input.blocker === "provider_sync_failed") return { id: "recovery", label: "正在恢复结果", detail: "已取得生成回执，只会同步、下载和验收，不会重复提交。", recoverable: true };
  if (input.status === "awaiting_manual_operator" && input.blocker === "automatic_generation_failed_manual_fallback") return { id: "recovery", label: "正在转人工处理", detail: "自动执行未取得生成回执，任务已保留并转入人工处理。", recoverable: true };
  if (input.status === "completed") return { id: "delivered", label: "已交付", detail: "媒体检查通过，已自动交付。", recoverable: false };
  return null;
}
