#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VERSION = "1.1.0-windows-astorie-fast-path";
const CHANNEL = "astorie";
const SKILL_ROUTE = ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "astorie-seedance2-channel"];
const directory = path.dirname(fileURLToPath(import.meta.url));
const helperDirectory = path.resolve(directory, "..", "windows-astorie-agent");

function command() { return process.argv[2] || "help"; }
function cleanWorkerId(value) {
  const workerId = String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  if (workerId.length < 3) throw new Error("ASTORIE_WINDOWS_WORKER_ID_INVALID");
  return workerId;
}
function cdpEndpoint(value) {
  const parsed = new URL(value || "http://127.0.0.1:9236");
  if (!["http:", "https:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error("ASTORIE_CDP_ENDPOINT_MUST_BE_LOOPBACK");
  return parsed.toString().replace(/\/$/, "");
}
function settings() {
  const origin = String(process.env.NIANNIAN_ORIGIN || "").replace(/\/$/, "");
  const token = String(process.env.ASTORIE_WINDOWS_AGENT_TOKEN || "").trim();
  if (!origin) throw new Error("NIANNIAN_ORIGIN_REQUIRED");
  if (new URL(origin).protocol !== "https:" && !["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("NIANNIAN_ORIGIN_HTTPS_REQUIRED");
  if (token.length < 24) throw new Error("ASTORIE_WINDOWS_AGENT_TOKEN_REQUIRED");
  return {
    origin, token, cdpEndpoint: cdpEndpoint(process.env.NIANNIAN_ASTORIE_CDP_URL),
    workerId: cleanWorkerId(process.env.NIANNIAN_ASTORIE_WORKER_ID || `windows-astorie-${os.hostname()}`),
    workspace: path.resolve(process.env.NIANNIAN_ASTORIE_WORKSPACE || path.join(os.homedir(), "niannian-windows-astorie-worker")),
    ffprobeBin: process.env.NIANNIAN_FFPROBE_BIN || "ffprobe.exe",
    claimPollMs: Math.min(Math.max(Number(process.env.NIANNIAN_ASTORIE_CLAIM_POLL_MS || 2000), 1000), 300000),
    syncPollMs: Math.min(Math.max(Number(process.env.NIANNIAN_ASTORIE_SYNC_POLL_MS || 5000), 2000), 300000),
    syncCycles: Math.min(Math.max(Number(process.env.NIANNIAN_ASTORIE_SYNC_CYCLES || 120), 1), 240),
  };
}
async function api(config, pathname, options = {}) {
  const headers = new Headers(options.headers || {}); headers.set("authorization", `Bearer ${config.token}`);
  const response = await fetch(new URL(pathname, config.origin), { ...options, headers });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(`${body.error || "ASTORIE_WINDOWS_REQUEST_FAILED"}:${response.status}`); }
  return response;
}
async function atomicJson(target, value) { await mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(temporary, target); }
async function readJson(target, fallback = null) { try { return JSON.parse(await readFile(target, "utf8")); } catch { return fallback; } }
async function exists(target) { try { await access(target); return true; } catch { return false; } }
async function executableAvailable(name) { return new Promise((resolve) => { const child = spawn(name, ["-version"], { stdio: "ignore", windowsHide: true }); child.once("error", () => resolve(false)); child.once("close", (code) => resolve(code === 0)); }); }
async function run(script, args, config) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, NIANNIAN_ASTORIE_CDP_URL: config.cdpEndpoint }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-4000); }); child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-6000); });
    child.once("error", reject); child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`ASTORIE_CDP_HELPER_FAILED:${code}:${stderr.replace(/\s+/g, " ").trim()}`)));
  });
}
async function mediaProbe(file, config) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffprobeBin, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,channels", "-of", "json", file], { windowsHide: true });
    let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject); child.once("close", (code) => { if (code !== 0) return reject(new Error(`FFPROBE_FAILED:${stderr}`)); try { const info = JSON.parse(stdout); const streams = info.streams || []; const video = streams.find((stream) => stream.codec_type === "video"); const audio = streams.find((stream) => stream.codec_type === "audio"); const duration = Number(info.format?.duration); if (!video || !audio || !Number.isFinite(duration) || duration <= 0) throw new Error("MEDIA_PROBE_INCOMPLETE"); resolve({ durationSeconds: duration, width: video.width, height: video.height, video: video.codec_name, audio: audio.codec_name, audioChannels: audio.channels ?? null }); } catch (error) { reject(error); } });
  });
}
function validate(task) {
  const route = task.skillRoute || task.skill_route;
  if (task.channel !== CHANNEL || JSON.stringify(task.allowedChannels || task.allowed_channels || []) !== JSON.stringify([CHANNEL])) throw new Error("ASTORIE_TASK_CHANNEL_NOT_AUTHORIZED");
  if (JSON.stringify(route) !== JSON.stringify(SKILL_ROUTE)) throw new Error("ASTORIE_SKILL_ROUTE_INVALID");
  if (task.submit_allowed !== true || task.costGate?.authorized !== true) throw new Error("ASTORIE_COST_AUTHORIZATION_REQUIRED");
  if (task.providerTaskId) return [];
  const maximumCost = Number(task.costGate?.maximum_cost ?? task.costGate?.max_cost);
  if (!Number.isFinite(maximumCost) || maximumCost <= 0) throw new Error("ASTORIE_COST_MAXIMUM_REQUIRED");
  if (task.model !== "Seedance 2.0 Mini" || String(task.resolution).toUpperCase() !== "720P" || !Number.isInteger(Number(task.durationSeconds)) || Number(task.durationSeconds) < 4 || Number(task.durationSeconds) > 15 || !["9:16", "16:9"].includes(task.aspectRatio)) throw new Error("ASTORIE_TASK_SPEC_UNSUPPORTED");
  const plan = task.channelReferencePlan?.astorie || task.channel_reference_plan?.astorie;
  const keys = Array.isArray(plan?.selected_reference_keys) ? plan.selected_reference_keys.map(String) : [];
  if (!plan || plan.channel !== CHANNEL || Number(plan.max_upload_references) !== 1 || keys.length > 1) throw new Error("ASTORIE_REFERENCE_PLAN_INVALID");
  const references = (task.references || []).filter((item) => keys.includes(String(item.refKey || item.ref_key)));
  if (references.length !== keys.length || references.some((item) => item.uploadEligible !== true || item.userConfirmation !== "confirmed")) throw new Error("ASTORIE_REFERENCE_NOT_AUTHORIZED");
  return references;
}
async function heartbeat(config, status, activeTaskId = null, summary = "") { await api(config, "/api/internal/windows-astorie/heartbeat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workerId: config.workerId, status, activeTaskId, summary, version: VERSION }) }); }
async function preflight(config, report = true) {
  const helpers = ["astorie-chrome-cdp.mjs", "astorie-chrome-cdp-submit.mjs", "astorie-chrome-cdp-sync.mjs"].map((file) => path.join(helperDirectory, file));
  const [files, ffprobe] = await Promise.all([Promise.all(helpers.map((file) => exists(file))).then((result) => result.every(Boolean)), executableAvailable(config.ffprobeBin)]);
  let channel; try { const module = await import(`file:///${path.join(helperDirectory, "astorie-chrome-cdp.mjs").replace(/\\/g, "/")}`); await module.ensureAStorieProjectCanvas({ endpoint: config.cdpEndpoint }); channel = await module.visibleAStorieState({ endpoint: config.cdpEndpoint }); } catch (error) { channel = { authenticated: false, blocker: error.message }; }
  const blocker = !files ? "ASTORIE_CDP_HELPER_MISSING" : !ffprobe ? "FFPROBE_NOT_AVAILABLE" : !channel.authenticated ? channel.blocker || "ASTORIE_LOGIN_REQUIRED" : !channel.seedanceMiniVisible ? "ASTORIE_SEEDANCE_MINI_NODE_NOT_VISIBLE" : null;
  const result = { ok: !blocker, blocker, channel, worker: { version: VERSION, workspace: config.workspace } };
  if (report) await heartbeat(config, blocker ? "blocked" : "idle", null, blocker || "Windows AStorie CDP worker ready").catch(() => undefined);
  return result;
}
async function report(config, result) {
  const form = new FormData(); for (const [key, value] of Object.entries({ status: result.status, workerId: config.workerId, providerTaskId: result.providerTaskId || "", summary: result.summary || "", blocker: result.blocker || "", receipt: JSON.stringify(result.receipt || null), mediaSpec: JSON.stringify(result.mediaProbe || null) })) form.set(key, String(value));
  if (result.status === "completed") { form.set("output", new Blob([await readFile(result.outputPath)]), path.basename(result.outputPath)); form.set("ledger", new Blob([await readFile(result.ledgerPath)], { type: "application/json" }), path.basename(result.ledgerPath)); }
  return (await api(config, `/api/internal/windows-astorie/tasks/${encodeURIComponent(result.taskId)}/result`, { method: "POST", body: form })).json();
}
async function stage(config, task) {
  const references = validate(task); const taskDirectory = path.join(config.workspace, "jobs", task.id); const input = path.join(taskDirectory, "input");
  if (!task.providerTaskId) await rm(taskDirectory, { recursive: true, force: true }); await mkdir(input, { recursive: true }); await mkdir(path.join(taskDirectory, "output"), { recursive: true }); await mkdir(path.join(taskDirectory, "ledger"), { recursive: true });
  for (const reference of references) { const response = await api(config, reference.downloadPath); const bytes = Buffer.from(await response.arrayBuffer()); if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw new Error("ASTORIE_REFERENCE_HASH_MISMATCH"); const localPath = path.join(input, `${reference.assetId}.jpg`); await writeFile(localPath, bytes, { mode: 0o600 }); reference.localPath = localPath; }
  const staged = { ...task, references, taskDirectory }; await atomicJson(path.join(taskDirectory, "task.json"), staged); return staged;
}
async function claim(config) {
  const ready = await preflight(config); if (!ready.ok) return null;
  const response = await api(config, "/api/internal/windows-astorie/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workerId: config.workerId }) }); const { task } = await response.json();
  if (!task) return null; try { if (createHash("sha256").update(String(task.prompt || "")).digest("hex") !== task.promptSha256) throw new Error("LOCKED_PROMPT_HASH_MISMATCH"); const staged = await stage(config, task); await heartbeat(config, "running", task.id, task.providerTaskId ? "AStorie receipt found; syncing same media only" : "AStorie task staged"); return staged; } catch (error) { await report(config, { taskId: task.id, status: "blocked", blocker: error.message, summary: "AStorie task could not be staged." }).catch(() => undefined); throw error; }
}
async function execute(config, task) {
  const output = path.join(task.taskDirectory, "output", "result.mp4"); const ledger = path.join(task.taskDirectory, "ledger", "delivery-ledger.json"); const receiptPath = path.join(task.taskDirectory, "ledger", "submission-receipt.json"); const submission = path.join(task.taskDirectory, "ledger", "submission-manifest.json"); const sync = path.join(task.taskDirectory, "ledger", "sync-manifest.json"); const prompt = path.join(task.taskDirectory, "prompt.txt"); await writeFile(prompt, `${task.prompt}\n`, { mode: 0o600 });
  let providerTaskId = task.providerTaskId || null;
  try {
    if (!providerTaskId) { const args = ["--prompt-file", prompt, "--duration", String(task.durationSeconds), "--aspect-ratio", task.aspectRatio, "--maximum-cost", String(task.costGate?.maximum_cost ?? task.costGate?.max_cost), "--manifest", submission, "--receipt", receiptPath]; if (task.references.length) args.push("--image", task.references[0].localPath); await run(path.join(helperDirectory, "astorie-chrome-cdp-submit.mjs"), args, config); const receipt = await readJson(receiptPath); providerTaskId = String(receipt?.providerTaskId || ""); if (!providerTaskId) throw new Error("ASTORIE_PROVIDER_RECEIPT_MISSING"); await report(config, { taskId: task.id, status: "running", providerTaskId, receipt, summary: "Visible AStorie canvas submitted once; receipt persisted before sync." }); }
    for (let cycle = 1; cycle <= config.syncCycles; cycle += 1) { await run(path.join(helperDirectory, "astorie-chrome-cdp-sync.mjs"), ["--receipt", receiptPath, "--out", output, "--manifest", sync], config); const state = await readJson(sync, {}); if (state.completed && await exists(output)) { const media = await mediaProbe(output, config); const delivery = { provider: "astorie", providerTaskId, submission: await readJson(submission, {}), sync: state, mediaProbe: media, sha256: createHash("sha256").update(await readFile(output)).digest("hex"), deliveredAt: new Date().toISOString() }; await atomicJson(ledger, delivery); await report(config, { taskId: task.id, status: "completed", providerTaskId, receipt: await readJson(receiptPath), mediaProbe: media, summary: "New AStorie media downloaded and passed ffprobe.", outputPath: output, ledgerPath: ledger }); return; } if (cycle === 1 || cycle % 6 === 0) await report(config, { taskId: task.id, status: "running", providerTaskId, receipt: await readJson(receiptPath), summary: `New AStorie media still running (${cycle}/${config.syncCycles}).` }); if (cycle < config.syncCycles) await new Promise((resolve) => setTimeout(resolve, config.syncPollMs)); }
    await report(config, { taskId: task.id, status: "blocked", providerTaskId, blocker: "ASTORIE_SYNC_WINDOW_EXHAUSTED", summary: "Provider receipt exists; only same media may be resumed, never resubmitted." });
  } catch (error) { await report(config, { taskId: task.id, status: "blocked", providerTaskId, blocker: error.message, summary: "Windows AStorie CDP worker stopped without a second submission." }).catch(() => undefined); throw error; }
}
async function runOnce(config) { const task = await claim(config); if (!task) return { ok: true, task: null }; await execute(config, task); return { ok: true, taskId: task.id }; }
async function runLoop(config) { let stopped = false; process.once("SIGINT", () => { stopped = true; }); process.once("SIGTERM", () => { stopped = true; }); while (!stopped) { try { await runOnce(config); } catch (error) { await heartbeat(config, "blocked", null, error.message).catch(() => undefined); } if (!stopped) await new Promise((resolve) => setTimeout(resolve, config.claimPollMs)); } }
function selfTest() { const valid = { channel: "astorie", allowedChannels: ["astorie"], skillRoute: SKILL_ROUTE, submit_allowed: true, costGate: { authorized: true, maximum_cost: 75 }, model: "Seedance 2.0 Mini", resolution: "720P", durationSeconds: 4, aspectRatio: "9:16", references: [], channelReferencePlan: { astorie: { channel: "astorie", max_upload_references: 1, selected_reference_keys: [] } } }; validate(valid); for (const invalid of [{ ...valid, durationSeconds: 3 }, { ...valid, aspectRatio: "1:1" }, { ...valid, model: "Seedance 2.0" }, { ...valid, allowedChannels: ["mimo"] }, { ...valid, costGate: { authorized: true } }]) { let rejected = false; try { validate(invalid); } catch { rejected = true; } if (!rejected) throw new Error("ASTORIE_CONTRACT_SELF_TEST_REJECTION_FAILED"); } process.stdout.write("ASTORIE_WINDOWS_AGENT_CONTRACT_SELF_TEST_PASS\n"); }
try { const selected = command(); if (selected === "contract-self-test") selfTest(); else if (["help", "--help", "-h"].includes(selected)) process.stdout.write("Windows AStorie CDP worker: preflight | heartbeat | run-once | run-loop | contract-self-test\n"); else { const config = settings(); if (["preflight", "heartbeat"].includes(selected)) process.stdout.write(`${JSON.stringify(await preflight(config))}\n`); else if (selected === "run-once") process.stdout.write(`${JSON.stringify(await runOnce(config))}\n`); else if (selected === "run-loop") await runLoop(config); else throw new Error("COMMAND_INVALID"); } } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
