import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { recordMioraSessionReadback } from "@/lib/miora-session";

export const mioraSkillChain = [
  "ai-video-production-router",
  "sd2-video-generation",
  "prompt-skill-router",
  "ai-video-channel-router",
  "miora-seedance2-channel",
] as const;

export type MioraReadiness = {
  checkedAt: string | null;
  configured: boolean;
  reachable: boolean | null;
  authenticated: boolean | null;
  credits: string | null;
  modelAvailable: boolean | null;
  model: string;
  entryUrl: string;
  state: "not_checked" | "configuration_missing" | "ready" | "browser_session_visible" | "unreachable" | "authentication_failed" | "unknown_error";
  blocker: string | null;
};

const statusPath = path.join(process.cwd(), "data", "miora-readiness.json");
const DEFAULT_MIORA_BASE_URL = "https://miora.design";
const DEFAULT_MIORA_CDP_URL = "http://127.0.0.1:9415";
const MIORA_MODEL_LABEL = "Seedance 2.0";

const emptyReadiness: MioraReadiness = {
  checkedAt: null,
  configured: false,
  reachable: null,
  authenticated: null,
  credits: null,
  modelAvailable: null,
  model: MIORA_MODEL_LABEL,
  entryUrl: DEFAULT_MIORA_BASE_URL,
  state: "not_checked",
  blocker: null,
};

function baseUrl() {
  const configured = process.env.MIORA_BASE_URL?.trim() || DEFAULT_MIORA_BASE_URL;
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MIORA_BASE_URL_INVALID");
  return parsed;
}

function cdpUrl() {
  const configured = process.env.MIORA_CDP_URL?.trim() || DEFAULT_MIORA_CDP_URL;
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MIORA_CDP_URL_INVALID");
  return parsed;
}

function cookie() {
  return process.env.MIORA_COOKIE?.trim() || "";
}

function hasConfiguration() {
  return Boolean(cookie() || process.env.MIORA_CDP_URL?.trim() || DEFAULT_MIORA_CDP_URL);
}

function normalizedCredits(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length <= 80) return value.trim();
  if (!value || typeof value !== "object") return null;
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      if (/credit|quota|balance|point|积分|额度/i.test(key)) {
        const normalized = normalizedCredits(item);
        if (normalized) return normalized;
      }
      if (typeof item === "object") stack.push(item);
    }
  }
  return null;
}

function modelAvailable(payload: unknown) {
  const text = JSON.stringify(payload ?? "").toLowerCase();
  return text.includes("seedance") || text.includes("seedance 2") || text.includes("seedance2");
}

async function writeStatus(status: MioraReadiness) {
  await mkdir(path.dirname(statusPath), { recursive: true });
  const temporary = `${statusPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  await rename(temporary, statusPath);
  await recordMioraSessionReadback(status);
}

export function mioraReferencePlan(references: Array<Record<string, unknown>>) {
  const ranked = [...references].sort((left, right) => {
    const primary = Number(right.is_primary === true) - Number(left.is_primary === true);
    if (primary) return primary;
    return Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0);
  });
  const selected = new Set(ranked.slice(0, 12).map((reference) => String(reference.ref_key)));
  return {
    channel: "miora",
    max_upload_references: 12,
    supports_multi_reference: true,
    supports_reference_video: true,
    supports_audio_reference: true,
    selected_reference_keys: ranked.filter((reference) => selected.has(String(reference.ref_key))).map((reference) => String(reference.ref_key)),
    default_params: {
      model: MIORA_MODEL_LABEL,
      resolution: "720P",
      duration: "15s",
      cost_policy: "Use the current authenticated provider readback. When no per-task price is displayed, record the visible balance as the authorization ceiling; do not infer an actual price.",
    },
    selections: ranked.map((reference, index) => ({
      ref_key: String(reference.ref_key),
      selected: selected.has(String(reference.ref_key)),
      selection_rank: index + 1,
      reason: selected.has(String(reference.ref_key))
        ? "confirmed reference selected within the Miora claimed multi-reference limit"
        : "authority reference retained in the task spec but not uploaded because it exceeds the conservative Miora material limit",
    })),
  };
}

function disconnectMioraCdp(browser: unknown) {
  // A CDP-attached browser belongs to the user.  Playwright's public
  // `browser.close()` sends Browser.close to the remote Chrome and can close
  // the visible canvas needed by later submit/sync calls.  Release only this
  // adapter connection instead.
  const connection = (browser as { _connection?: { close?: () => void } } | null)?._connection;
  if (typeof connection?.close === "function") connection.close();
}

export async function getMioraReadiness() {
  try {
    const saved = JSON.parse(await readFile(statusPath, "utf8")) as Partial<MioraReadiness>;
    return {
      checkedAt: typeof saved.checkedAt === "string" ? saved.checkedAt : null,
      configured: hasConfiguration(),
      reachable: typeof saved.reachable === "boolean" ? saved.reachable : null,
      authenticated: typeof saved.authenticated === "boolean" ? saved.authenticated : null,
      credits: typeof saved.credits === "string" ? saved.credits : null,
      modelAvailable: typeof saved.modelAvailable === "boolean" ? saved.modelAvailable : null,
      model: typeof saved.model === "string" ? saved.model : MIORA_MODEL_LABEL,
      entryUrl: typeof saved.entryUrl === "string" ? saved.entryUrl : baseUrl().toString(),
      state: typeof saved.state === "string" && ["not_checked", "configuration_missing", "ready", "browser_session_visible", "unreachable", "authentication_failed", "unknown_error"].includes(saved.state)
        ? saved.state as MioraReadiness["state"]
        : "not_checked",
      blocker: typeof saved.blocker === "string" ? saved.blocker : null,
    };
  } catch {
    return { ...emptyReadiness, configured: hasConfiguration(), entryUrl: baseUrl().toString() };
  }
}

async function runCookiePreflight(checkedAt: string, configured: boolean, entryUrl: string) {
  const base = baseUrl();
  const headers = { cookie: cookie(), accept: "application/json" };
  const [creditResponse, modelResponse] = await Promise.all([
    fetch(new URL("/api/ai/quota/credit", base), { headers, signal: AbortSignal.timeout(12_000), cache: "no-store" }),
    fetch(new URL("/api/ai/cloud-agent/media-models?lang=zh-CN", base), { headers, signal: AbortSignal.timeout(12_000), cache: "no-store" }),
  ]);
  if (!creditResponse.ok || !modelResponse.ok) {
    const status: MioraReadiness = { checkedAt, configured, reachable: true, authenticated: false, credits: null, modelAvailable: null, model: MIORA_MODEL_LABEL, entryUrl, state: "authentication_failed", blocker: "MIORA_COOKIE_AUTHENTICATION_FAILED" };
    await writeStatus(status);
    return status;
  }
  const creditPayload = await creditResponse.json().catch(() => ({}));
  const modelPayload = await modelResponse.json().catch(() => ({}));
  const available = modelAvailable(modelPayload);
  const status: MioraReadiness = {
    checkedAt,
    configured,
    reachable: true,
    authenticated: true,
    credits: normalizedCredits(creditPayload),
    modelAvailable: available,
    model: MIORA_MODEL_LABEL,
    entryUrl,
    state: available ? "ready" : "unknown_error",
    blocker: available ? null : "MIORA_SEEDANCE2_MODEL_NOT_OBSERVED",
  };
  await writeStatus(status);
  return status;
}

async function runCdpVisibilityPreflight(checkedAt: string, configured: boolean, entryUrl: string) {
  const browser = await chromium.connectOverCDP(cdpUrl().toString());
  try {
    const targetOrigin = new URL(entryUrl).origin;
    const context = browser.contexts().find((candidate) => candidate.pages().some((page) => {
      try { return new URL(page.url()).origin === targetOrigin; } catch { return false; }
    }));
    if (!context) {
      const status: MioraReadiness = { checkedAt, configured, reachable: false, authenticated: null, credits: null, modelAvailable: null, model: MIORA_MODEL_LABEL, entryUrl, state: "configuration_missing", blocker: "MIORA_BROWSER_SESSION_NOT_VISIBLE" };
      await writeStatus(status);
      return status;
    }
    const page = await context.newPage();
    const captured = new Map<string, { ok: boolean; status: number; body: string }>();
    const observe = (response: { url(): string; ok(): boolean; status(): number; text(): Promise<string> }) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname !== "/api/ai/quota/credit" && pathname !== "/api/ai/cloud-agent/media-models") return;
      response.text().then((body) => captured.set(pathname, { ok: response.ok(), status: response.status(), body })).catch(() => undefined);
    };
    page.on("response", observe);
    try {
      await page.goto(entryUrl, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => undefined);
      await page.waitForTimeout(1_500);
    } finally {
      page.off("response", observe);
      await page.close().catch(() => undefined);
    }
    const credit = captured.get("/api/ai/quota/credit") ?? { ok: false, status: 0, body: "" };
    const models = captured.get("/api/ai/cloud-agent/media-models") ?? { ok: false, status: 0, body: "" };
    let creditPayload: unknown = {};
    let modelPayload: unknown = {};
    try { creditPayload = JSON.parse(credit.body); } catch { /* status is sufficient for an auth failure */ }
    try { modelPayload = JSON.parse(models.body); } catch { /* status is sufficient for an auth failure */ }
    const authenticated = credit.ok && models.ok;
    const available = authenticated && modelAvailable(modelPayload);
    const status: MioraReadiness = {
      checkedAt, configured, reachable: true, authenticated,
      credits: authenticated ? normalizedCredits(creditPayload) : null,
      modelAvailable: authenticated ? available : null, model: MIORA_MODEL_LABEL, entryUrl,
      state: authenticated && available ? "ready" : authenticated ? "browser_session_visible" : "authentication_failed",
      blocker: authenticated && available ? null : authenticated ? "MIORA_SEEDANCE2_MODEL_READBACK_NOT_OBSERVED" : `MIORA_BROWSER_SESSION_AUTHENTICATION_FAILED:${credit.status}/${models.status}`,
    };
    await writeStatus(status);
    return status;
  } finally {
    disconnectMioraCdp(browser);
  }
}

export async function runMioraPreflight() {
  const configured = hasConfiguration();
  const checkedAt = new Date().toISOString();
  const entryUrl = baseUrl().toString();
  if (!configured) {
    const status: MioraReadiness = { ...emptyReadiness, checkedAt, configured, entryUrl, state: "configuration_missing", blocker: "MIORA_COOKIE_OR_CDP_REQUIRED" };
    await writeStatus(status);
    return status;
  }
  try {
    return cookie()
      ? await runCookiePreflight(checkedAt, configured, entryUrl)
      : await runCdpVisibilityPreflight(checkedAt, configured, entryUrl);
  } catch (error) {
    const status: MioraReadiness = {
      checkedAt,
      configured,
      reachable: false,
      authenticated: null,
      credits: null,
      modelAvailable: null,
      model: MIORA_MODEL_LABEL,
      entryUrl,
      state: error instanceof Error && /URL_INVALID/.test(error.message) ? "unknown_error" : "unreachable",
      blocker: error instanceof Error ? error.message.slice(0, 200) : "MIORA_PREFLIGHT_FAILED",
    };
    await writeStatus(status);
    return status;
  }
}
