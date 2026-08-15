#!/usr/bin/env node

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { authenticateMimoPage, connectMimoChrome, disconnectMimoCdp, visibleMimoState } from "./mimo-chrome-cdp.mjs";

function value(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const config = { taskId: value('--task-id'), out: value('--out'), manifest: value('--manifest') };
function fail(code) { throw new Error(`CHROME_CDP_SYNC:${code}`); }

async function openHistory(page) {
  const historyCards = page.locator('.his-card');
  if (await historyCards.first().isVisible().catch(() => false)) return;
  const history = page.locator('button.mini-icon[title="展开 历史记录"]');
  await history.waitFor({ state: 'visible', timeout: 30_000 });
  await history.evaluate((node) => node.click());
  await historyCards.first().waitFor({ state: 'visible', timeout: 10_000 });
}

function taskIdTail(taskId) {
  return String(taskId).slice(-10);
}

// This is intentionally DOM-only. The worker must not synthesize calls to
// Mimo's private status, list, or download APIs. A task that is not visible in
// the official page is reconciled as blocked rather than guessed or resubmitted.
async function visibleTask(page, taskId) {
  await openHistory(page);
  return page.evaluate((id) => {
    const textOf = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
    const tail = String(id).slice(-10);
    const nodes = [...document.querySelectorAll('body *')];
    const exact = nodes
      .filter((node) => textOf(node).includes(id) || node.getAttribute?.('title')?.includes(id) || textOf(node).includes(tail))
      .sort((left, right) => textOf(left).length - textOf(right).length)[0];
    if (!exact) return { found: false, text: '', hasVideo: false, hasDownload: false };
    const container = exact.closest('[data-task-id], [data-id], article, li, section, .task-item, .history-item, .video-item, .his-card') || exact.parentElement || exact;
    const text = textOf(container).slice(0, 2000);
    const videos = [...container.querySelectorAll('video')];
    const links = [...container.querySelectorAll('a[href]')];
    const buttons = [...container.querySelectorAll('button, a')];
    const downloadable = buttons.some((node) => /下载|保存|download/i.test(textOf(node)));
    return {
      found: true,
      text,
      hasVideo: videos.some((node) => Boolean(node.currentSrc || node.getAttribute('src')))
        || links.some((node) => /\.(mp4|mov|webm)(?:$|[?#])/i.test(node.getAttribute('href') || '')),
      hasDownload: downloadable,
    };
  }, taskId);
}

async function downloadVisibleTask(page, taskId, outputPath) {
  await openHistory(page);
  const taskText = page.locator(`.his-id[title*="${taskId}"]`).or(page.getByText(taskIdTail(taskId), { exact: false })).first();
  if (!(await taskText.isVisible().catch(() => false))) fail('VISIBLE_TASK_NOT_FOUND');
  const historyCard = taskText.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " his-card ")][1]');
  const container = await historyCard.count()
    ? historyCard
    : taskText.locator('xpath=ancestor-or-self::*[@data-task-id or @data-id or self::article or self::li or self::section or contains(@class, "task") or contains(@class, "history") or contains(@class, "video")][1]');
  const download = container.getByRole('button', { name: /下载|保存|download/i })
    .or(container.getByRole('link', { name: /下载|保存|download/i })).first();
  if (!(await download.isVisible().catch(() => false))) fail('VISIBLE_DOWNLOAD_CONTROL_NOT_FOUND');
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    download.click(),
  ]).catch(() => fail('VISIBLE_DOWNLOAD_NOT_OBSERVED'));
  await event.saveAs(path.resolve(outputPath));
  return { path: path.resolve(outputPath), suggestedFilename: event.suggestedFilename() };
}

async function main() {
  if (!config.taskId || !config.out || !config.manifest) fail('INVALID_ARGUMENTS');
  const { browser, page } = await connectMimoChrome();
  try {
    const authentication = await authenticateMimoPage(page);
    if (!authentication.authenticated) fail(authentication.blocker);
    const state = await visibleTask(page, config.taskId);
    if (!state.found) fail('VISIBLE_TASK_NOT_FOUND');
    const base = { provider: 'mimo', providerTaskId: config.taskId, visibleTaskText: state.text, syncPath: 'chrome_cdp_visible_frontend' };
    if (!state.hasDownload) {
      await writeFile(config.manifest, `${JSON.stringify(base, null, 2)}\n`, { mode: 0o600 });
      console.log(`task=${config.taskId} visible task is still running`); return;
    }
    const providerCompletedObservedAt = new Date().toISOString();
    const downloadStartedAt = new Date().toISOString();
    const downloaded = await downloadVisibleTask(page, config.taskId, config.out);
    const after = await visibleMimoState();
    const parsedBalance = after.billing?.balance === null ? null : Number(after.billing?.balance);
    await writeFile(config.manifest, `${JSON.stringify({ ...base, providerCompletedObservedAt, downloadStartedAt, balanceAfter: Number.isFinite(parsedBalance) ? parsedBalance : null, downloaded }, null, 2)}\n`, { mode: 0o600 });
    console.log(`task=${config.taskId} visible download saved`);
  } finally {
    disconnectMimoCdp(browser);
  }
}
main().then(
  () => process.exit(0),
  (error) => { console.error(error.message); process.exit(1); },
);
