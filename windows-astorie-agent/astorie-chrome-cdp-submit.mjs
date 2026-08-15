#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { connectAStorieChrome, disconnectAStorieCdp, visibleAStorieState } from "./astorie-chrome-cdp.mjs";

function flag(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
const config = { promptFile: flag("--prompt-file"), image: flag("--image"), duration: Number(flag("--duration")), aspectRatio: flag("--aspect-ratio"), maxCost: Number(flag("--maximum-cost")), manifest: flag("--manifest"), receipt: flag("--receipt") };
function fail(code) { throw new Error(`ASTORIE_CDP_SUBMIT:${code}`); }

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const candidate = page.locator(selector).first();
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function chooseVisibleOption(page, value, labels) {
  const control = await firstVisible(page, ["select", "[role=combobox]", "button"]);
  const target = page.getByText(value, { exact: false }).filter({ visible: true }).first();
  if (await target.isVisible().catch(() => false)) { await target.click(); return; }
  if (control && await control.isVisible().catch(() => false)) {
    await control.click().catch(() => undefined);
    const option = page.getByRole("option", { name: value }).first();
    if (await option.isVisible().catch(() => false)) { await option.click(); return; }
  }
  if (!labels.some((label) => new RegExp(label, "i").test(value))) fail(`SETTING_NOT_VISIBLE:${value}`);
}

async function main() {
  if (!config.promptFile || !config.manifest || !config.receipt || !Number.isInteger(config.duration) || config.duration < 4 || config.duration > 15 || !["9:16", "16:9"].includes(config.aspectRatio)) fail("INVALID_ARGUMENTS");
  const prompt = (await readFile(config.promptFile, "utf8")).trim();
  if (!prompt) fail("PROMPT_EMPTY");
  const { browser, page } = await connectAStorieChrome();
  try {
    const initial = await visibleAStorieState();
    if (!initial.authenticated) fail("LOGIN_REQUIRED");
    if (!initial.seedanceMiniVisible) fail("SEEDANCE_MINI_NODE_NOT_VISIBLE");
    const editor = await firstVisible(page, ['textarea[placeholder*="Describe the video"]', "textarea", "[contenteditable=true]"]);
    if (!editor) fail("PROMPT_EDITOR_MISSING");
    await editor.fill(prompt);
    const node = editor.locator("xpath=ancestor::div[.//button[@aria-label='Generate']][1]");
    if (config.image) {
      const input = page.locator('input[type="file"]').first();
      if (!await input.isVisible().catch(() => false)) fail("IMAGE_UPLOAD_MISSING");
      await input.setInputFiles(path.resolve(config.image));
    }
    const model = node.getByRole("button", { name: /Seedance\s*2\.0\s*Mini/i }).first();
    if (!await model.isVisible().catch(() => false)) fail("SEEDANCE_MINI_NODE_NOT_VISIBLE");
    const resolution = node.getByRole("combobox").filter({ hasText: /^720p$/i }).first();
    if (!await resolution.isVisible().catch(() => false)) fail("RESOLUTION_720P_NOT_SELECTED");
    const duration = node.getByRole("combobox").filter({ hasText: /^\d+s$/i }).first();
    if (!await duration.isVisible().catch(() => false)) fail("DURATION_CONTROL_MISSING");
    if ((await duration.innerText()).trim().toLowerCase() !== `${config.duration}s`) {
      await duration.click();
      const option = page.getByRole("option", { name: `${config.duration}s`, exact: true }).first();
      if (!await option.isVisible().catch(() => false)) fail(`DURATION_OPTION_MISSING:${config.duration}s`);
      await option.click();
    }
    const ratio = node.getByRole("button").filter({ hasText: /^(?:9:16|16:9|1:1|4:3|3:4|21:9|Auto)$/ }).first();
    if (!await ratio.isVisible().catch(() => false)) fail("ASPECT_RATIO_CONTROL_MISSING");
    if ((await ratio.innerText()).trim() !== config.aspectRatio) {
      await ratio.click();
      const option = page.getByRole("option", { name: config.aspectRatio, exact: true }).first();
      if (!await option.isVisible().catch(() => false)) fail(`ASPECT_RATIO_OPTION_MISSING:${config.aspectRatio}`);
      await option.click();
    }
    const before = await visibleAStorieState();
    const visible = await page.locator("body").innerText();
    const price = Number((await model.innerText()).match(/(?:^|\s)(\d+(?:\.\d+)?)\s*$/)?.[1] ?? visible.match(/(?:费用|消耗|credits?)\D{0,12}(\d+(?:\.\d+)?)/i)?.[1] ?? NaN);
    if (!Number.isFinite(price) || price < 0 || price > config.maxCost) fail("VISIBLE_PRICE_NOT_AUTHORIZED");
    const generate = node.getByRole("button", { name: /生成|generate/i }).first();
    if (!await generate.isVisible().catch(() => false) || await generate.isDisabled()) fail("GENERATE_UNAVAILABLE");
    const canvasNodeId = await node.getAttribute("data-node-id");
    if (!canvasNodeId || !/^n_[A-Za-z0-9_-]+$/.test(canvasNodeId)) fail("CANVAS_NODE_ID_NOT_OBSERVED");
    const canvasNode = page.locator(`.react-flow__node[data-id="${canvasNodeId}"]`).first();
    const baselineMediaUrls = await canvasNode.locator("video").evaluateAll((videos) => [...new Set(videos.map((video) => video.currentSrc || video.src).filter(Boolean))]);
    const generateClickedAt = new Date().toISOString();
    await generate.click();
    await page.waitForTimeout(3_000);
    const afterText = await page.locator("body").innerText();
    const requestId = [...afterText.matchAll(/\breq_[A-Za-z0-9_-]+\b/g)].map((match) => match[0]).at(-1)
      || `astorie:${before.projectId}/${canvasNodeId}`;
    const submissionObservedAt = new Date().toISOString();
    const [width, height] = config.aspectRatio === "9:16" ? [720, 1280] : [1280, 720];
    const receipt = { providerTaskId: requestId, projectId: before.projectId, projectUrl: page.url(), nodeId: canvasNodeId, submittedAt: generateClickedAt, generateClickedAt, submissionObservedAt, baselineMediaUrls, channel: "astorie", submitPath: "chrome_cdp_visible_canvas", durationSeconds: config.duration, width, height, actualCost: price, providerCost: { actualVisiblePrice: price, balanceBefore: before.credits } };
    await writeFile(config.receipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    await writeFile(config.manifest, `${JSON.stringify({ ...receipt, promptSha256: createHash("sha256").update(prompt).digest("hex"), model: "Seedance 2.0 Mini", resolution: "720P", durationSeconds: config.duration, aspectRatio: config.aspectRatio, referenceSha256: config.image ? createHash("sha256").update(await readFile(config.image)).digest("hex") : null }, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally { void disconnectAStorieCdp(browser); }
}
main().then(() => process.exit(0)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
