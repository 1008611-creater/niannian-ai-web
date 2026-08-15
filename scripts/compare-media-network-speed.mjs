import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const taskId = process.argv[2] ?? "aPh_FVncAV5fdhK3z8lCrCTv";
if (!/^[A-Za-z0-9_-]{12,120}$/.test(taskId)) throw new Error("invalid task ID");

const routes = {
  direct: `https://media-direct.sd2.cauai.fun/api/internal/media-edge/${taskId}`,
  cloudflare: `https://media.sd2.cauai.fun/local/${taskId}.mp4`,
};
const curlFormat = JSON.stringify({
  status: "%{http_code}",
  dns: "%{time_namelookup}",
  connect: "%{time_connect}",
  tls: "%{time_appconnect}",
  ttfb: "%{time_starttransfer}",
  total: "%{time_total}",
  bytes: "%{size_download}",
  bytesPerSecond: "%{speed_download}",
  contentType: "%{content_type}",
});

function signedUrl(base) {
  const script = `
    const fs = require('node:fs');
    const crypto = require('node:crypto');
    const id = ${JSON.stringify(taskId)};
    const exp = Math.floor(Date.now() / 1000) + 300;
    const secret = fs.readFileSync('/app/data/media-edge-secret', 'utf8').trim();
    const sig = crypto.createHmac('sha256', secret).update(id + '.' + exp + '.0').digest('base64url');
    process.stdout.write(${JSON.stringify(base)} + '?exp=' + exp + '&sig=' + sig + '&variant=stream-v1');
  `;
  const encoded = Buffer.from(script).toString("base64");
  return execFileSync("ssh", ["tencent-niannian", `docker exec niannian-ai-video-workbench-app-1 node -e "eval(Buffer.from('${encoded}','base64').toString())"`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function normalize(raw) {
  const value = JSON.parse(raw.trim());
  const seconds = (name) => Number(value[name]);
  return {
    status: Number(value.status),
    dnsMs: Math.round(seconds("dns") * 1000),
    tcpMs: Math.round((seconds("connect") - seconds("dns")) * 1000),
    tlsMs: Math.round((seconds("tls") - seconds("connect")) * 1000),
    ttfbMs: Math.round(seconds("ttfb") * 1000),
    totalMs: Math.round(seconds("total") * 1000),
    bytes: Number(value.bytes),
    mbps: Number(((Number(value.bytesPerSecond) * 8) / 1_000_000).toFixed(2)),
    contentType: value.contentType,
  };
}

function localProbe(url) {
  return normalize(execFileSync("curl.exe", ["-sS", "--range", "0-", "-o", "NUL", "-w", curlFormat, url], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function overseasProbe(url) {
  const command = `curl -sS --range 0- -o /dev/null -w '${curlFormat}' '${url}'`;
  return normalize(execFileSync("ssh", ["tencent-niannian", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function summarize(samples) {
  return {
    runs: samples.length,
    status: [...new Set(samples.map((sample) => sample.status))],
    bytes: [...new Set(samples.map((sample) => sample.bytes))],
    medianDnsMs: median(samples.map((sample) => sample.dnsMs)),
    medianTcpMs: median(samples.map((sample) => sample.tcpMs)),
    medianTlsMs: median(samples.map((sample) => sample.tlsMs)),
    medianTtfbMs: median(samples.map((sample) => sample.ttfbMs)),
    medianTotalMs: median(samples.map((sample) => sample.totalMs)),
    fastestTotalMs: Math.min(...samples.map((sample) => sample.totalMs)),
    slowestTotalMs: Math.max(...samples.map((sample) => sample.totalMs)),
    medianMbps: median(samples.map((sample) => sample.mbps)),
  };
}

const samples = {};
for (const [route, base] of Object.entries(routes)) {
  const url = signedUrl(base);
  samples[route] = { domesticClient: [], seoulServer: [] };
  for (let index = 0; index < 5; index += 1) {
    samples[route].domesticClient.push(localProbe(url));
    samples[route].seoulServer.push(overseasProbe(url));
  }
}

const result = {
  capturedAt: new Date().toISOString(),
  mediaPath: `/media/${taskId}`,
  playbackVariant: "playback-mp4",
  probes: {
    domesticClient: "current Windows client network",
    seoulServer: "production server network in Seoul",
  },
  summary: Object.fromEntries(Object.entries(samples).map(([route, probes]) => [route, {
    domesticClient: summarize(probes.domesticClient),
    seoulServer: summarize(probes.seoulServer),
  }])),
  samples,
};

await mkdir(".codex_tmp", { recursive: true });
await writeFile(".codex_tmp/domestic-overseas-media-speed.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.summary, null, 2));
