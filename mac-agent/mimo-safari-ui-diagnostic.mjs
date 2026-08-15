#!/usr/bin/env node

import path from "node:path";

const image = process.argv[2] ? path.resolve(process.argv[2]) : "";
const username = process.env.MIMO_USERNAME || "";
const password = process.env.MIMO_PASSWORD || "";
const webdriver = process.env.NIANNIAN_MIMO_WEBDRIVER_URL || "http://127.0.0.1:4444";
const mimoBase = process.env.MIMO_BASE_URL || "https://fd.aancn.cn";

if (!image || !username || !password) throw new Error("DIAGNOSTIC_INPUT_REQUIRED");

async function request(method, endpoint, body) {
  const response = await fetch(new URL(endpoint, webdriver), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.value?.error) throw new Error(`WEBDRIVER:${payload.value?.message || response.status}`);
  return payload.value;
}

function elementId(value) {
  return value["element-6066-11e4-a52e-4f735466cecf"] || value.ELEMENT;
}

async function execute(sessionId, script) {
  return request("POST", `/session/${sessionId}/execute/sync`, { script, args: [] });
}

async function find(sessionId, selector) {
  return elementId(await request("POST", `/session/${sessionId}/element`, { using: "css selector", value: selector }));
}

async function sendKeys(sessionId, element, text) {
  return request("POST", `/session/${sessionId}/element/${element}/value`, { text, value: [...text] });
}

async function waitFor(sessionId, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await execute(sessionId, `return Boolean(${expression});`)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("DIAGNOSTIC_WAIT_TIMEOUT");
}

const session = await request("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
const sessionId = session.sessionId;
try {
  await request("POST", `/session/${sessionId}/url`, { url: new URL("/", mimoBase).toString() });
  await waitFor(sessionId, "document.body && document.body.innerText.length > 0");
  const hasGenerator = await execute(sessionId, "return Boolean(document.querySelector('textarea') && document.querySelector('input[type=\"file\"]')); ");
  if (!hasGenerator) {
    await sendKeys(sessionId, await find(sessionId, 'input[placeholder="输入用户名"]'), username);
    await sendKeys(sessionId, await find(sessionId, 'input[placeholder="输入密码"]'), password);
    await execute(sessionId, "document.querySelector('input[placeholder=\"输入用户名\"]')?.closest('form')?.querySelector('button[type=\"submit\"]')?.click();");
    await waitFor(sessionId, "document.querySelector('textarea') && document.querySelector('input[type=\"file\"]')");
  }
  const input = await find(sessionId, 'input[type="file"]');
  await sendKeys(sessionId, input, image);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await execute(sessionId, "[...document.querySelectorAll('button')].find((button) => button.innerText.includes('上传') && !button.disabled)?.click();");
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  await sendKeys(sessionId, await find(sessionId, 'textarea'), '诊断视频提示词');
  await execute(sessionId, "const selects=[...document.querySelectorAll('select')]; selects[0].value='5'; selects[0].dispatchEvent(new Event('change',{bubbles:true})); selects[1].value='16:9'; selects[1].dispatchEvent(new Event('change',{bubbles:true}));");
  await execute(sessionId, "[...document.querySelectorAll('button')].find((button) => button.innerText.includes('一键检测素材') && !button.disabled)?.click();");
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const result = await execute(sessionId, `
    const input = document.querySelector('input[type="file"]');
    const textarea = document.querySelector('textarea');
    const generate = [...document.querySelectorAll('button')].find((button) => button.innerText.trim().includes('生成视频'));
    return {
      inputFiles: input?.files?.length ?? -1,
      pendingFileNameVisible: Boolean([...document.querySelectorAll('*')].some((node) => node.textContent?.includes(${JSON.stringify(path.basename(image))}))),
      buttons: [...document.querySelectorAll('button')].map((button) => ({ text: button.innerText.trim(), disabled: button.disabled })).filter((button) => /上传|选择|素材|生成/.test(button.text)),
      textareaPresent: Boolean(textarea),
      textareaLength: textarea?.value?.length ?? -1,
      selects: [...document.querySelectorAll('select')].map((select) => select.value),
      generate: generate ? { disabled: generate.disabled, title: generate.getAttribute('title'), ariaDisabled: generate.getAttribute('aria-disabled'), html: generate.outerHTML.slice(0, 500) } : null,
      referenceMarkup: [...document.querySelectorAll('[class*="ref"], [class*="role"], [class*="scene"]')].map((element) => element.outerHTML).filter((html) => /图片1|全局角色|场景/.test(html)).join("\\n").slice(0, 6000),
      controls: [...document.querySelectorAll('input,button')].map((element) => ({ tag: element.tagName, type: element.getAttribute('type'), text: element.innerText?.trim().slice(0, 80), checked: element.checked, disabled: element.disabled, name: element.getAttribute('name') })).filter((control) => control.type === 'checkbox' || /全局|固定|检测/.test(control.text || '')).slice(0, 20),
      body: (document.body?.innerText || '').slice(0, 1400),
    };
  `);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await request("DELETE", `/session/${sessionId}`).catch(() => undefined);
}
