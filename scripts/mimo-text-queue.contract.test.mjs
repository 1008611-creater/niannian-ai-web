import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (...parts) => readFile(path.join(root, ...parts), "utf8");

test("empty assets create text-to-video tasks while image assets stay image-to-video", async () => {
  const [tasks, route, credits, home] = await Promise.all([
    source("lib", "video-tasks.ts"),
    source("app", "api", "video-tasks", "route.ts"),
    source("lib", "credits.ts"),
    source("app", "home", "page.tsx"),
  ]);
  const creation = tasks.slice(tasks.indexOf("export async function createVideoTask"), tasks.indexOf("export async function listVideoTasks"));

  assert.match(creation, /assets\.length \? "image_to_video" : "text_to_video"/);
  assert.match(creation, /references,/);
  assert.match(creation, /prompt_sha256: promptSha256/);
  assert.match(creation, /allowed_channels: allowedChannels/);
  assert.match(creation, /\["ai-video-production-router", "ai-video-channel-router", "mimo-8001-video-channel"\]/);
  assert.match(creation, /resolution: input\.resolution\.toLowerCase\(\)/);
  assert.match(route, /requestedChannel === "higgsfield" \|\| requestedChannel === "miora" \? "server_auto" : "codex_skill"/);
  assert.match(tasks, /input\.durationSeconds < 4 \|\| input\.durationSeconds > 15/);
  for (const [duration, cost] of [[4, 16], [5, 20], [10, 40], [15, 60]]) {
    assert.match(credits, new RegExp(`${duration}: ${cost}`));
  }
  assert.match(home, /Array\.from\(\{ length: 12 \}/);
});

test("Mimo accepts authorized 4-15 second text-to-video and image-to-video tasks", async () => {
  const [worker, agent, submit, tasks] = await Promise.all([
    source("lib", "mimo-windows-worker.ts"),
    source("scripts", "niannian-windows-mimo-agent.mjs"),
    source("windows-mimo-agent", "mimo-chrome-cdp-submit.mjs"),
    source("lib", "video-tasks.ts"),
  ]);
  assert.match(worker, /spec\.generation_type === "image_to_video" \? "image_to_video" : spec\.generation_type === "text_to_video" \? "text_to_video" : null/);
  assert.match(agent, /\["text_to_video", "image_to_video"\]\.includes\(String\(generationType\)\)/);
  assert.match(agent, /Number\(task\.durationSeconds\) < 4 \|\| Number\(task\.durationSeconds\) > 15/);
  assert.match(agent, /for \(const reference of references\) stagedReferences\.push\(await downloadReference/);
  assert.match(agent, /for \(const reference of task\.references\) args\.push\("--image"/);
  assert.doesNotMatch(submit, /!config\.images\.length/);
  assert.match(submit, /if \(config\.images\.length\) \{/);
});

test("claim is Windows Mimo-only and provider receipts remain sync-only", async () => {
  const [worker, agent] = await Promise.all([
    source("lib", "mimo-windows-worker.ts"),
    source("scripts", "niannian-windows-mimo-agent.mjs"),
  ]);
  const claim = worker.slice(worker.indexOf("export async function claimMimoTask"), worker.indexOf("export async function writeMimoWorkerState"));
  const execute = agent.slice(agent.indexOf("async function execute"), agent.indexOf("async function runOnce"));
  assert.match(claim, /\["codex_skill", "mimo", "queued_skill", "approved_for_execution"\]/);
  assert.match(claim, /submit_allowed = 1 AND cost_authorized = 1/);
  assert.match(execute, /if \(!providerTaskId\) \{/);
  assert.ok(execute.indexOf("if (!providerTaskId) {") < execute.indexOf("for (let cycle = 1"));
});

test("a failed Mimo execution without a Provider receipt remains blocked on Mimo", async () => {
  const worker = await source("lib", "mimo-windows-worker.ts");
  const blockedWithoutReceipt = worker.slice(worker.indexOf('if (status === "blocked")'), worker.indexOf('if (!input.output'));
  assert.match(blockedWithoutReceipt, /UPDATE video_tasks SET execution_mode = \?, status = \?, blocker = \?, submit_allowed = 0/);
  assert.match(blockedWithoutReceipt, /\["codex_skill", "blocked"/);
  assert.match(blockedWithoutReceipt, /provider_task_id IS NULL/);
  assert.match(blockedWithoutReceipt, /retry_policy = "no_automatic_retry_without_new_owner_authorization"/);
  assert.doesNotMatch(blockedWithoutReceipt, /manual_assist|automatic_fallback_manual/);
});

test("unavailable Worker remains queued publicly and cost readback is not an authorization gate", async () => {
  const [tasks, publicState, projects] = await Promise.all([
    source("lib", "video-tasks.ts"),
    source("lib", "video-task-public-state.ts"),
    source("app", "projects", "page.tsx"),
  ]);
  const authorization = tasks.slice(tasks.indexOf("export async function authorizeOwnedMimoExecution"), tasks.indexOf("export async function resumeOwnedMioraHumanHandoff"));
  assert.doesNotMatch(authorization, /currentMimoCostReadback/);
  assert.doesNotMatch(authorization, /publicMimoWorkerAvailability/);
  assert.match(authorization, /submit_allowed = 1, cost_authorized = 1/);
  assert.match(authorization, /\["queued_skill", updatedAt/);
  assert.match(tasks, /task\.status === "approved_for_execution" && options\.mimoReadyToClaim === false\s*\? "queued"/);
  assert.match(publicState, /mimoReadyToClaim === false \? "正在排队"/);
  assert.match(publicState, /input\.status === "queued_skill" && input\.channel === "mimo" && input\.blocker === null\) return "正在排队"/);
  assert.doesNotMatch(projects, /disabled=\{authorizingTaskId === task\.id \|\| !task\.mimoCostReadback\}/);
});

test("automatic completion keeps ledger and ffprobe gates, then uses COS when configured or the authenticated local route when it is not", async () => {
  const worker = await source("lib", "mimo-windows-worker.ts");
  const completion = worker.slice(worker.indexOf("if (!input.output"), worker.indexOf("export async function mimoTaskHasResult"));
  const ledger = completion.indexOf("JSON.parse(ledgerText)");
  const probe = completion.indexOf("probeVideoDuration(outputPath)");
  const cos = completion.indexOf("uploadAndVerifyVideoDelivery");
  const completed = completion.indexOf('["completed", providerTaskId');
  assert.ok(ledger >= 0 && probe > ledger && cos > probe && completed > cos);
  assert.match(completion, /MEDIA_DURATION_MISMATCH/);
  assert.match(completion, /videoCosConfigured\(\)/);
  assert.match(completion, /provider: "local_private"/);
  assert.match(completion, /local_delivery_verified/);
  assert.doesNotMatch(completion, /VIDEO_COS_DELIVERY_REQUIRED/);
  assert.match(completion, /spec\.completion_evidence = \{\s+media_probe_passed: true/);
});
