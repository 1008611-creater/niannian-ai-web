import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const EDGE_HOST = process.env.MEDIA_EDGE_HOST || "https://sd2.cauai.fun";
const TTL_SECONDS = 300;

function secret() {
  let value = "";
  try {
    value = readFileSync(path.join(process.cwd(), "data", "media-edge-secret"), "utf8").trim();
  } catch {
    return null;
  }
  return value && /^[A-Za-z0-9_-]{32,160}$/.test(value) ? value : null;
}

function signature(taskId: string, expiresAt: number, download: boolean, value: string) {
  return createHmac("sha256", value).update(`${taskId}.${expiresAt}.${download ? 1 : 0}`).digest("base64url");
}

export function mediaEdgeEnabled() {
  return Boolean(secret());
}

export function mediaEdgeUrl(taskId: string, download = false) {
  const value = secret();
  if (!value || !/^[A-Za-z0-9_-]{12,120}$/.test(taskId)) return null;
  const expiresAt = Math.floor((Date.now() + TTL_SECONDS * 1000) / 1000 / 30) * 30;
  const edgeHost = new URL(EDGE_HOST);
  const directOrigin = edgeHost.hostname === "media-direct.sd2.cauai.fun" || edgeHost.hostname === "sd2.cauai.fun";
  const url = new URL(directOrigin ? `/api/internal/media-edge/${taskId}` : `/local/${taskId}.mp4`, edgeHost);
  url.searchParams.set("exp", String(expiresAt));
  url.searchParams.set("sig", signature(taskId, expiresAt, download, value));
  if (!download) url.searchParams.set("variant", "stream-v1");
  if (download) url.searchParams.set("download", "1");
  return url.toString();
}

export function validMediaEdgeRequest(taskId: string, expiresAt: string | null, received: string | null, download: boolean) {
  return mediaEdgeValidationReason(taskId, expiresAt, received, download) === null;
}

export function mediaEdgeValidationReason(taskId: string, expiresAt: string | null, received: string | null, download: boolean) {
  const value = secret();
  const expires = Number(expiresAt);
  if (!value) return "secret_missing";
  if (!Number.isInteger(expires)) return "expires_invalid";
  if (expires < Math.floor(Date.now() / 1000)) return "expires_elapsed";
  if (expires > Math.floor(Date.now() / 1000) + TTL_SECONDS + 30) return "expires_outside_window";
  if (!received) return "signature_missing";
  const expected = signature(taskId, expires, download, value);
  const actualBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes) ? null : "signature_mismatch";
}
