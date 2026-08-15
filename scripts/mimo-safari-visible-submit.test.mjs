import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const submitter = path.resolve("mac-agent/mimo-safari-visible-submit.mjs");

function json(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  let value = "";
  for await (const chunk of request) value += chunk;
  return value ? JSON.parse(value) : {};
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [submitter, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("visible Safari submit uploads through the page before clicking generate and records only the observed provider ID", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "niannian-safari-submit-"));
  const promptPath = path.join(temporary, "prompt.txt");
  const imagePath = path.join(temporary, "reference.png");
  const manifestPath = path.join(temporary, "manifest.json");
  const receiptPath = path.join(temporary, "receipt.json");
  await writeFile(promptPath, "Locked test prompt", "utf8");
  await writeFile(imagePath, Buffer.from("reference"));
  const commands = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/status" && request.method === "GET") return json(response, { value: { ready: true } });
    if (pathname === "/session" && request.method === "POST") return json(response, { value: { sessionId: "session-1" } });
    if (pathname === "/session/session-1" && request.method === "DELETE") return json(response, { value: null });
    if (pathname === "/session/session-1/element" && request.method === "POST") {
      const requestBody = await body(request);
      return json(response, { value: { "element-6066-11e4-a52e-4f735466cecf": `element:${requestBody.value}` } });
    }
    if (pathname.includes("/element/") && (pathname.endsWith("/value") || pathname.endsWith("/click")) && request.method === "POST") return json(response, { value: null });
    if (pathname === "/session/session-1/url" && request.method === "POST") return json(response, { value: null });
    if (pathname === "/session/session-1/window/rect") return json(response, { value: { width: 1440, height: 1000 } });
    if (pathname === "/session/session-1/execute/sync" && request.method === "POST") {
      const requestBody = await body(request);
      const script = String(requestBody.script || "");
      commands.push(script);
      if (script.includes("hasGenerator")) return json(response, { value: { hasGenerator: true, hasLogin: false, text: "AI 视频生成" } });
      if (script.includes("uploadEvents || []")) return json(response, { value: [{ code: 200, uploaded: true, message: null }] });
      if (script.includes("generateEvents.find")) return json(response, { value: { code: 200, id: "provider-visible-123", message: null } });
      if (script.includes("document.body.innerText")) return json(response, { value: "AI 视频生成" });
      return json(response, { value: true });
    }
    return json(response, { value: null }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const result = await run([
      "--prompt-file", promptPath,
      "--image", imagePath,
      "--duration", "5",
      "--aspect-ratio", "16:9",
      "--manifest", manifestPath,
      "--submission-receipt", receiptPath,
    ], { NIANNIAN_MIMO_WEBDRIVER_URL: `http://127.0.0.1:${address.port}` });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /submitted task=provider-visible-123/);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(receipt.providerTaskId, "provider-visible-123");
    assert.equal(receipt.submitPath, "safari_visible_frontend");
    assert.equal(manifest.providerTaskId, "provider-visible-123");
    const uploadClick = commands.findIndex((command) => command.includes(".includes(\"上传\")"));
    const generateClick = commands.findIndex((command) => command.includes('"生成视频"'));
    const clearReferences = commands.findIndex((command) => command.includes("trim() === '清空参考图'"));
    assert.ok(uploadClick >= 0, "expected the official page upload button to be clicked");
    assert.ok(clearReferences >= 0 && clearReferences < uploadClick, "expected stale page references to be cleared before this task uploads its locked assets");
    assert.ok(generateClick > uploadClick, "generate must be clicked only after the official page upload completes");
    assert.ok(commands.some((command) => command.includes("promptEditor.dispatchEvent(new Event('input'")), "expected an input event so Mimo's page model sees the visible prompt");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
});

test("visible Safari submit rejects a video reference instead of silently omitting it", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "niannian-safari-submit-video-"));
  const promptPath = path.join(temporary, "prompt.txt");
  const imagePath = path.join(temporary, "reference.png");
  const videoPath = path.join(temporary, "reference.mp4");
  await writeFile(promptPath, "Locked test prompt", "utf8");
  await writeFile(imagePath, Buffer.from("reference"));
  await writeFile(videoPath, Buffer.from("video-reference"));
  try {
    const result = await run([
      "--prompt-file", promptPath,
      "--image", imagePath,
      "--video", videoPath,
      "--duration", "5",
      "--aspect-ratio", "16:9",
      "--manifest", path.join(temporary, "manifest.json"),
      "--submission-receipt", path.join(temporary, "receipt.json"),
    ], {});
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /VIDEO_REFERENCE_UI_ROUTE_NOT_IMPLEMENTED/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
