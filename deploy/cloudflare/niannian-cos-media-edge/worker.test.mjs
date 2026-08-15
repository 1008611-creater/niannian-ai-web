import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

const objectPath = `/video-workbench/outputs/user_1/task-1/${"a".repeat(64)}.mp4`;
const signature = "q-ak=test&q-key-time=1%3B2&q-sign-time=1%3B2&q-signature=test";

test("edge rejects methods, paths, and unsigned objects before COS", async () => {
  assert.equal((await worker.fetch(new Request(`https://media.sd2.cauai.fun${objectPath}?${signature}`, { method: "POST" }))).status, 405);
  assert.equal((await worker.fetch(new Request(`https://media.sd2.cauai.fun/outside/file.mp4?${signature}`))).status, 404);
  assert.equal((await worker.fetch(new Request(`https://media.sd2.cauai.fun${objectPath}`))).status, 403);
});

test("edge forwards signed GET/Range only to the fixed COS bucket and restores inline playback", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (request) => {
    forwarded = request;
    return new Response(new Uint8Array(1024), {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Disposition": "attachment",
        "Content-Range": "bytes 0-1023/2344423",
        "Content-Type": "video/mp4",
      },
    });
  };
  try {
    const url = `https://media.sd2.cauai.fun${objectPath}?${signature}&response-content-disposition=${encodeURIComponent('inline; filename="niannian-video.mp4"')}`;
    const response = await worker.fetch(new Request(url, { headers: { Range: "bytes=0-1023" } }));
    assert.equal(response.status, 206);
    assert.equal(new URL(forwarded.url).host, "niannian-step01-artifacts-prod-1412440010.cos.ap-beijing.myqcloud.com");
    assert.equal(forwarded.headers.get("range"), "bytes=0-1023");
    assert.equal(response.headers.get("content-disposition"), 'inline; filename="niannian-video.mp4"');
    assert.equal(response.headers.get("content-range"), "bytes 0-1023/2344423");
    assert.equal(response.headers.get("cache-control"), "public, max-age=60, s-maxage=240");
    assert.equal((await response.arrayBuffer()).byteLength, 1024);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local signed media keeps Range and is refused after its edge signature expires", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "a".repeat(48);
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  const taskId = "SETuGbVQhDCi_2GUXbROtu12";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${taskId}.${expiresAt}.0`)));
  const sig = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  let forwarded;
  globalThis.fetch = async (request) => {
    forwarded = request;
    return new Response(new Uint8Array(4), { status: 206, headers: { "Accept-Ranges": "bytes", ETag: "edge-test" } });
  };
  try {
    const url = `https://media.sd2.cauai.fun/local/${taskId}.mp4?exp=${expiresAt}&sig=${sig}`;
    const response = await worker.fetch(new Request(url, { headers: { Range: "bytes=0-3" } }), { MEDIA_EDGE_SHARED_SECRET: secret });
    assert.equal(response.status, 206);
    assert.equal(new URL(forwarded.url).pathname, `/api/internal/media-edge/${taskId}`);
    assert.equal(forwarded.headers.get("range"), "bytes=0-3");
    assert.match(response.headers.get("cache-control"), /s-maxage=120/);
    assert.equal((await worker.fetch(new Request(`https://media.sd2.cauai.fun/local/${taskId}.mp4?exp=1&sig=${sig}`), { MEDIA_EDGE_SHARED_SECRET: secret })).status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
