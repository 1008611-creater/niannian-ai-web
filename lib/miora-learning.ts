import { dbAll } from "@/lib/auth";

type ReceiptRow = {
  task_id: string;
  provider_task_id: string | null;
  receipt_status: string;
  media_probe_passed: number;
  content_qa_passed: number;
  receipt_created_at: string;
  receipt_updated_at: string;
  task_status: string;
  task_blocker: string | null;
  model: string;
  resolution: string;
  duration_seconds: number;
  aspect_ratio: string;
  prompt: string;
  asset_manifest: string;
  task_created_at: string;
  task_updated_at: string;
};

type HandoffRow = { action: string; state: string; created_at: string; resolved_at: string | null };

export type MioraVerifiedTemplate = {
  sourceTaskId: string;
  prompt: string;
  referenceRoles: string[];
  model: string;
  resolution: string;
  durationSeconds: number;
  aspectRatio: string;
  completedAt: string;
  source: "real_qa_passed_receipt";
};

export type MioraLearningProfile = {
  evidenceRule: "only_real_receipts";
  receiptCount: number;
  providerTaskCount: number;
  downloadedAndProbedCount: number;
  qaPassedCount: number;
  consecutiveVerifiedCount: number;
  qaPassRate: number | null;
  activeHumanHandoffCount: number;
  handoffCounts: Record<string, number>;
  stableConcurrencyLimit: 1 | 3 | 10;
  concurrencyReason: string;
  latestVerifiedAt: string | null;
  costBaseline: {
    state: "not_observed" | "maximum_authorized_only";
    note: string;
  };
  templates: MioraVerifiedTemplate[];
};

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseReferenceRoles(assetManifest: string) {
  try {
    const assets = JSON.parse(assetManifest) as Array<{ role?: unknown }>;
    return [...new Set(assets.map((asset) => String(asset.role ?? "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/**
 * Derives a reusable Miora channel profile strictly from the durable task and
 * receipt ledgers. It intentionally has no "assumed success" path: a task
 * becomes a template only after the same task has a provider id, local media
 * evidence, a passed probe and a passed content QA flag.
 */
export async function getMioraLearningProfile(): Promise<MioraLearningProfile> {
  const [receipts, handoffs] = await Promise.all([
    dbAll<ReceiptRow>(
      `SELECT receipts.task_id, receipts.provider_task_id, receipts.status AS receipt_status,
        receipts.media_probe_passed, receipts.content_qa_passed,
        receipts.created_at AS receipt_created_at, receipts.updated_at AS receipt_updated_at,
        tasks.status AS task_status, tasks.blocker AS task_blocker, tasks.model, tasks.resolution,
        tasks.duration_seconds, tasks.aspect_ratio, tasks.prompt, tasks.asset_manifest,
        tasks.created_at AS task_created_at, tasks.updated_at AS task_updated_at
       FROM channel_execution_receipts AS receipts
       JOIN video_tasks AS tasks ON tasks.id = receipts.task_id
       WHERE receipts.channel = ? AND tasks.channel = ?
       ORDER BY receipts.updated_at DESC LIMIT 100`,
      ["miora", "miora"],
    ),
    dbAll<HandoffRow>(
      "SELECT action, state, created_at, resolved_at FROM channel_handoffs WHERE channel = ? ORDER BY created_at DESC LIMIT 200",
      ["miora"],
    ),
  ]);

  const providerTaskCount = receipts.filter((receipt) => Boolean(receipt.provider_task_id)).length;
  const downloadedAndProbed = receipts.filter((receipt) => asNumber(receipt.media_probe_passed) === 1);
  const receiptIsVerified = (receipt: ReceiptRow) => (
    Boolean(receipt.provider_task_id)
    && asNumber(receipt.media_probe_passed) === 1
    && asNumber(receipt.content_qa_passed) === 1
    && receipt.task_status === "completed"
  );
  const qaPassed = receipts.filter(receiptIsVerified);
  // Receipt rows are newest first. Promotion follows a streak, not a lifetime
  // total, so one newer failed/blocked run returns the channel to verification
  // mode instead of hiding the regression behind older wins.
  let consecutiveVerifiedCount = 0;
  for (const receipt of receipts) {
    if (!receiptIsVerified(receipt)) break;
    consecutiveVerifiedCount += 1;
  }
  const handoffCounts = handoffs.reduce<Record<string, number>>((counts, handoff) => {
    counts[handoff.action] = (counts[handoff.action] ?? 0) + 1;
    return counts;
  }, {});
  const activeHumanHandoffCount = handoffs.filter((handoff) => ["awaiting_user", "acknowledged"].includes(handoff.state)).length;
  const stableConcurrencyLimit: 1 | 3 | 10 = consecutiveVerifiedCount >= 10 ? 10 : consecutiveVerifiedCount >= 3 ? 3 : 1;
  const concurrencyReason = stableConcurrencyLimit === 10
    ? "已有至少 10 条真实、下载、探测和内容 QA 都通过的 Miora 回执；仍应在模型、会话或素材结构变化时降回单并发。"
    : stableConcurrencyLimit === 3
      ? "已有至少 3 条真实、下载、探测和内容 QA 都通过的 Miora 回执；可在相同模型与素材结构下升至 3 并发。"
      : "尚不足 3 条真实、下载、探测和内容 QA 都通过的 Miora 回执；保持单并发验证档。";
  const templates = qaPassed.slice(0, 12).map((receipt) => ({
    sourceTaskId: receipt.task_id,
    prompt: receipt.prompt,
    referenceRoles: parseReferenceRoles(receipt.asset_manifest),
    model: receipt.model,
    resolution: receipt.resolution,
    durationSeconds: asNumber(receipt.duration_seconds),
    aspectRatio: receipt.aspect_ratio,
    completedAt: receipt.task_updated_at,
    source: "real_qa_passed_receipt" as const,
  }));
  const latestVerifiedAt = qaPassed[0]?.task_updated_at ?? null;

  return {
    evidenceRule: "only_real_receipts",
    receiptCount: receipts.length,
    providerTaskCount,
    downloadedAndProbedCount: downloadedAndProbed.length,
    qaPassedCount: qaPassed.length,
    consecutiveVerifiedCount,
    qaPassRate: downloadedAndProbed.length ? Number((qaPassed.length / downloadedAndProbed.length).toFixed(4)) : null,
    activeHumanHandoffCount,
    handoffCounts,
    stableConcurrencyLimit,
    concurrencyReason,
    latestVerifiedAt,
    // Miora did not expose a per-task price in the proven UI. The max-cost gate
    // is an authorization ceiling, not a measured price, so never present it
    // as a cost baseline until a provider readback actually supplies one.
    costBaseline: {
      state: "not_observed",
      note: "尚无经 provider 页面读回的单条实际价格；成本门只保存本条最高授权，不会被误报为实际单价。",
    },
    templates,
  };
}
