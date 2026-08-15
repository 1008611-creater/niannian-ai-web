import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const synchronizer = path.resolve("mac-agent/mimo-safari-visible-sync.mjs");

function json(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  let value = "";
  for await (const chunk of request) value += chunk;
  return value ? JSON.parse(value) : {};
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [synchronizer, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("visible Safari sync recreates a stale session, authenticates, and downloads without provider submit", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "niannian-safari-sync-"));
  const sessionFile = path.join(temporary, "session.json");
  const outputPath = path.join(temporary, "result.mp4");
  const manifestPath = path.join(temporary, "manifest.json");
  const calls = [];
  let authenticated = false;
  const video = Buffer.from("real-provider-video-fixture");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    calls.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/status" && request.method === "GET") return json(response, { value: { ready: true } });
    if (url.pathname === "/session" && request.method === "POST") return json(response, { value: { sessionId: "session-sync-1" } });
    if (url.pathname === "/session/session-sync-1/url" && request.method === "POST") return json(response, { value: null });
    if (url.pathname === "/session/session-sync-1/element" && request.method === "POST") {
      const body = await requestBody(request);
      return json(response, { value: { "element-6066-11e4-a52e-4f735466cecf": `element:${body.value}` } });
    }
    if (url.pathname.includes("/element/") && url.pathname.endsWith("/value") && request.method === "POST") return json(response, { value: null });
    if (url.pathname === "/session/session-sync-1/execute/sync" && request.method === "POST") {
      const body = await requestBody(request);
      const script = String(body.script || "");
      if (script === "return document.readyState;") return json(response, { value: "complete" });
      if (script.startsWith("return Boolean(")) return json(response, { value: authenticated });
      if (script.includes("const lines = (document.body")) {
        return json(response, { value: {
          generator: authenticated,
          login: !authenticated,
          tokenPresent: authenticated,
          credits: authenticated ? "42" : null,
          title: "AI 视频生成",
          url: "https://fd.aancn.cn/",
        } });
      }
      if (script.includes("login button missing")) {
        authenticated = true;
        return json(response, { value: null });
      }
      if (script.includes("/api/video/batch-status")) {
        return json(response, { value: {
          auth: "present",
          httpStatus: 200,
          token: "test-browser-token",
          body: { code: 200, data: [{ taskId: "provider-sync-001", status: 1, videoUrl: `http://127.0.0.1:${server.address().port}/video.mp4#tos-cn-beijing` }] },
        } });
      }
      return json(response, { value: null });
    }
    if (url.pathname === "/video.mp4" && request.method === "GET") {
      response.writeHead(200, { "content-type": "video/mp4", "content-length": String(video.length) });
      return response.end(video);
    }
    return json(response, { value: { error: "unknown command" } }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const result = await run([
      "--webdriver", `http://127.0.0.1:${address.port}`,
      "--session-file", sessionFile,
      "--task-id", "provider-sync-001",
      "--out", outputPath,
      "--manifest", manifestPath,
    ], { MIMO_USERNAME: "approved-account", MIMO_PASSWORD: "approved-password" });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /downloaded/);
    assert.deepEqual(await readFile(outputPath), video);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.providerTaskId, "provider-sync-001");
    assert.equal(manifest.downloaded.path, outputPath);
    assert.ok(calls.includes("POST /session"), "expected a replacement Safari session");
    assert.ok(!calls.some((call) => /generate|upload/.test(call)), "sync-only recovery must never upload or submit");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
});
