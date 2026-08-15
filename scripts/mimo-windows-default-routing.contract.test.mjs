import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("new Mimo customer tasks route only to the Windows codex_skill contract", async () => {
  const [route, tasks, readme, environment, integration] = await Promise.all([
    readFile(path.join(root, "app", "api", "video-tasks", "route.ts"), "utf8"),
    readFile(path.join(root, "lib", "video-tasks.ts"), "utf8"),
    readFile(path.join(root, "README.md"), "utf8"),
    readFile(path.join(root, ".env.example"), "utf8"),
    readFile(path.join(root, "scripts", "manual-task.integration.mjs"), "utf8"),
  ]);

  assert.match(route, /requestedChannel !== "auto" && requestedChannel !== "mimo"/);
  assert.match(route, /executionMode: "codex_skill"/);
  assert.match(route, /channel: "mimo"/);
  assert.match(tasks, /New Mimo customer jobs are dispatched as channel-isolated codex_skill work/);
  assert.match(readme, /execution_mode=codex_skill.*channel=mimo.*status=queued_skill/);
  assert.match(readme, /Windows Mimo CDP Worker/);
  assert.match(environment, /MIMO_WINDOWS_AGENT_TOKEN=/);
  assert.match(integration, /execution_mode !== "codex_skill"/);
  assert.doesNotMatch(readme, /客户新任务的 `execution_mode` 固定为 `mac_codex`/);
  assert.doesNotMatch(readme, /客户任务默认进入 Mac Codex 队列/);
});
