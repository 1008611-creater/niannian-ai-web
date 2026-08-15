#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const config = {
  webdriver: value("--webdriver") || process.env.NIANNIAN_MIMO_WEBDRIVER_URL || "http://127.0.0.1:4444",
  mimoBase: process.env.MIMO_BASE_URL || "https://fd.aancn.cn",
  sessionFile: value("--session-file"),
  taskId: value("--task-id"),
  out: value("--out"),
  manifest: value("--manifest"),
};

function fail(message) { throw new Error(`SAFARI_VISIBLE_SYNC:${message}`); }

async function request(method, endpoint, body) {
  const response = await fetch(new URL(endpoint, config.webdriver), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.value?.error) fail(data.value?.message || `${method} ${endpoint} failed (${response.status})`);
  return data.value;
}

async function ensureAuthenticatedSession() {
  const preparer = path.join(path.dirname(fileURLToPath(import.meta.url)), "prepare-mimo-safari-session.mjs");
  const args = [preparer, "--webdriver", config.webdriver, "--url", new URL("/", config.mimoBase).toString(), "--session-file", config.sessionFile, "--username-env", "MIMO_USERNAME", "--password-env", "MIMO_PASSWORD"];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-8000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `session preparer failed (${code})`)));
  });
  const line = String(result).split(/\r?\n/).filter(Boolean).at(-1) || "{}";
  const state = JSON.parse(line);
  if (state.authenticated !== true) fail(`BROWSER_AUTH_NOT_READY:${state.state || "unknown"}`);
  return state;
}

async function sessionId() {
  if (!config.sessionFile) fail("SESSION_FILE_REQUIRED");
  const cached = JSON.parse(await readFile(config.sessionFile, "utf8"));
  if (typeof cached?.sessionId !== "string" || !cached.sessionId) fail("SESSION_REQUIRED");
  await request("POST", `/session/${cached.sessionId}/execute/sync`, { script: "return document.readyState;", args: [] });
  return cached.sessionId;
}

async function providerRequest(id, endpoint, body) {
  const script = `
    const token = localStorage.getItem('token');
    if (!token) return { auth: 'missing' };
    return fetch(${JSON.stringify(endpoint)}, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(${JSON.stringify(body)})
    }).then(async (response) => ({ auth: 'present', httpStatus: response.status, body: await response.json().catch(() => ({})), token }));
  `;
  const result = await request("POST", `/session/${id}/execute/sync`, { script, args: [] });
  if (result?.auth !== "present" || typeof result.token !== "string" || !result.token) fail("BROWSER_AUTH_MISSING");
  if (result.httpStatus < 200 || result.httpStatus >= 300 || ![0, 200].includes(Number(result.body?.code))) fail(`PROVIDER_REQUEST_FAILED:${result.httpStatus || "unknown"}`);
  return result;
}

async function providerList(id) {
  const script = `
    const token = localStorage.getItem('token');
    if (!token) return { auth: 'missing' };
    return fetch('/api/video/list?page=1', {
      headers: { authorization: 'Bearer ' + token }
    }).then(async (response) => ({ auth: 'present', httpStatus: response.status, body: await response.json().catch(() => ({})), token }));
  `;
  const result = await request("POST", `/session/${id}/execute/sync`, { script, args: [] });
  if (result?.auth !== "present" || typeof result.token !== "string" || !result.token) fail("BROWSER_AUTH_MISSING");
  if (result.httpStatus < 200 || result.httpStatus >= 300 || ![0, 200].includes(Number(result.body?.code))) fail(`PROVIDER_LIST_FAILED:${result.httpStatus || "unknown"}`);
  return result;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function download(url, token, outputPath) {
  let downloadUrl = url;
  let headers = {};
  if (!downloadUrl.includes("tos-cn-beijing")) {
    const id = await sessionId();
    const proxy = await providerRequest(id, "/api/video/proxy-token", { url: downloadUrl });
    const proxyToken = proxy.body?.data?.token;
    if (typeof proxyToken !== "string" || !proxyToken) fail("PROXY_TOKEN_MISSING");
    downloadUrl = new URL(`/api/video/proxy-video?token=${encodeURIComponent(proxyToken)}`, config.mimoBase).toString();
    headers = { authorization: `Bearer ${token}` };
  }
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  const response = await fetch(downloadUrl, { headers });
  if (!response.ok || !response.body) fail(`DOWNLOAD_FAILED:${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
  return { path: path.resolve(outputPath), sha256: await sha256(outputPath) };
}

async function main() {
  if (!config.taskId || !config.out || !config.manifest) fail("INVALID_ARGUMENTS");
  await ensureAuthenticatedSession();
  const id = await sessionId();
  const status = await providerRequest(id, "/api/video/batch-status", { taskIds: [config.taskId] });
  let item = Array.isArray(status.body?.data)
    ? status.body.data.find((entry) => String(entry?.taskId || entry?.id || "") === config.taskId) || status.body.data[0]
    : status.body?.data;
  if (!item) fail("PROVIDER_TASK_NOT_FOUND");
  let providerStatus = Number(item.status);
  let videoUrl = typeof item.videoUrl === "string" ? item.videoUrl : "";
  if (!videoUrl) {
    const listed = await providerList(id);
    const listedItems = Array.isArray(listed.body?.data)
      ? listed.body.data
      : Array.isArray(listed.body?.data?.list)
        ? listed.body.data.list
        : Array.isArray(listed.body?.data?.records)
          ? listed.body.data.records
          : [];
    const listedItem = listedItems.find((entry) => String(entry?.taskId || entry?.id || "") === config.taskId);
    if (listedItem) {
      item = listedItem;
      providerStatus = Number(listedItem.status);
      videoUrl = typeof listedItem.videoUrl === "string" ? listedItem.videoUrl : "";
    }
  }
  const base = { provider: "mimo", providerTaskId: config.taskId, finalStatus: { status: providerStatus }, syncPath: "safari_visible_frontend" };
  // The official page can expose the completed MP4 before its task-list status
  // advances from 60. The real downloadable artifact is the stronger signal;
  // otherwise the worker keeps reporting a finished video as still rendering.
  if ([20, 50, 60].includes(providerStatus) && !videoUrl) {
    await writeFile(config.manifest, `${JSON.stringify(base, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`task=${config.taskId} status=${providerStatus} running\n`);
    return;
  }
  if (providerStatus !== 1 && !videoUrl) fail(`PROVIDER_STATUS_${providerStatus}`);
  if (!videoUrl) fail("VIDEO_URL_MISSING");
  const downloaded = await download(videoUrl, status.token, config.out);
  await writeFile(config.manifest, `${JSON.stringify({ ...base, completedByVideoArtifact: providerStatus !== 1, downloaded }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`task=${config.taskId} status=${providerStatus} downloaded\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
