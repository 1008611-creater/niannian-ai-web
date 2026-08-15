import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activateControllerWriter, consumeControllerOutbox, createResumeEnvelope, reconstructHarness } from "./video-workbench-harness-dispatcher.mjs";
import { appendDispatcherEventCas, parseEventLedger, reduceEvents } from "./video-workbench-harness-state.mjs";
import { buildChineseTypedHandoff, deliverControllerOutbox } from "./video-workbench-harness-outbox-delivery.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sourceHarness = path.join(root, "docs", "agent-team", "video-workbench-harness-v1");
const controllerId = "outbox-delivery-test-server";
const sourceThreadId = "source-master-test-thread";
const packetId = "NIANNIAN-WB-REAL-I2V-4S-20260728-01";

function snapshot(result) {
  const packetSha = result.state.queue.find((item) => item.task_id === packetId)?.packet_sha256;
  return {
    revision: result.revision,
    event_head_hash: result.eventHeadHash,
    active_claim: result.state.active_claim,
    writer_locks: result.state.writer_locks,
    decisions: result.state.decisions,
    packet_sha256: packetSha,
    production_task_binding: result.state.production_task_binding ?? result.state.controller_writer?.snapshot?.production_task_binding,
  };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "niannian-outbox-delivery-"));
  const harness = path.join(directory, "harness");
  await cp(sourceHarness, harness, { recursive: true });
  const [eventText, stateText] = await Promise.all([readFile(path.join(harness, "events.jsonl"), "utf8"), readFile(path.join(harness, "state.json"), "utf8")]);
  const state = { ...JSON.parse(stateText), ...reduceEvents(parseEventLedger(eventText)) };
  await writeFile(path.join(harness, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
  const before = await reconstructHarness(harness);
  const activated = await activateControllerWriter({ harnessRoot: harness, controllerId, controllerKind: "server", expectedRevision: before.revision, at: "2026-07-28T22:00:00.000Z", snapshot: snapshot(before) });
  const escalated = await appendDispatcherEventCas({
    harnessRoot: harness,
    expectedRevision: activated.state.revision,
    event: {
      type: "controller_transition", at: "2026-07-28T22:00:00.500Z", task_id: packetId,
      controller_status: "blocked_user_action", resume_node: "user_acceptance", next_wake_at: "2099-01-01T00:00:00.000Z", observed_at: "2026-07-28T22:00:00.500Z", next_external_action: "await_user_acceptance",
      outbox: { project_id: "niannian-ai-video-workbench", formal_task_id: "aPh_FVncAV5fdhK3z8lCrCTv", harness_task_id: packetId, packet_sha: (activated.state.production_task_binding ?? activated.state.controller_writer?.snapshot?.production_task_binding).packet_sha256, event_type: "user_acceptance_required", node: "user_acceptance", status: "ready", evidence_refs: ["verified_candidate"], next_resume: "user_acceptance", occurred_at: "2026-07-28T22:00:00.500Z", dedupe_key: "test:user-acceptance" },
    },
  });
  return { directory, harness, state: escalated.state };
}

async function appendPreexistingResumeClaim({ harnessRoot, packetSha, nodeId, at }) {
  const current = await reconstructHarness(harnessRoot);
  return appendDispatcherEventCas({
    harnessRoot,
    expectedRevision: current.revision,
    event: {
      type: "resume_node_claimed",
      at,
      task_id: packetId,
      packet_sha256: packetSha,
      node_id: nodeId,
      controller_id: controllerId,
      next_external_action: "preexisting_exact_resume_claim",
    },
  });
}

test("中文 typed handoff binds the source master and required controller facts", () => {
  const outbox = {
    event_revision: 53,
    dedupe_key: "checkpoint:test",
    project_id: "niannian-ai-video-workbench",
    formal_task_id: "aPh_FVncAV5fdhK3z8lCrCTv",
    harness_task_id: packetId,
    packet_sha: "a".repeat(64),
    event_type: "user_action_blocked",
    node: "production_task_reconciliation_required",
    status: "active",
    evidence_refs: ["只读对账"],
    next_resume: "production_task_reconciliation_required",
    occurred_at: "2026-07-28T22:00:00.000Z",
  };
  const handoff = buildChineseTypedHandoff({ outbox, sourceThreadId });
  const parsed = JSON.parse(handoff.prompt);
  assert.equal(parsed.source_thread_id, sourceThreadId);
  assert.equal(parsed.dedupe_key, outbox.dedupe_key);
  assert.equal(parsed.required_master_branch, "user_action_blocked");
  assert.match(parsed.说明, /持久化主控交接/);
});

test("成功投递后才写 master_delivery_cursor，重试同一 dedupe 不再次发送", async () => {
  const current = await fixture();
  try {
    const target = current.state.controller_outbox.find((item) => item.dedupe_key === "test:user-acceptance");
    assert.ok(target);
    const calls = [];
    const sender = async (input) => { calls.push(input); };
    const delivered = await deliverControllerOutbox({ harnessRoot: current.harness, controllerId, sourceThreadId, sender, at: "2026-07-28T22:00:01.000Z", dedupeKey: target.dedupe_key });
    assert.equal(calls.length, 1);
    assert.equal(delivered.state.master_delivery_cursor.last_dedupe_key, target.dedupe_key);
    assert.equal(delivered.state.controller_outbox.find((item) => item.dedupe_key === target.dedupe_key).delivery.target_thread_id, sourceThreadId);
    const retry = await deliverControllerOutbox({ harnessRoot: current.harness, controllerId, sourceThreadId, sender, at: "2026-07-28T22:00:02.000Z", dedupeKey: target.dedupe_key });
    assert.equal(retry.idempotent, true);
    assert.equal(calls.length, 1);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("投递失败不写 cursor 或 ack，成功重试后主控 ack 保持原有 cursor", async () => {
  const current = await fixture();
  try {
    const target = current.state.controller_outbox.find((item) => item.dedupe_key === "test:user-acceptance");
    assert.ok(target);
    await assert.rejects(deliverControllerOutbox({
      harnessRoot: current.harness, controllerId, sourceThreadId,
      sender: async () => { throw new Error("TEST_SENDER_UNAVAILABLE"); },
      at: "2026-07-28T22:01:00.000Z", dedupeKey: target.dedupe_key,
    }), /TEST_SENDER_UNAVAILABLE/);
    const afterFailure = await reconstructHarness(current.harness);
    assert.ok(!afterFailure.state.master_delivery_cursor.delivered_dedupe_keys.includes(target.dedupe_key));
    assert.ok(!afterFailure.state.master_ack_cursor.acknowledged_dedupe_keys.includes(target.dedupe_key));
    const delivered = await deliverControllerOutbox({ harnessRoot: current.harness, controllerId, sourceThreadId, sender: async () => undefined, at: "2026-07-28T22:01:01.000Z", dedupeKey: target.dedupe_key });
    const outbox = delivered.state.controller_outbox.find((item) => item.dedupe_key === target.dedupe_key);
    const envelope = createResumeEnvelope({ outbox, resumeNode: outbox.next_resume, occurredAt: "2026-07-28T22:01:02.000Z" });
    const ack = await consumeControllerOutbox({ harnessRoot: current.harness, controllerId, expectedRevision: delivered.state.revision, dedupeKey: target.dedupe_key, disposition: "auto_approve_and_continue", nextEnvelope: envelope, at: "2026-07-28T22:01:02.000Z" });
    assert.equal(ack.state.master_ack_cursor.last_dedupe_key, target.dedupe_key);
    assert.equal(ack.state.master_delivery_cursor.last_dedupe_key, target.dedupe_key);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("未投递的直接主控 ack 被拒绝，成功投递后才可 ack 且重建一致", async () => {
  const current = await fixture();
  try {
    const target = current.state.controller_outbox.find((item) => item.dedupe_key === "test:user-acceptance");
    assert.ok(target);
    const envelope = createResumeEnvelope({ outbox: target, resumeNode: target.next_resume, occurredAt: "2026-07-28T22:02:00.000Z" });
    const before = await reconstructHarness(current.harness);
    await assert.rejects(consumeControllerOutbox({
      harnessRoot: current.harness,
      controllerId,
      expectedRevision: before.revision,
      dedupeKey: target.dedupe_key,
      disposition: "auto_approve_and_continue",
      nextEnvelope: envelope,
      at: "2026-07-28T22:02:00.000Z",
    }), /MASTER_ACK_DELIVERY_REQUIRED/);
    const rejected = await reconstructHarness(current.harness);
    assert.equal(rejected.revision, before.revision);
    assert.ok(!rejected.state.master_ack_cursor.acknowledged_dedupe_keys.includes(target.dedupe_key));
    const delivered = await deliverControllerOutbox({ harnessRoot: current.harness, controllerId, sourceThreadId, sender: async () => undefined, at: "2026-07-28T22:02:01.000Z", dedupeKey: target.dedupe_key });
    const deliveredOutbox = delivered.state.controller_outbox.find((item) => item.dedupe_key === target.dedupe_key);
    const deliveredEnvelope = createResumeEnvelope({ outbox: deliveredOutbox, resumeNode: deliveredOutbox.next_resume, occurredAt: "2026-07-28T22:02:02.000Z" });
    const ack = await consumeControllerOutbox({ harnessRoot: current.harness, controllerId, expectedRevision: delivered.state.revision, dedupeKey: target.dedupe_key, disposition: "auto_approve_and_continue", nextEnvelope: deliveredEnvelope, at: "2026-07-28T22:02:02.000Z" });
    const rebuilt = await reconstructHarness(current.harness);
    assert.equal(rebuilt.revision, ack.state.revision);
    assert.equal(rebuilt.state.master_ack_cursor.last_dedupe_key, target.dedupe_key);
    assert.equal(rebuilt.state.master_delivery_cursor.last_dedupe_key, target.dedupe_key);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("已存在完全匹配的 resume claim 时 ack 幂等消费，不新增 node run", async () => {
  const current = await fixture();
  try {
    const target = current.state.controller_outbox.find((item) => item.dedupe_key === "test:user-acceptance");
    assert.ok(target);
    const existing = await appendPreexistingResumeClaim({ harnessRoot: current.harness, packetSha: target.packet_sha, nodeId: target.next_resume, at: "2026-07-28T22:03:00.000Z" });
    const nodeRunsBefore = existing.state.node_runs.length;
    const delivered = await deliverControllerOutbox({ harnessRoot: current.harness, controllerId, sourceThreadId, sender: async () => undefined, at: "2026-07-28T22:03:01.000Z", dedupeKey: target.dedupe_key });
    const outbox = delivered.state.controller_outbox.find((item) => item.dedupe_key === target.dedupe_key);
    const envelope = createResumeEnvelope({ outbox, resumeNode: outbox.next_resume, occurredAt: "2026-07-28T22:03:02.000Z" });
    const ack = await consumeControllerOutbox({ harnessRoot: current.harness, controllerId, expectedRevision: delivered.state.revision, dedupeKey: target.dedupe_key, disposition: "auto_approve_and_continue", nextEnvelope: envelope, at: "2026-07-28T22:03:02.000Z" });
    assert.equal(ack.state.node_runs.length, nodeRunsBefore);
    assert.equal(ack.state.master_ack_cursor.last_dedupe_key, target.dedupe_key);
    assert.equal((await reconstructHarness(current.harness)).state.node_runs.length, nodeRunsBefore);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});

test("不匹配的既有 resume claim 拒绝 ack 且不改状态", async () => {
  const current = await fixture();
  try {
    const target = current.state.controller_outbox.find((item) => item.dedupe_key === "test:user-acceptance");
    assert.ok(target);
    await appendPreexistingResumeClaim({ harnessRoot: current.harness, packetSha: "f".repeat(64), nodeId: target.next_resume, at: "2026-07-28T22:04:00.000Z" });
    const delivered = await deliverControllerOutbox({ harnessRoot: current.harness, controllerId, sourceThreadId, sender: async () => undefined, at: "2026-07-28T22:04:01.000Z", dedupeKey: target.dedupe_key });
    const outbox = delivered.state.controller_outbox.find((item) => item.dedupe_key === target.dedupe_key);
    const envelope = createResumeEnvelope({ outbox, resumeNode: outbox.next_resume, occurredAt: "2026-07-28T22:04:02.000Z" });
    const before = await reconstructHarness(current.harness);
    await assert.rejects(consumeControllerOutbox({ harnessRoot: current.harness, controllerId, expectedRevision: before.revision, dedupeKey: target.dedupe_key, disposition: "auto_approve_and_continue", nextEnvelope: envelope, at: "2026-07-28T22:04:02.000Z" }), /MASTER_OUTBOX_RESUME_CLAIM_CONFLICT/);
    const after = await reconstructHarness(current.harness);
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.state.node_runs, before.state.node_runs);
    assert.deepEqual(after.state.master_ack_cursor, before.state.master_ack_cursor);
  } finally { await rm(current.directory, { recursive: true, force: true }); }
});
