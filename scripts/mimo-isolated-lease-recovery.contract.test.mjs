import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = await readFile(path.join(root, "lib", "mimo-windows-worker.ts"), "utf8");

test("isolated stale lease recovery is opt-in, exact, receipt-safe, and compare-and-set", () => {
  const config = source.slice(source.indexOf("function isolatedLeaseRecoveryConfig"), source.indexOf("export function isExactIsolatedMimoLeaseRecovery"));
  const recovery = source.slice(source.indexOf("async function claimConfiguredIsolatedLeaseRecovery"), source.indexOf("async function claimReceiptRecoveryTask"));
  const claim = source.slice(source.indexOf("export async function claimMimoTask"), source.indexOf("export async function writeMimoWorkerState"));

  assert.match(config, /MIMO_WINDOWS_ISOLATED_LEASE_RECOVERY_ENABLED !== "true"/);
  assert.match(config, /MIMO_WINDOWS_ISOLATED_LEASE_RECOVERY_TASK_ID/);
  assert.match(config, /MIMO_WINDOWS_ISOLATED_LEASE_RECOVERY_WORKER_ID/);
  for (const predicate of ["execution_mode", "channel", "status", "provider_task_id IS NULL", "submit_allowed = 1", "cost_authorized = 1", "updated_at = ?"]) {
    assert.match(recovery, new RegExp(predicate));
  }
  assert.match(recovery, /provider_receipt_observed/);
  assert.match(recovery, /priorWorkerId === workerId/);
  assert.match(recovery, /mimo_worker_isolated_lease_recovered/);
  assert.doesNotMatch(recovery, /Generate|upload|credit_ledger|INSERT INTO video_tasks/);
  assert.ok(claim.indexOf("claimConfiguredIsolatedLeaseRecovery") < claim.indexOf("recoverExpiredMimoLease"));
});
