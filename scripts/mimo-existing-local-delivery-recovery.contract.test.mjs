import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("expired Mimo receipt recovery can deliver only the existing matching local artifact", async () => {
  const [worker, agent] = await Promise.all([
    readFile(path.join(root, "lib", "mimo-windows-worker.ts"), "utf8"),
    readFile(path.join(root, "scripts", "niannian-windows-mimo-agent.mjs"), "utf8"),
  ]);
  const admission = worker.slice(worker.indexOf("async function assertMimoTaskAcceptingResult"), worker.indexOf("async function recordConfigured"));
  assert.match(admission, /task\.status === "blocked"/);
  assert.match(admission, /task\.blocker === "MIMO_PROVIDER_SYNC_RECOVERY_WINDOW_EXPIRED"/);
  assert.match(admission, /providerTaskId === task\.provider_task_id/);
  const recovery = agent.slice(agent.indexOf("async function recoverLocalDelivery"), agent.indexOf("async function runOnce"));
  assert.match(recovery, /submission-receipt\.json/);
  assert.match(recovery, /sync-manifest\.json/);
  assert.match(recovery, /probeNativeAudioMedia/);
  assert.match(recovery, /recovery: "existing_local_result_only"/);
  assert.doesNotMatch(recovery, /runHelper\(submitter|Generate/);
});
