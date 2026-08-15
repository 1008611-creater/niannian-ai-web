#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT = "http://127.0.0.1:9236";
const PROJECT_PATH = /^\/(?:[a-z]{2}-[A-Z]{2}\/)?projects\/[^/?#]+/;
const DEFAULT_PROJECT_URL = "https://astorie.ai/projects/a96e0ee3-c4eb-4b34-a201-4c465c5e3ed9";
let cachedBrowser = null;

function isProjectPath(pathname) { return PROJECT_PATH.test(pathname); }

function endpoint(value = process.env.NIANNIAN_ASTORIE_CDP_URL || DEFAULT_ENDPOINT) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("ASTORIE_CDP_ENDPOINT_MUST_BE_LOOPBACK");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function playwright() {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    process.env.NIANNIAN_ASTORIE_CDP_RUNTIME,
    path.resolve(directory, "node_modules", "playwright-core", "index.js"),
    path.resolve(directory, "..", "node_modules", "playwright-core", "index.js"),
    path.resolve(process.cwd(), "node_modules", "playwright-core", "index.js"),
  ].filter(Boolean)) {
    try { return await import(pathToFileURL(candidate).href); } catch { /* sealed local runtime only */ }
  }
  throw new Error("ASTORIE_CDP_RUNTIME_MISSING");
}

export async function connectAStorieChrome(options = {}) {
  const loaded = await playwright();
  const chromium = loaded.chromium || loaded.default?.chromium;
  if (!chromium) throw new Error("ASTORIE_CDP_CHROMIUM_EXPORT_MISSING");
  if (!cachedBrowser?.isConnected()) {
    cachedBrowser = await chromium.connectOverCDP(endpoint(options.endpoint));
    cachedBrowser.once("disconnected", () => { cachedBrowser = null; });
  }
  const page = cachedBrowser.contexts().flatMap((context) => context.pages())
    .find((candidate) => new URL(candidate.url()).hostname === "astorie.ai" && isProjectPath(new URL(candidate.url()).pathname));
  if (!page) throw new Error("ASTORIE_AUTHENTICATED_PROJECT_CANVAS_MISSING");
  return { browser: cachedBrowser, page };
}

export async function ensureAStorieProjectCanvas(options = {}) {
  const projectUrl = new URL(options.projectUrl || process.env.NIANNIAN_ASTORIE_PROJECT_URL || DEFAULT_PROJECT_URL);
  if (projectUrl.protocol !== "https:" || projectUrl.hostname !== "astorie.ai" || !isProjectPath(projectUrl.pathname)) {
    throw new Error("ASTORIE_PROJECT_URL_INVALID");
  }
  const loaded = await playwright();
  const chromium = loaded.chromium || loaded.default?.chromium;
  if (!chromium) throw new Error("ASTORIE_CDP_CHROMIUM_EXPORT_MISSING");
  if (!cachedBrowser?.isConnected()) {
    cachedBrowser = await chromium.connectOverCDP(endpoint(options.endpoint));
    cachedBrowser.once("disconnected", () => { cachedBrowser = null; });
  }
  const context = cachedBrowser.contexts()[0];
  if (!context) throw new Error("ASTORIE_CDP_CONTEXT_MISSING");
  let page = context.pages().find((candidate) => {
    try { return new URL(candidate.url()).hostname === "astorie.ai"; } catch { return false; }
  }) || await context.newPage();
  if (page.url() !== projectUrl.href) await page.goto(projectUrl.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (isProjectPath(new URL(page.url()).pathname)) return { browser: cachedBrowser, page };
  if (!new URL(page.url()).pathname.includes("/auth/login")) throw new Error("ASTORIE_PROJECT_REDIRECT_UNEXPECTED");
  const basicCookies = page.getByRole("button", { name: /使用基础设置|use basic/i }).first();
  if (await basicCookies.isVisible().catch(() => false)) {
    await basicCookies.click({ force: true });
    await basicCookies.waitFor({ state: "hidden", timeout: 5_000 });
  }
  const google = page.getByRole("button", { name: /google/i }).or(page.getByRole("link", { name: /google/i })).first();
  if (!await google.isVisible().catch(() => false)) throw new Error("ASTORIE_GOOGLE_LOGIN_ACTION_MISSING");
  await google.click();
  await page.waitForURL((url) => url.hostname === "astorie.ai" && isProjectPath(url.pathname), { timeout: 90_000 }).catch(() => undefined);
  if (!(new URL(page.url()).hostname === "astorie.ai" && isProjectPath(new URL(page.url()).pathname))) {
    throw new Error("ASTORIE_GOOGLE_LOGIN_REQUIRES_USER_ACTION");
  }
  await page.waitForLoadState("domcontentloaded");
  return { browser: cachedBrowser, page };
}

export async function disconnectAStorieCdp(browser) {
  const connection = browser?._connection;
  if (connection && typeof connection.close === "function") await connection.close();
}

export async function visibleAStorieState(options = {}) {
  const { page } = await connectAStorieChrome(options);
  return page.evaluate(() => {
    const text = (node) => String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
    const body = text(document.body);
    const login = /(?:登录|log\s*in|sign\s*in)/i.test(body) && !/Seedance\s*2\.0\s*Mini/i.test(body);
    const project = location.pathname.match(/\/projects\/([^/?#]+)/)?.[1] || null;
    const credits = body.match(/(?:余额|credits?)\s*[:：]?\s*(\d+(?:\.\d+)?)/i)?.[1] || null;
    return {
      authenticated: !login && Boolean(project), projectId: project, url: location.origin + location.pathname,
      seedanceMiniVisible: /Seedance\s*2\.0\s*Mini/i.test(body), credits: credits === null ? null : Number(credits),
    };
  });
}
