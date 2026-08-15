#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function many(flag) {
  return process.argv.flatMap((arg, index) => arg === flag && process.argv[index + 1] ? [process.argv[index + 1]] : []);
}

const config = {
  webdriver: value("--webdriver") || process.env.NIANNIAN_MIMO_WEBDRIVER_URL || "http://127.0.0.1:4444",
  mimoBase: process.env.MIMO_BASE_URL || "https://fd.aancn.cn",
  username: process.env[value("--username-env") || "MIMO_USERNAME"] || "",
  password: process.env[value("--password-env") || "MIMO_PASSWORD"] || "",
  promptFile: value("--prompt-file"),
  images: many("--image"),
  videos: many("--video"),
  duration: Number(value("--duration")),
  aspectRatio: value("--aspect-ratio"),
  manifest: value("--manifest"),
  receipt: value("--submission-receipt"),
  sessionFile: value("--session-file"),
};
// Current Mimo uses a contenteditable prompt editor. Older deployments used
// a textarea; retain that compatibility without mistaking the separate fixed
// camera-language textarea for the task's required prompt.
const MAIN_PROMPT_SELECTOR = '[contenteditable="true"][placeholder*="描述视频内容"], textarea[placeholder*="描述视频内容"], textarea[placeholder*="镜头语言"]';

function fail(message) { throw new Error(`SAFARI_VISIBLE_SUBMIT:${message}`); }
function jsonHeaders() { return { "content-type": "application/json" }; }
async function request(method, endpoint, body) {
  const response = await fetch(new URL(endpoint, config.webdriver), { method, headers: jsonHeaders(), body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.value?.error) fail(data.value?.message || `${method} ${endpoint} failed (${response.status})`);
  return data.value;
}
function elementId(result) { return result["element-6066-11e4-a52e-4f735466cecf"] || result.ELEMENT; }
async function execute(sessionId, script, args = []) { return request("POST", `/session/${sessionId}/execute/sync`, { script, args }); }
async function find(sessionId, selector) { return elementId(await request("POST", `/session/${sessionId}/element`, { using: "css selector", value: selector })); }
async function keys(sessionId, element, text) { await request("POST", `/session/${sessionId}/element/${element}/value`, { text, value: [...text] }); }
async function clickElement(sessionId, element) { await request("POST", `/session/${sessionId}/element/${element}/click`, {}); }
async function waitFor(sessionId, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await execute(sessionId, `return Boolean(${predicate});`);
    if (value) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  fail(`timed out waiting for ${predicate}`);
}

async function waitForOptional(sessionId, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await execute(sessionId, `return Boolean(${predicate});`);
    if (value) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function reusableSession() {
  if (config.sessionFile) {
    try {
      const cached = JSON.parse(await readFile(config.sessionFile, "utf8"));
      if (typeof cached?.sessionId === "string" && cached.sessionId) {
        await execute(cached.sessionId, "return document.readyState;");
        return cached.sessionId;
      }
    } catch {
      await rm(config.sessionFile, { force: true }).catch(() => undefined);
    }
  }
  const session = await request("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
  if (!session?.sessionId) fail("WEBDRIVER_SESSION_MISSING");
  if (config.sessionFile) await writeFile(config.sessionFile, `${JSON.stringify({ sessionId: session.sessionId, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  return session.sessionId;
}

async function pageState(sessionId) {
  return execute(sessionId, `
    const text = document.body?.innerText || '';
    return {
      hasGenerator: Boolean(document.querySelector(${JSON.stringify(MAIN_PROMPT_SELECTOR)}) && document.querySelector('input[type="file"]')),
      hasLogin: Boolean(document.querySelector('input[placeholder="输入用户名"]') && document.querySelector('input[placeholder="输入密码"]')),
      text: text.slice(0, 2000)
    };
  `);
}

function userVisibleFailure(value) {
  return String(value || "")
    .replace(/bearer\s+[a-zA-Z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(password|token|secret|cookie)=\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

async function installPageRequestObserver(sessionId) {
  await execute(sessionId, `
    window.__niannianMimo = { uploadEvents: [], generateEvents: [] };
    const record = (target, url, text) => {
      try {
        const json = JSON.parse(text || '{}');
        const event = {
          code: json.code ?? null,
          id: json.data?.id ?? null,
          uploaded: Boolean(json.data?.imageUri && json.data?.imageUrl),
          message: json.msg ?? json.message ?? null,
        };
        if (String(url).includes('/api/video/upload')) target.uploadEvents.push(event);
        if (String(url).includes('/api/video/generate')) target.generateEvents.push(event);
      } catch {
        if (String(url).includes('/api/video/upload')) target.uploadEvents.push({ code: null, id: null, message: 'upload response unreadable' });
        if (String(url).includes('/api/video/generate')) target.generateEvents.push({ code: null, id: null, message: 'generate response unreadable' });
      }
    };
    const originalFetch = window.fetch;
    if (originalFetch) {
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const url = String(args[0]?.url || args[0] || '');
        if (url.includes('/api/video/upload') || url.includes('/api/video/generate')) {
          response.clone().text().then((text) => record(window.__niannianMimo, url, text)).catch(() => undefined);
        }
        return response;
      };
    }
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__niannianMimoUrl = String(url || '');
      return open.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener('loadend', () => {
        const url = this.__niannianMimoUrl || '';
        if (url.includes('/api/video/upload') || url.includes('/api/video/generate')) record(window.__niannianMimo, url, this.responseText);
      }, { once: true });
      return send.apply(this, args);
    };
  `);
}

async function waitForUploadCount(sessionId, expected, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await execute(sessionId, `return window.__niannianMimo?.uploadEvents || [];`);
    if (state.length >= expected) {
      // The provider has shipped more than one successful upload response
      // shape. The official page itself owns material normalization, so the
      // cross-version success signal here is its explicit code=200 response.
      const failed = state.find((event) => event.code !== 200);
      if (failed) fail(`FRONTEND_UPLOAD_FAILED:${userVisibleFailure(failed.message) || "provider rejected material"}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  fail("FRONTEND_UPLOAD_TIMEOUT");
}

async function clickVisibleButton(sessionId, label) {
  await execute(sessionId, `
    const button = [...document.querySelectorAll('button')].find((item) => item.innerText.trim().includes(${JSON.stringify(label)}) && !item.disabled);
    if (!button) throw new Error(${JSON.stringify(`${label} button missing or disabled`)});
    button.click();
  `);
}

async function clearStaleReferences(sessionId) {
  await execute(sessionId, `
    const button = [...document.querySelectorAll('button')].find((item) => item.innerText.trim() === '清空参考图' && !item.disabled);
    if (button) button.click();
  `);
}

async function ensureUsableViewport(sessionId) {
  try {
    const current = await request("GET", `/session/${sessionId}/window/rect`);
    if (Number(current?.width || 0) < 1_200 || Number(current?.height || 0) < 800) {
      await request("POST", `/session/${sessionId}/window/rect`, { width: 1_440, height: 1_000 });
    }
  } catch {
    // A provider page may still be usable when a WebDriver implementation
    // does not expose window sizing. The normal page readiness checks remain
    // authoritative in that case.
  }
}

async function setMainPrompt(sessionId, prompt) {
  const element = await find(sessionId, MAIN_PROMPT_SELECTOR);
  await clickElement(sessionId, element);
  await keys(sessionId, element, prompt);
  // SafariDriver can update an editable control without emitting the input
  // event consumed by Mimo's Vue model. Re-dispatch after native focus and
  // visible keystrokes so the provider page enables Generate from the same
  // prompt the user sees.
  await execute(sessionId, `
    const promptEditor = document.querySelector(${JSON.stringify(MAIN_PROMPT_SELECTOR)});
    if (!promptEditor) throw new Error('main prompt editor missing');
    promptEditor.dispatchEvent(new Event('input', { bubbles: true }));
    promptEditor.dispatchEvent(new Event('change', { bubbles: true }));
  `);
}

async function main(attempt = 0) {
  if (!config.promptFile || !config.manifest || !config.receipt || !config.images.length || !Number.isInteger(config.duration) || !config.aspectRatio) fail("INVALID_ARGUMENTS");
  if (config.videos.length) fail("VIDEO_REFERENCE_UI_ROUTE_NOT_IMPLEMENTED");
  const prompt = (await readFile(config.promptFile, "utf8")).trim();
  if (!prompt) fail("PROMPT_EMPTY");
  const driver = await request("GET", "/status");
  if (driver.ready !== true) fail("WEBDRIVER_NOT_READY");
  let sessionId = null;
  let submissionClicked = false;
  try {
    sessionId = await reusableSession();
    await ensureUsableViewport(sessionId);
    await request("POST", `/session/${sessionId}/url`, { url: new URL("/", config.mimoBase).toString() });
    await waitFor(sessionId, "document.body && document.body.innerText.length > 0");
    // Mimo leaves login inputs in the DOM while an authenticated generator page
    // is still hydrating. Treating either login input as ready made a valid
    // Safari session look logged out and stopped before any provider request.
    await waitForOptional(sessionId, `document.querySelector(${JSON.stringify(MAIN_PROMPT_SELECTOR)}) && document.querySelector('input[type="file"]')`, 30_000);
    let state = await pageState(sessionId);
    if (!state.hasGenerator) {
      if (!state.hasLogin) fail("LOGIN_OR_GENERATOR_NOT_RENDERED");
      if (!config.username || !config.password) fail("MIMO_CREDENTIAL_ENV_MISSING");
      await keys(sessionId, await find(sessionId, 'input[placeholder="输入用户名"]'), config.username);
      await keys(sessionId, await find(sessionId, 'input[placeholder="输入密码"]'), config.password);
      await execute(sessionId, "const input=document.querySelector('input[placeholder=\"输入用户名\"]'); const button=input?.closest('form')?.querySelector('button[type=\"submit\"]'); if (!button) throw new Error('login button missing'); button.click();");
      await waitFor(sessionId, "document.querySelector('textarea') && document.querySelector('input[type=\"file\"]')", 30_000);
      state = await pageState(sessionId);
    }
    if (!state.hasGenerator) fail("GENERATOR_NOT_READY_AFTER_LOGIN");
    // The official page preserves prior uploads in its live browser session.
    // Each task must start from its own locked reference manifest rather than
    // let a previous failed attempt leak into the next provider payload.
    await clearStaleReferences(sessionId);
    await installPageRequestObserver(sessionId);
    const fileInput = await find(sessionId, 'input[type="file"]');
    for (const image of config.images) await keys(sessionId, fileInput, path.resolve(image));
    // The Mimo Vue handler intentionally clears input.files after it places
    // the selected files into its pending list. Wait on the real enabled page
    // command, not on input.files, so a correctly selected file is not
    // mistaken for an empty selection.
    await waitFor(sessionId, "[...document.querySelectorAll('button')].some((item) => item.innerText.trim().includes('上传') && !item.disabled)");
    await clickVisibleButton(sessionId, "上传");
    await waitForUploadCount(sessionId, config.images.length);
    // The official page receives the upload response before its Vue state has
    // finished moving files from the pending list to active references.
    // Generating during that window leaves its command disabled.
    await waitFor(sessionId, "![...document.querySelectorAll('button')].some((item) => item.innerText.includes('上传中'))", 60_000);
    // Mimo's role-mapping and fixed camera-language inputs are auxiliary. Its
    // generation gate reads the visible video-description editor instead.
    await setMainPrompt(sessionId, prompt);
    await execute(sessionId, `const selects=[...document.querySelectorAll('select')]; selects[0].value=${JSON.stringify(String(config.duration))}; selects[0].dispatchEvent(new Event('change',{bubbles:true})); selects[1].value=${JSON.stringify(config.aspectRatio)}; selects[1].dispatchEvent(new Event('change',{bubbles:true}));`);
    await waitFor(sessionId, "[...document.querySelectorAll('button')].some((item) => item.innerText.trim().includes('生成视频') && !item.disabled)", 30_000);
    submissionClicked = true;
    await clickVisibleButton(sessionId, "生成视频");
    const deadline = Date.now() + 30_000;
    let event = null;
    let body = "";
    while (Date.now() < deadline && !event) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      event = await execute(sessionId, "return window.__niannianMimo.generateEvents.find((item) => item.id) || window.__niannianMimo.generateEvents.at(-1) || null;");
      body = await execute(sessionId, "return document.body.innerText;");
      if (event?.id) break;
    }
    if (!event?.id) fail(event?.message ? `FRONTEND_GENERATE_FAILED:${userVisibleFailure(event.message)}` : body.includes("失败") ? "FRONTEND_GENERATE_FAILED" : "PROVIDER_TASK_ID_NOT_OBSERVED");
    const submittedAt = new Date().toISOString();
    const uploaded = await Promise.all(config.images.map(async (image) => ({ path: path.resolve(image), sha256: createHash("sha256").update(await readFile(image)).digest("hex") })));
    await writeFile(config.receipt, `${JSON.stringify({ providerTaskId: String(event.id), submittedAt, channel: "mimo", submitPath: "safari_visible_frontend" }, null, 2)}\n`, { mode: 0o600 });
    await writeFile(config.manifest, `${JSON.stringify({ provider: "mimo", providerTaskId: String(event.id), submittedAt, submitPath: "safari_visible_frontend", prompt_sha256: createHash("sha256").update(prompt).digest("hex"), duration: config.duration, aspectRatio: config.aspectRatio, uploaded }, null, 2)}\n`, { mode: 0o600 });
    console.log(`submitted task=${event.id}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // A SafariDriver session can disappear while the browser is recovering
    // from an unrelated diagnostic session. Before its visible Generate click
    // this has no provider side effect, so one clean-session retry is safe.
    if (!submissionClicked && attempt === 0 && /\/session\/[^/]+\/.*failed \(404\)/.test(detail)) {
      if (config.sessionFile) await rm(config.sessionFile, { force: true }).catch(() => undefined);
      return main(1);
    }
    throw error;
  } finally {
    // Keep the official Safari session alive across attempts. Closing it after
    // every task is what caused SafariDriver to lose the page mid-workflow.
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
