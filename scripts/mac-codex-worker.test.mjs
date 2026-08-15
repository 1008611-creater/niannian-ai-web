import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const projectDirectory = path.resolve(import.meta.dirname, "..");
const workerScript = path.join(projectDirectory, "mac-agent", "niannian-mac-worker.mjs");
const skillBundleDirectory = path.join(projectDirectory, "mac-agent", "skill-bundle");
const skillBundleManifest = path.join(skillBundleDirectory, "bundle-manifest.json");
const skillBundleRoot = path.join(skillBundleDirectory, "skills");
const token = "mac-worker-integration-token-0123456789";
const taskId = "mac-worker-test-task-001";
const assetId = "mac-worker-test-asset-001";
const assetBytes = Buffer.from("verified-reference-content");
const assetSha256 = createHash("sha256").update(assetBytes).digest("hex");

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function json(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function runWorker(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerScript, ...args], {
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
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`worker failed ${code}: ${stderr}`)));
  });
}

async function readyEnvironment(workspace, codexBin = process.execPath, mimoBase = "http://127.0.0.1") {
  const authPath = path.join(workspace, "codex-auth.json");
  await writeFile(authPath, `${JSON.stringify({ test: true })}\n`, "utf8");
  return {
    NIANNIAN_CODEX_BIN: codexBin,
    NIANNIAN_CODEX_AUTH_PATH: authPath,
    NIANNIAN_SKILL_BUNDLE_MANIFEST: skillBundleManifest,
    NIANNIAN_SKILL_ROOT: skillBundleRoot,
    NIANNIAN_FFPROBE_BIN: process.execPath,
    MIMO_TOKEN: "test-mimo-readiness-token",
    MIMO_BASE_URL: mimoBase,
  };
}

test("Mac worker blocks before claim when the production Skill bundle is missing", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "niannian-mac-preflight-block-"));
  const requests = { heartbeats: [], claim: 0 };
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/api/internal/mac-codex/heartbeat" && request.method === "POST") {
      requests.heartbeats.push(JSON.parse((await readRequest(request)).toString("utf8")));
      return json(response, { ok: true });
    }
    if (pathname === "/api/internal/mac-codex/claim") requests.claim += 1;
    return json(response, { error: "NOT_FOUND" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const authPath = path.join(workspace, "auth.json");
  await writeFile(authPath, `${JSON.stringify({ test: true })}\n`, "utf8");
  try {
    const output = JSON.parse(await runWorker(["run-once"], {
      NIANNIAN_ORIGIN: `http://127.0.0.1:${address.port}`,
      NIANNIAN_MAC_AGENT_TOKEN: token,
      NIANNIAN_MAC_WORKER_ID: "preflight-block-worker",
      NIANNIAN_MAC_WORKSPACE: workspace,
      NIANNIAN_CODEX_BIN: process.execPath,
      NIANNIAN_CODEX_AUTH_PATH: authPath,
      NIANNIAN_FFPROBE_BIN: process.execPath,
      NIANNIAN_SKILL_BUNDLE_MANIFEST: path.join(workspace, "missing-manifest.json"),
      NIANNIAN_SKILL_ROOT: path.join(workspace, "missing-skills"),
    }));
    assert.equal(output.status, "blocked");
    assert.match(output.blocker, /SKILL_BUNDLE_MANIFEST_MISSING_OR_INVALID/);
    assert.equal(requests.claim, 0);
    assert.equal(requests.heartbeats.at(-1)?.status, "blocked");
  } finally {
    server.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Mac worker blocks before claim when ffprobe or Mimo credentials are missing", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "niannian-mac-capability-block-"));
  const requests = { claim: 0 };
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/api/internal/mac-codex/heartbeat" && request.method === "POST") {
      await readRequest(request);
      return json(response, { ok: true });
    }
    if (pathname === "/api/internal/mac-codex/claim") requests.claim += 1;
    return json(response, { error: "NOT_FOUND" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = {
    ...await readyEnvironment(workspace, process.execPath, `http://127.0.0.1:${address.port}`),
    NIANNIAN_ORIGIN: `http://127.0.0.1:${address.port}`,
    NIANNIAN_MAC_AGENT_TOKEN: token,
    NIANNIAN_MAC_WORKSPACE: workspace,
  };
  try {
    const noProbe = JSON.parse(await runWorker(["run-once"], {
      ...base,
      NIANNIAN_MAC_WORKER_ID: "missing-ffprobe-worker",
      NIANNIAN_FFPROBE_BIN: path.join(workspace, "missing-ffprobe"),
    }));
    assert.equal(noProbe.blocker, "FFPROBE_NOT_AVAILABLE");
    const noCredentials = JSON.parse(await runWorker(["run-once"], {
      ...base,
      NIANNIAN_MAC_WORKER_ID: "missing-mimo-credentials-worker",
      MIMO_TOKEN: "",
      MIMO_USERNAME: "",
      MIMO_PASSWORD: "",
    }));
    assert.equal(noCredentials.blocker, "MIMO_CREDENTIALS_MISSING");
    assert.equal(requests.claim, 0);
  } finally {
    server.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Mac worker stages verified assets and uploads a result receipt", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "niannian-mac-worker-"));
  const requests = { heartbeats: 0, claim: 0, asset: 0, result: null };
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/api/video/list" && request.method === "GET") return json(response, { code: 200, data: { list: [] } });
    if (request.headers.authorization !== `Bearer ${token}`) return json(response, { error: "UNAUTHORIZED" }, 401);
    if (pathname === "/api/internal/mac-codex/heartbeat" && request.method === "POST") {
      requests.heartbeats += 1;
      await readRequest(request);
      return json(response, { ok: true, state: { status: "idle" } });
    }
    if (pathname === "/api/internal/mac-codex/claim" && request.method === "POST") {
      requests.claim += 1;
      await readRequest(request);
      return json(response, {
        task: {
          id: taskId,
          channel: "mimo",
          prompt: "Locked integration prompt",
          promptSha256: createHash("sha256").update("Locked integration prompt").digest("hex"),
          durationSeconds: 5,
          aspectRatio: "9:16",
          resolution: "720P",
          allowedChannels: ["mimo"],
          costGate: { authorized: true, readback: "test" },
          generationType: "image_to_video",
          generation_type: "image_to_video",
          allowed_channels: ["mimo"],
          cost_gate: { authorized: true, readback: "test" },
          submit_allowed: true,
          references: [{
            assetId,
            refKey: `asset_${assetId}`,
            sha256: assetSha256,
            role: "video_first_frame_anchor",
            duty: "人物图",
            userConfirmation: "confirmed",
            actualVideoInput: true,
            uploadEligible: true,
            downloadPath: `/api/internal/mac-codex/tasks/${taskId}/assets/${assetId}`,
          }],
        },
      });
    }
    if (pathname.endsWith(`/assets/${assetId}`) && request.method === "GET") {
      requests.asset += 1;
      response.writeHead(200, {
        "content-type": "image/png",
        "content-disposition": 'attachment; filename="reference.png"',
      });
      return response.end(assetBytes);
    }
    if (pathname === `/api/internal/mac-codex/tasks/${taskId}/result` && request.method === "POST") {
      requests.result = await readRequest(request);
      return json(response, { ok: true, result: { status: "blocked", blocker: "awaiting_content_qa" } });
    }
    return json(response, { error: "NOT_FOUND" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const environment = {
    ...await readyEnvironment(workspace, process.execPath, `http://127.0.0.1:${address.port}`),
    NIANNIAN_ORIGIN: `http://127.0.0.1:${address.port}`,
    NIANNIAN_MAC_AGENT_TOKEN: token,
    NIANNIAN_MAC_WORKER_ID: "integration-mac-worker",
    NIANNIAN_MAC_WORKSPACE: workspace,
  };
  try {
    const staleTaskDirectory = path.join(workspace, "jobs", taskId);
    await mkdir(path.join(staleTaskDirectory, "input"), { recursive: true });
    await mkdir(path.join(staleTaskDirectory, "output"), { recursive: true });
    await mkdir(path.join(staleTaskDirectory, "ledger"), { recursive: true });
    await writeFile(path.join(staleTaskDirectory, "input", "old-reference.png"), "stale-input");
    await writeFile(path.join(staleTaskDirectory, "output", "result.mp4"), "stale-output");
    await writeFile(path.join(staleTaskDirectory, "ledger", "execution-ledger.json"), "stale-ledger");
    await writeFile(path.join(staleTaskDirectory, "worker-result.json"), "stale-result");

    const claimOutput = JSON.parse(await runWorker(["claim"], environment));
    assert.equal(claimOutput.taskId, taskId, JSON.stringify(claimOutput));
    assert.equal(requests.claim, 1);
    assert.equal(requests.asset, 1);
    assert.ok(requests.heartbeats >= 2);
    const stagedTask = JSON.parse(await readFile(path.join(claimOutput.taskDirectory, "task.json"), "utf8"));
    assert.equal(stagedTask.references[0].sha256, assetSha256);
    assert.equal(stagedTask.references[0].refKey, `asset_${assetId}`);
    assert.equal(stagedTask.references[0].userConfirmation, "confirmed");
    assert.equal(stagedTask.references[0].uploadEligible, true);
    assert.equal(stagedTask.submit_allowed, true);
    assert.equal(stagedTask.generation_type, "image_to_video");
    assert.equal(createHash("sha256").update(await readFile(stagedTask.references[0].localPath)).digest("hex"), assetSha256);
    await assert.rejects(readFile(path.join(claimOutput.taskDirectory, "worker-result.json")));
    await assert.rejects(readFile(path.join(claimOutput.taskDirectory, "input", "old-reference.png")));
    await assert.rejects(readFile(path.join(claimOutput.taskDirectory, "output", "result.mp4")));
    await assert.rejects(readFile(path.join(claimOutput.taskDirectory, "ledger", "execution-ledger.json")));
    const instructionText = await readFile(path.join(claimOutput.taskDirectory, "INSTRUCTIONS.md"), "utf8");
    assert.match(instructionText, /awaiting_content_qa/);
    assert.match(instructionText, /子员工不得再次执行这些父级操作/);

    const outputPath = path.join(claimOutput.taskDirectory, "output", "result.mp4");
    const ledgerPath = path.join(claimOutput.taskDirectory, "ledger", "execution-ledger.json");
    const resultPath = path.join(claimOutput.taskDirectory, "worker-result.json");
    await writeFile(outputPath, Buffer.from("fake-output-for-transport-test"));
    await writeFile(ledgerPath, `${JSON.stringify({ taskId, status: "downloaded" })}\n`, "utf8");
    await writeFile(resultPath, `${JSON.stringify({
      taskId,
      status: "completed",
      providerTaskId: "provider-test-001",
      summary: "transport test",
      blocker: null,
      outputPath,
      ledgerPath,
    })}\n`, "utf8");
    const reportOutput = JSON.parse(await runWorker(["report", "--result", resultPath], environment));
    assert.equal(reportOutput.server.result.blocker, "awaiting_content_qa");
    assert.ok(Buffer.isBuffer(requests.result));
    assert.match(requests.result.toString("utf8"), /provider-test-001/);
    assert.match(requests.result.toString("utf8"), /execution-ledger\.json/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  }
});

test("run-once launches a fresh Codex employee and reports its output", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "niannian-mac-run-once-"));
  const fakeCodexScript = path.join(workspace, "fake-codex.mjs");
  const fakeLauncher = path.join(workspace, process.platform === "win32" ? "codex.cmd" : "codex");
  await writeFile(fakeCodexScript, `
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
const resultPath = args[args.indexOf("-o") + 1];
const taskDirectory = args[args.indexOf("-C") + 1];
const task = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(path.join(taskDirectory, "task.json"), "utf8")));
const counterPath = path.join(taskDirectory, ".fake-codex-counter");
let counter = 0;
try { counter = Number(await import("node:fs/promises").then((fs) => fs.readFile(counterPath, "utf8"))); } catch {}
await writeFile(counterPath, String(counter + 1));
if (counter === 0) {
  await writeFile(resultPath, JSON.stringify({ taskId: task.id, status: "running", providerTaskId: "fake-codex-provider-001", summary: "provider running", blocker: null, outputPath: null, ledgerPath: null }));
  process.exit(0);
}
const outputPath = path.join(taskDirectory, "output", "result.mp4");
const ledgerPath = path.join(taskDirectory, "ledger", "execution-ledger.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await mkdir(path.dirname(ledgerPath), { recursive: true });
await writeFile(outputPath, "fake-codex-output");
await writeFile(ledgerPath, JSON.stringify({ taskId: task.id, status: "downloaded" }));
await writeFile(resultPath, JSON.stringify({ taskId: task.id, status: "completed", providerTaskId: "fake-codex-provider-001", summary: "fake Codex completed", blocker: null, outputPath, ledgerPath }));
`, "utf8");
  if (process.platform === "win32") {
    await writeFile(fakeLauncher, `@echo off\r\n"${process.execPath}" "${fakeCodexScript}" %*\r\n`, "utf8");
  } else {
    await writeFile(fakeLauncher, `#!/bin/sh\nexec "${process.execPath}" "${fakeCodexScript}" "$@"\n`, "utf8");
    await chmod(fakeLauncher, 0o755);
  }
  const resultBodies = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/api/video/list" && request.method === "GET") return json(response, { code: 200, data: { list: [] } });
    if (request.headers.authorization !== `Bearer ${token}`) return json(response, { error: "UNAUTHORIZED" }, 401);
    if (pathname === "/api/internal/mac-codex/heartbeat" && request.method === "POST") {
      await readRequest(request);
      return json(response, { ok: true, state: { status: "idle" } });
    }
    if (pathname === "/api/internal/mac-codex/claim" && request.method === "POST") {
      await readRequest(request);
      return json(response, {
        task: {
          id: taskId,
          channel: "mimo",
          prompt: "Locked integration prompt",
          promptSha256: createHash("sha256").update("Locked integration prompt").digest("hex"),
          durationSeconds: 5,
          aspectRatio: "9:16",
          resolution: "720P",
          allowedChannels: ["mimo"],
          costGate: { authorized: true, readback: "test" },
          references: [{ assetId, sha256: assetSha256, role: "video_first_frame_anchor", duty: "人物图", downloadPath: `/api/internal/mac-codex/tasks/${taskId}/assets/${assetId}` }],
        },
      });
    }
    if (pathname.endsWith(`/assets/${assetId}`) && request.method === "GET") {
      response.writeHead(200, { "content-type": "image/png", "content-disposition": 'attachment; filename="reference.png"' });
      return response.end(assetBytes);
    }
    if (pathname === `/api/internal/mac-codex/tasks/${taskId}/result` && request.method === "POST") {
      const resultBody = await readRequest(request);
      resultBodies.push(resultBody);
      const isRunning = /name="status"\r\n\r\nrunning/.test(resultBody.toString("utf8"));
      return json(response, { ok: true, result: isRunning ? { status: "running_on_mac", blocker: null } : { status: "blocked", blocker: "awaiting_content_qa" } });
    }
    return json(response, { error: "NOT_FOUND" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const output = JSON.parse(await runWorker(["run-once"], {
      ...await readyEnvironment(workspace, fakeLauncher, `http://127.0.0.1:${address.port}`),
      NIANNIAN_ORIGIN: `http://127.0.0.1:${address.port}`,
      NIANNIAN_MAC_AGENT_TOKEN: token,
      NIANNIAN_MAC_WORKER_ID: "integration-run-once-worker",
      NIANNIAN_MAC_WORKSPACE: path.join(workspace, "jobs-root"),
      NIANNIAN_CODEX_TIMEOUT_MS: "60000",
      NIANNIAN_CODEX_MAX_CYCLES: "3",
      NIANNIAN_CODEX_SYNC_DELAY_MS: "1000",
    }));
    assert.equal(output.taskId, taskId, JSON.stringify(output));
    assert.equal(output.server.result.blocker, "awaiting_content_qa");
    assert.equal(resultBodies.length, 2);
    assert.match(resultBodies[0].toString("utf8"), /fake-codex-provider-001/);
    assert.match(resultBodies[1].toString("utf8"), /execution-ledger\.json/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  }
});
