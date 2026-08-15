import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activateControllerWriter, checkpointProductionTruth, completeChildWorkItem, reconstructHarness, refreshOverdueControllerLiveness, startChildWorkItem } from "./video-workbench-harness-dispatcher.mjs";
import { appendDispatcherEventCas, parseEventLedger, recoverPendingDispatcherCommit, reduceEvents } from "./video-workbench-harness-state.mjs";
import { exactProductionBinding, readWorkerStateSafely, reconcileProductionRecord } from "./video-workbench-harness-dispatcher-runner.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sourceHarness = path.join(root, "docs", "agent-team", "video-workbench-harness-v1");
const controllerId = "dispatcher-repair-test";
const packetId = "NIANNIAN-WB-REAL-I2V-4S-20260728-01";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "niannian-dispatcher-repair-"));
  const harness = path.join(directory, "harness");
  await cp(sourceHarness, harness, { recursive: true });
  const eventsPath = path.join(harness, "events.jsonl");
  const statePath = path.join(harness, "state.json");
  // Repair fixtures require a local writer bootstrap before the production
  // cutover, so isolate the immutable pre-cutover ledger prefix.
  const events = parseEventLedger(await readFile(eventsPath, "utf8")).slice(0, 49);
  const sourceState = JSON.parse(await readFile(statePath, "utf8"));
  const state = { ...sourceState, ...reduceEvents(structuredClone(events)), artifact_ledger: sourceState.artifact_ledger ?? [], gate_events: sourceState.gate_events ?? [] };
  await Promise.all([
    writeFile(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`),
    writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`),
  ]);
  return { directory, harness };
}

function snapshot(result) {
  const packet = result.state.queue.find((item) => item.task_id === packetId)?.packet_sha256;
  return { revision: result.revision, event_head_hash: result.eventHeadHash, active_claim: result.state.active_claim, writer_locks: result.state.writer_locks, decisions: result.state.decisions, packet_sha256: packet, production_task_binding: exactProductionBinding(packet) };
}

async function activeFixture() {
  const current = await fixture();
  const initial = await reconstructHarness(current.harness);
  const active = await activateControllerWriter({ harnessRoot: current.harness, controllerId: initial.state.controller.executor_id, controllerKind: "local", expectedRevision: initial.revision, at: "2026-07-28T18:00:00.000Z", snapshot: snapshot(initial) });
  const binding = exactProductionBinding(active.state.queue.find((item) => item.task_id === packetId).packet_sha256);
  const checkpoint = await checkpointProductionTruth({
    harnessRoot: current.harness, controllerId: initial.state.controller.executor_id, expectedRevision: active.state.revision, at: "2026-07-28T18:00:01.000Z", productionTaskBinding: binding,
    reconciliation: { production_task_id: binding.production_task_id, updated_at: "2026-07-28T18:00:01.000Z", observed_at: "2026-07-28T18:00:01.000Z", status: "running", blocker: null, provider_task_id: null, provider_receipt_present: false, worker_state: "running" },
    nextCheckAt: "2099-01-01T00:00:00.000Z", nextExternalAction: "observe_existing_windows_worker",
  });
  return { ...current, controllerId: initial.state.controller.executor_id, binding, revision: checkpoint.state.revision };
}

function validRecord() {
  const prompt = "一名年轻男子在未来感便利店里拿起一瓶普通矿泉水，瓶盖打开瞬间，整个便利店像失重空间一样漂浮起来，零食和彩色包装缓慢环绕他旋转。他先惊讶地环顾四周，随后对镜头露出得意微笑，喝下一口水。电影感运镜，真实人物，动作自然，光影清晰，无文字，无水印。";
  return { task: { id: "aPh_FVncAV5fdhK3z8lCrCTv", owner_email: "liusb0713@qq.com", prompt, channel: "mimo", execution_mode: "codex_skill", duration_seconds: 4, aspect_ratio: "16:9", resolution: "720P", status: "running", provider_task_id: null, updated_at: "2026-07-28T18:00:00.000Z" }, spec: { prompt, prompt_sha256: "5cf55fb95b436768028c3e3e69745a17be8ee87759fbada8329fe6efe181e5af", references: [{ sha256: "ad87a15f8ada8cc0da952d0e0cfe754e1f2d539deb9708d30cb3528c89767fee" }] }, creditLedger: [{ reason: "video_automatic_reservation", amount: -16 }], events: [], workerState: null, observedAt: "2026-07-28T18:00:00.000Z" };
}

test("exact prompt, derived SHA, and only one 16-credit reservation reject format-valid drift", () => {
  const variants = [
    ["prompt", (record) => { record.task.prompt = `${record.task.prompt}x`; }, "DISPATCHER_PRODUCTION_PROMPT_MISMATCH"],
    ["derived", (record) => { record.spec.references[0].sha256 = "f".repeat(64); }, "DISPATCHER_PRODUCTION_REFERENCE_MISMATCH"],
    ["credit", (record) => { record.creditLedger = [{ reason: "video_automatic_reservation", amount: -20 }]; }, "DISPATCHER_PRODUCTION_CREDIT_RESERVATION_MISMATCH"],
    ["duplicate-credit", (record) => { record.creditLedger.push({ reason: "video_automatic_reservation", amount: -16 }); }, "DISPATCHER_PRODUCTION_CREDIT_RESERVATION_MISMATCH"],
  ];
  for (const [, mutate, code] of variants) {
    const record = validRecord();
    mutate(record);
    assert.throws(() => reconcileProductionRecord(record), new RegExp(code));
  }
});

test("worker state is accepted only after realpath containment in data root", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "niannian-worker-state-"));
  try {
    const dataRoot = path.join(directory, "data");
    const inside = path.join(dataRoot, "worker.json");
    const outside = path.join(directory, "outside.json");
    await mkdir(dataRoot);
    await Promise.all([writeFile(inside, '{"status":"running"}'), writeFile(outside, '{"status":"running"}')]);
    assert.deepEqual(await readWorkerStateSafely(inside, dataRoot), { status: "running" });
    await assert.rejects(readWorkerStateSafely(outside, dataRoot), /DISPATCHER_WORKER_STATE_OUTSIDE_DATA_ROOT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("active child work persists next wake and continues internally without an outbox handoff", async () => {
  const current = await activeFixture();
  try {
    const outboxCount = (await reconstructHarness(current.harness)).state.controller_outbox.length;
    const started = await startChildWorkItem({ harnessRoot: current.harness, controllerId: current.controllerId, expectedRevision: current.revision, at: "2026-07-28T18:00:02.000Z", workItem: { id: "audio-fix", kind: "implementation", write_set: ["candidate"] }, nextWakeAt: "2099-01-01T00:00:00.000Z", resumeNode: "await_audio_fix", controllerStatus: "waiting_implementation" });
    assert.equal(started.state.controller.status, "waiting_implementation");
    assert.equal(started.state.child_work_items.find((item) => item.id === "audio-fix").state, "active");
    const completed = await completeChildWorkItem({ harnessRoot: current.harness, controllerId: current.controllerId, expectedRevision: started.state.revision, at: "2026-07-28T18:00:03.000Z", workItemId: "audio-fix", result: { evidence_refs: ["candidate-test"] }, nextWakeAt: "2099-01-01T00:01:00.000Z", resumeNode: "independent_acceptance", controllerStatus: "waiting_independent_acceptance" });
    const rebuilt = await reconstructHarness(current.harness);
    assert.equal(rebuilt.state.child_work_items.find((item) => item.id === "audio-fix").state, "completed");
    assert.equal(rebuilt.state.controller_liveness.resume_node, "independent_acceptance");
    assert.equal(rebuilt.state.controller_outbox.length, outboxCount);
    assert.equal(rebuilt.state.next_external_action, "consume_typed_result_then_continue_parent");
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("active child cannot project idle and interrupted ledger/state commit recovers exactly once", async () => {
  const current = await activeFixture();
  try {
    await assert.rejects(startChildWorkItem({ harnessRoot: current.harness, controllerId: current.controllerId, expectedRevision: current.revision, at: "2026-07-28T18:01:00.000Z", workItem: { id: "bad-idle", kind: "implementation" }, nextWakeAt: "2099-01-01T00:00:00.000Z", resumeNode: "bad", controllerStatus: "idle_no_task" }), /DISPATCHER_ACTIVE_WORK_IDLE_INVALID/);
    const before = await reconstructHarness(current.harness);
    const event = { type: "controller_transition", at: "2026-07-28T18:01:01.000Z", task_id: packetId, controller_status: "waiting_internal_repair", resume_node: "repair", next_wake_at: "2099-01-01T00:00:00.000Z", observed_at: "2026-07-28T18:01:01.000Z", next_external_action: "repair" };
    await assert.rejects(appendDispatcherEventCas({ harnessRoot: current.harness, expectedRevision: before.revision, event, faultInjection: "after_ledger_rename" }), /DISPATCHER_INJECTED_FAULT_AFTER_LEDGER_RENAME/);
    const recovered = await recoverPendingDispatcherCommit(current.harness);
    assert.equal(recovered.committed, true);
    const after = await reconstructHarness(current.harness);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.state.controller_outbox.filter((item) => item.dedupe_key === "fault-injection-repair").length, 0);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("new internal outbox writes are rejected while historical ledger entries remain reconstructable", async () => {
  const current = await activeFixture();
  try {
    await assert.rejects(appendDispatcherEventCas({
      harnessRoot: current.harness,
      expectedRevision: current.revision,
      event: {
        type: "controller_transition", at: "2026-07-28T18:02:00.000Z", task_id: packetId,
        controller_status: "waiting_internal_repair", resume_node: "repair", next_wake_at: "2099-01-01T00:00:00.000Z", observed_at: "2026-07-28T18:02:00.000Z", next_external_action: "repair",
        outbox: { project_id: "niannian-ai-video-workbench", formal_task_id: current.binding.production_task_id, harness_task_id: packetId, packet_sha: current.binding.packet_sha256, event_type: "progress_checkpoint", node: "repair", status: "waiting_internal_repair", evidence_refs: ["test"], next_resume: "repair", occurred_at: "2026-07-28T18:02:00.000Z", dedupe_key: "forbidden-internal-outbox" },
      },
    }), /CONTROLLER_OUTBOX_INTERNAL_EVENT_FORBIDDEN/);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("an overdue child checkpoint requires durable refresh before its normal transition can continue", async () => {
  const current = await activeFixture();
  try {
    const started = await startChildWorkItem({
      harnessRoot: current.harness,
      controllerId: current.controllerId,
      expectedRevision: current.revision,
      at: "2026-07-28T18:10:00.000Z",
      workItem: { id: "overdue-child", kind: "implementation", write_set: ["candidate"] },
      nextWakeAt: "2026-07-28T18:11:00.000Z",
      resumeNode: "await_overdue_child",
      controllerStatus: "waiting_implementation",
    });
    const beforeRefresh = await reconstructHarness(current.harness);
    const parentBefore = structuredClone(beforeRefresh.state.active_claim);
    const locksBefore = structuredClone(beforeRefresh.state.writer_locks);
    const packetBefore = beforeRefresh.state.queue.find((item) => item.task_id === packetId).packet_sha256;
    await assert.rejects(completeChildWorkItem({
      harnessRoot: current.harness,
      controllerId: current.controllerId,
      expectedRevision: started.state.revision,
      at: "2026-07-28T18:12:00.000Z",
      workItemId: "overdue-child",
      result: { evidence_refs: ["candidate-test"] },
      nextWakeAt: "2026-07-28T18:13:00.000Z",
      resumeNode: "independent_acceptance",
    }), /DISPATCHER_LIVENESS_OVERDUE_REFRESH_REQUIRED/);
    const refreshed = await refreshOverdueControllerLiveness({
      harnessRoot: current.harness,
      controllerId: current.controllerId,
      expectedRevision: beforeRefresh.revision,
      at: "2026-07-28T18:12:00.000Z",
      nextWakeAt: "2026-07-28T18:13:00.000Z",
    });
    assert.deepEqual(refreshed.state.active_claim, parentBefore);
    assert.deepEqual(refreshed.state.writer_locks, locksBefore);
    assert.equal(refreshed.state.queue.find((item) => item.task_id === packetId).packet_sha256, packetBefore);
    assert.equal(refreshed.state.controller_liveness.resume_node, "await_overdue_child");
    assert.ok(Date.parse(refreshed.state.controller_liveness.next_check_at) > Date.parse(refreshed.state.controller_liveness.observed_at));
    const completed = await completeChildWorkItem({
      harnessRoot: current.harness,
      controllerId: current.controllerId,
      expectedRevision: refreshed.state.revision,
      at: "2026-07-28T18:12:01.000Z",
      workItemId: "overdue-child",
      result: { evidence_refs: ["candidate-test"] },
      nextWakeAt: "2026-07-28T18:13:00.000Z",
      resumeNode: "independent_acceptance",
    });
    assert.equal(completed.state.child_work_items.find((item) => item.id === "overdue-child").state, "completed");
    assert.equal((await reconstructHarness(current.harness)).revision, completed.state.revision);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});
