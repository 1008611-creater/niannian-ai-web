#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT = "http://127.0.0.1:9226";
const DEFAULT_ORIGIN = "https://fd.aancn.cn/";
const MAIN_PROMPT_SELECTOR = '[contenteditable="true"][placeholder*="描述视频内容"], textarea[placeholder*="描述视频内容"]';
const USERNAME_SELECTOR = 'input[placeholder="输入用户名"], input[name="username"], input[type="email"]';
const PASSWORD_SELECTOR = 'input[placeholder="输入密码"], input[name="password"], input[type="password"]';
let cachedBrowser = null;

function endpoint(value = process.env.NIANNIAN_MIMO_CDP_URL || DEFAULT_ENDPOINT) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('MIMO_CDP_ENDPOINT_MUST_BE_LOOPBACK');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function playwright() {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const roots = [
    process.env.NIANNIAN_MIMO_CDP_RUNTIME,
    // The candidate archive installs its own production dependency here.
    path.resolve(moduleDirectory, 'node_modules', 'playwright-core'),
    path.resolve(moduleDirectory, '..', 'node_modules', 'playwright-core'),
    path.resolve(process.cwd(), 'node_modules', 'playwright-core'),
  ].filter(Boolean);
  for (const root of roots) {
    try {
      return await import(pathToFileURL(path.join(root, 'index.js')).href);
    } catch {
      // Try the next sealed local runtime. Do not download dependencies at run time.
    }
  }
  throw new Error('MIMO_CDP_RUNTIME_MISSING');
}

export async function connectMimoChrome(options = {}) {
  const loaded = await playwright();
  const chromium = loaded.chromium || loaded.default?.chromium;
  if (!chromium) throw new Error('MIMO_CDP_CHROMIUM_EXPORT_MISSING');
  if (!cachedBrowser?.isConnected()) {
    cachedBrowser = await chromium.connectOverCDP(endpoint(options.endpoint));
    cachedBrowser.once('disconnected', () => { cachedBrowser = null; });
  }
  const browser = cachedBrowser;
  const origin = new URL(options.origin || process.env.MIMO_BASE_URL || DEFAULT_ORIGIN).origin;
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith(origin));
  if (!page) throw new Error('MIMO_CDP_PAGE_MISSING');
  return { browser, page, origin };
}

export function disconnectMimoCdp(browser) {
  // The public close API sends Browser.close and terminates the separately owned
  // Edge process. Close only this Playwright client transport.
  const connection = browser?._connection;
  if (connection && typeof connection.close === 'function') connection.close();
}

export async function nativeAudioState(page, { enable = false } = {}) {
  const candidates = page.locator('label, [role="switch"], button').filter({ hasText: /原生音频|生成音频|音频生成|声音/ })
    .or(page.locator('input[type="checkbox"][aria-label*="音频"], input[type="checkbox"][aria-label*="声音"]'));
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const control = candidates.nth(index);
    if (!await control.isVisible().catch(() => false)) continue;
    const snapshot = async () => control.evaluate((node) => {
      const input = node instanceof HTMLInputElement ? node : node.querySelector('input[type="checkbox"]');
      return ({
      checked: input ? input.checked : node.getAttribute('aria-checked') === 'true' || node.getAttribute('data-state') === 'checked',
      disabled: input ? input.disabled : node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('disabled'),
      text: String(node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    }); });
    let state = await snapshot();
    if (enable && !state.checked && !state.disabled) {
      await control.click();
      await page.waitForTimeout(100);
      state = await snapshot();
    }
    return { capable: true, enabled: state.checked, disabled: state.disabled, readback: state.text || 'visible_native_audio_control' };
  }
  return { capable: false, enabled: false, disabled: null, readback: 'native_audio_control_not_visible' };
}

function configuredCredential() {
  const username = String(process.env.NIANNIAN_MIMO_USERNAME || "").trim();
  const password = String(process.env.NIANNIAN_MIMO_PASSWORD || "");
  if (!username || !password) return null;
  return { username, password };
}

export async function authenticateMimoPage(page) {
  if (await page.locator(MAIN_PROMPT_SELECTOR).first().isVisible().catch(() => false)) return { authenticated: true, blocker: null };
  const usernameInput = page.locator(USERNAME_SELECTOR).first();
  const passwordInput = page.locator(PASSWORD_SELECTOR).first();
  if (!await usernameInput.isVisible().catch(() => false) || !await passwordInput.isVisible().catch(() => false)) {
    return { authenticated: false, blocker: 'MIMO_VISIBLE_FRONTEND_UNAVAILABLE' };
  }
  const credential = configuredCredential();
  if (!credential) return { authenticated: false, blocker: 'MIMO_CREDENTIAL_NOT_CONFIGURED' };
  const verification = page.locator('input[placeholder*="验证码"], input[name*="captcha" i], iframe[src*="captcha" i], [class*="captcha" i]');
  if (await verification.first().isVisible().catch(() => false)) return { authenticated: false, blocker: 'MIMO_LOGIN_VERIFICATION_REQUIRED' };
  await usernameInput.fill(credential.username);
  await passwordInput.fill(credential.password);
  const submit = page.locator('form button[type="submit"], button.submit-btn').first();
  if (!await submit.isVisible().catch(() => false)) return { authenticated: false, blocker: 'MIMO_LOGIN_SUBMIT_UNAVAILABLE' };
  await submit.click();
  const outcome = await Promise.race([
    page.locator(MAIN_PROMPT_SELECTOR).first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'authenticated'),
    verification.first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'verification'),
  ]).catch(() => 'failed');
  if (outcome === 'authenticated') return { authenticated: true, blocker: null };
  if (outcome === 'verification') return { authenticated: false, blocker: 'MIMO_LOGIN_VERIFICATION_REQUIRED' };
  return { authenticated: false, blocker: 'MIMO_LOGIN_FAILED' };
}

export async function visibleMimoState(options = {}) {
  const { page } = await connectMimoChrome(options);
  const authentication = await authenticateMimoPage(page);
  const state = await page.evaluate((selector) => {
      const visibleText = (element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" ? (element.textContent || "").replace(/\s+/g, " ").trim() : "";
      };
      // Only return the numeric billing widgets. Prompt, asset, and account text
      // remain in the browser and are never included in the heartbeat.
      const widgets = Array.from(document.querySelectorAll("button, strong, span, div"))
        .map(visibleText)
        .filter((text) => /(?:积分|credits?)/i.test(text) && text.length <= 80);
      const balanceText = widgets.find((text) => /(?:余额|积分)\s*\d+(?:\.\d+)?\s*(?:积分|credits?)/i.test(text)) || null;
      const pricingText = widgets.find((text) => /\d+(?:\.\d+)?\s*积分\s*\/\s*秒/i.test(text)) || null;
      const balance = balanceText?.match(/(\d+(?:\.\d+)?)\s*(?:积分|credits?)/i)?.[1] || null;
      const unitCreditsPerSecond = pricingText?.match(/(\d+(?:\.\d+)?)\s*积分\s*\/\s*秒/i)?.[1] || null;
      return {
        generator: Boolean(document.querySelector(selector) && document.querySelector('input[type="file"]')),
        login: Boolean(document.querySelector('input[placeholder="输入用户名"]') && document.querySelector('input[placeholder="输入密码"]')),
        title: document.title,
        url: location.origin + location.pathname,
        billing: { balance, unitCreditsPerSecond, observedAt: new Date().toISOString() },
      };
  }, MAIN_PROMPT_SELECTOR);
  const nativeAudio = authentication.authenticated ? await nativeAudioState(page) : { capable: false, enabled: false, disabled: null, readback: 'authentication_required' };
  return { ...state, authentication, nativeAudio };
}
