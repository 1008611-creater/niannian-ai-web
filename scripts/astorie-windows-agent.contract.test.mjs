import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("AStorie agent submits a claimed task once, writes its receipt, then only synchronizes it", async () => {
  const agent = await source("scripts/niannian-windows-astorie-agent.mjs");
  const submit = await source("windows-astorie-agent/astorie-chrome-cdp-submit.mjs");
  const sync = await source("windows-astorie-agent/astorie-chrome-cdp-sync.mjs");

  assert.match(agent, /receiptPath/);
  assert.match(agent, /status:\s*["']running["']/);
  assert.match(agent, /receipt.*sync|sync.*receipt/is);
  assert.match(submit, /生成\|generate/);
  assert.match(submit, /exactly once|submitOnce|submitted/is);
  assert.match(submit, /baselineMediaUrls/);
  assert.match(submit, /generateClickedAt/);
  assert.doesNotMatch(sync, /Generate/);
  assert.match(sync, /providerTaskId|mediaIdentity|requestId/);
  assert.match(sync, /!baselineMediaUrls\.includes\(url\)/);
  assert.match(sync, /generationDurationMs/);
});

test("AStorie fast path polls quickly without noisy per-cycle status writes", async () => {
  const agent = await source("scripts/niannian-windows-astorie-agent.mjs");

  assert.match(agent, /ASTORIE_CLAIM_POLL_MS \|\| 2000/);
  assert.match(agent, /ASTORIE_SYNC_POLL_MS \|\| 5000/);
  assert.match(agent, /cycle === 1 \|\| cycle % 6 === 0/);
});

test("AStorie unsupported multi-reference, video-reference, and audio-reference tasks route away before claim", async () => {
  const [worker, agent] = await Promise.all([
    source("lib/astorie-windows-worker.ts"),
    source("scripts/niannian-windows-astorie-agent.mjs"),
  ]);

  assert.match(worker, /references\.slice\(0, 1\)/);
  assert.match(worker, /max_upload_references: 1/);
  assert.match(worker, /channel_reference_plan/);
  assert.match(agent, /ASTORIE_REFERENCE_PLAN_INVALID/);
});

test("AStorie records delivered media mismatches without blocking automatic delivery", async () => {
  const worker = await source("lib/astorie-windows-worker.ts");

  assert.match(worker, /media.*mismatch|specification.*mismatch|actual.*duration/is);
  assert.match(worker, /durationSeconds/);
  assert.match(worker, /width/);
  assert.match(worker, /height/);
  assert.match(worker, /status:\s*["']completed["']|status\s*=\s*["']completed["']/);
  assert.doesNotMatch(worker, /MEDIA_SPEC_MISMATCH[^\n]*(?:blocked|failed)/i);
});

test("AStorie completion requires a media probe and a ledger", async () => {
  const [worker, agent] = await Promise.all([
    source("lib/astorie-windows-worker.ts"),
    source("scripts/niannian-windows-astorie-agent.mjs"),
  ]);

  assert.match(agent, /ffprobeBin|mediaProbe/);
  assert.match(agent, /ledger/);
  assert.match(worker, /probeVideoDuration/);
  assert.match(worker, /ledger/);
  assert.match(worker, /completed/);
});
