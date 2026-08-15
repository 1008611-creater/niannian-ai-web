import assert from "node:assert/strict";
import test from "node:test";
import { publicTaskExecutionNotice, publicTaskStatus } from "../lib/video-task-public-state.ts";

const queuedMimo = {
  status: "queued_skill",
  blocker: "awaiting_cost_readback_and_submit_authorization",
  channel: "mimo",
  providerTaskId: null,
};

test("unapproved Mimo tasks clearly report that they have not been submitted", () => {
  assert.equal(publicTaskStatus(queuedMimo.status, queuedMimo.blocker), "authorization");
  assert.match(publicTaskExecutionNotice(queuedMimo, true), /尚未提交 Mimo/);
  assert.match(publicTaskExecutionNotice(queuedMimo, true), /当前 Windows 执行器已就绪/);
  assert.match(publicTaskExecutionNotice(queuedMimo, true), /不会重复扣费/);
});

test("authorized tasks distinguish a ready worker from an unavailable worker", () => {
  const task = { ...queuedMimo, status: "approved_for_execution", blocker: null };
  assert.match(publicTaskExecutionNotice(task, true), /等待 Windows 执行器领取/);
  assert.equal(publicTaskExecutionNotice(task, false), "正在排队");
});
