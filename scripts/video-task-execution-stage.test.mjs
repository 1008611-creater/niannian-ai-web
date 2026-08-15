import assert from "node:assert/strict";
import test from "node:test";
import { executionStageStartedAt, publicTaskExecutionStage } from "../lib/video-task-execution-stage.ts";

test("Mimo stage never claims provider submission before a provider receipt exists", () => {
  assert.equal(publicTaskExecutionStage({ status: "running", blocker: null, channel: "mimo", providerTaskId: null })?.id, "preparing");
});

test("provider receipt failure is sync-only recovery", () => {
  const stage = publicTaskExecutionStage({ status: "blocked", blocker: "provider_sync_failed", channel: "mimo", providerTaskId: "receipt-1" });
  assert.equal(stage?.id, "recovery");
  assert.match(stage?.detail ?? "", /不会重复提交/);
});

test("historical content-QA tasks remain in their existing review stage", () => {
  const stage = publicTaskExecutionStage({ status: "blocked", blocker: "awaiting_content_qa", channel: "mimo", providerTaskId: "receipt-1" });
  assert.equal(stage?.id, "quality_review");
});

test("provider receipt is ordered before separately observed provider progress", () => {
  const events = [
    { event: "provider_progress_observed", createdAt: "2026-07-28T00:00:02.000Z" },
    { event: "provider_receipt_observed", createdAt: "2026-07-28T00:00:01.000Z" },
  ];
  assert.equal(executionStageStartedAt(events, "fallback"), "2026-07-28T00:00:02.000Z");
});
