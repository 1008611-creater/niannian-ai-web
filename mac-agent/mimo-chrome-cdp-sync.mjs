#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { connectMimoChrome } from "./mimo-chrome-cdp.mjs";

function value(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const config = { taskId: value('--task-id'), out: value('--out'), manifest: value('--manifest') };
function fail(code) { throw new Error(`CHROME_CDP_SYNC:${code}`); }
async function sha256(file) { const { readFile } = await import('node:fs/promises'); return createHash('sha256').update(await readFile(file)).digest('hex'); }

async function main() {
  if (!config.taskId || !config.out || !config.manifest) fail('INVALID_ARGUMENTS');
  const { browser, page } = await connectMimoChrome();
  try {
    const state = await page.evaluate(async (taskId) => {
      const request = async (url, body) => {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        return { httpStatus: response.status, body: await response.json().catch(() => ({})) };
      };
      const status = await request('/api/video/batch-status', { taskIds: [taskId] });
      const entries = Array.isArray(status.body?.data) ? status.body.data : [status.body?.data];
      const item = entries.find((entry) => String(entry?.taskId || entry?.id || '') === taskId) || entries[0];
      return { httpStatus: status.httpStatus, item: item || null };
    }, config.taskId);
    if (state.httpStatus < 200 || state.httpStatus >= 300 || !state.item) fail('PROVIDER_TASK_NOT_FOUND');
    const providerStatus = Number(state.item.status);
    const videoUrl = typeof state.item.videoUrl === 'string' ? state.item.videoUrl : '';
    const base = { provider: 'mimo', providerTaskId: config.taskId, finalStatus: { status: providerStatus }, syncPath: 'chrome_cdp_visible_frontend' };
    if ([20, 50, 60].includes(providerStatus) && !videoUrl) {
      await writeFile(config.manifest, `${JSON.stringify(base, null, 2)}\n`, { mode: 0o600 });
      console.log(`task=${config.taskId} status=${providerStatus} running`); return;
    }
    if (providerStatus !== 1 || !videoUrl) fail(`PROVIDER_STATUS_${providerStatus}`);
    if (!/^https:\/\//.test(videoUrl)) fail('VIDEO_URL_INVALID');
    await mkdir(path.dirname(path.resolve(config.out)), { recursive: true });
    const response = await fetch(videoUrl);
    if (!response.ok || !response.body) fail(`DOWNLOAD_FAILED:${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(config.out));
    const downloaded = { path: path.resolve(config.out), sha256: await sha256(config.out) };
    await writeFile(config.manifest, `${JSON.stringify({ ...base, downloaded }, null, 2)}\n`, { mode: 0o600 });
    console.log(`task=${config.taskId} status=${providerStatus} downloaded`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
