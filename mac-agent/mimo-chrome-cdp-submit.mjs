#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { connectMimoChrome } from "./mimo-chrome-cdp.mjs";

function value(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
function many(flag) { return process.argv.flatMap((arg, i) => arg === flag && process.argv[i + 1] ? [process.argv[i + 1]] : []); }
const config = { promptFile: value("--prompt-file"), images: many("--image"), duration: Number(value("--duration")), aspectRatio: value("--aspect-ratio"), manifest: value("--manifest"), receipt: value("--submission-receipt") };
const editor = '[contenteditable="true"][placeholder*="描述视频内容"], textarea[placeholder*="描述视频内容"]';
function fail(code) { throw new Error(`CHROME_CDP_SUBMIT:${code}`); }

async function main() {
  if (!config.promptFile || !config.images.length || !config.manifest || !config.receipt || !Number.isInteger(config.duration) || !config.aspectRatio) fail("INVALID_ARGUMENTS");
  const prompt = (await readFile(config.promptFile, "utf8")).trim();
  if (!prompt) fail("PROMPT_EMPTY");
  const { browser, page } = await connectMimoChrome();
  try {
    await page.waitForSelector(editor, { timeout: 30_000 });
    await page.waitForSelector('input[type="file"]', { timeout: 30_000 });
    const clear = page.getByRole('button', { name: '清空参考图' });
    if (await clear.isVisible().catch(() => false)) await clear.click();
    await page.locator('input[type="file"]').setInputFiles(config.images.map((file) => path.resolve(file)));
    const upload = page.getByRole('button', { name: /上传/ });
    await upload.waitFor({ state: 'visible', timeout: 30_000 });
    await upload.click();
    await page.getByRole('button', { name: /上传中/ }).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
    const input = page.locator(editor).first();
    await input.fill(prompt);
    await page.locator('select').nth(0).selectOption(String(config.duration));
    await page.locator('select').nth(1).selectOption(config.aspectRatio);
    const generate = page.getByRole('button', { name: '生成视频' });
    await generate.waitFor({ state: 'visible', timeout: 30_000 });
    if (await generate.isDisabled()) fail("GENERATE_DISABLED");
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/video/generate') && response.request().method() === 'POST', { timeout: 30_000 });
    await generate.click();
    const response = await responsePromise;
    const body = await response.json().catch(() => ({}));
    const providerTaskId = body?.data?.id;
    if (!response.ok() || !providerTaskId) fail("PROVIDER_TASK_ID_NOT_OBSERVED");
    const submittedAt = new Date().toISOString();
    const uploaded = await Promise.all(config.images.map(async (file) => ({ path: path.resolve(file), sha256: createHash('sha256').update(await readFile(file)).digest('hex') })));
    await writeFile(config.receipt, `${JSON.stringify({ providerTaskId: String(providerTaskId), submittedAt, channel: 'mimo', submitPath: 'chrome_cdp_visible_frontend' }, null, 2)}\n`, { mode: 0o600 });
    await writeFile(config.manifest, `${JSON.stringify({ provider: 'mimo', providerTaskId: String(providerTaskId), submittedAt, submitPath: 'chrome_cdp_visible_frontend', prompt_sha256: createHash('sha256').update(prompt).digest('hex'), duration: config.duration, aspectRatio: config.aspectRatio, uploaded }, null, 2)}\n`, { mode: 0o600 });
    console.log(`submitted task=${providerTaskId}`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
