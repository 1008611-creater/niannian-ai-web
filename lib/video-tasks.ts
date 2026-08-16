import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId, dbAll, dbOne, dbRun, dbTransaction, timestamp } from "@/lib/auth";
import { reserveTaskCredits, ServiceMode, taskCreditCost } from "@/lib/credits";
import { dolaReferencePlan, validateDolaPrompt } from "@/lib/dola-channel";
import { astorieReferencePlan, astorieSkillChain, validAstorieModel } from "@/lib/astorie-channel";
import { HIGGSFIELD_MODEL, higgsfieldReferencePlan, higgsfieldSkillChain } from "@/lib/higgsfield-channel";
import { mioraReferencePlan, mioraSkillChain } from "@/lib/miora-channel";
import { resolveMioraHandoffForTask } from "@/lib/miora-session";
import { readVerifiedVideoCosDelivery } from "@/lib/video-cos";
import { mediaEdgeEnabled, mediaEdgeUrl } from "@/lib/media-edge";
import { publicTaskExecutionNotice, publicTaskStatus } from "@/lib/video-task-public-state";
import { executionStageStartedAt, mimoProviderCostContract, publicTaskExecutionStage } from "@/lib/video-task-execution-stage";

// `motion` remains readable for tasks created before reference videos became
// semantic inputs. New customer uploads use `reference_video` instead.
export const assetRoles = ["character", "product", "scene", "motion", "reference_video"] as const;
// New Mimo customer jobs are dispatched as channel-isolated codex_skill work
// for the trusted Windows CDP Agent. mac_codex remains for historical tasks;
// the server-side worker is reserved for explicitly routed legacy/system jobs.
export const executionModes = ["manual_assist", "mac_codex", "codex_skill", "server_auto"] as const;
export const videoChannels = ["auto", "mimo", "dola", "miora", "astorie", "higgsfield"] as const;
export const generationTypes = ["text_to_video", "image_to_video", "action_transfer", "reference_guided_video"] as const;
export const referenceIntents = [
  "identity",
  "asset_lock",
  "scene",
  "motion_performance",
  "camera_language",
  "rhythm",
  "composition",
  "dynamics",
  "atmosphere",
  "overall_expression",
] as const;
export const MAX_TASK_REFERENCES = 12;

export type AssetRole = (typeof assetRoles)[number];
export type ExecutionMode = (typeof executionModes)[number];
export type VideoChannel = (typeof videoChannels)[number];
export type GenerationType = (typeof generationTypes)[number];
export type ReferenceIntent = (typeof referenceIntents)[number];

type AssetRecord = {
  id: string;
  user_id: string;
  role: AssetRole;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  local_path: string;
  created_at: string;
};

type AssetReferenceMetadata = {
  asset_id: string;
  reference_intent: ReferenceIntent;
  is_primary: number;
  sort_order: number;
  chinese_duty: string;
};

export type VideoTaskRecord = {
  id: string;
  user_id: string;
  execution_mode: ExecutionMode;
  channel: VideoChannel;
  prompt: string;
  model: string;
  resolution: string;
  duration_seconds: number;
  aspect_ratio: string;
  asset_manifest: string;
  task_spec_path: string;
  status: string;
  blocker: string | null;
  provider_task_id: string | null;
  output_path: string | null;
  submit_allowed: number;
  cost_authorized: number;
  created_at: string;
  updated_at: string;
};

function extensionFor(file: File) {
  const fromName = path.extname(file.name).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/png") return ".png";
  if (file.type === "image/webp") return ".webp";
  if (file.type === "video/mp4") return ".mp4";
  if (file.type === "video/quicktime") return ".mov";
  return ".bin";
}

export function validAssetRole(value: unknown): AssetRole | null {
  return typeof value === "string" && assetRoles.includes(value as AssetRole) ? value as AssetRole : null;
}

export function validReferenceIntent(value: unknown): ReferenceIntent | null {
  return typeof value === "string" && referenceIntents.includes(value as ReferenceIntent)
    ? value as ReferenceIntent
    : null;
}

export function validExecutionMode(value: unknown): ExecutionMode | null {
  return typeof value === "string" && executionModes.includes(value as ExecutionMode) ? value as ExecutionMode : null;
}

export function validVideoChannel(value: unknown): VideoChannel | null {
  return typeof value === "string" && videoChannels.includes(value as VideoChannel) ? value as VideoChannel : null;
}

function isVideoRole(role: AssetRole) {
  return role === "motion" || role === "reference_video";
}

function defaultReferenceIntent(role: AssetRole): ReferenceIntent {
  if (role === "character") return "identity";
  if (role === "product") return "asset_lock";
  if (role === "scene") return "scene";
  // Historical `motion` rows are interpreted explicitly as performance
  // references. A video itself never chooses the final channel operation.
  return "motion_performance";
}

function defaultReferenceDuty(role: AssetRole, intent: ReferenceIntent) {
  const byIntent: Record<ReferenceIntent, string> = {
    identity: "人物身份与形象参考",
    asset_lock: "关键资产一致性参考",
    scene: "场景与环境参考",
    motion_performance: "动作与表演参考视频",
    camera_language: "镜头语言参考视频",
    rhythm: "节奏参考视频",
    composition: "构图参考视频",
    dynamics: "动态表现参考视频",
    atmosphere: "氛围参考视频",
    overall_expression: "整体视频表达参考",
  };
  return byIntent[intent] || (isVideoRole(role) ? "视频参考" : "图片参考");
}

function referenceRole(role: AssetRole, intent: ReferenceIntent) {
  if (role === "character" || intent === "identity") return "video_first_frame_anchor";
  if (role === "product" || intent === "asset_lock") return "video_key_asset_ref";
  if (role === "scene" || intent === "scene") return "video_upload_non_first_ref";
  return "video_semantic_reference";
}

function referenceType(asset: AssetRecord) {
  return asset.mime_type.startsWith("video/") ? "video" : "image";
}

function normalizeSortOrder(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 999 ? number : 0;
}

export async function saveUploadedAsset(
  userId: string,
  role: AssetRole,
  file: File,
  metadata: { referenceIntent?: ReferenceIntent | null; isPrimary?: boolean; sortOrder?: number; duty?: string } = {},
) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if ((isVideoRole(role) && !isVideo) || (!isVideoRole(role) && !isImage)) throw new Error("ASSET_TYPE_INVALID");
  if (bytes.length < 1 || bytes.length > 100 * 1024 * 1024) throw new Error("ASSET_SIZE_INVALID");

  const assetId = createId();
  const directory = path.join(process.cwd(), "data", "video-assets", userId);
  const localPath = path.join(directory, `${assetId}${extensionFor(file)}`);
  await mkdir(directory, { recursive: true });
  await writeFile(localPath, bytes);
  const record: AssetRecord = {
    id: assetId,
    user_id: userId,
    role,
    original_name: file.name.slice(0, 180) || `${role}-asset`,
    mime_type: file.type,
    byte_size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    local_path: localPath,
    created_at: timestamp(),
  };
  await dbRun(
    "INSERT INTO uploaded_assets (id, user_id, role, original_name, mime_type, byte_size, sha256, local_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [record.id, record.user_id, record.role, record.original_name, record.mime_type, record.byte_size, record.sha256, record.local_path, record.created_at],
  );
  const referenceIntent = metadata.referenceIntent ?? defaultReferenceIntent(role);
  const chineseDuty = String(metadata.duty ?? defaultReferenceDuty(role, referenceIntent)).trim().slice(0, 160) || defaultReferenceDuty(role, referenceIntent);
  const isPrimary = metadata.isPrimary === true ? 1 : 0;
  const sortOrder = normalizeSortOrder(metadata.sortOrder);
  await dbRun(
    "INSERT INTO asset_reference_metadata (asset_id, reference_intent, is_primary, sort_order, chinese_duty, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [record.id, referenceIntent, isPrimary, sortOrder, chineseDuty, record.created_at],
  );
  return { id: record.id, role: record.role, referenceIntent, isPrimary: Boolean(isPrimary), sortOrder, duty: chineseDuty, name: record.original_name, mimeType: record.mime_type, byteSize: record.byte_size };
}

async function loadAssets(userId: string, assetIds: string[]) {
  const uniqueIds = [...new Set(assetIds)];
  if (uniqueIds.length > MAX_TASK_REFERENCES) throw new Error("ASSET_LIMIT_EXCEEDED");
  const assets: AssetRecord[] = [];
  for (const assetId of uniqueIds) {
    const asset = await dbOne<AssetRecord>("SELECT * FROM uploaded_assets WHERE id = ? AND user_id = ? LIMIT 1", [assetId, userId]);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    assets.push(asset);
  }
  return assets;
}

type ReusableAssetRecord = AssetRecord & { hidden: number | string | null };

export async function listReusableImageAssets(userId: string) {
  const rows = await dbAll<ReusableAssetRecord>(
    `SELECT uploaded_assets.*, COALESCE(asset_library_visibility.hidden, 0) AS hidden
     FROM uploaded_assets
     LEFT JOIN asset_library_visibility ON asset_library_visibility.asset_id = uploaded_assets.id
     WHERE uploaded_assets.user_id = ? AND uploaded_assets.role IN ('character','product','scene')
       AND uploaded_assets.mime_type IN ('image/jpeg','image/png','image/webp') AND uploaded_assets.byte_size > 0
     ORDER BY created_at DESC LIMIT 60`,
    [userId],
  );
  return rows.map((asset) => ({
    id: asset.id,
    role: asset.role,
    name: asset.original_name,
    mimeType: asset.mime_type,
    byteSize: asset.byte_size,
    hidden: Number(asset.hidden ?? 0) === 1,
    previewUrl: `/media/assets/${encodeURIComponent(asset.id)}`,
    createdAt: asset.created_at,
  }));
}

async function ownedReusableImage(userId: string, assetId: string) {
  return dbOne<AssetRecord>(
    `SELECT * FROM uploaded_assets WHERE id = ? AND user_id = ?
     AND role IN ('character','product','scene')
     AND mime_type IN ('image/jpeg','image/png','image/webp') AND byte_size > 0 LIMIT 1`,
    [assetId, userId],
  );
}

export async function getOwnedReusableAssetPreview(userId: string, assetId: string) {
  const asset = await ownedReusableImage(userId, assetId);
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  const root = path.resolve(process.cwd(), "data", "video-assets", userId);
  const localPath = path.resolve(asset.local_path);
  if (!localPath.startsWith(`${root}${path.sep}`)) throw new Error("ASSET_PATH_INVALID");
  const file = await readFile(localPath);
  if (file.length !== Number(asset.byte_size) || createHash("sha256").update(file).digest("hex") !== asset.sha256) throw new Error("ASSET_HASH_MISMATCH");
  return { file, mimeType: asset.mime_type, name: asset.original_name };
}

export async function setOwnedReusableAssetHidden(userId: string, assetId: string, hidden: boolean) {
  const asset = await ownedReusableImage(userId, assetId);
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  await dbRun(
    `INSERT INTO asset_library_visibility (asset_id, user_id, hidden, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET hidden = excluded.hidden, updated_at = excluded.updated_at
     WHERE asset_library_visibility.user_id = excluded.user_id`,
    [asset.id, userId, hidden ? 1 : 0, timestamp()],
  );
  return { id: asset.id, hidden };
}

function queueDirectory(mode: ExecutionMode) {
  if (mode === "manual_assist") return "video-manual-queue";
  if (mode === "mac_codex") return "video-mac-queue";
  if (mode === "codex_skill") return "video-handoffs";
  return "video-server-queue";
}

function initialStatus(mode: ExecutionMode) {
  if (mode === "manual_assist") return "awaiting_manual_operator";
  if (mode === "mac_codex") return "queued_mac";
  if (mode === "codex_skill") return "queued_skill";
  return "queued_server";
}

async function referenceMetadata(asset: AssetRecord, index: number): Promise<AssetReferenceMetadata> {
  const saved = await dbOne<AssetReferenceMetadata>("SELECT * FROM asset_reference_metadata WHERE asset_id = ? LIMIT 1", [asset.id]);
  const persistedIntent = saved?.reference_intent;
  const persistedSortOrder = saved?.sort_order;
  const reference_intent = persistedIntent && referenceIntents.includes(persistedIntent)
    ? persistedIntent
    : defaultReferenceIntent(asset.role);
  return {
    asset_id: asset.id,
    reference_intent,
    is_primary: saved?.is_primary === 1 || (!saved && index === 0) ? 1 : 0,
    sort_order: typeof persistedSortOrder === "number" && Number.isInteger(persistedSortOrder) ? persistedSortOrder : index,
    chinese_duty: saved?.chinese_duty || defaultReferenceDuty(asset.role, reference_intent),
  };
}

function mimoReferencePlan(references: Array<Record<string, unknown>>) {
  const ranked = [...references].sort((left, right) => {
    const primary = Number(right.is_primary === true) - Number(left.is_primary === true);
    if (primary) return primary;
    return Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0);
  });
  const selected = new Set(ranked.slice(0, 12).map((reference) => String(reference.ref_key)));
  return {
    channel: "mimo",
    max_upload_references: 12,
    supports_multi_reference: true,
    selected_reference_keys: ranked.filter((reference) => selected.has(String(reference.ref_key))).map((reference) => String(reference.ref_key)),
    selections: ranked.map((reference, index) => ({
      ref_key: String(reference.ref_key),
      selected: selected.has(String(reference.ref_key)),
      selection_rank: index + 1,
      reason: selected.has(String(reference.ref_key))
        ? "confirmed reference selected within the verified Mimo material limit"
        : "authority reference retained in the task spec but not uploaded because it exceeds the verified Mimo material limit",
    })),
  };
}

export async function createVideoTask(input: {
  userId: string;
  executionMode: ExecutionMode;
  channel: VideoChannel;
  serviceMode?: ServiceMode;
  chargeCredits?: boolean;
  prompt: string;
  model: string;
  resolution: string;
  durationSeconds: number;
  aspectRatio: string;
  assetIds: string[];
  // A customer pressing the workbench's create button authorizes this exact
  // already-priced task to enter its configured automatic worker queue.
  autoSubmitAuthorized?: boolean;
  // Miora is an operator-only channel.  When its caller has just performed a
  // live, authenticated preflight it may carry that readback into this exact
  // task instead of asking the operator to type a speculative credit cap.
  // The provider-visible balance remains a ceiling, never a claimed price.
  mioraCurrentBalanceAuthorization?: {
    readback: string;
    maxCost: string;
    maxCredits?: number;
  };
}) {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 2000) throw new Error("PROMPT_INVALID");
  if (!videoChannels.includes(input.channel)) throw new Error("CHANNEL_INVALID");
  if (input.channel === "dola") {
    validateDolaPrompt(prompt);
    if (input.executionMode !== "codex_skill") throw new Error("DOLA_EXECUTION_MODE_INVALID");
  }
  if (input.channel === "mimo" && input.executionMode !== "mac_codex" && input.executionMode !== "codex_skill") {
    throw new Error("MIMO_EXECUTION_MODE_INVALID");
  }
  if (input.channel === "miora" && input.executionMode !== "server_auto") throw new Error("MIORA_EXECUTION_MODE_INVALID");
  if (input.channel === "astorie" && input.executionMode !== "codex_skill") throw new Error("ASTORIE_EXECUTION_MODE_INVALID");
  if (input.channel === "higgsfield" && input.executionMode !== "server_auto") throw new Error("HIGGSFIELD_EXECUTION_MODE_INVALID");
  if (input.channel === "astorie" && !validAstorieModel(input.model)) throw new Error("ASTORIE_MODEL_INVALID");
  if (input.mioraCurrentBalanceAuthorization && input.channel !== "miora") throw new Error("MIORA_COST_AUTHORIZATION_CHANNEL_INVALID");
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 4 || input.durationSeconds > 15) throw new Error("DURATION_INVALID");
  if (input.resolution !== "720P") throw new Error("RESOLUTION_INVALID");
  if (!["9:16", "16:9", "1:1"].includes(input.aspectRatio)) throw new Error("ASPECT_RATIO_INVALID");
  const assets = await loadAssets(input.userId, input.assetIds);
  if (input.channel === "astorie" && assets.length > 1) throw new Error("ASTORIE_MAX_ONE_IMAGE_REFERENCE");
  if (input.channel === "higgsfield" && assets.length > 1) throw new Error("HIGGSFIELD_MAX_ONE_IMAGE_REFERENCE");
  const roles = new Set(assets.map((asset) => asset.role));
  if (assets.length && !roles.has("character") && !roles.has("product") && !roles.has("scene")) throw new Error("ASSET_PREFLIGHT_FAILED");
  // The currently deployed Mimo visible-frontend route accepts image references
  // only. Reject before reserving credits instead of creating a task that cannot
  // reach the provider. Historical video-reference tasks remain readable.
  if (assets.some((asset) => isVideoRole(asset.role))) throw new Error("REFERENCE_VIDEO_UNSUPPORTED");
  // A reference video is not an operation selection. The routing worker may
  // choose a compatible method only after reading the locked semantic intent.
  const generationType: GenerationType = assets.length ? "image_to_video" : "text_to_video";
  const selectedChannel = input.channel === "auto" ? "mimo" : input.channel;
  const mimoProviderCost = selectedChannel === "mimo"
    ? mimoProviderCostContract({ generationType: generationType as "text_to_video" | "image_to_video", durationSeconds: input.durationSeconds, resolution: input.resolution, model: input.model })
    : null;

  const taskId = createId();
  const createdAt = timestamp();
  const directory = path.join(process.cwd(), "data", queueDirectory(input.executionMode), "pending");
  const taskSpecPath = path.join(directory, `${taskId}.json`);
  const promptPath = path.join(directory, `${taskId}.prompt.txt`);
  const allowedChannels = [selectedChannel];
  const promptSha256 = createHash("sha256").update(prompt).digest("hex");
  const serviceMode: ServiceMode = input.serviceMode ?? (input.executionMode === "manual_assist" ? "manual" : "automatic");
  const creditCost = input.chargeCredits ? taskCreditCost(serviceMode, input.durationSeconds) : 0;
  const metadata = await Promise.all(assets.map(referenceMetadata));
  const references = assets.map((asset, index) => {
    const detail = metadata[index];
    return {
      asset_id: asset.id,
      ref_key: `asset_${asset.id}`,
      path: asset.local_path,
      sha256: asset.sha256,
      role: referenceRole(asset.role, detail.reference_intent),
      source_role: asset.role,
      reference_type: referenceType(asset),
      reference_intent: detail.reference_intent,
      chinese_duty: detail.chinese_duty,
      is_primary: detail.is_primary === 1,
      sort_order: detail.sort_order,
      user_confirmation: "confirmed",
      actual_video_input: true,
      upload_eligible: true,
    };
  });
  const mioraCostAuthorized = input.channel === "miora" && Boolean(input.mioraCurrentBalanceAuthorization);
  const higgsfieldAuthorized = selectedChannel === "higgsfield";
  const automaticSubmissionAuthorized = input.autoSubmitAuthorized === true && input.channel !== "miora";
  const submissionAuthorized = mioraCostAuthorized || higgsfieldAuthorized || automaticSubmissionAuthorized;
  const queuedStatus = input.executionMode === "codex_skill" ? "queued_skill" : input.executionMode === "mac_codex" ? "queued_mac" : "approved_for_execution";
  const taskSpec = {
    task_id: taskId,
    series_id: "niannian-ai",
    episode_id: "",
    video_group_id: taskId,
    generation_type: generationType,
    prompt,
    prompt_path: promptPath,
    prompt_sha256: promptSha256,
    reference_contract_version: 2,
    references,
    channel_reference_plan: {
      mimo: mimoReferencePlan(references),
      ...(selectedChannel === "dola" ? { dola: dolaReferencePlan(references) } : {}),
      ...(selectedChannel === "miora" ? { miora: mioraReferencePlan(references) } : {}),
      ...(selectedChannel === "astorie" ? { astorie: astorieReferencePlan(references) } : {}),
      ...(selectedChannel === "higgsfield" ? { higgsfield: higgsfieldReferencePlan(references) } : {}),
    },
    ...(selectedChannel === "miora" ? {
      // The current user goal explicitly authorizes only this locked service
      // for the Miora reference-compatible white-line pass. The worker records
      // a per-task source/derived SHA lineage; no local image-edit fallback is
      // allowed when the service is unavailable.
      face_line: {
        required: true,
        authorization: "current_miora_task_goal",
        service_url: "http://127.0.0.1:9093/face",
        line_color: "white",
        line_thickness: 2,
      },
    } : {}),
    duration: `${input.durationSeconds}s`,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution.toLowerCase(),
    model: input.model,
    execution_mode: input.executionMode,
    billing: {
      service_mode: serviceMode,
      credits_reserved: creditCost,
      reservation_state: input.chargeCredits ? "reserved" : "not_charged",
    },
    ...(selectedChannel === "mimo" ? {
      provider_cost: {
        generation_type: generationType,
        duration_seconds: input.durationSeconds,
        currency: "Mimo credits",
        expected_cost: mimoProviderCost?.expectedCost ?? null,
        maximum_cost: mimoProviderCost?.maximumCost ?? null,
        evidence: mimoProviderCost?.evidence ?? "unavailable",
        balance_before: null,
        balance_after: null,
        actual_cost: null,
        live_estimate: null,
      },
    } : {}),
    ...(selectedChannel === "astorie" ? {
      provider_cost: {
        currency: "AStorie credits",
        expected_cost: null,
        maximum_cost: null,
        evidence: "pending_live_canvas_readback",
        balance_before: null,
        balance_after: null,
        actual_cost: null,
        live_estimate: null,
      },
    } : {}),
    ...(selectedChannel === "higgsfield" ? {
      provider_cost: {
        currency: "Higgsfield credits",
        expected_cost: null,
        maximum_cost: null,
        evidence: "owner_authorized_unbounded_higgsfield_spend_20260729",
        actual_cost: null,
      },
    } : {}),
    allowed_channels: allowedChannels,
    skill_route: selectedChannel === "dola"
      ? ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "dola-video-channel"]
      : selectedChannel === "miora"
        ? [...mioraSkillChain]
      : selectedChannel === "astorie"
        ? [...astorieSkillChain]
        : selectedChannel === "higgsfield"
          ? [...higgsfieldSkillChain]
        : ["ai-video-production-router", "ai-video-channel-router", "mimo-8001-video-channel"],
    cost_gate: higgsfieldAuthorized
      ? { authorized: true, currency: "Higgsfield credits", max_cost: null, readback: "owner_authorized_unbounded_higgsfield_spend_20260729", authorization: "owner_authorized_higgsfield_auto_submit" }
      : mioraCostAuthorized
      ? {
        authorized: true,
        currency: "Miora credits",
        max_cost: input.mioraCurrentBalanceAuthorization!.maxCost,
        readback: input.mioraCurrentBalanceAuthorization!.readback,
        authorization: "The operator explicitly requested this Miora video without a separate numeric cap; current provider-visible balance is the hard ceiling.",
        ...(typeof input.mioraCurrentBalanceAuthorization!.maxCredits === "number" ? { max_credits: input.mioraCurrentBalanceAuthorization!.maxCredits } : {}),
      }
      : automaticSubmissionAuthorized && selectedChannel === "mimo"
        ? { authorized: true, currency: mimoProviderCost?.currency ?? "Mimo credits", expected_cost: mimoProviderCost?.expectedCost ?? null, maximum_cost: mimoProviderCost?.maximumCost ?? null, max_cost: mimoProviderCost?.maximumCost ?? null, readback: "workbench_create_authorization", authorization: "customer_created_exact_mimo_task" }
        : automaticSubmissionAuthorized && selectedChannel === "astorie"
          ? { authorized: true, currency: "AStorie credits", max_cost: 75, maximum_cost: 75, readback: "workbench_create_authorization", authorization: "customer_created_exact_astorie_task" }
          : { authorized: false, max_cost: "", readback: "pending" },
    submit_allowed: submissionAuthorized,
    output_paths: {
      downloads: path.join(process.cwd(), "data", "video-outputs", taskId, "downloads"),
      qa: path.join(process.cwd(), "data", "video-outputs", taskId, "qa"),
      events: path.join(process.cwd(), "data", "video-outputs", taskId, "events"),
      ledger: path.join(process.cwd(), "data", "video-outputs", taskId, "ledger"),
    },
    qa_requirements: ["download_exists", "ledger_json", "media_probe", "duration_check", "cos_upload", "cos_readback"],
    status: submissionAuthorized ? queuedStatus : "prepared",
    blocker: submissionAuthorized ? null : input.executionMode === "manual_assist" ? "awaiting_manual_operator" : "awaiting_cost_readback_and_submit_authorization",
  };
  const task: VideoTaskRecord = {
    id: taskId,
    user_id: input.userId,
    execution_mode: input.executionMode,
    channel: input.channel,
    prompt,
    model: input.model,
    resolution: input.resolution,
    duration_seconds: input.durationSeconds,
    aspect_ratio: input.aspectRatio,
    asset_manifest: JSON.stringify(assets.map((asset, index) => ({
      id: asset.id,
      role: asset.role,
      name: asset.original_name,
      sha256: asset.sha256,
      referenceIntent: metadata[index].reference_intent,
      duty: metadata[index].chinese_duty,
      isPrimary: metadata[index].is_primary === 1,
      sortOrder: metadata[index].sort_order,
    }))),
    task_spec_path: taskSpecPath,
    status: submissionAuthorized ? queuedStatus : initialStatus(input.executionMode),
    blocker: taskSpec.blocker,
    provider_task_id: null,
    output_path: null,
    submit_allowed: submissionAuthorized ? 1 : 0,
    cost_authorized: submissionAuthorized ? 1 : 0,
    created_at: createdAt,
    updated_at: createdAt,
  };
  if (input.chargeCredits) await reserveTaskCredits({ userId: input.userId, taskId, serviceMode, durationSeconds: input.durationSeconds });
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(promptPath, `${prompt}\n`, "utf8");
    await writeFile(taskSpecPath, `${JSON.stringify(taskSpec, null, 2)}\n`, "utf8");
    await dbRun(
      "INSERT INTO video_tasks (id, user_id, execution_mode, channel, prompt, model, resolution, duration_seconds, aspect_ratio, asset_manifest, task_spec_path, status, blocker, provider_task_id, output_path, submit_allowed, cost_authorized, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [task.id, task.user_id, task.execution_mode, task.channel, task.prompt, task.model, task.resolution, task.duration_seconds, task.aspect_ratio, task.asset_manifest, task.task_spec_path, task.status, task.blocker, task.provider_task_id, task.output_path, task.submit_allowed, task.cost_authorized, task.created_at, task.updated_at],
    );
    await dbRun("INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)", [createId(), task.id, submissionAuthorized ? "workbench_execution_authorized" : "task_prepared", JSON.stringify({ executionMode: task.execution_mode, serviceMode, channel: task.channel, creditsReserved: creditCost, workbenchCreateAuthorization: automaticSubmissionAuthorized, mioraCurrentBalanceAuthorization: mioraCostAuthorized }), createdAt]);
  } catch (error) {
    await Promise.all([
      rm(promptPath, { force: true }),
      rm(taskSpecPath, { force: true }),
    ]);
    if (input.chargeCredits) {
      const { refundTaskCredits } = await import("@/lib/credits");
      await refundTaskCredits(taskId).catch(() => undefined);
    }
    throw error;
  }
  return task;
}

export async function listVideoTasks(userId: string) {
  return dbAll<VideoTaskRecord>("SELECT * FROM video_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", [userId]);
}

export async function findOwnedVideoTask(userId: string, taskId: string) {
  return dbOne<VideoTaskRecord>("SELECT * FROM video_tasks WHERE id = ? AND user_id = ? LIMIT 1", [taskId, userId]);
}

async function writeTaskSpec(task: VideoTaskRecord, spec: Record<string, unknown>) {
  const temporary = `${task.task_spec_path}.${createId()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  await rename(temporary, task.task_spec_path);
}

function ownerMimoAuthorizationSpec(task: VideoTaskRecord, spec: Record<string, unknown>) {
  const allowedChannels = Array.isArray(spec.allowed_channels) ? spec.allowed_channels.map(String) : [];
  const skillRoute = Array.isArray(spec.skill_route) ? spec.skill_route.map(String) : [];
  const expectedRoute = ["ai-video-production-router", "ai-video-channel-router", "mimo-8001-video-channel"];
  if (!allowedChannels.includes("mimo") || JSON.stringify(skillRoute) !== JSON.stringify(expectedRoute)) {
    throw new Error("MIMO_TASK_SPEC_MISMATCH");
  }
  const generationType = spec.generation_type === "image_to_video" ? "image_to_video" : "text_to_video";
  const providerCost = mimoProviderCostContract({ generationType, durationSeconds: task.duration_seconds, resolution: task.resolution, model: task.model });
  if (!providerCost) throw new Error("MIMO_PROVIDER_COST_CONTRACT_UNAVAILABLE");
  return {
    ...spec,
    status: "queued_skill",
    blocker: null,
    submit_allowed: true,
    cost_gate: {
      authorized: true,
      currency: providerCost.currency,
      expected_cost: providerCost.expectedCost,
      maximum_cost: providerCost.maximumCost,
      max_cost: providerCost.maximumCost,
      readback: "live_estimate_checked_by_worker_before_generate_when_available",
      authorization: "owner_confirmed_locked_mimo_execution",
      evidence: providerCost.evidence,
    },
    owner_execution_authorization: {
      kind: "locked_mimo_execution",
      website_credits_reserved: taskCreditCost("automatic", task.duration_seconds),
      provider_cost_monitoring: "typed_contract_and_live_pre_submit_estimate",
      provider_submission: "Windows Mimo Worker claims this task later; this confirmation does not click Generate.",
    },
  };
}

function ownerAstorieAuthorizationSpec(task: VideoTaskRecord, spec: Record<string, unknown>) {
  const allowedChannels = Array.isArray(spec.allowed_channels) ? spec.allowed_channels.map(String) : [];
  const skillRoute = Array.isArray(spec.skill_route) ? spec.skill_route.map(String) : [];
  if (!allowedChannels.includes("astorie") || JSON.stringify(skillRoute) !== JSON.stringify(astorieSkillChain)) {
    throw new Error("ASTORIE_TASK_SPEC_MISMATCH");
  }
  if (task.model !== "Seedance 2.0 Mini" || task.resolution !== "720P" || task.duration_seconds < 4 || task.duration_seconds > 15) {
    throw new Error("ASTORIE_TASK_PARAMETERS_INVALID");
  }
  return {
    ...spec,
    status: "queued_skill",
    blocker: null,
    submit_allowed: true,
    cost_gate: {
      authorized: true,
      currency: "AStorie credits",
      max_cost: 75,
      maximum_cost: 75,
      readback: "pending_live_astorie_canvas_price_readback",
      authorization: "owner_confirmed_one_astorie_seedance_2_mini_4_to_15_second_generate_up_to_75_credits",
    },
    owner_execution_authorization: {
      kind: "locked_astorie_execution",
      provider_submission: "AStorie Windows Worker must read the visible price and may click Generate once only when it is at or below 75 AStorie credits.",
    },
  };
}

export async function authorizeOwnedMimoExecution(userId: string, taskId: string) {
  const task = await findOwnedVideoTask(userId, taskId);
  if (!task) throw new Error("VIDEO_TASK_NOT_FOUND");
  if (task.channel !== "mimo" || task.execution_mode !== "codex_skill") throw new Error("MIMO_OWNER_AUTHORIZATION_INVALID");
  if (task.provider_task_id) throw new Error("PROVIDER_TASK_SYNC_ONLY");

  if (["queued_skill", "approved_for_execution"].includes(task.status) && task.blocker === null && task.submit_allowed === 1 && task.cost_authorized === 1) {
    return { task, idempotent: true };
  }
  if (task.status !== "queued_skill" || task.blocker !== "awaiting_cost_readback_and_submit_authorization" || task.submit_allowed !== 0 || task.cost_authorized !== 0) {
    throw new Error("MIMO_OWNER_AUTHORIZATION_STATE_INVALID");
  }

  const originalSpec = JSON.parse(await readFile(task.task_spec_path, "utf8")) as Record<string, unknown>;
  const authorizedSpec = ownerMimoAuthorizationSpec(task, originalSpec);
  const authorizedCostGate = authorizedSpec.cost_gate as Record<string, unknown>;
  await writeTaskSpec(task, authorizedSpec);

  const updatedAt = timestamp();
  try {
    const result = await dbTransaction(async (transaction) => {
      const changed = await transaction.run(
        `UPDATE video_tasks SET status = ?, blocker = NULL, submit_allowed = 1, cost_authorized = 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND execution_mode = ? AND channel = ? AND status = ?
           AND blocker = ? AND provider_task_id IS NULL AND submit_allowed = 0 AND cost_authorized = 0`,
        ["queued_skill", updatedAt, task.id, userId, "codex_skill", "mimo", "queued_skill", "awaiting_cost_readback_and_submit_authorization"],
      );
      if (changed !== 1) return null;
      await transaction.run(
        "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
        [createId(), task.id, "owner_mimo_execution_authorized", JSON.stringify({ websiteCreditsReserved: taskCreditCost("automatic", task.duration_seconds), providerCostMonitoring: "typed_contract_and_live_pre_submit_estimate", expectedProviderCost: authorizedCostGate.expected_cost, maximumProviderCost: authorizedCostGate.maximum_cost, providerSubmission: "not_submitted" }), updatedAt],
      );
      return await transaction.one<VideoTaskRecord>("SELECT * FROM video_tasks WHERE id = ? AND user_id = ? LIMIT 1", [task.id, userId]);
    });
    if (result) return { task: result, idempotent: false };
  } catch (error) {
    await writeTaskSpec(task, originalSpec).catch(() => undefined);
    throw error;
  }

  const current = await findOwnedVideoTask(userId, taskId);
  if (!current) throw new Error("VIDEO_TASK_NOT_FOUND");
  if (current.provider_task_id) throw new Error("PROVIDER_TASK_SYNC_ONLY");
  if (["queued_skill", "approved_for_execution"].includes(current.status) && current.blocker === null && current.submit_allowed === 1 && current.cost_authorized === 1) {
    return { task: current, idempotent: true };
  }
  await writeTaskSpec(task, originalSpec).catch(() => undefined);
  throw new Error("MIMO_OWNER_AUTHORIZATION_STATE_INVALID");
}

export async function authorizeOwnedAstorieExecution(userId: string, taskId: string) {
  const task = await findOwnedVideoTask(userId, taskId);
  if (!task) throw new Error("VIDEO_TASK_NOT_FOUND");
  if (task.channel !== "astorie" || task.execution_mode !== "codex_skill") throw new Error("ASTORIE_OWNER_AUTHORIZATION_INVALID");
  if (task.provider_task_id) throw new Error("PROVIDER_TASK_SYNC_ONLY");
  if (["queued_skill", "approved_for_execution"].includes(task.status) && task.blocker === null && task.submit_allowed === 1 && task.cost_authorized === 1) {
    return { task, idempotent: true };
  }
  if (task.status !== "queued_skill" || task.blocker !== "awaiting_cost_readback_and_submit_authorization" || task.submit_allowed !== 0 || task.cost_authorized !== 0) {
    throw new Error("ASTORIE_OWNER_AUTHORIZATION_STATE_INVALID");
  }

  const originalSpec = JSON.parse(await readFile(task.task_spec_path, "utf8")) as Record<string, unknown>;
  const authorizedSpec = ownerAstorieAuthorizationSpec(task, originalSpec);
  await writeTaskSpec(task, authorizedSpec);
  const updatedAt = timestamp();
  try {
    const result = await dbTransaction(async (transaction) => {
      const changed = await transaction.run(
        `UPDATE video_tasks SET status = ?, blocker = NULL, submit_allowed = 1, cost_authorized = 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND execution_mode = ? AND channel = ? AND status = ?
           AND blocker = ? AND provider_task_id IS NULL AND submit_allowed = 0 AND cost_authorized = 0`,
        ["queued_skill", updatedAt, task.id, userId, "codex_skill", "astorie", "queued_skill", "awaiting_cost_readback_and_submit_authorization"],
      );
      if (changed !== 1) return null;
      await transaction.run(
        "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
        [createId(), task.id, "owner_astorie_execution_authorized", JSON.stringify({ maximumProviderCost: 75, providerSubmission: "not_submitted_until_visible_astorie_price_readback" }), updatedAt],
      );
      return await transaction.one<VideoTaskRecord>("SELECT * FROM video_tasks WHERE id = ? AND user_id = ? LIMIT 1", [task.id, userId]);
    });
    if (result) return { task: result, idempotent: false };
  } catch (error) {
    await writeTaskSpec(task, originalSpec).catch(() => undefined);
    throw error;
  }
  const current = await findOwnedVideoTask(userId, taskId);
  if (!current) throw new Error("VIDEO_TASK_NOT_FOUND");
  if (current.provider_task_id) throw new Error("PROVIDER_TASK_SYNC_ONLY");
  if (["queued_skill", "approved_for_execution"].includes(current.status) && current.blocker === null && current.submit_allowed === 1 && current.cost_authorized === 1) {
    return { task: current, idempotent: true };
  }
  await writeTaskSpec(task, originalSpec).catch(() => undefined);
  throw new Error("ASTORIE_OWNER_AUTHORIZATION_STATE_INVALID");
}

export async function resumeOwnedMioraHumanHandoff(userId: string, taskId: string) {
  const task = await findOwnedVideoTask(userId, taskId);
  if (!task) throw new Error("VIDEO_TASK_NOT_FOUND");
  if (task.channel !== "miora" || !["awaiting_human_login", "awaiting_human_verification"].includes(task.status) || task.cost_authorized !== 1) {
    throw new Error("MIORA_HANDOFF_RESUME_INVALID");
  }
  const handoff = await resolveMioraHandoffForTask(task.id);
  const spec = JSON.parse(await readFile(task.task_spec_path, "utf8")) as Record<string, unknown>;
  spec.execution_mode = "server_auto";
  spec.status = "approved_for_execution";
  spec.blocker = null;
  spec.submit_allowed = true;
  spec.resume = {
    kind: task.provider_task_id ? "provider_sync_only_after_human_handoff" : "submit_after_human_handoff",
    handoff_id: handoff.id,
    requested_at: timestamp(),
  };
  const temporary = `${task.task_spec_path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  await rename(temporary, task.task_spec_path);
  const updatedAt = timestamp();
  await dbRun(
    "UPDATE video_tasks SET execution_mode = ?, status = ?, blocker = NULL, submit_allowed = 1, cost_authorized = 1, updated_at = ? WHERE id = ? AND user_id = ?",
    ["server_auto", "approved_for_execution", updatedAt, task.id, userId],
  );
  await dbRun(
    "INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    [createId(), task.id, "miora_handoff_completed_by_owner", JSON.stringify({ handoffId: handoff.id, providerTaskId: task.provider_task_id }), updatedAt],
  );
  return findOwnedVideoTask(userId, task.id);
}

export function taskDownloadsRoot(taskId: string) {
  return path.join(process.cwd(), "data", "video-outputs", taskId, "downloads");
}

export async function hasDeliverableOutput(task: VideoTaskRecord) {
  if (task.status !== "completed" || !task.output_path) return false;
  try {
    const spec = JSON.parse(await readFile(task.task_spec_path, "utf8")) as Record<string, unknown>;
    if (readVerifiedVideoCosDelivery(spec)) return true;
  } catch {
    // Historical tasks can still be served from their validated local output.
  }
  const downloadsRoot = path.resolve(taskDownloadsRoot(task.id));
  const outputPath = path.resolve(task.output_path);
  if (!outputPath.startsWith(`${downloadsRoot}${path.sep}`)) return false;
  try {
    return (await stat(outputPath)).isFile();
  } catch {
    return false;
  }
}

export async function publicVideoTask(task: VideoTaskRecord, options: { mimoReadyToClaim?: boolean } = {}) {
  const outputReady = await hasDeliverableOutput(task);
  const manifest = (() => {
    try {
      const value = JSON.parse(task.asset_manifest) as Array<{ id?: unknown }>;
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  })();
  const thumbnailAssetId = manifest.map((asset) => typeof asset.id === "string" ? asset.id : null).find(Boolean) ?? null;
  const creditEntries = await dbAll<{ amount: number | string }>(
    "SELECT amount FROM credit_ledger WHERE task_id = ? AND reason IN ('video_automatic_reservation', 'video_manual_reservation', 'video_task_refund')",
    [task.id],
  );
  const creditSpent = Math.max(0, -creditEntries.reduce((total, entry) => total + Number(entry.amount || 0), 0));
  const handoff = task.channel === "miora" && ["awaiting_human_login", "awaiting_human_verification"].includes(task.status)
    ? await dbOne<{ action: string; instructions: string; browser_url: string | null }>(
      "SELECT action, instructions, browser_url FROM channel_handoffs WHERE task_id = ? AND channel = ? AND state IN ('awaiting_user','acknowledged') ORDER BY created_at DESC LIMIT 1",
      [task.id, "miora"],
    )
    : null;
  const executionInput = { status: task.status, blocker: task.blocker, channel: task.channel, providerTaskId: task.provider_task_id };
  const executionStage = publicTaskExecutionStage(executionInput);
  const progressEvents = executionStage ? await dbAll<{ event: string; created_at: string }>(
    `SELECT event, created_at FROM video_task_events
     WHERE task_id = ? AND event IN ('task_prepared','owner_mimo_execution_authorized','mimo_worker_claimed','provider_receipt_observed','provider_progress_observed','provider_completed_observed','download_started','cos_verified')
     ORDER BY created_at ASC`,
    [task.id],
  ) : [];
  const stageStartedAt = executionStageStartedAt(progressEvents.map((event) => ({ event: event.event, createdAt: event.created_at })), task.updated_at);
  return {
    id: task.id,
    prompt: task.prompt,
    channel: task.channel,
    resolution: task.resolution,
    durationSeconds: task.duration_seconds,
    aspectRatio: task.aspect_ratio,
    creditCost: creditSpent,
    thumbnailUrl: thumbnailAssetId ? `/api/assets?id=${encodeURIComponent(thumbnailAssetId)}` : null,
    assetIds: manifest.map((asset) => typeof asset.id === "string" ? asset.id : "").filter(Boolean),
    status: task.channel === "mimo" && task.status === "approved_for_execution" && options.mimoReadyToClaim === false
      ? "queued"
      : publicTaskStatus(task.status, task.blocker),
    executionNotice: publicTaskExecutionNotice(executionInput, options.mimoReadyToClaim),
    executionStage: executionStage ? {
      ...executionStage,
      startedAt: stageStartedAt,
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(stageStartedAt)) / 1000)),
      etaSeconds: null,
    } : null,
    outputReady,
    outputUrl: outputReady ? (mediaEdgeEnabled() ? mediaEdgeUrl(task.id) : `/api/video-tasks/${task.id}/download`) : null,
    humanHandoff: handoff ? { action: handoff.action, instructions: handoff.instructions, browserUrl: handoff.browser_url } : null,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}
