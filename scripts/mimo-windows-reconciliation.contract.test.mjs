import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("official Mimo reconciliation remains Windows-owned and sync-only", async () => {
  const [admin, worker, agent] = await Promise.all([
    readFile(path.join(root, "lib", "admin.ts"), "utf8"),
    readFile(path.join(root, "lib", "mimo-windows-worker.ts"), "utf8"),
    readFile(path.join(root, "scripts", "niannian-windows-mimo-agent.mjs"), "utf8"),
  ]);
  const reconciliation = admin.slice(admin.indexOf('input.action === "reconcile_official_frontend"'), admin.indexOf('input.action === "block"'));

  assert.match(reconciliation, /task\.channel !== "mimo"/);
  assert.match(reconciliation, /executionMode = "codex_skill"/);
  assert.match(reconciliation, /spec\.execution_mode = "codex_skill"/);
  assert.match(reconciliation, /spec\.provider_task_id = providerTaskId/);
  assert.match(reconciliation, /spec\.reconciliation_only = true/);
  assert.match(reconciliation, /spec\.allowed_channels = \["mimo"\]/);
  assert.match(reconciliation, /spec\.skill_route = \["ai-video-production-router", "ai-video-channel-router", "mimo-8001-video-channel"\]/);
  assert.doesNotMatch(reconciliation, /mac_codex/);
  assert.match(worker, /\["codex_skill", "mimo", "queued_skill", "approved_for_execution"\]/);
  const blockedWithoutReceipt = worker.slice(worker.indexOf('if (status === "blocked")'), worker.indexOf('if (!input.output'));
  assert.match(blockedWithoutReceipt, /provider_task_id IS NULL/);
  assert.match(blockedWithoutReceipt, /\["codex_skill", "blocked"/);
  assert.match(blockedWithoutReceipt, /mimo_worker_blocked_no_provider/);
  assert.doesNotMatch(blockedWithoutReceipt, /manual_assist|automatic_fallback_manual/);
  assert.match(agent, /if \(!providerTaskId\) \{/);
  assert.match(agent, /provider receipt found; syncing only/);
});
