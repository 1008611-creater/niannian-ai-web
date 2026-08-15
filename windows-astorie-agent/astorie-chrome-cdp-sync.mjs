#!/usr/bin/env node

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connectAStorieChrome, disconnectAStorieCdp } from "./astorie-chrome-cdp.mjs";

function flag(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
const config = { receipt: flag("--receipt"), out: flag("--out"), manifest: flag("--manifest") };
function fail(code) { throw new Error(`ASTORIE_CDP_SYNC:${code}`); }

async function main() {
  if (!config.receipt || !config.out || !config.manifest) fail("INVALID_ARGUMENTS");
  const receipt = JSON.parse(await readFile(config.receipt, "utf8"));
  if (!/^(?:req_[A-Za-z0-9_-]+|astorie:[A-Za-z0-9._:/?&=%-]+)$/.test(String(receipt.providerTaskId || "")) || !/^n_[A-Za-z0-9_-]+$/.test(String(receipt.nodeId || ""))) fail("RECEIPT_ID_INVALID");
  const { browser, page } = await connectAStorieChrome();
  try {
    const requestId = receipt.providerTaskId;
    const promptNode = page.locator(`[data-node-id="${receipt.nodeId}"][data-role="prompt-input"]`).first();
    const canvasNode = page.locator(`.react-flow__node[data-id="${receipt.nodeId}"]`).first();
    if (!await promptNode.isVisible().catch(() => false) || !await canvasNode.isVisible().catch(() => false)) fail("SAME_REQUEST_NOT_VISIBLE");
    const text = await canvasNode.innerText().catch(() => promptNode.innerText().catch(() => page.locator("body").innerText()));
    const baselineMediaUrls = Array.isArray(receipt.baselineMediaUrls) ? receipt.baselineMediaUrls.map(String) : null;
    const mediaUrls = await canvasNode.locator("video").evaluateAll((videos) => [...new Set(videos.map((video) => video.currentSrc || video.src).filter(Boolean))]);
    const mediaUrl = baselineMediaUrls ? mediaUrls.find((url) => !baselineMediaUrls.includes(url)) : mediaUrls[0];
    if (!mediaUrl) {
      await writeFile(config.manifest, `${JSON.stringify({ provider: "astorie", providerTaskId: requestId, syncPath: "chrome_cdp_visible_canvas", completed: false, baselineMediaCount: baselineMediaUrls?.length ?? null, visibleMediaCount: mediaUrls.length, visibleText: String(text).slice(0, 1000) }, null, 2)}\n`, { mode: 0o600 });
      return;
    }
    let parsed;
    try { parsed = new URL(mediaUrl); } catch { fail("SAME_MEDIA_URL_INVALID"); }
    if (parsed.protocol !== "https:" || parsed.hostname !== "s3.astorie.ai" || !/^\/req\/req_[A-Za-z0-9_-]+\/\d+\.mp4$/.test(parsed.pathname)) fail("SAME_MEDIA_URL_INVALID");
    await mkdir(path.dirname(path.resolve(config.out)), { recursive: true });
    const download = page.locator(`[data-node-id="${receipt.nodeId}"][data-chrome-kind="action-bar"]`).getByRole("button", { name: /下载|download/i }).or(page.locator(`[data-node-id="${receipt.nodeId}"][data-chrome-kind="action-bar"]`).getByRole("link", { name: /下载|download/i })).first();
    let suggestedFilename = null;
    const downloadStartedAt = new Date().toISOString();
    if (await download.isVisible().catch(() => false) && await download.isEnabled().catch(() => false) && await download.getAttribute("aria-disabled") !== "true") {
      const [event] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), download.click()]).catch(() => fail("SAME_MEDIA_DOWNLOAD_NOT_OBSERVED"));
      await event.saveAs(path.resolve(config.out));
      suggestedFilename = event.suggestedFilename();
    } else {
      const response = await browser.contexts()[0].request.get(parsed.href, { timeout: 60_000 });
      if (!response.ok() || !/^video\//i.test(response.headers()["content-type"] || "")) fail("SAME_MEDIA_DOWNLOAD_FAILED");
      await writeFile(path.resolve(config.out), await response.body(), { mode: 0o600 });
      suggestedFilename = path.basename(parsed.pathname);
    }
    const downloadedAt = new Date().toISOString();
    const providerCompletedObservedAt = downloadStartedAt;
    const generationStartedAt = receipt.generateClickedAt || receipt.submittedAt || null;
    const generationDurationMs = generationStartedAt ? Date.parse(providerCompletedObservedAt) - Date.parse(generationStartedAt) : null;
    const providerRequestId = mediaUrl.match(/\/req\/(req_[A-Za-z0-9_-]+)\//)?.[1] || null;
    await writeFile(config.manifest, `${JSON.stringify({ provider: "astorie", providerTaskId: requestId, providerRequestId, syncPath: "chrome_cdp_visible_canvas", completed: true, providerCompletedObservedAt, generationDurationMs: Number.isFinite(generationDurationMs) && generationDurationMs >= 0 ? generationDurationMs : null, downloadedAt, transferDurationMs: Date.parse(downloadedAt) - Date.parse(downloadStartedAt), downloaded: { path: path.resolve(config.out), suggestedFilename, mediaUrl } }, null, 2)}\n`, { mode: 0o600 });
  } finally { void disconnectAStorieCdp(browser); }
}
main().then(() => process.exit(0)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
