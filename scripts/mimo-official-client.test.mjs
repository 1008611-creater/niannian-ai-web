import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const projectDirectory = path.resolve(import.meta.dirname, "..");
const client = path.join(projectDirectory, "mac-agent", "skill-bundle", "skills", "mimo-8001-video-channel", "scripts", "mimo_client.mjs");

function json(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function runClient(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [client, ...args], {
      cwd: projectDirectory,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`client failed ${code}: ${stderr}`)));
  });
}

test("official Mimo client persists a provider receipt before its first poll", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "niannian-mimo-official-client-"));
  const requests = { apply: 0, upload: 0, commit: 0, generate: 0, poll: 0 };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/auth/login") return json(response, { code: 200, data: { token: "test-token", username: "test-user", credits: 99 } });
    if (url.pathname === "/api/video/upload-apply") {
      requests.apply += 1;
      return json(response, { code: 200, data: { uploadUrl: `http://127.0.0.1:${server.address().port}/object`, sessionKey: "session", storeUri: "store", fileType: "image", vid: "image-vid" } });
    }
    if (url.pathname === "/object") {
      if (url.searchParams.get("phase") === "init") return json(response, { uploadId: "upload-id" });
      if (url.searchParams.get("phase") === "upload") { requests.upload += 1; return json(response, { etag: "etag" }); }
      if (url.searchParams.get("phase") === "finish") { requests.upload += 1; response.writeHead(200); return response.end("ok"); }
    }
    if (url.pathname === "/api/video/upload-commit") { requests.commit += 1; return json(response, { code: 200, data: { imageUri: "mimo://image/one", imageUrl: "https://example.invalid/image/one" } }); }
    if (url.pathname === "/api/video/generate") { requests.generate += 1; return json(response, { code: 200, data: { id: "provider-task-001" } }); }
    if (url.pathname === "/api/video/batch-status") { requests.poll += 1; return json(response, { code: 200, data: [{ taskId: "provider-task-001", status: 50 }] }); }
    return json(response, { code: 404, msg: "not found" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const image = path.join(workspace, "verified.jpg");
  const prompt = path.join(workspace, "locked-prompt.txt");
  const receipt = path.join(workspace, "submission.json");
  const manifest = path.join(workspace, "manifest.json");
  await writeFile(image, "verified-image");
  await writeFile(prompt, "locked prompt");
  try {
    await runClient(["--base", base, "--username-env", "TEST_MIMO_USER", "--password-env", "TEST_MIMO_PASS", "--image", image, "--prompt-file", prompt, "--duration", "5", "--aspect-ratio", "9:16", "--upload-strategy", "official_frontend", "--submit-only", "--submission-receipt", receipt, "--manifest", manifest], { TEST_MIMO_USER: "test-user", TEST_MIMO_PASS: "test-password" });
    const savedReceipt = JSON.parse(await readFile(receipt, "utf8"));
    const savedManifest = JSON.parse(await readFile(manifest, "utf8"));
    assert.equal(savedReceipt.providerTaskId, "provider-task-001");
    assert.equal(savedReceipt.uploadStrategy, "official_frontend");
    assert.equal(savedManifest.submitted.taskId, "provider-task-001");
    assert.equal(savedManifest.finalStatus, null);
    assert.equal(requests.apply, 1);
    assert.equal(requests.commit, 1);
    assert.equal(requests.generate, 1);
    assert.equal(requests.poll, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  }
});
