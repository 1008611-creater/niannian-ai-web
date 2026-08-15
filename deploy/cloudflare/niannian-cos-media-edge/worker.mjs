const UPSTREAM_HOST = "niannian-step01-artifacts-prod-1412440010.cos.ap-beijing.myqcloud.com";
const OBJECT_PATH = /^\/video-workbench\/outputs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[a-f0-9]{64}\.mp4$/;
const REQUIRED_SIGNATURE_FIELDS = ["q-ak", "q-key-time", "q-sign-time", "q-signature"];
const SIGNED_MEDIA_EDGE_TTL_SECONDS = 240;
const LOCAL_PATH = /^\/local\/([A-Za-z0-9_-]{12,120})\.mp4$/;
const LOCAL_ORIGIN = "https://sd2.cauai.fun";

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function localSignature(taskId, expiresAt, download, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${taskId}.${expiresAt}.${download ? 1 : 0}`)));
}

function sameSignature(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function localMedia(request, incoming, match, env) {
  const expiresAt = Number(incoming.searchParams.get("exp"));
  const download = incoming.searchParams.get("download") === "1";
  const received = incoming.searchParams.get("sig") || "";
  const now = Math.floor(Date.now() / 1000);
  const secret = String(env.MEDIA_EDGE_SHARED_SECRET || "").trim();
  if (!secret || !Number.isInteger(expiresAt) || expiresAt < now || expiresAt > now + 330) return new Response("Forbidden", { status: 403 });
  const expected = await localSignature(match[1], expiresAt, download, secret);
  if (!sameSignature(received, expected)) return new Response("Forbidden", { status: 403 });
  const upstreamUrl = new URL(`/api/internal/media-edge/${match[1]}`, LOCAL_ORIGIN);
  upstreamUrl.search = incoming.search;
  const ttl = Math.max(1, Math.min(SIGNED_MEDIA_EDGE_TTL_SECONDS, expiresAt - now));
  const upstream = await fetch(new Request(upstreamUrl, request), {
    cf: { cacheEverything: true, cacheTtl: ttl, resolveOverride: "origin-canary.cauai.fun" },
  });
  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", `public, max-age=60, s-maxage=${ttl}`);
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

export default {
  async fetch(request, env = {}) {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
    }

    const incoming = new URL(request.url);
    const local = incoming.pathname.match(LOCAL_PATH);
    if (local) return localMedia(request, incoming, local, env);
    if (!OBJECT_PATH.test(incoming.pathname)) return new Response("Not Found", { status: 404 });
    if (!REQUIRED_SIGNATURE_FIELDS.every((field) => incoming.searchParams.has(field))) {
      return new Response("Forbidden", { status: 403 });
    }

    const upstreamUrl = new URL(incoming);
    upstreamUrl.protocol = "https:";
    upstreamUrl.hostname = UPSTREAM_HOST;
    upstreamUrl.port = "";

    const upstream = await fetch(new Request(upstreamUrl, request));
    const headers = new Headers(upstream.headers);
    const disposition = incoming.searchParams.get("response-content-disposition");
    if (disposition && /^(?:inline|attachment)(?:;|$)/i.test(disposition)) {
      headers.set("Content-Disposition", disposition);
    }
    // The complete COS signature stays in Cloudflare's cache key. Keep the edge
    // entry shorter than the server-issued five-minute signature, so a private
    // object can reuse cached MP4/Range reads without becoming a public URL.
    headers.set("Cache-Control", `public, max-age=60, s-maxage=${SIGNED_MEDIA_EDGE_TTL_SECONDS}`);
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
