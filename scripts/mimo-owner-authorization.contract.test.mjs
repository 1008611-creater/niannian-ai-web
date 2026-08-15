import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("owner Mimo authorization preserves the locked execution and sync-only contracts", async () => {
  const [tasks, route, projects] = await Promise.all([
    readFile(path.join(root, "lib", "video-tasks.ts"), "utf8"),
    readFile(path.join(root, "app", "api", "video-tasks", "[id]", "authorize-execution", "route.ts"), "utf8"),
    readFile(path.join(root, "app", "projects", "page.tsx"), "utf8"),
  ]);
  const authorization = tasks.slice(tasks.indexOf("export async function authorizeOwnedMimoExecution"), tasks.indexOf("export async function resumeOwnedMioraHumanHandoff"));

  assert.match(authorization, /findOwnedVideoTask\(userId, taskId\)/);
  assert.match(authorization, /task\.provider_task_id\) throw new Error\("PROVIDER_TASK_SYNC_ONLY"\)/);
  assert.doesNotMatch(authorization, /publicMimoWorkerAvailability\(\)/);
  assert.doesNotMatch(authorization, /MIMO_WINDOWS_WORKER_NOT_READY/);
  assert.doesNotMatch(authorization, /MIMO_COST_READBACK_REQUIRED/);
  assert.match(authorization, /dbTransaction/);
  assert.match(authorization, /owner_mimo_execution_authorized/);
  assert.match(authorization, /provider_task_id IS NULL/);
  assert.match(authorization, /submit_allowed = 0 AND cost_authorized = 0/);
  assert.match(tasks, /owner_confirmed_locked_mimo_execution/);
  assert.match(tasks, /MIMO_PROVIDER_COST_CONTRACT_UNAVAILABLE/);
  assert.match(tasks, /expected_cost: providerCost\.expectedCost/);
  assert.match(tasks, /maximum_cost: providerCost\.maximumCost/);
  assert.match(tasks, /provider_cost_monitoring: "typed_contract_and_live_pre_submit_estimate"/);
  assert.match(route, /validRequestOrigin/);
  assert.match(route, /sessionFromToken/);
  assert.match(projects, /authorize-execution/);
  assert.match(projects, /确认并开始生成/);
  assert.match(projects, /不会直接提交 Mimo/);
  assert.doesNotMatch(projects, /!task\.mimoCostReadback/);
});
