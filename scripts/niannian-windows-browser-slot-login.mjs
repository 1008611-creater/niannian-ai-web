#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { pathToFileURL } from "node:url";

const flag = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const slotId = String(flag("--slot") || "");
if (!/^account-slot-\d{3}$/.test(slotId)) throw new Error("BROWSER_SLOT_ID_INVALID");
const port = 9300 + Number(slotId.slice(-3));

const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
await once(process.stdin, "end");
const credentialBuffer = Buffer.concat(chunks);
let credential;
try {
  credential = JSON.parse(credentialBuffer.toString("utf8"));
} catch {
  throw new Error("BROWSER_SLOT_CREDENTIAL_NOT_AVAILABLE");
} finally {
  credentialBuffer.fill(0);
  chunks.forEach((chunk) => chunk.fill(0));
}
const username = String(credential?.username || "");
const password = String(credential?.password || "");
const expectedFingerprint = String(credential?.accountFingerprint || "");
const profileDirectory = path.join(os.homedir(), "niannian-browser-slots", "profiles", slotId);
const authenticatedMarker = path.join(profileDirectory, ".authenticated-account-fingerprint");
let currentStage = "credential_loaded";
credential = null;
if (!username || !password || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) throw new Error("BROWSER_SLOT_CREDENTIAL_NOT_AVAILABLE");
if (createHash("sha256").update(username.toLowerCase()).digest("hex") !== expectedFingerprint) throw new Error("BROWSER_SLOT_CREDENTIAL_ACCOUNT_MISMATCH");

async function runtime() {
  for (const candidate of [
    process.env.NIANNIAN_BROWSER_SLOT_PLAYWRIGHT,
    path.resolve(path.dirname(process.argv[1]), "..", "node_modules", "playwright-core", "index.js"),
  ].filter(Boolean)) { try { return await import(pathToFileURL(candidate).href); } catch {} }
  throw new Error("BROWSER_SLOT_PLAYWRIGHT_MISSING");
}

async function login() {
  currentStage = "playwright_loading";
  const loaded = await runtime();
  const chromium = loaded.chromium || loaded.default?.chromium;
  let browser;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
      browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  if (!browser) throw new Error("BROWSER_SLOT_CDP_UNAVAILABLE");
  currentStage = "cdp_connected";
  const context = browser.contexts()[0];
  const pages = context.pages();
  let page = pages.find((candidate) => {
    try { return ["accounts.google.com", "myaccount.google.com"].includes(new URL(candidate.url()).hostname); } catch { return false; }
  }) || pages.at(-1) || await context.newPage();
  page.setDefaultNavigationTimeout(12_000);
  const marker = await readFile(authenticatedMarker, "utf8").catch(() => "");
  if (marker.trim() !== expectedFingerprint) {
    await context.clearCookies();
    page = await context.newPage();
    await page.goto("https://accounts.google.com/", { waitUntil: "commit", timeout: 12_000 }).catch(() => {});
    currentStage = "cookies_cleared";
  }
  const currentAccountMatches = async () => {
    const readIdentifiers = () => page.locator('[data-email], [data-identifier], [aria-label*="@"]')
      .evaluateAll((nodes) => nodes.flatMap((node) => [node.getAttribute("data-email"), node.getAttribute("data-identifier"), node.getAttribute("aria-label")]).filter(Boolean))
      .catch(() => []);
    let values = await readIdentifiers();
    if (!values.some((value) => String(value).toLowerCase().includes(username.toLowerCase()))) {
      await page.goto("https://accounts.google.com/SignOutOptions", { waitUntil: "domcontentloaded" }).catch(() => {});
      values = await readIdentifiers();
    }
    if (values.some((value) => String(value).toLowerCase().includes(username.toLowerCase()))) return true;
    await page.goto("https://myaccount.google.com/personal-info", { waitUntil: "domcontentloaded" }).catch(() => {});
    const personalInfo = await page.locator("body").innerText().catch(() => "");
    if (personalInfo.toLowerCase().includes(username.toLowerCase())) return true;
    await page.goto("https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard", { waitUntil: "domcontentloaded" }).catch(() => {});
    const accountList = await page.locator("body").innerText().catch(() => "");
    return accountList.toLowerCase().includes(username.toLowerCase());
  };
  try {
  const loginEntry = marker.trim() === expectedFingerprint
    ? "https://myaccount.google.com/"
    : "https://accounts.google.com/";
  let existingHost = "";
  try { existingHost = new URL(page.url()).hostname; } catch {}
  const alreadyAtEntry = marker.trim() === expectedFingerprint
    ? existingHost === "myaccount.google.com"
    : existingHost === "accounts.google.com";
  if (marker.trim() === expectedFingerprint && !alreadyAtEntry) {
    await page.evaluate((target) => window.location.assign(target), loginEntry).catch(() => {});
  }
  await page.waitForTimeout(3000);
  currentStage = "login_entry_loaded";
  let entryHost = "";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let candidate = "";
    try { candidate = new URL(page.url()).hostname; } catch {}
    if (candidate === "accounts.google.com" || candidate === "myaccount.google.com") { entryHost = candidate; break; }
    await page.waitForTimeout(500);
  }
  if (!entryHost) throw new Error("GOOGLE_LOGIN_NETWORK_FAILED");
  currentStage = "login_host_resolved";
  if (!entryHost.endsWith("accounts.google.com")) {
    const verifiedHost = entryHost;
    if (verifiedHost !== "myaccount.google.com") throw new Error("GOOGLE_LOGIN_NETWORK_FAILED");
    if (marker.trim() !== expectedFingerprint) {
      await mkdir(profileDirectory, { recursive: true });
      await writeFile(authenticatedMarker, expectedFingerprint, { encoding: "utf8", mode: 0o600 });
    }
    return { slotId, authenticated: true, urlHost: verifiedHost };
  }
  currentStage = "verification_probe";
  const verification = page.locator('input[name="totpPin"], input[name="idvPin"], input[autocomplete="one-time-code"], iframe[title*="challenge"]').first();
  if (await verification.isVisible().catch(() => false)) throw new Error("GOOGLE_LOGIN_VERIFICATION_REQUIRED");
  currentStage = "verification_absent";
  let email = page.locator('#identifierId, input[name="identifier"], input[autocomplete="username"], input[type="email"]').first();
  await email.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (!await email.isVisible().catch(() => false)) {
    currentStage = "account_chooser_probe";
    const useAnother = page.getByText(/Use another account|使用其他账号/, { exact: false }).first();
    const signIn = page.locator('a[href*="ServiceLogin"], a[href*="/signin/"]').first();
    if (await useAnother.isVisible().catch(() => false)) { currentStage = "account_chooser_click"; await useAnother.click(); }
    else if (await signIn.isVisible().catch(() => false)) { currentStage = "signin_link_click"; await signIn.click(); }
    await page.waitForTimeout(1500);
    currentStage = "email_reprobe";
    email = page.locator('#identifierId, input[name="identifier"], input[autocomplete="username"], input[type="email"]').first();
    await email.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  }
  let credentialSubmitted = false;
  if (await email.isVisible().catch(() => false)) {
    currentStage = "email_visible";
    await email.fill(username);
    currentStage = "email_filled";
    const identifierNext = page.locator("#identifierNext").first();
    if (await identifierNext.isVisible().catch(() => false)) await identifierNext.click();
    else await page.getByRole("button", { name: /Next|下一步/ }).first().click();
    currentStage = "email_next_clicked";
    await page.waitForTimeout(1200);
    credentialSubmitted = true;
    currentStage = "email_submitted";
  }
  if (await verification.isVisible().catch(() => false)) throw new Error("GOOGLE_LOGIN_VERIFICATION_REQUIRED");
  const passwordInput = page.locator('input[name="Passwd"], input[type="password"]').first();
  await passwordInput.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await passwordInput.isVisible().catch(() => false)) {
    currentStage = "password_visible";
    await passwordInput.fill(password);
    currentStage = "password_filled";
    const passwordNext = page.locator("#passwordNext").first();
    if (await passwordNext.isVisible().catch(() => false)) await passwordNext.click();
    else await page.getByRole("button", { name: /Next|下一步/ }).first().click();
    currentStage = "password_next_clicked";
    await page.waitForURL((url) => !url.hostname.endsWith("accounts.google.com"), { timeout: 15_000 }).catch(() => {});
    credentialSubmitted = true;
    currentStage = "password_submitted";
  }
  if (await verification.isVisible().catch(() => false)) throw new Error("GOOGLE_LOGIN_VERIFICATION_REQUIRED");
  let finalHost = entryHost;
  try { finalHost = new URL(page.url()).hostname || entryHost; } catch {}
  if (finalHost.endsWith("accounts.google.com")) throw new Error("GOOGLE_LOGIN_NOT_COMPLETED");
  if (!credentialSubmitted && marker.trim() !== expectedFingerprint && !await currentAccountMatches()) throw new Error("GOOGLE_ACCOUNT_IDENTITY_MISMATCH");
  await mkdir(profileDirectory, { recursive: true });
  await writeFile(authenticatedMarker, expectedFingerprint, { encoding: "utf8", mode: 0o600 });
  currentStage = "account_verified";
  return { slotId, authenticated: true, urlHost: finalHost };
  } finally {
    browser?._connection?.close();
  }
}

try {
  const result = await login();
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
} catch (error) {
  const known = new Set([
    "BROWSER_SLOT_CREDENTIAL_ACCOUNT_MISMATCH",
    "BROWSER_SLOT_CDP_UNAVAILABLE",
    "GOOGLE_ACCOUNT_IDENTITY_MISMATCH",
    "GOOGLE_LOGIN_NOT_COMPLETED",
    "GOOGLE_LOGIN_NETWORK_FAILED",
    "GOOGLE_LOGIN_VERIFICATION_REQUIRED",
  ]);
  const message = String(error?.message || "");
  const blocker = known.has(message) ? message
    : /ECONNREFUSED|connectOverCDP/.test(message) ? "BROWSER_SLOT_CDP_UNAVAILABLE"
      : /net::ERR_/.test(message) ? "GOOGLE_LOGIN_NETWORK_FAILED"
        : /Target page, context or browser has been closed/.test(message) ? "BROWSER_SLOT_CDP_SESSION_CLOSED"
          : /Timeout/i.test(message) ? "GOOGLE_LOGIN_TIMEOUT"
            : /Cannot read properties/.test(message) ? "BROWSER_SLOT_LOGIN_RUNTIME_INVALID"
              : "BROWSER_SLOT_LOGIN_FAILED";
  process.stdout.write(`${JSON.stringify({ slotId, authenticated: false, blocker, stage: currentStage })}\n`, () => process.exit(1));
}
