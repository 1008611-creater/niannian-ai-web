import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const agent = path.join(root, "scripts", "niannian-windows-mimo-agent.mjs");
const testToken = "mimo-windows-preflight-test-token-only";

function runAgent(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [agent, ...args], {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`AGENT_EXIT_${code}:${stderr}`));
    });
  });
}

test("Windows Mimo Agent blocks before claim when local preflight is not ready", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "niannian-mimo-preflight-"));
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({ path: new URL(request.url || "/", "http://127.0.0.1").pathname, authorization: request.headers.authorization || null, body: await new Promise((resolve) => {
      let text = "";
      request.on("data", (chunk) => { text += chunk; });
      request.on("end", () => resolve(text));
    }) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const { stdout } = await runAgent(["run-once"], {
      ...process.env,
      NIANNIAN_ORIGIN: `http://127.0.0.1:${address.port}`,
      MIMO_WINDOWS_AGENT_TOKEN: testToken,
      NIANNIAN_MIMO_WORKER_ID: "preflight-fixture",
      NIANNIAN_MIMO_WORKSPACE: workspace,
      NIANNIAN_MIMO_CDP_URL: "http://127.0.0.1:9",
      NIANNIAN_FFPROBE_BIN: path.join(workspace, "ffprobe-does-not-exist"),
      MIMO_BASE_URL: "https://fd.aancn.cn",
    });
    const result = JSON.parse(stdout);
    assert.equal(result.preflightBlocked, true);
    assert.equal(result.blocker, "FFPROBE_NOT_AVAILABLE");
    assert.equal(requests.filter((request) => request.path === "/api/internal/windows-mimo/claim").length, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/api/internal/windows-mimo/heartbeat");
    assert.equal(requests[0].authorization, `Bearer ${testToken}`);
    const heartbeat = JSON.parse(requests[0].body);
    assert.equal(heartbeat.status, "blocked");
    assert.equal(heartbeat.activeTaskId, null);
    assert.equal(heartbeat.readiness.readyToClaim, false);
    assert.equal(heartbeat.readiness.blocker, "FFPROBE_NOT_AVAILABLE");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  }
});
