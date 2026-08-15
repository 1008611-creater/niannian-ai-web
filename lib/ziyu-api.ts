const DEFAULT_BASE_URL = "https://ziyuai.vip";

export type ZiyuMode = "i2v" | "t2v" | "t2i";

export interface ZiyuModel {
  id: string;
  name: string;
  type: "video" | "image" | "text" | string;
  modes: ZiyuMode[];
  allowedDurations: number[];
  allowedRatios: string[];
  resolution: string;
  promptMaxLength: number;
}

export interface ZiyuJobInput {
  modelId?: string;
  mode: ZiyuMode;
  prompt: string;
  ratio?: string;
  duration?: string;
  assets?: { image?: Array<{ url: string }>; video?: Array<{ url: string }>; audio?: Array<{ url: string }> };
}

export class ZiyuApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ZiyuApiError";
  }
}

function configuredKey() {
  const key = process.env.ZIYU_API_KEY?.trim();
  return key || null;
}

export function ziyuConfigured() {
  return Boolean(configuredKey());
}

function baseUrl() {
  return (process.env.ZIYU_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const key = configuredKey();
  if (!key) throw new ZiyuApiError(503, "ZIYU_API_KEY is not configured");
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${key}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "紫域 API Key 无效或已失效",
      402: "紫域账户额度不足",
      403: "紫域账户已禁用",
      429: "紫域请求过于频繁",
      503: "紫域 API 暂时关闭",
    };
    throw new ZiyuApiError(response.status, messages[response.status] ?? `紫域接口请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}

function normalizeModel(model: Partial<ZiyuModel>): ZiyuModel | null {
  if (typeof model.id !== "string" || typeof model.name !== "string") return null;
  const modes = Array.isArray(model.modes) ? model.modes.filter((mode): mode is ZiyuMode => mode === "i2v" || mode === "t2v" || mode === "t2i") : [];
  return {
    id: model.id,
    name: model.name,
    type: typeof model.type === "string" ? model.type : "unknown",
    modes,
    allowedDurations: Array.isArray(model.allowedDurations) ? model.allowedDurations.filter((value): value is number => typeof value === "number") : [],
    allowedRatios: Array.isArray(model.allowedRatios) ? model.allowedRatios.filter((value): value is string => typeof value === "string") : [],
    resolution: typeof model.resolution === "string" ? model.resolution : "",
    promptMaxLength: typeof model.promptMaxLength === "number" ? model.promptMaxLength : 0,
  };
}

export async function listZiyuModels() {
  const payload = await requestJson<{ models?: Partial<ZiyuModel>[] }>("/api/v1/models");
  return Array.isArray(payload.models) ? payload.models.map(normalizeModel).filter((model): model is ZiyuModel => Boolean(model)) : [];
}

export async function uploadZiyuAssets(files: Array<{ type: "image" | "video" | "audio"; name: string; data: string }>) {
  const payload = await requestJson<{ assets?: Array<{ url?: string; type?: string }> }>("/api/v1/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  return Array.isArray(payload.assets)
    ? payload.assets.filter((asset): asset is { url: string; type?: string } => typeof asset?.url === "string").map((asset) => ({ url: asset.url, type: asset.type ?? "unknown" }))
    : [];
}

export async function createZiyuJob(input: ZiyuJobInput) {
  return requestJson<{ job?: { id?: string; status?: string; previewUrl?: string } }>("/api/v1/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getZiyuJob(jobId: string) {
  return requestJson<{ job?: { id?: string; status?: string; previewUrl?: string; failureReason?: string; message?: string } }>(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
}

export async function listZiyuJobs(limit = 50) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return requestJson<{ jobs?: Array<{ id?: string; status?: string; previewUrl?: string }> }>(`/api/v1/jobs?limit=${boundedLimit}`);
}
