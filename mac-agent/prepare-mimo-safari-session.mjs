#!/usr/bin/env node

import { readFile, rm, writeFile } from "node:fs/promises";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const webdriver = value("--webdriver") || process.env.NIANNIAN_MIMO_WEBDRIVER_URL || "http://127.0.0.1:4444";
const sessionFile = value("--session-file");
const url = value("--url") || process.env.MIMO_BASE_URL || "https://fd.aancn.cn/";
const username = process.env[value("--username-env") || "MIMO_USERNAME"] || "";
const password = process.env[value("--password-env") || "MIMO_PASSWORD"] || "";
const MAIN_PROMPT_SELECTOR = '[contenteditable="true"][placeholder*="描述视频内容"], textarea[placeholder*="描述视频内容"]';

if (!sessionFile) throw new Error("SESSION_FILE_REQUIRED");

async function request(method, endpoint, body) {
  const response = await fetch(new URL(endpoint, webdriver), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.value?.error) throw new Error(data.value?.message || `${method} ${endpoint} failed (${response.status})`);
  return data.value;
}

async function sessionIsUsable(sessionId) {
  try {
    await request("POST", `/session/${sessionId}/execute/sync`, { script: "return document.readyState;", args: [] });
    return true;
  } catch {
    return false;
  }
}

function elementId(value) {
  return value?.["element-6066-11e4-a52e-4f735466cecf"] || value?.ELEMENT;
}

async function execute(sessionId, script) {
  return request("POST", `/session/${sessionId}/execute/sync`, { script, args: [] });
}

async function find(sessionId, selector) {
  return elementId(await request("POST", `/session/${sessionId}/element`, { using: "css selector", value: selector }));
}

async function keys(sessionId, element, text) {
  await request("POST", `/session/${sessionId}/element/${element}/value`, { text, value: [...text] });
}

async function waitFor(sessionId, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await execute(sessionId, `return Boolean(${predicate});`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function pageState(sessionId) {
  return execute(sessionId, `
    const lines = (document.body?.innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean);
    const evidence = lines.filter((line) => /额度|余额|积分|credits?/i.test(line)).slice(0, 20);
    const localCandidates = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || '';
      if (/token|password|secret|cookie/i.test(key)) continue;
      const raw = localStorage.getItem(key) || '';
      if (raw.length > 4000) continue;
      try {
        const parsed = JSON.parse(raw);
        for (const field of ['credits', 'credit', 'balance', 'points']) {
          if (typeof parsed?.[field] === 'number' || typeof parsed?.[field] === 'string') localCandidates.push(String(parsed[field]));
          if (typeof parsed?.data?.[field] === 'number' || typeof parsed?.data?.[field] === 'string') localCandidates.push(String(parsed.data[field]));
        }
      } catch {}
    }
    const visibleEvidence = evidence.join(' ');
    const visibleMatch = visibleEvidence.match(/(?:额度|余额|积分|credits?)\D{0,16}(\d+(?:\.\d+)?)/i)
      || visibleEvidence.match(/(\d+(?:\.\d+)?)\D{0,8}(?:额度|余额|积分|credits?)/i);
    return {
      generator: Boolean(document.querySelector(${JSON.stringify(MAIN_PROMPT_SELECTOR)}) && document.querySelector('input[type="file"]')),
      login: Boolean(document.querySelector('input[placeholder="输入用户名"]') && document.querySelector('input[placeholder="输入密码"]')),
      tokenPresent: Boolean(localStorage.getItem('token')),
      credits: localCandidates[0] || visibleMatch?.[1] || null,
      title: document.title || '',
      url: location.origin + location.pathname
    };
  `);
}

async function main() {
  const status = await request("GET", "/status");
  if (status.ready !== true) throw new Error("WEBDRIVER_NOT_READY");

  let sessionId = null;
  try {
    const cached = JSON.parse(await readFile(sessionFile, "utf8"));
    if (typeof cached?.sessionId === "string" && await sessionIsUsable(cached.sessionId)) sessionId = cached.sessionId;
  } catch {
    // A missing or dead checkpoint is replaced below. It contains no provider credential.
  }

  if (!sessionId) {
    await rm(sessionFile, { force: true });
    const session = await request("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
    if (!session?.sessionId) throw new Error("WEBDRIVER_SESSION_MISSING");
    sessionId = session.sessionId;
    await writeFile(sessionFile, `${JSON.stringify({ sessionId, createdAt: new Date().toISOString(), purpose: "single_reusable_mimo_visible_session" })}\n`, { mode: 0o600 });
  }

  await request("POST", `/session/${sessionId}/url`, { url });
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  await waitFor(sessionId, `document.querySelector(${JSON.stringify(MAIN_PROMPT_SELECTOR)}) && document.querySelector('input[type="file"]')`, 8_000);
  let page = await pageState(sessionId);
  if (!page.generator && page.login && username && password) {
    await keys(sessionId, await find(sessionId, 'input[placeholder="输入用户名"]'), username);
    await keys(sessionId, await find(sessionId, 'input[placeholder="输入密码"]'), password);
    await execute(sessionId, `
      const input = document.querySelector('input[placeholder="输入用户名"]');
      const button = input?.closest('form')?.querySelector('button[type="submit"]');
      if (!button) throw new Error('login button missing');
      button.click();
    `);
    await waitFor(sessionId, `document.querySelector(${JSON.stringify(MAIN_PROMPT_SELECTOR)}) && document.querySelector('input[type="file"]')`, 30_000);
    page = await pageState(sessionId);
  }
  if (page.generator && page.tokenPresent && !page.credits) {
    // The authenticated generator can become interactive before the balance
    // badge finishes hydrating. Give only that read-only badge a short window
    // so readiness records the visible provider balance instead of null.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    page = await pageState(sessionId);
  }

  // This utility can authenticate the existing approved account, but it has no
  // upload, material mutation, Generate click, or provider-submit code.
  const authenticated = page.generator && page.tokenPresent;
  process.stdout.write(`${JSON.stringify({
    state: authenticated ? "SESSION_READY_GENERATOR" : page.login ? "SESSION_READY_LOGIN" : "SESSION_READY_UNKNOWN",
    authenticated,
    credits: page.credits,
    title: page.title,
    url: page.url,
    sessionIdPresent: true,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`MIMO_SAFARI_SESSION_PREP:${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
