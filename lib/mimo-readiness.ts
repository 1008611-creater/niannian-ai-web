import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type MimoReadiness = {
  checkedAt: string | null;
  configured: boolean;
  reachable: boolean | null;
  authenticated: boolean | null;
  credits: string | null;
  state: "not_checked" | "configuration_missing" | "ready" | "unreachable" | "authentication_failed" | "unknown_error";
};

const statusPath = path.join(process.cwd(), "data", "mimo-readiness.json");
const emptyReadiness: MimoReadiness = {
  checkedAt: null,
  configured: false,
  reachable: null,
  authenticated: null,
  credits: null,
  state: "not_checked",
};

function hasCredentialConfiguration() {
  return Boolean(process.env.MIMO_TOKEN || (process.env.MIMO_USERNAME && process.env.MIMO_PASSWORD));
}

function baseUrl() {
  const configured = process.env.MIMO_BASE_URL?.trim() || "https://fd.aancn.cn";
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MIMO_BASE_URL_INVALID");
  return parsed;
}

function normalizedCredits(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length <= 80) return value.trim();
  return null;
}

async function writeStatus(status: MimoReadiness) {
  await mkdir(path.dirname(statusPath), { recursive: true });
  const temporary = `${statusPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  await rename(temporary, statusPath);
}

export async function getMimoReadiness() {
  try {
    const saved = JSON.parse(await readFile(statusPath, "utf8")) as Partial<MimoReadiness>;
    return {
      checkedAt: typeof saved.checkedAt === "string" ? saved.checkedAt : null,
      configured: hasCredentialConfiguration(),
      reachable: typeof saved.reachable === "boolean" ? saved.reachable : null,
      authenticated: typeof saved.authenticated === "boolean" ? saved.authenticated : null,
      credits: typeof saved.credits === "string" ? saved.credits : null,
      state: typeof saved.state === "string" && ["not_checked", "configuration_missing", "ready", "unreachable", "authentication_failed", "unknown_error"].includes(saved.state)
        ? saved.state as MimoReadiness["state"]
        : "not_checked",
    };
  } catch {
    return { ...emptyReadiness, configured: hasCredentialConfiguration() };
  }
}

export async function runMimoPreflight() {
  const configured = hasCredentialConfiguration();
  const checkedAt = new Date().toISOString();
  if (!configured) {
    const status: MimoReadiness = { ...emptyReadiness, checkedAt, configured, state: "configuration_missing" };
    await writeStatus(status);
    return status;
  }

  try {
    const base = baseUrl();
    let token = process.env.MIMO_TOKEN?.trim() || "";
    let credits: string | null = null;
    if (!token) {
      const response = await fetch(new URL("/api/auth/login", base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: process.env.MIMO_USERNAME, password: process.env.MIMO_PASSWORD }),
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (!response.ok) {
        const status: MimoReadiness = { checkedAt, configured, reachable: true, authenticated: false, credits: null, state: "authentication_failed" };
        await writeStatus(status);
        return status;
      }
      const payload = await response.json().catch(() => ({})) as { code?: number; data?: { token?: unknown; credits?: unknown } };
      if (payload.code !== 200 || typeof payload.data?.token !== "string" || !payload.data.token) {
        const status: MimoReadiness = { checkedAt, configured, reachable: true, authenticated: false, credits: null, state: "authentication_failed" };
        await writeStatus(status);
        return status;
      }
      token = payload.data.token;
      credits = normalizedCredits(payload.data.credits);
    }

    // The provider rejects an empty batch-status request. Its paginated task list is the
    // read-only authenticated endpoint used by the provider's own frontend on page load.
    const response = await fetch(new URL("/api/video/list?page=1", base), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as { code?: number };
    const status: MimoReadiness = response.ok && (payload.code === 200 || payload.code === 0)
      ? { checkedAt, configured, reachable: true, authenticated: true, credits, state: "ready" }
      : { checkedAt, configured, reachable: true, authenticated: false, credits: null, state: "authentication_failed" };
    await writeStatus(status);
    return status;
  } catch (error) {
    const status: MimoReadiness = {
      checkedAt,
      configured,
      reachable: false,
      authenticated: null,
      credits: null,
      state: error instanceof Error && error.message === "MIMO_BASE_URL_INVALID" ? "unknown_error" : "unreachable",
    };
    await writeStatus(status);
    return status;
  }
}
