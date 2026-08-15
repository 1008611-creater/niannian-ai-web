import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activateControllerWriter, checkpointProductionTruth, dispatchCheckpointResume, dispatchResumeReady, freezeControllerWriter, markResumeReady, outboxFor, reconstructHarness } from "./video-workbench-harness-dispatcher.mjs";
import { parseEventLedger, reduceEvents } from "./video-workbench-harness-state.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sourceHarness = path.join(root, "docs", "agent-team", "video-workbench-harness-v1");
const controllerId = "server-controller-test";

test("internal transitions stay in the ledger while only escalation and delivery enter controller outbox", () => {
  const binding = snapshot({ state: { queue: [{ task_id: "NIANNIAN-WB-REAL-I2V-4S-20260728-01", packet_sha256: "a".repeat(64) }], active_claim: { task_id: "NIANNIAN-WB-REAL-I2V-4S-20260728-01" } } }).production_task_binding;
  const input = { binding, node: "preflight", status: "active", evidenceRefs: ["test"], nextResume: "preflight", occurredAt: "2026-07-28T15:00:00.000Z", dedupeKey: "test" };
  assert.equal(outboxFor({ ...input, eventType: "progress_checkpoint" }), undefined);
  assert.equal(outboxFor({ ...input, eventType: "implementation_completed" }), undefined);
  assert.equal(outboxFor({ ...input, eventType: "user_action_blocked" }).event_type, "user_action_blocked");
  assert.equal(outboxFor({ ...input, eventType: "user_acceptance_required" }).event_type, "user_acceptance_required");
  assert.equal(outboxFor({ ...input, eventType: "delivery_completed" }).event_type, "delivery_completed");
});

function snapshot(result) {
  const packet = result.state.queue.find((entry) => entry.task_id === result.state.active_claim?.task_id)?.packet_sha256 ?? null;
  return {
    revision: result.revision, event_head_hash: result.eventHeadHash, active_claim: result.state.active_claim, writer_locks: result.state.writer_locks, decisions: result.state.decisions, packet_sha256: packet,
    production_task_binding: { packet_task_id: "NIANNIAN-WB-REAL-I2V-4S-20260728-01", packet_sha256: packet, production_task_id: "aPh_FVncAV5fdhK3z8lCrCTv", owner_account: "liusb0713@qq.com", locked_prompt_sha256: "5cf55fb95b436768028c3e3e69745a17be8ee87759fbada8329fe6efe181e5af", derived_reference_sha256: "ad87a15f8ada8cc0da952d0e0cfe754e1f2d539deb9708d30cb3528c89767fee", duration_seconds: 4, aspect_ratio: "16:9", resolution: "720P", website_credit_reservation: 16 },
  };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "niannian-dispatcher-"));
  const harness = path.join(directory, "harness");
  await cp(sourceHarness, harness, { recursive: true });
  const eventsPath = path.join(harness, "events.jsonl");
  const statePath = path.join(harness, "state.json");
  // These cutover tests start from the pre-cutover ledger by design. The project
  // source ledger now retains the completed local freeze at revisions 50-51.
  const events = parseEventLedger(await readFile(eventsPath, "utf8")).slice(0, 49);
  const reduced = reduceEvents(structuredClone(events));
  const sourceState = JSON.parse(await readFile(statePath, "utf8"));
  const state = { ...sourceState, ...reduced, artifact_ledger: sourceState.artifact_ledger ?? [], gate_events: sourceState.gate_events ?? [] };
  await Promise.all([
    writeFile(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`),
    writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`),
  ]);
  return { directory, harness, revision: state.revision };
}

test("resume_ready dispatch persists exactly one node claim and survives restart reconstruction", async () => {
  const current = await fixture();
  try {
    const initial = await reconstructHarness(current.harness);
    const local = await activateControllerWriter({ harnessRoot: current.harness, controllerId: initial.state.controller.executor_id, controllerKind: "local", expectedRevision: initial.revision, at: "2026-07-28T15:00:00.000Z", snapshot: snapshot(initial) });
    const localState = await reconstructHarness(current.harness);
    await freezeControllerWriter({ harnessRoot: current.harness, controllerId: initial.state.controller.executor_id, expectedRevision: local.state.revision, at: "2026-07-28T15:00:01.000Z", snapshot: snapshot(localState) });
    const frozen = await reconstructHarness(current.harness);
    const activation = await activateControllerWriter({ harnessRoot: current.harness, controllerId, controllerKind: "server", expectedRevision: frozen.revision, at: "2026-07-28T15:00:02.000Z", snapshot: snapshot(frozen) });
    const ready = await markResumeReady({ harnessRoot: current.harness, controllerId, expectedRevision: activation.state.revision, at: "2026-07-28T15:00:03.000Z", resumeNode: "controlled_private_face_processor_deployment", nextExternalAction: "controlled_release" });
    const first = await dispatchResumeReady({ harnessRoot: current.harness, controllerId, expectedRevision: ready.state.revision, at: "2026-07-28T15:00:04.000Z" });
    assert.equal(first.event.type, "resume_node_claimed");
    const recovered = await reconstructHarness(current.harness);
    assert.equal(recovered.state.node_runs.length, 1);
    assert.equal(recovered.state.node_runs[0].packet_sha256, recovered.state.queue[0].packet_sha256);
    const duplicate = await dispatchResumeReady({ harnessRoot: current.harness, controllerId, expectedRevision: recovered.revision, at: "2026-07-28T15:00:05.000Z" });
    assert.equal(duplicate.idempotent, true);
    assert.equal((await reconstructHarness(current.harness)).state.node_runs.length, 1);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("only the active controller writer can dispatch and freeze prevents any later wake", async () => {
  const current = await fixture();
  try {
    const initial = await reconstructHarness(current.harness);
    await assert.rejects(activateControllerWriter({ harnessRoot: current.harness, controllerId, controllerKind: "server", expectedRevision: initial.revision, at: "2026-07-28T15:01:00.000Z", snapshot: snapshot(initial) }), /DISPATCHER_LOCAL_FREEZE_REQUIRED/);
    const local = await activateControllerWriter({ harnessRoot: current.harness, controllerId: initial.state.controller.executor_id, controllerKind: "local", expectedRevision: initial.revision, at: "2026-07-28T15:01:01.000Z", snapshot: snapshot(initial) });
    const active = await reconstructHarness(current.harness);
    await assert.rejects(activateControllerWriter({ harnessRoot: current.harness, controllerId: "local-controller", controllerKind: "local", expectedRevision: local.state.revision, at: "2026-07-28T15:01:02.000Z", snapshot: snapshot(active) }), /DISPATCHER_DUAL_WRITER_REJECTED/);
    await assert.rejects(dispatchResumeReady({ harnessRoot: current.harness, controllerId: "local-controller", expectedRevision: local.state.revision, at: "2026-07-28T15:01:03.000Z" }), /DISPATCHER_DUAL_WRITER_REJECTED/);
    const frozen = await freezeControllerWriter({ harnessRoot: current.harness, controllerId: initial.state.controller.executor_id, expectedRevision: local.state.revision, at: "2026-07-28T15:01:04.000Z", snapshot: snapshot(active) });
    await assert.rejects(dispatchResumeReady({ harnessRoot: current.harness, controllerId: initial.state.controller.executor_id, expectedRevision: frozen.state.revision, at: "2026-07-28T15:01:05.000Z" }), /DISPATCHER_CONTROLLER_NOT_ACTIVE/);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("dispatcher preserves parent packet binding and parent writer locks", async () => {
  const current = await fixture();
  try {
    const before = await reconstructHarness(current.harness);
    const local = await activateControllerWriter({ harnessRoot: current.harness, controllerId: before.state.controller.executor_id, controllerKind: "local", expectedRevision: before.revision, at: "2026-07-28T15:02:00.000Z", snapshot: snapshot(before) });
    const localState = await reconstructHarness(current.harness);
    await freezeControllerWriter({ harnessRoot: current.harness, controllerId: before.state.controller.executor_id, expectedRevision: local.state.revision, at: "2026-07-28T15:02:01.000Z", snapshot: snapshot(localState) });
    const frozen = await reconstructHarness(current.harness);
    const activation = await activateControllerWriter({ harnessRoot: current.harness, controllerId, controllerKind: "server", expectedRevision: frozen.revision, at: "2026-07-28T15:02:02.000Z", snapshot: snapshot(frozen) });
    const ready = await markResumeReady({ harnessRoot: current.harness, controllerId, expectedRevision: activation.state.revision, at: "2026-07-28T15:02:03.000Z", resumeNode: "controlled_private_face_processor_deployment", nextExternalAction: "controlled_release" });
    const result = await dispatchResumeReady({ harnessRoot: current.harness, controllerId, expectedRevision: ready.state.revision, at: "2026-07-28T15:02:04.000Z" });
    assert.equal(result.state.active_claim.task_id, before.state.active_claim.task_id);
    assert.deepEqual(result.state.writer_locks, before.state.writer_locks);
    assert.equal(result.state.node_runs[0].packet_sha256, before.state.queue[0].packet_sha256);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("production checkpoint binds the formal task, survives reconstruction, and claims its resume node once", async () => {
  const current = await fixture();
  try {
    const initial = await reconstructHarness(current.harness);
    const local = await activateControllerWriter({ harnessRoot: current.harness, controllerId: initial.state.controller.executor_id, controllerKind: "local", expectedRevision: initial.revision, at: "2026-07-28T15:03:00.000Z", snapshot: snapshot(initial) });
    const active = await reconstructHarness(current.harness);
    await freezeControllerWriter({ harnessRoot: current.harness, controllerId: initial.state.controller.executor_id, expectedRevision: local.state.revision, at: "2026-07-28T15:03:01.000Z", snapshot: snapshot(active) });
    const frozen = await reconstructHarness(current.harness);
    const server = await activateControllerWriter({ harnessRoot: current.harness, controllerId, controllerKind: "server", expectedRevision: frozen.revision, at: "2026-07-28T15:03:02.000Z", snapshot: snapshot(frozen) });
    const binding = snapshot(server).production_task_binding;
    const reconciliation = { production_task_id: binding.production_task_id, updated_at: "2026-07-28T15:03:03.000Z", observed_at: "2026-07-28T15:03:03.000Z", status: "running", blocker: null, provider_task_id: null, provider_receipt_present: false, worker_state: "running" };
    const checkpoint = await checkpointProductionTruth({ harnessRoot: current.harness, controllerId, expectedRevision: server.state.revision, at: "2026-07-28T15:03:04.000Z", productionTaskBinding: binding, reconciliation, nextCheckAt: "2099-01-01T00:00:00.000Z", nextExternalAction: "observe_existing_windows_worker_or_reconcile_safe_recovery" });
    assert.equal(checkpoint.event.type, "controller_checkpoint");
    const restored = await reconstructHarness(current.harness);
    assert.equal(restored.state.production_task_binding.production_task_id, "aPh_FVncAV5fdhK3z8lCrCTv");
    assert.equal(restored.state.controller_liveness.resume_node, "observe_windows_worker_progress");
    assert.equal(restored.state.controller.status, "claimed");
    const claim = await dispatchCheckpointResume({ harnessRoot: current.harness, controllerId, expectedRevision: restored.revision, at: "2026-07-28T15:03:05.000Z" });
    assert.equal(claim.event.type, "resume_node_claimed");
    const duplicate = await dispatchCheckpointResume({ harnessRoot: current.harness, controllerId, expectedRevision: claim.state.revision, at: "2026-07-28T15:03:06.000Z" });
    assert.equal(duplicate.idempotent, true);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("production checkpoint rejects wrong formal task without changing harness bytes", async () => {
  const current = await fixture();
  try {
    const before = await reconstructHarness(current.harness);
    const local = await activateControllerWriter({ harnessRoot: current.harness, controllerId: before.state.controller.executor_id, controllerKind: "local", expectedRevision: before.revision, at: "2026-07-28T15:04:00.000Z", snapshot: snapshot(before) });
    const active = await reconstructHarness(current.harness);
    await freezeControllerWriter({ harnessRoot: current.harness, controllerId: before.state.controller.executor_id, expectedRevision: local.state.revision, at: "2026-07-28T15:04:01.000Z", snapshot: snapshot(active) });
    const frozen = await reconstructHarness(current.harness);
    const server = await activateControllerWriter({ harnessRoot: current.harness, controllerId, controllerKind: "server", expectedRevision: frozen.revision, at: "2026-07-28T15:04:02.000Z", snapshot: snapshot(frozen) });
    const bytes = await Promise.all([readFile(path.join(current.harness, "state.json")), readFile(path.join(current.harness, "events.jsonl"))]);
    const binding = { ...snapshot(server).production_task_binding, production_task_id: "wrong-task" };
    await assert.rejects(checkpointProductionTruth({ harnessRoot: current.harness, controllerId, expectedRevision: server.state.revision, at: "2026-07-28T15:04:03.000Z", productionTaskBinding: binding, reconciliation: { production_task_id: "wrong-task", updated_at: "2026-07-28T15:04:03.000Z", observed_at: "2026-07-28T15:04:03.000Z", status: "running", provider_task_id: null, provider_receipt_present: false, worker_state: "not_running" }, nextCheckAt: "2099-01-01T00:00:00.000Z", nextExternalAction: "observe" }), /DISPATCHER_PRODUCTION_TASK_ID_INVALID/);
    assert.deepEqual(await Promise.all([readFile(path.join(current.harness, "state.json")), readFile(path.join(current.harness, "events.jsonl"))]), bytes);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});
