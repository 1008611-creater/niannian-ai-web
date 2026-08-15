import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { releaseCandidate } from "./release-candidate-config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const check = path.join(root, "scripts", "postdeploy-readonly-check.mjs");
const token = "windows-mimo-postdeploy-readonly-test-token";

function runCheck(origin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [check, "--origin", origin, "--worker", "windows-mimo"], {
      cwd: root,
      env: { ...process.env, MIMO_WINDOWS_AGENT_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`POSTDEPLOY_EXIT_${code}:${stderr}`)));
  });
}

test("Windows Mimo post-deploy readback checks readiness without claiming work", async () => {
  const requests = [];
  const now = new Date().toISOString();
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    requests.push({ pathname, authorization: request.headers.authorization || null });
    if (pathname === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ release: { releaseId: releaseCandidate.releaseId, referenceContractVersion: releaseCandidate.referenceContractVersion } }));
    }
    if (["/", "/login", "/guide", "/showcase"].includes(pathname)) {
      response.writeHead(200);
      return response.end("ok");
    }
    if (pathname === "/api/internal/windows-mimo/status") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({
        configured: true,
        state: {
          version: releaseCandidate.windowsMimoWorkerVersion, heartbeatAt: now, status: "idle", activeTaskId: null,
          readiness: {
            readyToClaim: true,
            skills: { bundleName: "niannian-windows-mimo-cdp", bundleVersion: releaseCandidate.windowsMimoWorkerVersion },
            channel: { state: "ready", authenticated: true, credits: "test", model: "Seedance 2.0" },
          },
        },
        diagnostics: {
          release: { releaseId: releaseCandidate.releaseId, referenceContractVersion: releaseCandidate.referenceContractVersion },
          queue: { approvedForExecution: 0, runningOnMimo: 0, staleRunningOnMimo: 0 },
          recoveryPolicy: { strategy: "parent_claim_auto_recovery" },
        },
      }));
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const { stdout } = await runCheck(`http://127.0.0.1:${address.port}`);
    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    assert.equal(report.readOnly, true);
    assert.equal(report.worker.kind, "windows-mimo");
    assert.equal(report.worker.readyToClaim, true);
    assert.equal(report.mimo.authenticated, true);
    assert.equal(requests.filter((request) => request.pathname === "/api/internal/windows-mimo/status").length, 1);
    assert.equal(requests.find((request) => request.pathname === "/api/internal/windows-mimo/status")?.authorization, `Bearer ${token}`);
    assert.equal(requests.some((request) => request.pathname.includes("/claim")), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
