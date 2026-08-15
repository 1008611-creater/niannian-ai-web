const DOLA_ADAPTER_IDENTITY = "dola2api_local_bridge_v1";
const DEFAULT_DOLA_BRIDGE_URL = "http://127.0.0.1:9190";

export const dolaSkillChain = [
  "ai-video-production-router",
  "sd2-video-generation",
  "prompt-skill-router",
  "ai-video-channel-router",
  "dola-video-channel",
] as const;

export type DolaReadinessState =
  | "not_checked"
  | "ready"
  | "bridge_unreachable"
  | "interactive_login_required"
  | "region_restricted"
  | "capability_invalid";

export type DolaReadiness = {
  checkedAt: string;
  configured: boolean;
  reachable: boolean;
  authenticated: boolean;
  proxyConfigured: boolean;
  cdpAvailable: boolean;
  extensionCount: number;
  state: DolaReadinessState;
  blocker: string | null;
  novncUrl: string | null;
  allowedActions: string[];
  providerSubmitEnabled: false;
  spendEnabled: false;
};

let readinessCache: { expiresAt: number; value: DolaReadiness } | null = null;

function bridgeOrigin() {
  const url = new URL(process.env.DOLA2API_BASE_URL?.trim() || DEFAULT_DOLA_BRIDGE_URL);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) throw new Error("DOLA_BRIDGE_ENDPOINT_INVALID");
  return url.origin;
}

export function validateDolaPrompt(promptValue: unknown) {
  const prompt = String(promptValue ?? "").trim();
  if (!prompt) throw new Error("DOLA_PROMPT_EMPTY");
  if (/(?:第\s*)?\d+(?:\.\d+)?\s*(?:秒|s\b)|前\s*\d+(?:\.\d+)?\s*秒/i.test(prompt)) {
    throw new Error("DOLA_PROMPT_SECONDS_FORBIDDEN");
  }
  if (/[“”"【】]/.test(prompt)) throw new Error("DOLA_PROMPT_DIALOGUE_QUOTES_FORBIDDEN");
  if (/\[[^\]]+\]/.test(prompt) && !prompt.startsWith("全程使用中国中文普通话对话，")) {
    throw new Error("DOLA_PROMPT_DIALOGUE_PREFIX_REQUIRED");
  }
  return prompt;
}

export function dolaReferencePlan(references: Array<Record<string, unknown>>) {
  const ranked = [...references].sort((left, right) => {
    const primary = Number(right.is_primary === true) - Number(left.is_primary === true);
    if (primary) return primary;
    return Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0);
  });
  const selectedKey = ranked.length ? String(ranked[0].ref_key ?? "") : "";
  return {
    channel: "dola",
    max_upload_references: 1,
    supports_multi_reference: false,
    selected_reference_keys: selectedKey ? [selectedKey] : [],
    selections: ranked.map((reference, index) => ({
      ref_key: String(reference.ref_key ?? ""),
      selected: index === 0,
      selection_rank: index + 1,
      reason: index === 0
        ? "confirmed primary image selected for the Dola reference upload"
        : "authority reference retained but not uploaded because the verified Dola route uses one primary image",
    })),
  };
}

export async function getDolaReadiness(options: { force?: boolean } = {}): Promise<DolaReadiness> {
  if (!options.force && readinessCache && readinessCache.expiresAt > Date.now()) return readinessCache.value;
  const checkedAt = new Date().toISOString();
  if (process.env.DOLA_CODEX_AGENT_TOKEN?.trim()) {
    try {
      const state = JSON.parse(await readFile(path.join(process.cwd(), "data", "dola-windows-worker-state.json"), "utf8"));
      const age = Date.now() - Date.parse(String(state.heartbeatAt ?? ""));
      const channel = state.readiness?.channel ?? {};
      const ready = age >= 0 && age <= 120_000 && state.readiness?.readyToClaim === true && channel.id === "dola";
      const value: DolaReadiness = {
        checkedAt, configured: true, reachable: ready, authenticated: channel.authenticated === true,
        proxyConfigured: channel.proxyConfigured === true,
        cdpAvailable: channel.cdpAvailable === true,
        extensionCount: Number.isInteger(channel.extensionCount) ? Number(channel.extensionCount) : 0,
        state: ready ? "ready" : "bridge_unreachable", blocker: ready ? null : "DOLA_WINDOWS_AGENT_NOT_READY",
        novncUrl: null, allowedActions: ["preflight", "prepare_route"], providerSubmitEnabled: false, spendEnabled: false,
      };
      readinessCache = { expiresAt: Date.now() + 15_000, value };
      return value;
    } catch {
      const value: DolaReadiness = {
        checkedAt, configured: true, reachable: false, authenticated: false,
        proxyConfigured: false, cdpAvailable: false, extensionCount: 0,
        state: "bridge_unreachable", blocker: "DOLA_WINDOWS_AGENT_NOT_READY",
        novncUrl: null, allowedActions: ["preflight", "prepare_route"], providerSubmitEnabled: false, spendEnabled: false,
      };
      readinessCache = { expiresAt: Date.now() + 15_000, value };
      return value;
    }
  }
  let origin: string;
  try {
    origin = bridgeOrigin();
  } catch {
    const value: DolaReadiness = {
      checkedAt, configured: false, reachable: false, authenticated: false,
      proxyConfigured: false, cdpAvailable: false, extensionCount: 0,
      state: "capability_invalid", blocker: "DOLA_BRIDGE_ENDPOINT_INVALID",
      novncUrl: null, allowedActions: [], providerSubmitEnabled: false, spendEnabled: false,
    };
    readinessCache = { expiresAt: Date.now() + 15_000, value };
    return value;
  }
  try {
    const response = await fetch(`${origin}/api/v1/capabilities`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      headers: { accept: "application/json" },
    });
    const capability = await response.json().catch(() => ({})) as Record<string, unknown>;
    const allowedActions = Array.isArray(capability.allowed_actions) ? capability.allowed_actions.map(String) : [];
    if (!response.ok) throw new Error(`DOLA_BRIDGE_HTTP_${response.status}`);
    if (
      capability.schema_version !== "dola2api_capabilities_v1" ||
      capability.adapter_identity !== DOLA_ADAPTER_IDENTITY ||
      JSON.stringify(allowedActions) !== JSON.stringify(["preflight", "prepare_route"]) ||
      capability.provider_submit_enabled !== false ||
      capability.provider_upload_enabled !== false ||
      capability.spend_enabled !== false
    ) {
      const value: DolaReadiness = {
        checkedAt, configured: true, reachable: true, authenticated: false,
        proxyConfigured: false, cdpAvailable: false, extensionCount: 0,
        state: "capability_invalid", blocker: "DOLA_CAPABILITY_CONTRACT_INVALID",
        novncUrl: null, allowedActions: [], providerSubmitEnabled: false, spendEnabled: false,
      };
      readinessCache = { expiresAt: Date.now() + 15_000, value };
      return value;
    }
    const regionRestricted = capability.region_restricted === true;
    const authenticated = capability.login_state === "authenticated";
    const ready = capability.ready === true && capability.proxy_configured === true &&
      !regionRestricted && capability.cdp_available === true &&
      Number(capability.extension_count) >= 2 && authenticated;
    const state: DolaReadinessState = ready
      ? "ready"
      : regionRestricted
        ? "region_restricted"
        : !authenticated
          ? "interactive_login_required"
          : "capability_invalid";
    const value: DolaReadiness = {
      checkedAt,
      configured: true,
      reachable: true,
      authenticated,
      proxyConfigured: capability.proxy_configured === true,
      cdpAvailable: capability.cdp_available === true,
      extensionCount: Number(capability.extension_count ?? 0),
      state,
      blocker: ready ? null : state,
      novncUrl: typeof capability.novnc_url === "string" ? capability.novnc_url : null,
      allowedActions,
      providerSubmitEnabled: false,
      spendEnabled: false,
    };
    readinessCache = { expiresAt: Date.now() + 15_000, value };
    return value;
  } catch {
    const value: DolaReadiness = {
      checkedAt, configured: true, reachable: false, authenticated: false,
      proxyConfigured: false, cdpAvailable: false, extensionCount: 0,
      state: "bridge_unreachable", blocker: "DOLA_BRIDGE_UNREACHABLE",
      novncUrl: null, allowedActions: [], providerSubmitEnabled: false, spendEnabled: false,
    };
    readinessCache = { expiresAt: Date.now() + 15_000, value };
    return value;
  }
}
import { readFile } from "node:fs/promises";
import path from "node:path";
