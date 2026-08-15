import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { probeVideoDuration } from "../lib/video-output-gate.mjs";

const PROVIDER_TIMEOUT_MS = 45_000;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);

function baseUrl(env) {
  const raw = String(env.MIMO_BASE_URL || "https://fd.aancn.cn").trim();
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MIMO_BASE_URL_INVALID");
  return parsed;
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanProviderError(value) {
  return String(value || "provider request failed")
    .replace(/bearer\s+[a-zA-Z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(password|token|secret|cookie)=\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function mimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".webm": return "video/webm";
    default: return "application/octet-stream";
  }
}

function isVideoReference(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function providerStatus(item) {
  const value = Number(item?.status);
  if ([20, 50, 60].includes(value)) return "running";
  if (value === 1) return "completed";
  if (value === 40) return "failed";
  return "unknown";
}

function providerResult({ status, providerTaskId, summary, blocker = null, outputPath = null, mediaProbePassed = false, ledgerPath = null }) {
  return {
    status,
    providerTaskId,
    outputPath,
    blocker,
    summary,
    mediaProbePassed,
    contentQaPassed: false,
    ledgerPath,
  };
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function apiJson(fetchImpl, base, endpoint, { method = "GET", token = "", body } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const response = await fetchImpl(new URL(endpoint, base), {
    method,
    headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`MIMO_${endpoint.replaceAll("/", "_").toUpperCase()}_INVALID_RESPONSE`);
  }
  if (!response.ok || (data.code !== undefined && data.code !== 0 && data.code !== 200)) {
    throw new Error(`MIMO_${endpoint.replaceAll("/", "_").toUpperCase()}_FAILED:${response.status}:${cleanProviderError(data.msg)}`);
  }
  return data;
}

async function authenticate(fetchImpl, base, env) {
  const configuredToken = String(env.MIMO_TOKEN || "").trim();
  if (configuredToken) return { token: configuredToken, mode: "token", credits: null };
  const username = String(env.MIMO_USERNAME || "").trim();
  const password = String(env.MIMO_PASSWORD || "");
  if (!username || !password) throw new Error("MIMO_DIRECT_CREDENTIALS_MISSING");
  const payload = await apiJson(fetchImpl, base, "/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  const token = typeof payload.data?.token === "string" ? payload.data.token : "";
  if (!token) throw new Error("MIMO_LOGIN_TOKEN_MISSING");
  const credits = payload.data?.credits;
  return {
    token,
    mode: "username_password",
    credits: typeof credits === "string" || typeof credits === "number" ? String(credits) : null,
  };
}

async function uploadReference(fetchImpl, base, token, reference) {
  const bytes = await readFile(reference.path);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType(reference.path) }), path.basename(reference.path));
  const response = await fetchImpl(new URL("/api/video/upload", base), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 200) {
    throw new Error(`MIMO_UPLOAD_FAILED:${response.status}:${cleanProviderError(payload.msg)}`);
  }
  const material = payload.data || {};
  const video = isVideoReference(reference.path);
  if (video && !material.vid) throw new Error("MIMO_VIDEO_UPLOAD_REFERENCE_MISSING");
  if (!video && (!material.imageUri || !material.imageUrl)) throw new Error("MIMO_IMAGE_UPLOAD_REFERENCE_MISSING");
  return {
    path: path.resolve(reference.path),
    sha256: hash(bytes),
    role: reference.role || null,
    chineseDuty: reference.chinese_duty || null,
    type: video ? "video" : "image",
    material: video ? { vid: material.vid } : { imageUri: material.imageUri, imageUrl: material.imageUrl },
  };
}

function generationRequest(spec, uploaded) {
  const duration = Number(String(spec.duration || "").replace(/[^\d.]/g, ""));
  if (!Number.isInteger(duration) || duration < 2 || duration > 15) throw new Error("MIMO_DURATION_INVALID");
  const aspectRatio = String(spec.aspect_ratio || "");
  if (!["9:16", "1:1", "16:9", "4:3", "3:4"].includes(aspectRatio)) throw new Error("MIMO_ASPECT_RATIO_INVALID");
  const prompt = String(spec.prompt || "").trim();
  if (!prompt) throw new Error("LOCKED_PROMPT_MISSING");
  const images = uploaded.filter((item) => item.type === "image").map((item) => item.material);
  const videos = uploaded.filter((item) => item.type === "video").map((item) => item.material);
  if (!images.length && !videos.length) throw new Error("MIMO_REFERENCES_MISSING");
  return {
    prompt,
    duration,
    aspectRatio,
    ...(images.length ? { images } : {}),
    ...(videos.length ? { videos } : {}),
  };
}

async function downloadOutput(fetchImpl, base, token, videoUrl, outputPath) {
  if (!videoUrl) throw new Error("MIMO_VIDEO_URL_MISSING");
  let source = String(videoUrl);
  let includeAuth = false;
  if (!source.includes("tos-cn-beijing")) {
    const proxy = await apiJson(fetchImpl, base, "/api/video/proxy-token", {
      method: "POST",
      token,
      body: { url: source },
    });
    const proxyToken = typeof proxy.data?.token === "string" ? proxy.data.token : "";
    if (!proxyToken) throw new Error("MIMO_PROXY_TOKEN_MISSING");
    source = new URL(`/api/video/proxy-video?token=${encodeURIComponent(proxyToken)}`, base).toString();
    includeAuth = true;
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  const response = await fetchImpl(source, {
    headers: includeAuth ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) throw new Error(`MIMO_DOWNLOAD_FAILED:${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
  const bytes = await readFile(outputPath);
  return { path: path.resolve(outputPath), sha256: hash(bytes) };
}

export function mimoDirectConfigured(env = process.env) {
  return Boolean(String(env.MIMO_TOKEN || "").trim() || (String(env.MIMO_USERNAME || "").trim() && String(env.MIMO_PASSWORD || "")));
}

// Keep every authority reference in the task spec. New task specs carry a
// deterministic provider selection because Mimo accepts at most 12 materials.
// Legacy specs omit the plan and keep their historical active-reference path.
export function selectMimoUploadReferences(spec) {
  const references = Array.isArray(spec.references)
    ? spec.references.filter((reference) => reference?.actual_video_input !== false)
    : [];
  const plan = spec.channel_reference_plan?.mimo;
  if (!plan) return references;
  if (plan.channel !== "mimo" || plan.max_upload_references !== 12 || !Array.isArray(plan.selections)) {
    throw new Error("MIMO_REFERENCE_PLAN_INVALID");
  }
  const selections = new Map(plan.selections.map((selection) => [String(selection?.ref_key || ""), selection]));
  const selected = references.filter((reference) => {
    const selection = selections.get(String(reference?.ref_key || ""));
    return selection?.selected === true && reference?.upload_eligible === true && reference?.user_confirmation === "confirmed";
  });
  if (!selected.length || selected.length > 12) throw new Error("MIMO_REFERENCE_COUNT_INVALID");
  if (new Set(selected.map((reference) => String(reference.ref_key))).size !== selected.length) throw new Error("MIMO_REFERENCE_PLAN_DUPLICATE");
  return selected;
}

export async function runMimoDirectTask({ task, spec, env = process.env, fetchImpl = fetch, probe = probeVideoDuration }) {
  const base = baseUrl(env);
  const auth = await authenticate(fetchImpl, base, env);
  const providerTaskId = task.provider_task_id || spec.provider_task_id || null;

  if (!providerTaskId) {
    const references = selectMimoUploadReferences(spec);
    if (!references.length || references.length > 12) throw new Error("MIMO_REFERENCE_COUNT_INVALID");
    const uploaded = [];
    for (const reference of references) uploaded.push(await uploadReference(fetchImpl, base, auth.token, reference));
    const request = generationRequest(spec, uploaded);
    const response = await apiJson(fetchImpl, base, "/api/video/generate", {
      method: "POST",
      token: auth.token,
      body: request,
    });
    const submittedTaskId = typeof response.data?.id === "string" ? response.data.id : "";
    if (!submittedTaskId) throw new Error("MIMO_PROVIDER_TASK_ID_MISSING");
    const eventPath = path.join(String(spec.output_paths?.events || ""), "mimo-submission.json");
    if (!path.isAbsolute(eventPath)) throw new Error("EVENT_OUTPUT_PATH_MISSING");
    await writeJson(eventPath, {
      provider: "mimo",
      taskId: task.id,
      providerTaskId: submittedTaskId,
      auth: { mode: auth.mode, credits: auth.credits, tokenPresent: true },
      promptSha256: spec.prompt_sha256 || null,
      duration: request.duration,
      aspectRatio: request.aspectRatio,
      referenceSelection: references.map((reference) => ({
        refKey: reference.ref_key || null,
        role: reference.role || null,
        referenceIntent: reference.reference_intent || null,
        chineseDuty: reference.chinese_duty || null,
      })),
      uploaded,
      createdAt: new Date().toISOString(),
    });
    return providerResult({
      status: "running",
      providerTaskId: submittedTaskId,
      summary: "渠道 M 已提交，正在生成。",
    });
  }

  const statusPayload = await apiJson(fetchImpl, base, "/api/video/batch-status", {
    method: "POST",
    token: auth.token,
    body: { taskIds: [providerTaskId] },
  });
  const data = Array.isArray(statusPayload.data)
    ? statusPayload.data.find((item) => item?.taskId === providerTaskId || item?.id === providerTaskId) || statusPayload.data[0]
    : statusPayload.data;
  const status = providerStatus(data);
  if (status === "running") {
    return providerResult({ status: "running", providerTaskId, summary: "渠道 M 正在生成。" });
  }
  if (status !== "completed") {
    return providerResult({
      status: "blocked",
      providerTaskId,
      blocker: "mimo_provider_failed",
      summary: `渠道 M 未能完成本次生成：${cleanProviderError(data?.failReason || "provider status unavailable")}`,
    });
  }

  const downloadsRoot = String(spec.output_paths?.downloads || "");
  const ledgerRoot = String(spec.output_paths?.ledger || "");
  if (!path.isAbsolute(downloadsRoot) || !path.isAbsolute(ledgerRoot)) throw new Error("TASK_OUTPUT_PATHS_INVALID");
  const output = await downloadOutput(fetchImpl, base, auth.token, data?.videoUrl, path.join(downloadsRoot, "mimo-output.mp4"));
  const probedDuration = await probe(output.path);
  const ledgerPath = path.join(ledgerRoot, "mimo-provider-ledger.json");
  await writeJson(ledgerPath, {
    provider: "mimo",
    taskId: task.id,
    providerTaskId,
    auth: { mode: auth.mode, credits: auth.credits, tokenPresent: true },
    promptSha256: spec.prompt_sha256 || null,
    finalStatus: Number(data?.status),
    output,
    probedDuration,
    contentQa: "pending_admin_review",
    completedAt: new Date().toISOString(),
  });
  return providerResult({
    status: "blocked",
    providerTaskId,
    outputPath: output.path,
    mediaProbePassed: true,
    ledgerPath,
    blocker: "awaiting_content_qa",
    summary: "渠道 M 已下载成片并通过媒体探测，等待管理员内容验收后交付。",
  });
}
