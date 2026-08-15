#!/usr/bin/env node

import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const command = process.argv[2] || "help";
const value = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const proxyServer = value("--proxy") || process.env.NIANNIAN_BROWSER_SLOT_PROXY || "";
const workspace = path.resolve(process.env.NIANNIAN_BROWSER_SLOT_WORKSPACE || path.join(os.homedir(), "niannian-browser-slots"));
const registryPath = path.resolve(process.env.NIANNIAN_BROWSER_SLOT_REGISTRY || path.join(workspace, "account-slot-registry.json"));
const statePath = path.join(workspace, "state.json");
const lockPath = path.join(workspace, "state.lock");
const maximumActive = Math.min(Math.max(Number(process.env.NIANNIAN_BROWSER_SLOT_MAX_ACTIVE || 2), 1), 8);

function slotId(input) {
  const id = String(input || "").trim();
  if (!/^account-slot-\d{3}$/.test(id)) throw new Error("BROWSER_SLOT_ID_INVALID");
  return id;
}

function slotPort(id) { return 9300 + Number(id.slice(-3)); }
function loginUrl(input) {
  const parsed = new URL(String(input || "https://accounts.google.com/"));
  if (parsed.protocol !== "https:") throw new Error("BROWSER_SLOT_LOGIN_URL_INVALID");
  return parsed.toString();
}

function proxyArgument(input) {
  if (!input) return [];
  const parsed = new URL(input);
  if (!["http:", "socks5:"].includes(parsed.protocol)) throw new Error("BROWSER_SLOT_PROXY_INVALID");
  return [`--proxy-server=${parsed.protocol}//${parsed.host}`];
}

async function exists(target) { try { await access(target); return true; } catch { return false; } }
async function readJson(target, fallback) { try { return JSON.parse(await readFile(target, "utf8")); } catch { return fallback; } }
async function atomicJson(target, data) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

async function withLock(action) {
  await mkdir(workspace, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await mkdir(lockPath); break; } catch {
      const ageMs = Date.now() - (await stat(lockPath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      if (ageMs > 120_000) { await rm(lockPath, { recursive: true, force: true }); continue; }
      if (attempt === 99) throw new Error("BROWSER_SLOT_MANAGER_BUSY");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try { return await action(); } finally { await rm(lockPath, { recursive: true, force: true }); }
}

async function registrySlot(id) {
  const registry = await readJson(registryPath, null);
  const slot = registry?.slots?.find((candidate) => candidate.slotId === id);
  if (!slot || slot.concurrency !== 1) throw new Error("BROWSER_SLOT_NOT_REGISTERED");
  return slot;
}

function edgePath() {
  const candidates = [
    process.env.NIANNIAN_BROWSER_SLOT_EDGE_PATH,
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates;
}

async function waitForCdp(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok && (await response.json()).webSocketDebuggerUrl) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("BROWSER_SLOT_CDP_UNAVAILABLE");
}

async function closeSlot(session) {
  await new Promise((resolve) => {
    const child = spawn("taskkill.exe", ["/PID", String(session.processId), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    child.once("close", resolve); child.once("error", resolve);
  });
}

async function openUrl(port, requestedUrl) {
  await waitForCdp(port, 3000);
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(loginUrl(requestedUrl))}`, { method: "PUT" });
  if (!response.ok) throw new Error("BROWSER_SLOT_NAVIGATION_FAILED");
}

async function activate(idInput, requestedUrl) {
  return withLock(async () => {
    const id = slotId(idInput); await registrySlot(id);
    const state = await readJson(statePath, { version: 1, sessions: {} });
    const current = state.sessions[id];
    if (current) {
      try {
        await openUrl(current.port, requestedUrl);
        current.lastUsedAt = new Date().toISOString(); await atomicJson(statePath, state);
        return current;
      } catch {
        delete state.sessions[id];
        await atomicJson(statePath, state);
      }
    }
    const active = Object.values(state.sessions);
    if (active.length >= maximumActive) {
      const idle = active.filter((session) => !session.activeTaskId).sort((a, b) => String(a.lastUsedAt).localeCompare(String(b.lastUsedAt)))[0];
      if (!idle) throw new Error("BROWSER_SLOT_CAPACITY_BUSY");
      await closeSlot(idle); delete state.sessions[idle.slotId];
    }
    const executable = (await Promise.all(edgePath().map(async (candidate) => await exists(candidate) ? candidate : null))).find(Boolean);
    if (!executable) throw new Error("BROWSER_SLOT_EDGE_MISSING");
    const port = slotPort(id); const profile = path.join(workspace, "profiles", id); await mkdir(profile, { recursive: true });
    const extension = process.env.NIANNIAN_BROWSER_SLOT_EXTENSION ? path.resolve(process.env.NIANNIAN_BROWSER_SLOT_EXTENSION) : null;
    const extensionArgs = extension && await exists(path.join(extension, "manifest.json")) ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : [];
    const child = spawn(executable, [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...proxyArgument(proxyServer), ...extensionArgs, loginUrl(requestedUrl)], { detached: true, stdio: "ignore", windowsHide: false }); child.unref();
    await waitForCdp(port);
    const session = { slotId: id, port, profile, processId: child.pid, activeTaskId: null, activatedAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() };
    state.sessions[id] = session; await atomicJson(statePath, state); return session;
  });
}

async function lease(idInput, taskInput) {
  return withLock(async () => {
    const id = slotId(idInput); const taskId = String(taskInput || "").trim();
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(taskId)) throw new Error("BROWSER_SLOT_TASK_ID_INVALID");
    const state = await readJson(statePath, { version: 1, sessions: {} }); const session = state.sessions[id];
    if (!session) throw new Error("BROWSER_SLOT_NOT_ACTIVE");
    if (session.activeTaskId && session.activeTaskId !== taskId) throw new Error("BROWSER_SLOT_ALREADY_LEASED");
    session.activeTaskId = taskId; session.lastUsedAt = new Date().toISOString(); await atomicJson(statePath, state); return session;
  });
}

async function release(idInput, taskInput) {
  return withLock(async () => {
    const id = slotId(idInput); const state = await readJson(statePath, { version: 1, sessions: {} }); const session = state.sessions[id];
    if (!session) throw new Error("BROWSER_SLOT_NOT_ACTIVE");
    if (session.activeTaskId && session.activeTaskId !== String(taskInput || "")) throw new Error("BROWSER_SLOT_LEASE_MISMATCH");
    session.activeTaskId = null; session.lastUsedAt = new Date().toISOString(); await atomicJson(statePath, state); return session;
  });
}

function selfTest() {
  if (slotPort(slotId("account-slot-001")) !== 9301 || slotPort(slotId("account-slot-086")) !== 9386) throw new Error("BROWSER_SLOT_PORT_CONTRACT_FAILED");
  let rejected = false; try { slotId("../secret"); } catch { rejected = true; } if (!rejected) throw new Error("BROWSER_SLOT_PATH_CONTRACT_FAILED");
  process.stdout.write("BROWSER_SLOT_MANAGER_CONTRACT_SELF_TEST_PASS\n");
}

try {
  if (command === "activate") process.stdout.write(`${JSON.stringify(await activate(value("--slot"), value("--url")))}\n`);
  else if (command === "lease") process.stdout.write(`${JSON.stringify(await lease(value("--slot"), value("--task")))}\n`);
  else if (command === "release") process.stdout.write(`${JSON.stringify(await release(value("--slot"), value("--task")))}\n`);
  else if (command === "status") process.stdout.write(`${JSON.stringify(await readJson(statePath, { version: 1, sessions: {} }))}\n`);
  else if (command === "contract-self-test") selfTest();
  else process.stdout.write("Browser slot manager: activate --slot <id> --url <https-url> [--proxy <http-or-socks5-url>] | lease --slot <id> --task <id> | release --slot <id> --task <id> | status | contract-self-test\n");
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
