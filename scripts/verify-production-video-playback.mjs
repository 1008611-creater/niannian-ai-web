import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const taskId = process.argv[2] ?? "SETuGbVQhDCi_2GUXbROtu12";
if (!/^[A-Za-z0-9_-]{12,120}$/.test(taskId)) throw new Error("invalid task ID");
const route = process.argv[3] ?? "edge";
const mediaBase = route === "origin"
  ? `https://origin-canary.cauai.fun/api/internal/media-edge/${taskId}`
  : route === "same-origin"
    ? `https://sd2.cauai.fun/api/internal/media-edge/${taskId}`
  : route === "direct"
    ? `https://media-direct.sd2.cauai.fun/api/internal/media-edge/${taskId}`
    : `https://media.sd2.cauai.fun/local/${taskId}.mp4`;
const remoteScript = `
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const id = '${taskId}';
  const exp = Math.floor(Date.now() / 1000) + 300;
  const secret = fs.readFileSync('/app/data/media-edge-secret', 'utf8').trim();
  const sig = crypto.createHmac('sha256', secret).update(id + '.' + exp + '.0').digest('base64url');
  process.stdout.write(${JSON.stringify(mediaBase)} + '?exp=' + exp + '&sig=' + sig + '&variant=stream-v1');
`;
const encoded = Buffer.from(remoteScript).toString("base64");
const mediaUrl = execFileSync(
  "ssh",
  ["tencent-niannian", `docker exec niannian-ai-video-workbench-app-1 node -e \"eval(Buffer.from('${encoded}','base64').toString())\"`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
).trim();
const directProbe = route !== "edge" ? await fetch(mediaUrl, { headers: { Range: "bytes=0-1023" } }).then((response) => ({
  status: response.status,
  contentType: response.headers.get("content-type"),
  corp: response.headers.get("cross-origin-resource-policy"),
  contentRange: response.headers.get("content-range"),
})) : null;

async function waitFor(page, expression, timeout = 15000) {
  await page.waitForFunction(expression, undefined, { timeout });
}

async function run(label) {
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  const responseEvents = [];
  const requestFailures = [];
  page.on("response", (response) => {
    if (response.url().startsWith(mediaBase)) {
      responseEvents.push({
        status: response.status(),
        cache: response.headers()["cf-cache-status"] ?? null,
        contentRange: response.headers()["content-range"] ?? null,
      });
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(mediaBase)) {
      requestFailures.push(request.failure()?.errorText ?? "unknown");
    }
  });
  const startedAt = Date.now();
  try {
    await page.setContent('<video id="video" muted playsinline preload="metadata"></video>');
    await page.locator("#video").evaluate((video) => {
      window.__playbackEvents = [];
      for (const type of ["loadstart", "loadedmetadata", "canplay", "playing", "waiting", "stalled", "suspend", "ended", "error"]) {
        video.addEventListener(type, () => window.__playbackEvents.push({ type, at: performance.now(), time: video.currentTime }));
      }
    });
    await page.locator("#video").evaluate((video, url) => { video.src = url; video.load(); }, mediaUrl);
    await waitFor(page, () => document.querySelector("#video")?.readyState >= HTMLMediaElement.HAVE_METADATA);
    const metadataMs = Date.now() - startedAt;
    await waitFor(page, () => document.querySelector("#video")?.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
    const canPlayMs = Date.now() - startedAt;
    await page.locator("#video").evaluate(async (video) => { await video.play(); });
    await waitFor(page, () => document.querySelector("#video")?.currentTime > 0.3, 8000);
    const afterStart = await page.locator("#video").evaluate((video) => ({
      currentTime: video.currentTime,
      duration: video.duration,
      readyState: video.readyState,
      networkState: video.networkState,
      error: video.error?.code ?? null,
    }));
    await waitFor(page, () => Boolean(document.querySelector("#video")?.ended), 10000);
    const afterContinuousPlayback = await page.locator("#video").evaluate((video) => ({
      currentTime: video.currentTime,
      ended: video.ended,
      error: video.error?.code ?? null,
    }));
    const playbackEvents = await page.evaluate(() => window.__playbackEvents);
    return {
      label,
      metadataMs,
      canPlayMs,
      startedPlayback: afterStart.currentTime > 0.3,
      startCurrentTime: afterStart.currentTime,
      duration: afterStart.duration,
      playedToEnd: afterContinuousPlayback.ended,
      endCurrentTime: afterContinuousPlayback.currentTime,
      readyState: afterStart.readyState,
      networkState: afterStart.networkState,
      error: afterContinuousPlayback.error ?? afterStart.error,
      responses: responseEvents,
      playbackEvents,
    };
  } catch (error) {
    const state = await page.locator("#video").evaluate((video) => ({
      currentTime: video.currentTime,
      duration: video.duration,
      readyState: video.readyState,
      networkState: video.networkState,
      error: video.error?.code ?? null,
    }));
    return {
      label,
      browserFailure: error instanceof Error ? error.message : String(error),
      ...state,
      responses: responseEvents,
      requestFailures,
    };
  } finally {
    await browser.close();
  }
}

const result = { testedAt: new Date().toISOString(), directProbe, cold: await run("cold"), warm: await run("warm") };
await mkdir(".codex_tmp", { recursive: true });
await writeFile(path.join(".codex_tmp", "production-video-playback-result.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
