import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildCodexPrompt,
  isExecutableReference,
  mioraHumanHandoff,
  normalizeWorkerResult,
  selectTaskChannel,
  validateTaskSpec,
} from "./video-task-worker.mjs";
import { isPathInside } from "../lib/video-output-gate.mjs";

const authorizedSpec = {
  task_id: "task-1",
  prompt_sha256: "abc",
  references: [{ path: "asset.png" }],
  allowed_channels: ["artflash", "mimo"],
  submit_allowed: true,
  cost_gate: { authorized: true },
};

test("authorized specs pass dispatch preflight", () => {
  assert.deepEqual(validateTaskSpec(authorizedSpec), []);
});

test("unauthorized specs cannot dispatch", () => {
  const errors = validateTaskSpec({
    ...authorizedSpec,
    submit_allowed: false,
    cost_gate: { authorized: false },
  });
  assert.ok(errors.includes("submit_not_authorized"));
  assert.ok(errors.includes("cost_not_authorized"));
});

test("automatic routing skips disabled channels and selects Mimo", () => {
  assert.equal(selectTaskChannel({ channel: "auto" }, authorizedSpec), "mimo");
});

test("disabled channels remain unavailable while Mimo stays active", () => {
  assert.equal(selectTaskChannel({ channel: "mimo" }, authorizedSpec), "mimo");
  assert.throws(() => selectTaskChannel({ channel: "artflash" }, authorizedSpec), /NO_ALLOWED_ACTIVE_CHANNEL/);
});

test("Dola is active only when the locked task spec selects it", () => {
  const dolaSpec = {
    ...authorizedSpec,
    prompt: "镜头缓慢向前移动，画面稳定。",
    allowed_channels: ["dola"],
    skill_route: ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "dola-video-channel"],
  };
  assert.equal(selectTaskChannel({ channel: "dola" }, dolaSpec), "dola");
  assert.deepEqual(validateTaskSpec(dolaSpec), []);
  assert.ok(validateTaskSpec({ ...dolaSpec, prompt: "第 1 秒展示商品" }).includes("dola_prompt_seconds_forbidden"));
});

test("Miora is active only for the locked Seedance2 720P 15s route", () => {
  const mioraSpec = {
    ...authorizedSpec,
    allowed_channels: ["miora"],
    resolution: "720p",
    duration: "15s",
    skill_route: ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "miora-seedance2-channel"],
  };
  assert.equal(selectTaskChannel({ channel: "miora" }, mioraSpec), "miora");
  assert.deepEqual(validateTaskSpec(mioraSpec), []);
  assert.ok(validateTaskSpec({ ...mioraSpec, resolution: "1080p" }).includes("miora_resolution_720p_required"));
  assert.ok(validateTaskSpec({ ...mioraSpec, duration: "10s" }).includes("miora_duration_15s_required"));
  assert.ok(validateTaskSpec({ ...mioraSpec, skill_route: [] }).includes("miora_skill_route_invalid"));
});

test("AStorie accepts its observed 720P 4-15 second Seedance routes", () => {
  const astorieSpec = {
    ...authorizedSpec,
    references: [],
    allowed_channels: ["astorie"],
    resolution: "720p",
    duration: "4s",
    model: "Seedance 2.0 Mini",
    skill_route: ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "astorie-seedance2-channel"],
  };
  assert.equal(selectTaskChannel({ channel: "astorie" }, astorieSpec), "astorie");
  assert.deepEqual(validateTaskSpec(astorieSpec), []);
  assert.ok(validateTaskSpec({ ...astorieSpec, duration: "3s" }).includes("astorie_duration_4_15s_required"));
  assert.ok(validateTaskSpec({ ...astorieSpec, model: "Seedance 2" }).includes("astorie_model_invalid"));
  assert.ok(validateTaskSpec({ ...astorieSpec, model: "Seedance 2.0 Pro" }).includes("astorie_model_invalid"));
  assert.ok(validateTaskSpec({ ...astorieSpec, references: [{ path: "a" }, { path: "b" }] }).includes("astorie_max_one_reference_required"));
});

test("Miora authentication and CAPTCHA blockers become resumable human handoffs", () => {
  assert.deepEqual(mioraHumanHandoff("MIORA_AUTHENTICATION_REQUIRED"), {
    action: "login",
    taskStatus: "awaiting_human_login",
    instructions: "请在已打开的 Miora 浏览器完成登录或验证码。系统不会保存账号、密码、Cookie 或验证码；完成后在工作台点击“我已完成，继续任务”。",
  });
  assert.equal(mioraHumanHandoff("MIORA_CAPTCHA_REQUIRED")?.taskStatus, "awaiting_human_verification");
  assert.deepEqual(mioraHumanHandoff("MIORA_TERMS_REQUIRED"), {
    action: "terms",
    taskStatus: "awaiting_human_login",
    instructions: "请在已打开的 Miora 浏览器本人阅读并确认平台服务协议或隐私条款。系统不会把该条款伪装成普通登录，也不会代替你接受；完成后在工作台点击“我已完成，继续任务”。",
  });
  assert.equal(mioraHumanHandoff("MIORA_PROVIDER_FAILED"), null);
});

test("explicit channels must be approved by the task spec", () => {
  assert.throws(
    () => selectTaskChannel({ channel: "tmlab" }, authorizedSpec),
    /CHANNEL_OUTSIDE_TASK_SPEC/,
  );
});

test("reference input flags are explicit and enforceable", () => {
  assert.equal(isExecutableReference({ actual_video_input: true }), true);
  assert.equal(isExecutableReference({ actual_video_input: false }), false);
  assert.equal(isExecutableReference({ upload_eligible: true }), true);
});

test("worker results normalize terminal fields", () => {
  assert.deepEqual(
    normalizeWorkerResult({
      status: "running",
      providerTaskId: "provider-1",
      outputPath: null,
      blocker: null,
      summary: "submitted",
      mediaProbePassed: false,
      contentQaPassed: false,
      ledgerPath: null,
    }),
    {
      status: "running",
      providerTaskId: "provider-1",
      outputPath: null,
      blocker: null,
      summary: "submitted",
      mediaProbePassed: false,
      contentQaPassed: false,
      ledgerPath: null,
    },
  );
});

test("Codex handoff locks Mimo and the authoritative spec", () => {
  const prompt = buildCodexPrompt(
    { id: "task-1", provider_task_id: null },
    "C:\\tasks\\task-1.json",
    authorizedSpec,
    "mimo",
  );
  assert.match(prompt, /mimo-8001-video-channel/);
  assert.match(prompt, /C:\\tasks\\task-1\.json/);
  assert.match(prompt, /Never use a different channel/);
});

test("Codex handoff locks the complete Dola Skill route", () => {
  const prompt = buildCodexPrompt(
    { id: "task-dola", provider_task_id: null },
    "C:\\tasks\\task-dola.json",
    { ...authorizedSpec, allowed_channels: ["dola"] },
    "dola",
  );
  assert.match(prompt, /ai-video-production-router -> sd2-video-generation -> prompt-skill-router -> ai-video-channel-router -> dola-video-channel/);
  assert.match(prompt, /Channel skill: dola-video-channel/);
});

test("Codex handoff locks the complete Miora Skill route", () => {
  const prompt = buildCodexPrompt(
    { id: "task-miora", provider_task_id: null },
    "C:\\tasks\\task-miora.json",
    { ...authorizedSpec, allowed_channels: ["miora"] },
    "miora",
  );
  assert.match(prompt, /ai-video-production-router -> sd2-video-generation -> prompt-skill-router -> ai-video-channel-router -> miora-seedance2-channel/);
  assert.match(prompt, /Channel skill: miora-seedance2-channel/);
});

test("Codex handoff requires AStorie live price readback before Generate", () => {
  const prompt = buildCodexPrompt(
    { id: "task-astorie", provider_task_id: null },
    "C:\\tasks\\task-astorie.json",
    { ...authorizedSpec, allowed_channels: ["astorie"] },
    "astorie",
  );
  assert.match(prompt, /astorie-seedance2-channel/);
  assert.match(prompt, /ASTORIE_LIVE_COST_AUTHORIZATION_REQUIRED/);
});

test("completion output paths cannot escape task directories", () => {
  const root = path.resolve("data", "video-outputs", "task-1", "downloads");
  assert.equal(isPathInside(root, path.join(root, "final.mp4")), true);
  assert.equal(isPathInside(root, root), false);
  assert.equal(isPathInside(root, path.resolve(`${root}-other`, "final.mp4")), false);
  assert.equal(isPathInside(root, path.resolve(root, "..", "ledger", "final.mp4")), false);
});
