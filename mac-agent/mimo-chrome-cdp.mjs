#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT = "http://127.0.0.1:9226";
const DEFAULT_ORIGIN = "https://fd.aancn.cn/";
const MAIN_PROMPT_SELECTOR = '[contenteditable="true"][placeholder*="描述视频内容"], textarea[placeholder*="描述视频内容"]';

function endpoint(value = process.env.NIANNIAN_MIMO_CDP_URL || DEFAULT_ENDPOINT) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('MIMO_CDP_ENDPOINT_MUST_BE_LOOPBACK');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function playwright() {
  const root = process.env.NIANNIAN_MIMO_CDP_RUNTIME
    || path.join(process.env.NIANNIAN_MAC_WORKSPACE || process.env.HOME || '', 'runtime', 'chrome-cdp', 'node_modules', 'playwright-core');
  try {
    return await import(pathToFileURL(path.join(root, 'index.js')).href);
  } catch {
    throw new Error('MIMO_CDP_RUNTIME_MISSING');
  }
}

export async function connectMimoChrome(options = {}) {
  const loaded = await playwright();
  const chromium = loaded.chromium || loaded.default?.chromium;
  if (!chromium) throw new Error('MIMO_CDP_CHROMIUM_EXPORT_MISSING');
  const browser = await chromium.connectOverCDP(endpoint(options.endpoint));
  const origin = new URL(options.origin || process.env.MIMO_BASE_URL || DEFAULT_ORIGIN).origin;
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith(origin));
  if (!page) {
    await browser.close();
    throw new Error('MIMO_CDP_PAGE_MISSING');
  }
  return { browser, page, origin };
}

export async function visibleMimoState(options = {}) {
  const { browser, page } = await connectMimoChrome(options);
  try {
    return await page.evaluate((selector) => ({
      generator: Boolean(document.querySelector(selector) && document.querySelector('input[type="file"]')),
      login: Boolean(document.querySelector('input[placeholder="输入用户名"]') && document.querySelector('input[placeholder="输入密码"]')),
      title: document.title,
      url: location.origin + location.pathname,
    }), MAIN_PROMPT_SELECTOR);
  } finally {
    await browser.close();
  }
}
