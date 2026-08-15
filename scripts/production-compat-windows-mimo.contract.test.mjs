import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("production compatibility snapshot blocks active Windows Mimo work", async () => {
  const source = await readFile(path.join(root, "scripts", "production-compat-readonly.mjs"), "utf8");
  assert.match(source, /row\.execution_mode === "codex_skill" && row\.channel === "mimo" && row\.status === "running"/);
  assert.match(source, /const activeMimoProviderTasks = taskRows\.filter/);
  assert.match(source, /\["approved_for_execution", "running"\]\.includes\(row\.status\)/);
  assert.match(source, /runningOnMimo: runningMimoTasks\.length/);
  assert.match(source, /activeMimoProviderTasks: activeMimoProviderTasks\.length/);
  assert.match(source, /current\.queueGate\.runningOnMimo \|\| current\.queueGate\.activeMimoProviderTasks/);
  assert.doesNotMatch(source, /deployRequiresBothZero/);
});
