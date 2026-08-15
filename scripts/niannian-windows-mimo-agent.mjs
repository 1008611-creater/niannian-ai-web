#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { probeNativeAudioMedia } from "../windows-mimo-agent/mimo-media-gates.mjs";

const VERSION = "1.4.13-windows-mimo.3";
const WORKER_CHANNEL = "mimo";
const SKILL_ROUTE = ["ai-video-production-router", "ai-video-channel-router", "mimo-8001-video-channel"];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mimoCdpDirectory = path.resolve(scriptDirectory, "..", "windows-mimo-agent");
const submitter = path.join(mimoCdpDirectory, "mimo-chrome-cdp-submit.mjs");
const synchronizer = path.join(mimoCdpDirectory, "mimo-chrome-cdp-sync.mjs");
const cdpModule = path.join(mimoCdpDirectory, "mimo-chrome-cdp.mjs");
const EXACT_REAL_TASK_ID = "NIANNIAN-WB-REAL-I2V-4S-20260728-01";
const EXACT_REAL_SOURCE_SHA256 = "59388ad9cc2e37e5d54b03b24f303fb0d83a6a740b4f0d1c9ab7e8af4c375454";
const EXACT_FACE_ENDPOINT = "http://127.0.0.1:9093/face";
const EXACT_FACE_BRIDGE_ENDPOINT = "http://niannian-face-processor:9093/face";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function command() {
  return process.argv[2] || "help";
}

function safeWorkerId(value) {
  const workerId = String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  if (workerId.length < 3) throw new Error("MIMO_WINDOWS_WORKER_ID_INVALID");
  return workerId;
}

function localCdpEndpoint(value) {
  const endpoint = new URL(String(value || "http://127.0.0.1:9226"));
  if (!['http:', 'https:'].includes(endpoint.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) {
    throw new Error("MIMO_CDP_ENDPOINT_MUST_BE_LOOPBACK");
  }
  return endpoint.toString().replace(/\/$/, "");
}

function settings() {
  const origin = String(process.env.NIANNIAN_ORIGIN || "").replace(/\/$/, "");
  // The worker and the server deliberately use one environment variable name.
  // A mismatched agent-side name makes every heartbeat/claim unauthorized.
  const token = String(process.env.MIMO_WINDOWS_AGENT_TOKEN || "").trim();
  if (!origin) throw new Error("NIANNIAN_ORIGIN_REQUIRED");
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("NIANNIAN_ORIGIN_HTTPS_REQUIRED");
  if (token.length < 24) throw new Error("MIMO_WINDOWS_AGENT_TOKEN_REQUIRED");
  const workspace = path.resolve(process.env.NIANNIAN_MIMO_WORKSPACE || path.join(os.homedir(), "niannian-windows-mimo-worker"));
  const ffprobeBin = process.env.NIANNIAN_FFPROBE_BIN || "ffprobe.exe";
  const claimPollMs = Math.min(Math.max(Number(process.env.NIANNIAN_MIMO_CLAIM_POLL_MS || process.env.NIANNIAN_MIMO_POLL_MS || 5_000), 5_000), 5 * 60_000);
  const syncPollMs = Math.min(Math.max(Number(process.env.NIANNIAN_MIMO_SYNC_POLL_MS || 10_000), 10_000), 5 * 60_000);
  const syncCycles = Math.min(Math.max(Number(process.env.NIANNIAN_MIMO_SYNC_CYCLES || 60), 1), 240);
  return {
    origin, token, workspace, ffprobeBin, claimPollMs, syncPollMs, syncCycles,
    cdpEndpoint: localCdpEndpoint(process.env.NIANNIAN_MIMO_CDP_URL),
    workerId: safeWorkerId(process.env.NIANNIAN_MIMO_WORKER_ID || `windows-mimo-${os.hostname()}`),
  };
}

async function api(config, pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${config.token}`);
  const response = await fetch(new URL(pathname, config.origin), { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`${body.error || "MIMO_WINDOWS_REQUEST_FAILED"}:${response.status}`);
  }
  return response;
}

async function atomicJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

async function readJsonOr(target, fallback) {
  try { return JSON.parse(await readFile(target, "utf8")); } catch { return fallback; }
}

async function executableAvailable(commandName) {
  return new Promise((resolve) => {
    const child = spawn(commandName, ["-version"], { stdio: "ignore", windowsHide: true });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

async function workspaceWritable(workspace) {
  const target = path.join(workspace, `.readiness-${process.pid}.tmp`);
  try {
    await mkdir(workspace, { recursive: true });
    await writeFile(target, "ok", { encoding: "utf8", mode: 0o600 });
    await rm(target, { force: true });
    return true;
  } catch {
    await rm(target, { force: true }).catch(() => undefined);
    return false;
  }
}

async function browserReadiness(config) {
  const checkedAt = new Date().toISOString();
  try {
    const { visibleMimoState } = await import(pathToFileURL(cdpModule).href);
    const state = await visibleMimoState({ endpoint: config.cdpEndpoint, origin: process.env.MIMO_BASE_URL || "https://fd.aancn.cn/" });
    if (state.generator) {
      return { id: WORKER_CHANNEL, state: "ready", checkedAt, reachable: true, authenticated: true, proxyConfigured: false, cdpAvailable: true, extensionCount: 0, credits: state.billing?.balance || null, unitCreditsPerSecond: state.billing?.unitCreditsPerSecond || null, pricingObservedAt: state.billing?.observedAt || null, model: "Seedance 2.0", nativeAudio: state.nativeAudio, referenceAudioRequired: false, audioMode: "provider_generated_audio", blocker: null };
    }
    if (state.login || state.authentication?.authenticated === false) {
      return { id: WORKER_CHANNEL, state: "authentication_failed", checkedAt, reachable: true, authenticated: false, proxyConfigured: false, cdpAvailable: true, extensionCount: 0, credits: null, model: "Seedance 2.0", blocker: state.authentication?.blocker || "MIMO_LOGIN_FAILED" };
    }
    return { id: WORKER_CHANNEL, state: "configuration_invalid", checkedAt, reachable: true, authenticated: null, proxyConfigured: false, cdpAvailable: true, extensionCount: 0, credits: null, model: "Seedance 2.0", blocker: "MIMO_VISIBLE_FRONTEND_UNAVAILABLE" };
  } catch (error) {
    return { id: WORKER_CHANNEL, state: "unreachable", checkedAt, reachable: false, authenticated: false, proxyConfigured: false, cdpAvailable: false, extensionCount: 0, credits: null, model: "Seedance 2.0", blocker: error instanceof Error ? `MIMO_CDP_UNAVAILABLE:${error.message}`.slice(0, 240) : "MIMO_CDP_UNAVAILABLE" };
  }
}

async function heartbeat(config, status, activeTaskId = null, summary = "", readiness = undefined) {
  await api(config, "/api/internal/windows-mimo/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerId: config.workerId, status, activeTaskId, summary, version: VERSION, ...(readiness ? { readiness } : {}) }),
  });
}

async function preflight(config, report = true) {
  const checkedAt = new Date().toISOString();
  const [workspaceOk, ffprobeAvailable, channel, submitExists, syncExists] = await Promise.all([
    workspaceWritable(config.workspace), executableAvailable(config.ffprobeBin), browserReadiness(config), access(submitter).then(() => true, () => false), access(synchronizer).then(() => true, () => false),
  ]);
  const blockers = [
    workspaceOk ? null : "MIMO_WORKSPACE_NOT_WRITABLE",
    ffprobeAvailable ? null : "FFPROBE_NOT_AVAILABLE",
    submitExists && syncExists ? null : "MIMO_CDP_HELPER_MISSING",
    channel.blocker,
  ].filter(Boolean);
  const readiness = {
    schemaVersion: 1, checkedAt, readyToClaim: blockers.length === 0, blocker: blockers[0] || null,
    computer: { hostname: os.hostname(), platform: process.platform, arch: process.arch, workspaceWritable: workspaceOk, ffprobeAvailable },
    skills: { state: "ready", bundleName: "niannian-windows-mimo-cdp", bundleVersion: VERSION, skills: 3, blocker: null },
    channel,
  };
  if (report) await heartbeat(config, readiness.readyToClaim ? "idle" : "blocked", null, readiness.readyToClaim ? "Windows Mimo CDP worker ready" : `preflight blocked: ${readiness.blocker}`, readiness).catch(() => undefined);
  return { ok: readiness.readyToClaim, status: readiness.readyToClaim ? "ready" : "blocked", blocker: readiness.blocker, readiness };
}

function selectedReferences(task) {
  if (task.channel !== WORKER_CHANNEL || JSON.stringify(task.allowedChannels || task.allowed_channels || []) !== JSON.stringify([WORKER_CHANNEL])) throw new Error("MIMO_TASK_CHANNEL_NOT_AUTHORIZED");
  if (JSON.stringify(task.skillRoute || task.skill_route || []) !== JSON.stringify(SKILL_ROUTE)) throw new Error("MIMO_SKILL_ROUTE_INVALID");
  if (task.submit_allowed !== true || task.costGate?.authorized !== true) throw new Error("MIMO_COST_AUTHORIZATION_REQUIRED");
  const generationType = task.generationType || task.generation_type;
  const expectedCost = Number(task.costGate?.expected_cost);
  const maximumCost = Number(task.costGate?.maximum_cost ?? task.costGate?.max_cost);
  if (!task.providerTaskId && !["text_to_video", "image_to_video"].includes(String(generationType))) throw new Error("MIMO_PROVIDER_GENERATION_TYPE_UNSUPPORTED");
  if (!task.providerTaskId && (Number(task.durationSeconds) < 4 || Number(task.durationSeconds) > 15)) throw new Error("MIMO_PROVIDER_DURATION_UNSUPPORTED");
  if (!task.providerTaskId && String(task.resolution).toUpperCase() !== "720P") throw new Error("MIMO_PROVIDER_RESOLUTION_UNSUPPORTED");
  if (!task.providerTaskId && String(task.model) !== "Seedance 2.0") throw new Error("MIMO_PROVIDER_MODEL_UNSUPPORTED");
  if (!task.providerTaskId && (!Number.isFinite(expectedCost) || expectedCost <= 0 || !Number.isFinite(maximumCost) || maximumCost < expectedCost)) throw new Error("MIMO_PROVIDER_COST_CONTRACT_UNAVAILABLE");
  const plan = task.channelReferencePlan?.mimo || task.channel_reference_plan?.mimo;
  if (!plan || plan.channel !== WORKER_CHANNEL || plan.supports_multi_reference !== true || Number(plan.max_upload_references) !== 12) throw new Error("MIMO_REFERENCE_PLAN_INVALID");
  const selectedKeys = Array.isArray(plan.selected_reference_keys) ? plan.selected_reference_keys.map(String) : [];
  if (generationType === "text_to_video" && selectedKeys.length === 0 && (task.references || []).length === 0) return [];
  if (!selectedKeys.length || selectedKeys.length > 12 || new Set(selectedKeys).size !== selectedKeys.length) throw new Error("MIMO_REFERENCE_SELECTION_INVALID");
  const selected = (task.references || []).filter((reference) => selectedKeys.includes(String(reference.refKey || reference.ref_key || "")));
  if (selected.length !== selectedKeys.length || selected.some((reference) => reference.uploadEligible !== true || reference.userConfirmation !== "confirmed")) throw new Error("MIMO_REFERENCE_NOT_AUTHORIZED");
  return selected;
}

function expectedMediaDimensions(aspectRatio) {
  return String(aspectRatio) === "9:16" ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
}

function requiredFacePreprocess(task, references) {
  if (task.id !== EXACT_REAL_TASK_ID || task.providerTaskId) return null;
  const manifest = task.facePreprocessManifest || task.face_preprocess_manifest;
  if (!manifest || typeof manifest !== "object") throw new Error("FACE_PREPROCESS_MANIFEST_REQUIRED");
  const source = manifest.source || {};
  const output = manifest.output || {};
  const processor = manifest.processor || {};
  if (manifest.schema !== "niannian_face_preprocess_manifest_v1" || manifest.taskId !== EXACT_REAL_TASK_ID || source.sha256 !== EXACT_REAL_SOURCE_SHA256 || manifest.derivedFrom !== EXACT_REAL_SOURCE_SHA256 || ![EXACT_FACE_ENDPOINT, EXACT_FACE_BRIDGE_ENDPOINT].includes(manifest.serviceUrl) || manifest.duty !== "mimo_primary_reference" || processor.version !== "face-white-2px-v1" || processor.lineColor !== "white" || processor.lineThickness !== 2 || !/^[a-f0-9]{64}$/.test(String(output.sha256 || ""))) throw new Error("FACE_PREPROCESS_MANIFEST_INVALID");
  if (references.length !== 1 || references[0].sha256 !== output.sha256 || references[0].sha256 === EXACT_REAL_SOURCE_SHA256) throw new Error("FACE_PREPROCESS_DERIVED_REFERENCE_REQUIRED");
  return manifest;
}

function mediaFilename(reference, response) {
  const contentType = response.headers.get("content-type") || "";
  const extension = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
  return `${reference.assetId}${extension}`;
}

function finiteCostOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function downloadReference(config, reference, inputDirectory) {
  const response = await api(config, reference.downloadPath);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!reference.sha256 || sha256 !== reference.sha256) throw new Error(`REFERENCE_HASH_MISMATCH:${reference.assetId}`);
  if (!/^image\/(png|jpeg|webp)$/i.test(response.headers.get("content-type") || "")) throw new Error(`MIMO_REFERENCE_IMAGE_REQUIRED:${reference.assetId}`);
  const localPath = path.join(inputDirectory, mediaFilename(reference, response));
  await writeFile(localPath, bytes, { mode: 0o600 });
  return { ...reference, localPath, sha256, bytes: bytes.length };
}

async function report(config, result) {
  const form = new FormData();
  form.set("status", result.status);
  form.set("workerId", config.workerId);
  form.set("providerTaskId", String(result.providerTaskId || ""));
  form.set("summary", String(result.summary || ""));
  form.set("blocker", String(result.blocker || ""));
  form.set("providerCostEvidence", JSON.stringify(result.providerCostEvidence ?? null));
  form.set("progressEvents", JSON.stringify(result.progressEvents ?? []));
  if (result.status === "completed") {
    const [output, ledger] = await Promise.all([readFile(result.outputPath), readFile(result.ledgerPath)]);
    JSON.parse(ledger.toString("utf8"));
    form.set("output", new Blob([output]), path.basename(result.outputPath));
    form.set("ledger", new Blob([ledger], { type: "application/json" }), path.basename(result.ledgerPath));
  }
  const response = await api(config, `/api/internal/windows-mimo/tasks/${encodeURIComponent(result.taskId)}/result`, { method: "POST", body: form });
  return response.json();
}

async function runHelper(script, args, config) {
  const env = { ...process.env, NIANNIAN_MIMO_CDP_URL: config.cdpEndpoint, MIMO_BASE_URL: process.env.MIMO_BASE_URL || "https://fd.aancn.cn" };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-4000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-6000); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`MIMO_CDP_HELPER_FAILED:${code}:${stderr.replace(/\s+/g, " ").trim()}`)));
  });
}

async function claim(config) {
  const readiness = await preflight(config, true);
  if (!readiness.ok) return { preflightBlocked: true, blocker: readiness.blocker };
  await heartbeat(config, "claiming", null, "checking Mimo codex_skill queue");
  const response = await api(config, "/api/internal/windows-mimo/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workerId: config.workerId }) });
  const { task } = await response.json();
  if (!task) {
    await heartbeat(config, "idle", null, "no eligible Mimo task");
    return null;
  }
  try {
    if (!task.promptSha256 || createHash("sha256").update(String(task.prompt || "")).digest("hex") !== task.promptSha256) throw new Error("LOCKED_PROMPT_HASH_MISMATCH");
    if (task.preflightOnly === true || task.preflight_only === true) {
      await heartbeat(config, "running", task.id, "locked Mimo task claimed for visible cost preflight only");
      return { ...task, preflightOnly: true, preflightReadback: readiness.readiness.channel, taskDirectory: null };
    }
    const references = task.providerTaskId ? [] : selectedReferences(task);
    const facePreprocessManifest = requiredFacePreprocess(task, references);
    const taskDirectory = path.join(config.workspace, "jobs", task.id);
    const inputDirectory = path.join(taskDirectory, "input");
    if (!task.providerTaskId) await rm(taskDirectory, { recursive: true, force: true });
    await mkdir(inputDirectory, { recursive: true });
    await mkdir(path.join(taskDirectory, "output"), { recursive: true });
    await mkdir(path.join(taskDirectory, "ledger"), { recursive: true });
    const stagedReferences = [];
    for (const reference of references) stagedReferences.push(await downloadReference(config, reference, inputDirectory));
    if (facePreprocessManifest && (stagedReferences.length !== 1 || stagedReferences[0].sha256 !== facePreprocessManifest.output.sha256)) throw new Error("FACE_PREPROCESS_DERIVED_UPLOAD_MISMATCH");
    const staged = { ...task, references: stagedReferences, ...(facePreprocessManifest ? { facePreprocessManifest } : {}), taskDirectory };
    await atomicJson(path.join(taskDirectory, "task.json"), staged);
    await heartbeat(config, "running", task.id, task.providerTaskId ? "provider receipt found; syncing only" : "locked Mimo task staged");
    return staged;
  } catch (error) {
    const blocker = error instanceof Error ? error.message : "MIMO_WINDOWS_CLAIM_FAILED";
    await report(config, { taskId: task.id, status: "blocked", blocker, summary: "Windows Mimo worker could not stage the claimed task." }).catch(() => undefined);
    throw error;
  }
}

async function execute(config, task) {
  if (task.preflightOnly === true) {
    const unitCreditsPerSecond = Number(task.preflightReadback?.unitCreditsPerSecond);
    const liveEstimate = unitCreditsPerSecond * Number(task.durationSeconds);
    if (!Number.isFinite(unitCreditsPerSecond) || unitCreditsPerSecond <= 0 || !Number.isFinite(liveEstimate) || liveEstimate <= 0) {
      throw new Error("MIMO_PREFLIGHT_COST_READBACK_INVALID");
    }
    await report(config, {
      taskId: task.id,
      status: "preflight",
      providerCostEvidence: { generationType: "image_to_video", liveEstimate },
      summary: "Authenticated Mimo CDP visible pricing readback recorded before any upload or Generate.",
    });
    await heartbeat(config, "idle", null, "Mimo preflight cost recorded; awaiting normal submit-safe claim");
    return;
  }
  const taskDirectory = task.taskDirectory;
  const promptPath = path.join(taskDirectory, "prompt.txt");
  const submitManifest = path.join(taskDirectory, "ledger", "submission-manifest.json");
  const receiptPath = path.join(taskDirectory, "ledger", "submission-receipt.json");
  const syncManifest = path.join(taskDirectory, "ledger", "sync-manifest.json");
  const outputPath = path.join(taskDirectory, "output", "result.mp4");
  const deliveryLedger = path.join(taskDirectory, "ledger", "delivery-ledger.json");
  await writeFile(promptPath, `${task.prompt}\n`, { encoding: "utf8", mode: 0o600 });
  let providerTaskId = task.providerTaskId || null;
  try {
    if (!providerTaskId) {
      const expectedCost = Number(task.costGate?.expected_cost);
      const maximumCost = Number(task.costGate?.maximum_cost ?? task.costGate?.max_cost);
      if (!Number.isFinite(expectedCost) || !Number.isFinite(maximumCost) || maximumCost <= 0) throw new Error("MIMO_PROVIDER_COST_CONTRACT_INVALID");
      const args = ["--prompt-file", promptPath, "--duration", String(task.durationSeconds), "--aspect-ratio", task.aspectRatio, "--generation-type", String(task.generationType || task.generation_type), "--expected-cost", String(expectedCost), "--maximum-cost", String(maximumCost), "--manifest", submitManifest, "--submission-receipt", receiptPath];
      for (const reference of task.references) args.push("--image", reference.localPath);
      let submitError = null;
      try {
        await runHelper(submitter, args, config);
      } catch (error) {
        submitError = error;
      }
      let receipt;
      try {
        receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      } catch (receiptError) {
        throw submitError || receiptError;
      }
      providerTaskId = String(receipt.providerTaskId || "");
      if (!providerTaskId) throw submitError || new Error("MIMO_PROVIDER_TASK_ID_NOT_OBSERVED");
      const submission = JSON.parse(await readFile(submitManifest, "utf8"));
      await report(config, { taskId: task.id, status: "running", providerTaskId, providerCostEvidence: submission.providerCost, progressEvents: ["provider_receipt_observed"], summary: submitError ? "Provider receipt recovered after helper exit; syncing only." : "Official visible Mimo frontend submitted; provider receipt observed." });
    }
    for (let cycle = 1; cycle <= config.syncCycles; cycle += 1) {
      await runHelper(synchronizer, ["--task-id", providerTaskId, "--out", outputPath, "--manifest", syncManifest], config);
      const sync = JSON.parse(await readFile(syncManifest, "utf8"));
      if (sync.downloaded?.path) {
        const mediaProbe = await probeNativeAudioMedia(outputPath, { duration: task.durationSeconds, ...expectedMediaDimensions(task.aspectRatio) }, config.ffprobeBin);
        const submission = await readJsonOr(submitManifest, { providerCost: { generationType: task.generationType || task.generation_type, expectedCost: task.costGate?.expected_cost ?? null, maximumCost: task.costGate?.maximum_cost ?? task.costGate?.max_cost ?? null, liveEstimate: null, balanceBefore: null } });
        const balanceBefore = finiteCostOrNull(submission.providerCost?.balanceBefore);
        const balanceAfter = finiteCostOrNull(sync.balanceAfter);
        const providerCost = { ...submission.providerCost, balanceBefore, balanceAfter, actualCost: balanceBefore !== null && balanceAfter !== null && balanceAfter <= balanceBefore ? balanceBefore - balanceAfter : null };
        await atomicJson(deliveryLedger, { provider: "mimo", providerTaskId, providerCost, submission: { submittedAt: submission.submittedAt ?? null, audio_mode: submission.audio_mode ?? null, reference_audio_required: submission.reference_audio_required === true, reference_audio_count: Number(submission.reference_audio_count ?? 0), native_audio_setting_readback: submission.native_audio_setting_readback ?? null, native_audio_page_readback: submission.native_audio_page_readback ?? null }, sync: { providerCompletedObservedAt: sync.providerCompletedObservedAt ?? null, downloadStartedAt: sync.downloadStartedAt ?? null }, downloaded: sync.downloaded, mediaProbe });
        await report(config, { taskId: task.id, status: "completed", providerTaskId, providerCostEvidence: providerCost, progressEvents: ["provider_completed_observed", "download_started"], summary: "Official visible Mimo frontend downloaded provider media.", outputPath, ledgerPath: deliveryLedger });
        await heartbeat(config, "idle", null, "Mimo output passed media gates and was uploaded for automatic delivery");
        return;
      }
      await report(config, { taskId: task.id, status: "running", providerTaskId, progressEvents: ["provider_progress_observed"], summary: `Provider progress observed at sync ${cycle}/${config.syncCycles}.` });
      await heartbeat(config, "running", task.id, `provider running; sync ${cycle}/${config.syncCycles}`);
      if (cycle < config.syncCycles) await new Promise((resolve) => setTimeout(resolve, config.syncPollMs));
    }
    await report(config, { taskId: task.id, status: "blocked", providerTaskId, blocker: "MIMO_SYNC_WINDOW_EXHAUSTED", summary: "Provider receipt exists; sync window elapsed without media. Reconcile only, do not resubmit." });
  } catch (error) {
    await report(config, { taskId: task.id, status: "blocked", providerTaskId, blocker: error instanceof Error ? error.message : "MIMO_WINDOWS_EXECUTION_FAILED", summary: "Windows Mimo CDP worker stopped safely." }).catch(() => undefined);
    throw error;
  }
}

async function recoverLocalDelivery(config) {
  const taskId = String(argument("--task-id", "")).trim();
  const durationSeconds = Number(argument("--duration", ""));
  const aspectRatio = String(argument("--aspect-ratio", "")).trim();
  if (!taskId) throw new Error("MIMO_LOCAL_DELIVERY_TASK_ID_REQUIRED");
  if (!Number.isFinite(durationSeconds) || durationSeconds < 4 || durationSeconds > 15) throw new Error("MIMO_LOCAL_DELIVERY_DURATION_INVALID");
  if (!["16:9", "9:16"].includes(aspectRatio)) throw new Error("MIMO_LOCAL_DELIVERY_ASPECT_RATIO_INVALID");
  const taskDirectory = path.join(config.workspace, "jobs", taskId);
  const outputPath = path.join(taskDirectory, "output", "result.mp4");
  const submitManifest = path.join(taskDirectory, "ledger", "submission-manifest.json");
  const receiptPath = path.join(taskDirectory, "ledger", "submission-receipt.json");
  const syncManifest = path.join(taskDirectory, "ledger", "sync-manifest.json");
  const deliveryLedger = path.join(taskDirectory, "ledger", "delivery-ledger.json");
  const [submission, receipt, sync] = await Promise.all([
    readJsonOr(submitManifest, null),
    readJsonOr(receiptPath, null),
    readJsonOr(syncManifest, null),
  ]);
  if (!submission || !receipt || !sync) throw new Error("MIMO_LOCAL_DELIVERY_EVIDENCE_MISSING");
  const providerTaskId = String(receipt.providerTaskId || "").trim();
  if (!providerTaskId) throw new Error("MIMO_LOCAL_DELIVERY_PROVIDER_RECEIPT_MISMATCH");
  await access(outputPath);
  const mediaProbe = await probeNativeAudioMedia(outputPath, {
    duration: durationSeconds,
    ...expectedMediaDimensions(aspectRatio),
  }, config.ffprobeBin);
  const balanceBefore = finiteCostOrNull(submission.providerCost?.balanceBefore);
  const balanceAfter = finiteCostOrNull(sync.balanceAfter);
  const providerCost = {
    ...(submission.providerCost || {}),
    balanceBefore,
    balanceAfter,
    actualCost: balanceBefore !== null && balanceAfter !== null && balanceAfter <= balanceBefore ? balanceBefore - balanceAfter : null,
  };
  await atomicJson(deliveryLedger, {
    provider: "mimo",
    recovery: "existing_local_result_only",
    providerTaskId,
    providerCost,
    submission: { submittedAt: submission.submittedAt ?? null },
    sync: { providerCompletedObservedAt: sync.providerCompletedObservedAt ?? null, downloadStartedAt: sync.downloadStartedAt ?? null },
    downloaded: sync.downloaded ?? { path: outputPath },
    mediaProbe,
  });
  await report(config, {
    taskId,
    status: "completed",
    providerTaskId,
    providerCostEvidence: providerCost,
    progressEvents: ["provider_completed_observed", "download_started"],
    summary: "Existing local Mimo result recovered for delivery; no Provider submission or polling was performed.",
    outputPath,
    ledgerPath: deliveryLedger,
  });
  await heartbeat(config, "idle", null, "Existing Mimo result recovered into delivery path");
  return { ok: true, taskId, providerTaskId, outputPath, deliveryLedger, mediaProbe };
}

async function runOnce(config) {
  const task = await claim(config);
  if (!task || task.preflightBlocked) return task || { ok: true, task: null };
  await execute(config, task);
  return { ok: true, taskId: task.id };
}

async function runLoop(config) {
  let stopped = false;
  let activeTaskId = null;
  const stop = () => { stopped = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  while (!stopped) {
    try {
      const task = await claim(config);
      if (task && !task.preflightBlocked) {
        activeTaskId = task.id;
        await execute(config, task);
      }
      activeTaskId = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // execute() reports the task-specific failure before it reaches here. Keep
      // the heartbeat bound to that task so the next idle loop cannot hide it.
      await heartbeat(config, "blocked", activeTaskId, message).catch(() => undefined);
      activeTaskId = null;
    }
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, config.claimPollMs));
  }
}

function contractSelfTest() {
  const valid = { channel: "mimo", allowedChannels: ["mimo"], skillRoute: SKILL_ROUTE, submit_allowed: true, generationType: "image_to_video", generation_type: "image_to_video", durationSeconds: 4, resolution: "720P", model: "Seedance 2.0", costGate: { authorized: true, expected_cost: 8, maximum_cost: 8 }, references: [{ refKey: "asset_1", uploadEligible: true, userConfirmation: "confirmed" }], channelReferencePlan: { mimo: { channel: "mimo", max_upload_references: 12, supports_multi_reference: true, selected_reference_keys: ["asset_1"] } } };
  if (selectedReferences(valid).length !== 1) throw new Error("MIMO_CONTRACT_SELF_TEST_VALID_FAILED");
  const textToVideo = { ...valid, generationType: "text_to_video", generation_type: "text_to_video", durationSeconds: 4, costGate: { authorized: true, expected_cost: 4, maximum_cost: 4 }, references: [], channelReferencePlan: { mimo: { ...valid.channelReferencePlan.mimo, selected_reference_keys: [] } } };
  if (selectedReferences(textToVideo).length !== 0) throw new Error("MIMO_CONTRACT_SELF_TEST_TEXT_TO_VIDEO_FAILED");
  const syncOnly = { ...valid, providerTaskId: "provider-1", generationType: "text_to_video", generation_type: "text_to_video", references: [], channelReferencePlan: { mimo: { ...valid.channelReferencePlan.mimo, selected_reference_keys: [] } } };
  if (selectedReferences(syncOnly).length !== 0) throw new Error("MIMO_CONTRACT_SELF_TEST_SYNC_ONLY_FAILED");
  for (const rejected of [{ ...valid, channel: "dola" }, { ...valid, allowedChannels: ["mimo", "dola"] }, { ...valid, submit_allowed: false }, { ...valid, durationSeconds: 16 }, { ...textToVideo, costGate: { authorized: true, expected_cost: 0, maximum_cost: 0 } }, { ...valid, channelReferencePlan: { mimo: { ...valid.channelReferencePlan.mimo, selected_reference_keys: [] } } }]) {
    let rejectedClosed = false;
    try { selectedReferences(rejected); } catch { rejectedClosed = true; }
    if (!rejectedClosed) throw new Error("MIMO_CONTRACT_SELF_TEST_REJECTION_FAILED");
  }
  process.stdout.write("MIMO_WINDOWS_AGENT_CONTRACT_SELF_TEST_PASS\n");
}

try {
  const selected = command();
  if (selected === "contract-self-test") contractSelfTest();
  else if (selected === "help" || selected === "--help" || selected === "-h") process.stdout.write("Windows Mimo CDP worker: preflight | heartbeat | run-once | run-loop | recover-local-delivery | contract-self-test\n");
  else {
    const config = settings();
    if (selected === "preflight" || selected === "heartbeat") process.stdout.write(`${JSON.stringify(await preflight(config, true))}\n`);
    else if (selected === "run-once") process.stdout.write(`${JSON.stringify(await runOnce(config))}\n`);
    else if (selected === "run-loop") await runLoop(config);
    else if (selected === "recover-local-delivery") process.stdout.write(`${JSON.stringify(await recoverLocalDelivery(config))}\n`);
    else throw new Error("COMMAND_INVALID");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
