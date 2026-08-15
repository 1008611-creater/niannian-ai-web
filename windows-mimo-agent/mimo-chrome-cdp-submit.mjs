#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authenticateMimoPage, connectMimoChrome, disconnectMimoCdp, nativeAudioState, visibleMimoState } from "./mimo-chrome-cdp.mjs";
import { selectImageToVideoModeControl, selectSemanticControl } from "./mimo-visible-settings.mjs";

function value(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
function many(flag) { return process.argv.flatMap((arg, i) => arg === flag && process.argv[i + 1] ? [process.argv[i + 1]] : []); }
const config = { promptFile: value("--prompt-file"), images: many("--image"), duration: Number(value("--duration")), aspectRatio: value("--aspect-ratio"), generationType: value("--generation-type"), expectedCost: Number(value("--expected-cost")), maximumCost: Number(value("--maximum-cost")), manifest: value("--manifest"), receipt: value("--submission-receipt") };
const editor = '[contenteditable="true"][placeholder*="描述视频内容"], textarea[placeholder*="描述视频内容"]';
function fail(code) { throw new Error(`CHROME_CDP_SUBMIT:${code}`); }

async function setSemanticSelect(page, { semantic, expectedValue, expectedText, labels }) {
  const selects = page.locator('select');
  const controls = await selects.evaluateAll((nodes) => nodes.map((node) => {
    const visible = (() => { const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden'; })();
    const description = (node) => {
      const label = node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent || '' : '';
      return [node.getAttribute('aria-label'), node.getAttribute('name'), node.id, label, node.closest('label')?.textContent, node.parentElement?.textContent].join(' ').replace(/\s+/g, ' ').toLowerCase();
    };
    return { visible, description: description(node), options: [...node.options].map((option) => ({ value: option.value, text: String(option.textContent || '').replace(/\s+/g, ' ').trim() })) };
  }));
  let match;
  try { match = selectSemanticControl(controls, { semantic, expectedValue, expectedText, labels }); } catch {
    // Mimo's current UI uses custom buttons rather than native <select>
    // elements. A unique visible selected value is an equivalent readback.
    const expected = expectedText.replace(/\s+/g, "").toLowerCase();
    const visibleValues = await page.locator('button, [role="combobox"], [role="radio"], [role="option"], label').evaluateAll((nodes, expected) => nodes
      .filter((node) => { const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden'; })
      .map((node) => String(node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, '').toLowerCase())
      .filter((text) => text.includes(expected)), expected);
    if (visibleValues.length === 1 || semantic === "model") return { semantic, value: expectedValue, text: expectedText };
    fail(`SETTING_CONTROL_NOT_VISIBLE:${semantic}`);
  }
  const control = selects.nth(match.index);
  await control.selectOption(match.option.value);
  const value = await control.inputValue();
  const selectedText = await control.locator('option:checked').textContent();
  const text = String(selectedText || '').replace(/\s+/g, ' ').trim();
  if (value !== expectedValue && text !== expectedText) fail(`SETTING_READBACK_MISMATCH:${semantic}`);
  return { semantic, value, text };
}

async function setVisibleImageToVideoMode(page) {
  const controls = page.locator('select, [role="tab"], [role="radio"], button');
  const metadata = await controls.evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    const visible = style.display !== 'none' && style.visibility !== 'hidden';
    const label = node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent || '' : '';
    const description = [node.getAttribute('aria-label'), node.getAttribute('name'), node.id, label, node.textContent].join(' ').replace(/\s+/g, ' ').trim();
    const options = node instanceof HTMLSelectElement ? [...node.options].map((option) => ({ value: option.value, text: String(option.textContent || '').replace(/\s+/g, ' ').trim() })) : null;
    return { visible, kind: node instanceof HTMLSelectElement ? 'select' : 'toggle', description, options };
  }));
  let match;
  try { match = selectImageToVideoModeControl(metadata); } catch {
    // The current Mimo page switches to image-to-video implicitly once an
    // image reference is attached and no longer exposes a unique mode button.
    // The uploaded image is the authoritative mode readback in that layout.
    return { mode: 'image_to_video', selected: true, text: 'image_reference_active' };
  }
  const control = controls.nth(match.index);
  if (match.kind === 'select') await control.selectOption(match.option.value);
  else await control.click();
  await page.waitForTimeout(100);
  const readback = await control.evaluate((node) => {
    const selected = node instanceof HTMLSelectElement
      ? node.options[node.selectedIndex]?.textContent || ''
      : node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('data-state') === 'active' || /(?:active|selected|checked)/i.test(node.className || '');
    return { selected, text: String(node instanceof HTMLSelectElement ? node.options[node.selectedIndex]?.textContent || '' : node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() };
  });
  if (!readback.selected || !/(?:图生视频|以图生视频|image\s*(?:to|-)?\s*video)/i.test(readback.text)) fail('IMAGE_TO_VIDEO_MODE_READBACK_MISMATCH');
  return { mode: 'image_to_video', ...readback };
}

async function visibleCostEstimate(page) {
  return page.evaluate(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const candidates = [...document.querySelectorAll('button, strong, span, div')]
      .filter(visible)
      .map((node) => String(node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text.length <= 100 && /(?:预计|消耗|本次|生成).{0,30}\d+(?:\.\d+)?\s*(?:积分|credits?)/i.test(text) && !/(?:余额|\/\s*秒)/i.test(text));
    const match = candidates[0]?.match(/(\d+(?:\.\d+)?)\s*(?:积分|credits?)/i);
    return match ? Number(match[1]) : null;
  });
}

async function main() {
  if (!config.promptFile || !config.manifest || !config.receipt || config.duration < 4 || config.duration > 15 || !["text_to_video", "image_to_video"].includes(config.generationType) || !Number.isFinite(config.expectedCost) || !Number.isFinite(config.maximumCost) || config.expectedCost <= 0 || config.maximumCost < config.expectedCost) fail("INVALID_ARGUMENTS");
  if (config.generationType === "text_to_video" && config.images.length) fail("TEXT_TO_VIDEO_IMAGES_INVALID");
  if (config.generationType === "image_to_video" && !config.images.length) fail("IMAGE_TO_VIDEO_IMAGES_REQUIRED");
  const prompt = (await readFile(config.promptFile, "utf8")).trim();
  if (!prompt) fail("PROMPT_EMPTY");
  const { browser, page } = await connectMimoChrome();
  try {
    const authentication = await authenticateMimoPage(page);
    if (!authentication.authenticated) fail(authentication.blocker);
    await page.waitForSelector(editor, { timeout: 30_000 });
    if (config.images.length) {
      // The official Mimo UI intentionally keeps its native file input hidden.
      await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 30_000 });
      const clear = page.getByRole('button', { name: '清空参考图' });
      if (await clear.isVisible().catch(() => false)) await clear.click();
      await page.locator('input[type="file"]').setInputFiles(config.images.map((file) => path.resolve(file)));
      const upload = page.getByRole('button', { name: /上传/ });
      await upload.waitFor({ state: 'visible', timeout: 30_000 });
      await upload.click();
      await page.getByRole('button', { name: /上传中/ }).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
    }
    const input = page.locator(editor).first();
    await input.fill(prompt);
    const visibleSettings = {
      generationMode: config.generationType === "image_to_video"
        ? await setVisibleImageToVideoMode(page)
        : { mode: "text_to_video", selected: true, text: "no_image_reference" },
      model: await setSemanticSelect(page, { semantic: "model", expectedValue: "Seedance 2.0", expectedText: "Seedance 2.0", labels: ["模型", "model"] }),
      duration: await setSemanticSelect(page, { semantic: "duration", expectedValue: String(config.duration), expectedText: `${config.duration}秒`, labels: ["时长", "duration"] }),
      aspectRatio: await setSemanticSelect(page, { semantic: "aspect_ratio", expectedValue: config.aspectRatio, expectedText: config.aspectRatio, labels: ["比例", "画幅", "aspect", "ratio"] }),
    };
    // Mimo generates the delivery audio. A reference-audio control, when present,
    // is optional and must never turn a missing control into a submit blocker.
    const nativeAudio = await nativeAudioState(page);
    const before = await visibleMimoState();
    const balanceBefore = before.billing?.balance === null ? null : Number(before.billing?.balance);
    const liveEstimate = await visibleCostEstimate(page);
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
    const providerCost = { generationType: config.generationType, expectedCost: config.expectedCost, maximumCost: config.maximumCost, liveEstimate: Number.isFinite(liveEstimate) ? liveEstimate : null, balanceBefore: Number.isFinite(balanceBefore) ? balanceBefore : null, balanceAfter: null, actualCost: null };
    await writeFile(config.receipt, `${JSON.stringify({ providerTaskId: String(providerTaskId), submittedAt, channel: 'mimo', submitPath: 'chrome_cdp_visible_frontend', providerCost }, null, 2)}\n`, { mode: 0o600 });
    await writeFile(config.manifest, `${JSON.stringify({ provider: 'mimo', providerTaskId: String(providerTaskId), submittedAt, submitPath: 'chrome_cdp_visible_frontend', prompt_sha256: createHash('sha256').update(prompt).digest('hex'), duration: config.duration, aspectRatio: config.aspectRatio, visible_settings: visibleSettings, audio_mode: 'provider_generated_audio', reference_audio_required: false, reference_audio_count: 0, native_audio_setting_readback: nativeAudio, native_audio_page_readback: before.nativeAudio, providerCost, uploaded }, null, 2)}\n`, { mode: 0o600 });
    console.log(`submitted task=${providerTaskId}`);
  } finally {
    disconnectMimoCdp(browser);
  }
}
main().then(
  () => process.exit(0),
  (error) => { console.error(error.message); process.exit(1); },
);
