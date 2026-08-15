import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const worker = await readFile(path.join(root, "lib", "astorie-windows-worker.ts"), "utf8");
const resultRoute = await readFile(path.join(root, "app", "api", "internal", "windows-astorie", "tasks", "[id]", "result", "route.ts"), "utf8");

test("AStorie claim is isolated to the authorized Seedance Mini queue", () => {
  assert.match(worker, /execution_mode = \? AND channel = \?/);
  assert.match(worker, /\["codex_skill", "astorie", "running", "queued_skill", "approved_for_execution"\]/);
  assert.match(worker, /task\.model\.trim\(\) === "Seedance 2\.0 Mini"/);
  assert.match(worker, /task\.duration_seconds >= 4 && task\.duration_seconds <= 15/);
  assert.match(worker, /channel: "astorie"/);
});

test("a pre-receipt worker failure leaves a visible resumable blocker", () => {
  assert.match(worker, /status === "blocked" && !task\.provider_task_id/);
  assert.match(worker, /astorie_worker_blocked_before_receipt/);
});

test("receipt persists provider identity and locked visible specification before synchronization", () => {
  assert.match(worker, /recordAStorieReceipt/);
  assert.match(worker, /astorie_provider_receipt_observed/);
  assert.match(worker, /provider_receipt =/);
  assert.match(worker, /reconciliation_only = true/);
});

test("completed output requires MP4-style media, JSON ledger, and server probe", () => {
  assert.match(worker, /ASTORIE_WINDOWS_RESULT_FILE_INVALID/);
  assert.match(worker, /ASTORIE_WINDOWS_LEDGER_FILE_INVALID/);
  assert.match(worker, /probeVideoDuration\(outputPath\)/);
  assert.match(worker, /astorie_worker_output_auto_delivered/);
  assert.match(resultRoute, /output instanceof File/);
  assert.match(resultRoute, /ledger instanceof File/);
});

test("spec mismatch is recorded without blocking automatic delivery", () => {
  assert.match(worker, /astorie_spec_mismatch_observed/);
  assert.match(worker, /specMismatch: mismatch/);
  assert.match(worker, /\["completed", outputPath/);
});
