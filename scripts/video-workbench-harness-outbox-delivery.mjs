import { createHash } from "node:crypto";
import { appendDispatcherEventCas } from "./video-workbench-harness-state.mjs";
import { reconstructHarness } from "./video-workbench-harness-dispatcher.mjs";

const HANDOFF_SCHEMA = "niannian_controller_outbox_handoff_v1";
const DELIVERABLE_EVENT_TYPES = new Set([
  "user_action_blocked",
  "user_acceptance_required",
  "delivery_completed",
]);

function fail(code) { throw new Error(code); }

function branchFor(event) {
  if (event.event_type === "user_acceptance_required" || event.event_type === "delivery_completed") return "user_acceptance_required";
  if (event.event_type === "user_action_blocked") return "user_action_blocked";
  return "user_acceptance_required";
}

function handoffEventId(event) {
  return `controller-outbox:${event.event_revision}:${createHash("sha256").update(event.dedupe_key, "utf8").digest("hex").slice(0, 16)}`;
}

function assertActiveWriter(state, controllerId) {
  if (state.controller_writer?.mode !== "active") fail("MASTER_DELIVERY_CONTROLLER_NOT_ACTIVE");
  if (state.controller_writer.controller_id !== controllerId) fail("MASTER_DELIVERY_DUAL_WRITER_REJECTED");
}

export function buildChineseTypedHandoff({ outbox, sourceThreadId }) {
  if (!outbox || !sourceThreadId || !DELIVERABLE_EVENT_TYPES.has(outbox.event_type)) fail("MASTER_DELIVERY_HANDOFF_INVALID");
  const eventId = handoffEventId(outbox);
  const payload = {
    schema: HANDOFF_SCHEMA,
    type: "controller_outbox_handoff",
    说明: "这是流程治理框架的持久化主控交接；仅用于用户动作、用户验收或最终交付，按 dedupe_key 只消费一次。",
    source_thread_id: sourceThreadId,
    event_id: eventId,
    dedupe_key: outbox.dedupe_key,
    project_id: outbox.project_id,
    formal_task_id: outbox.formal_task_id,
    harness_task_id: outbox.harness_task_id,
    packet_sha: outbox.packet_sha,
    event_type: outbox.event_type,
    node: outbox.node,
    status: outbox.status,
    evidence_refs: outbox.evidence_refs,
    next_resume: outbox.next_resume,
    required_master_branch: branchFor(outbox),
    occurred_at: outbox.occurred_at,
  };
  return { eventId, payload, prompt: JSON.stringify(payload) };
}

export function nextUndeliveredControllerOutbox(state, dedupeKey = null) {
  const delivered = new Set(state.master_delivery_cursor?.delivered_dedupe_keys ?? []);
  const candidates = (state.controller_outbox ?? []).filter((item) => DELIVERABLE_EVENT_TYPES.has(item.event_type)
    && !item.acknowledged
    && !item.delivery
    && !delivered.has(item.dedupe_key)
    && (!dedupeKey || item.dedupe_key === dedupeKey));
  return candidates.sort((left, right) => left.event_revision - right.event_revision)[0] ?? null;
}

export async function deliverControllerOutbox({ harnessRoot, controllerId, sourceThreadId, sender, at, dedupeKey = null }) {
  if (typeof sender !== "function") fail("MASTER_DELIVERY_SENDER_REQUIRED");
  const current = await reconstructHarness(harnessRoot);
  assertActiveWriter(current.state, controllerId);
  const outbox = nextUndeliveredControllerOutbox(current.state, dedupeKey);
  if (!outbox) {
    if (dedupeKey && (current.state.master_delivery_cursor?.delivered_dedupe_keys ?? []).includes(dedupeKey)) return { idempotent: true, state: current.state };
    return { idle: true, state: current.state };
  }
  const handoff = buildChineseTypedHandoff({ outbox, sourceThreadId });
  // The sender is deliberately injected. Production integration owns the Codex API call;
  // this project contract records a cursor only after that call resolves successfully.
  await sender({ threadId: sourceThreadId, prompt: handoff.prompt, dedupeKey: outbox.dedupe_key, eventId: handoff.eventId });
  return appendDispatcherEventCas({
    harnessRoot,
    expectedRevision: current.revision,
    event: {
      type: "master_handoff_delivered",
      at,
      dedupe_key: outbox.dedupe_key,
      event_id: handoff.eventId,
      delivery_id: `delivery:${handoff.eventId}`,
      target_thread_id: sourceThreadId,
    },
  });
}
