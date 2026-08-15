import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const zeroEventHash = "0".repeat(64);
export const controllerOutboxEventTypes = new Set([
  "implementation_completed",
  "independent_acceptance_passed",
  "independent_acceptance_failed",
  "post_coding_review_completed",
  "deployment_verified",
  "worker_progressed",
  "delivery_completed",
  "external_blocked",
  "progress_checkpoint",
  "user_acceptance_required",
  "auto_approve_and_continue",
  "user_action_blocked",
]);
export const escalationOutboxEventTypes = new Set(["user_action_blocked", "user_acceptance_required", "delivery_completed"]);
const legacyOutboxCutoffRevision = Number(process.env.NIANNIAN_HARNESS_LEGACY_OUTBOX_CUTOFF_REVISION ?? 51);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isFutureTimestamp(value) {
  const time = Date.parse(String(value));
  return Number.isFinite(time) && time > Date.now();
}

function isFutureFrom(value, reference) {
  const time = Date.parse(String(value));
  const base = Date.parse(String(reference));
  return Number.isFinite(time) && Number.isFinite(base) && time > base;
}

function hasValidFutureLiveness(liveness) {
  return Boolean(liveness) && isFutureFrom(liveness.next_check_at, liveness.observed_at);
}

function hasFutureEventWake(event, wakeField) {
  return isFutureFrom(event[wakeField], event.observed_at ?? event.at);
}

function assertNoIdleWithActiveWork(state) {
  const activeChildren = (state.child_work_items ?? []).some((item) => item.state === "active");
  const activeBackground = (state.background_work ?? []).some((item) => item.state === "active");
  if ((state.active_claim || activeChildren || activeBackground) && ["idle", "idle_no_task", "completed_verified", "rejected"].includes(state.controller?.status)) {
    throw new Error("DISPATCHER_ACTIVE_WORK_IDLE_INVALID");
  }
  // A checkpoint is measured from the observation that produced it. Later
  // append-only evidence must not retroactively make that observation invalid.
  if ((activeChildren || activeBackground) && !hasValidFutureLiveness(state.controller_liveness)) {
    throw new Error("DISPATCHER_ACTIVE_WORK_NEXT_WAKE_MISSING");
  }
}

function hasActiveChildOrBackground(state) {
  return (state.child_work_items ?? []).some((item) => item.state === "active") || (state.background_work ?? []).some((item) => item.state === "active");
}

function assertTerminalTransition(event) {
  if (!["idle", "idle_no_task", "completed_verified", "rejected"].includes(event.controller_status)) return;
  if (!event.outbox || !["delivery_completed", "user_action_blocked", "external_blocked"].includes(event.outbox.event_type)) throw new Error("DISPATCHER_NONTERMINAL_STOP_INVALID");
}

function applyOutboxProjection(state, event) {
  if (!event.outbox) return;
  const outbox = event.outbox;
  if (!controllerOutboxEventTypes.has(outbox.event_type)) throw new Error("CONTROLLER_OUTBOX_EVENT_TYPE_INVALID");
  // Revisions 1-51 are immutable noisy history. New writes must use the small
  // escalation/delivery outbox; internal progress remains ledger-only.
  if (event.revision > legacyOutboxCutoffRevision && !escalationOutboxEventTypes.has(outbox.event_type)) throw new Error("CONTROLLER_OUTBOX_INTERNAL_EVENT_FORBIDDEN");
  const required = ["project_id", "formal_task_id", "harness_task_id", "packet_sha", "event_type", "node", "status", "evidence_refs", "next_resume", "occurred_at", "dedupe_key"];
  if (required.some((key) => outbox[key] === undefined || outbox[key] === null) || !Array.isArray(outbox.evidence_refs) || !outbox.dedupe_key) throw new Error("CONTROLLER_OUTBOX_FIELDS_INVALID");
  state.controller_outbox ??= [];
  if (state.controller_outbox.some((item) => item.dedupe_key === outbox.dedupe_key)) throw new Error("CONTROLLER_OUTBOX_DEDUPE_CONFLICT");
  state.controller_outbox.push({ ...outbox, event_revision: event.revision, acknowledged: false });
}

function applyOutboxAckProjection(state, event) {
  state.controller_outbox ??= [];
  state.master_ack_cursor ??= { acknowledged_dedupe_keys: [], last_dedupe_key: null, updated_at: null };
  const item = state.controller_outbox.find((entry) => entry.dedupe_key === event.dedupe_key);
  if (!item) throw new Error("MASTER_ACK_OUTBOX_NOT_FOUND");
  if (item.acknowledged || state.master_ack_cursor.acknowledged_dedupe_keys.includes(event.dedupe_key)) throw new Error("MASTER_ACK_DUPLICATE");
  item.acknowledged = true;
  state.master_ack_cursor = {
    acknowledged_dedupe_keys: [...state.master_ack_cursor.acknowledged_dedupe_keys, event.dedupe_key],
    last_dedupe_key: event.dedupe_key,
    updated_at: event.at,
    last_disposition: event.disposition ?? "acknowledged",
  };
}

function applyMasterDeliveryProjection(state, event) {
  state.controller_outbox ??= [];
  state.master_delivery_cursor ??= { delivered_dedupe_keys: [], last_dedupe_key: null, last_event_id: null, target_thread_id: null, delivered_at: null };
  const item = state.controller_outbox.find((entry) => entry.dedupe_key === event.dedupe_key);
  if (!item) throw new Error("MASTER_DELIVERY_OUTBOX_NOT_FOUND");
  if (!event.event_id || !event.target_thread_id || !event.delivery_id) throw new Error("MASTER_DELIVERY_FIELDS_INVALID");
  if (item.delivery || state.master_delivery_cursor.delivered_dedupe_keys.includes(event.dedupe_key)) throw new Error("MASTER_DELIVERY_DUPLICATE");
  item.delivery = {
    delivery_id: event.delivery_id,
    event_id: event.event_id,
    target_thread_id: event.target_thread_id,
    delivered_at: event.at,
  };
  state.master_delivery_cursor = {
    delivered_dedupe_keys: [...state.master_delivery_cursor.delivered_dedupe_keys, event.dedupe_key],
    last_dedupe_key: event.dedupe_key,
    last_event_id: event.event_id,
    target_thread_id: event.target_thread_id,
    delivered_at: event.at,
  };
}

export function nextEligibleControllerOutbox(state) {
  const claim = state.active_claim;
  const liveness = state.controller_liveness;
  if (!claim || !liveness?.resume_node) return null;
  const packetSha = state.queue?.find((item) => item.task_id === claim.task_id)?.packet_sha256;
  const candidates = (state.controller_outbox ?? []).filter((item) => escalationOutboxEventTypes.has(item.event_type)
    && !item.acknowledged
    && item.harness_task_id === claim.task_id
    && item.packet_sha === packetSha
    && item.next_resume === liveness.resume_node
    && !(hasActiveChildOrBackground(state) && item.event_type === "progress_checkpoint"));
  return candidates.sort((left, right) => right.event_revision - left.event_revision)[0] ?? null;
}

function applyMasterOutboxConsumption(state, event) {
  if (!["user_acceptance_required", "auto_approve_and_continue", "user_action_blocked"].includes(event.disposition)) throw new Error("MASTER_OUTBOX_DISPOSITION_INVALID");
  // Revisions 1-51 are immutable pre-delivery history. Every current event,
  // including a malformed direct append with no causal version, must prove
  // an earlier sender success before it can acknowledge an outbox entry.
  const requiresDelivery = event.revision >= 52;
  const deliveryCursor = state.master_delivery_cursor ?? { delivered_dedupe_keys: [] };
  const deliveryOutbox = (state.controller_outbox ?? []).find((item) => item.dedupe_key === event.dedupe_key);
  if (requiresDelivery && (!deliveryOutbox?.delivery
    || deliveryOutbox.delivery.event_id == null
    || deliveryOutbox.delivery.delivery_id == null
    || !deliveryCursor.delivered_dedupe_keys.includes(event.dedupe_key))) throw new Error("MASTER_ACK_DELIVERY_REQUIRED");
  if (event.causal_version === 1) {
    const consumedOutbox = (state.controller_outbox ?? []).find((item) => item.dedupe_key === event.dedupe_key);
    if (!consumedOutbox) throw new Error("MASTER_ACK_OUTBOX_NOT_FOUND");
    if (nextEligibleControllerOutbox(state)?.dedupe_key !== consumedOutbox.dedupe_key) throw new Error("MASTER_OUTBOX_NOT_ELIGIBLE");
  }
  if (event.causal_version === 1 && event.disposition === "auto_approve_and_continue" && !Object.hasOwn(event, "resume_node_claim")) throw new Error("MASTER_OUTBOX_RESUME_CLAIM_REQUIRED");
  if (event.disposition === "auto_approve_and_continue" && Object.hasOwn(event, "resume_node_claim")) {
    const envelope = event.next_envelope;
    const outbox = (state.controller_outbox ?? []).find((item) => item.dedupe_key === event.dedupe_key);
    if (!outbox) throw new Error("MASTER_ACK_OUTBOX_NOT_FOUND");
    if (nextEligibleControllerOutbox(state)?.dedupe_key !== outbox.dedupe_key) throw new Error("MASTER_OUTBOX_NOT_ELIGIBLE");
    if (!envelope || envelope.schema !== "niannian_controller_resume_envelope_v1" || !envelope.immutable_sha256 || !envelope.resume_node) throw new Error("MASTER_OUTBOX_ENVELOPE_INVALID");
    for (const key of ["project_id", "formal_task_id", "harness_task_id", "packet_sha", "parent_dedupe_key"]) {
      const expected = key === "parent_dedupe_key" ? outbox.dedupe_key : outbox[key];
      if (envelope[key] !== expected) throw new Error("MASTER_OUTBOX_ENVELOPE_BINDING_MISMATCH");
    }
    const { immutable_sha256: _sha, ...withoutHash } = envelope;
    if (sha256(Buffer.from(JSON.stringify(withoutHash), "utf8")) !== envelope.immutable_sha256) throw new Error("MASTER_OUTBOX_ENVELOPE_HASH_INVALID");
  }
  if (event.disposition === "auto_approve_and_continue" && Object.hasOwn(event, "resume_node_claim")) {
    const claim = event.resume_node_claim;
    const parent = state.active_claim;
    const envelope = event.next_envelope;
    if (!claim || !parent || claim.task_id !== parent.task_id || claim.packet_sha256 !== envelope.packet_sha || claim.node_id !== envelope.resume_node) throw new Error("MASTER_OUTBOX_RESUME_CLAIM_INVALID");
    const claimedRuns = (state.node_runs ?? []).filter((run) => run.node_id === claim.node_id && run.state === "claimed");
    const exactClaim = claimedRuns.find((run) => run.task_id === claim.task_id && run.packet_sha256 === claim.packet_sha256);
    if (claimedRuns.some((run) => run.task_id !== claim.task_id || run.packet_sha256 !== claim.packet_sha256)) throw new Error("MASTER_OUTBOX_RESUME_CLAIM_CONFLICT");
    state.node_runs ??= [];
    if (!exactClaim) state.node_runs.push({ task_id: claim.task_id, packet_sha256: claim.packet_sha256, node_id: claim.node_id, state: "claimed", controller_id: event.controller_id, claimed_at: event.at, source_outbox_dedupe_key: event.dedupe_key });
    state.controller.status = "claimed";
    state.earliest_unsatisfied_node = `${claim.task_id}:${claim.node_id}`;
    state.next_external_action = "dispatch_claimed_resume_node";
  }
  applyOutboxAckProjection(state, event);
  state.master_handoffs ??= [];
  state.master_handoffs.push({ dedupe_key: event.dedupe_key, disposition: event.disposition, next_envelope: event.next_envelope ?? null, consumed_at: event.at });
}

export function eventHash(event) {
  const { hash: _hash, ...withoutHash } = event;
  return createHash("sha256").update(`${event.previous_hash}${JSON.stringify(withoutHash)}`, "utf8").digest("hex");
}

export function parseEventLedger(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function validateEventChain(events) {
  let previous = zeroEventHash;
  let revision = 0;
  for (const event of events) {
    if (event.revision !== revision + 1) throw new Error("EVENT_REVISION_INVALID");
    if (event.previous_hash !== previous) throw new Error("EVENT_PREVIOUS_HASH_INVALID");
    if (event.hash !== eventHash(event)) throw new Error("EVENT_HASH_INVALID");
    previous = event.hash;
    revision = event.revision;
  }
  return { revision, headHash: previous };
}

export function reduceEvents(events) {
  const reduced = {
    revision: 0,
    updated_at: null,
    controller: null,
    queue: [],
    active_claim: null,
    writer_locks: [],
    dependency_status: {},
    decisions: [],
    earliest_unsatisfied_node: null,
    next_external_action: null,
    repair_work_items: [],
    node_runs: [],
    controller_writer: null,
    production_task_binding: null,
    controller_liveness: null,
    child_work_items: [],
    background_work: [],
    controller_outbox: [],
    master_delivery_cursor: { delivered_dedupe_keys: [], last_dedupe_key: null, last_event_id: null, target_thread_id: null, delivered_at: null },
    master_ack_cursor: { acknowledged_dedupe_keys: [], last_dedupe_key: null, updated_at: null },
    master_handoffs: [],
  };
  for (const event of events) {
    reduced.revision = event.revision;
    reduced.updated_at = event.at;
    if (event.type === "harness_initialized") {
      reduced.controller = { executor_id: event.executor_id, status: event.controller_status };
      if (event.writer_lock) reduced.writer_locks.push(event.writer_lock);
    }
    if (event.type === "writer_released") {
      reduced.writer_locks = reduced.writer_locks.filter((lock) => !(lock.surface === event.surface && lock.owner === event.owner));
      if (event.controller_status) reduced.controller.status = event.controller_status;
    }
    if (event.type === "packet_adopted") reduced.queue.push({
      task_id: event.task_id,
      packet_sha256: event.packet_sha256,
      state: "adopted",
      dependencies: event.dependencies,
      writer_surfaces: event.writer_surfaces,
      adopted_at: event.at,
      claimed_at: null,
    });
    if (event.type === "queue_transition") {
      const item = reduced.queue.find((entry) => entry.task_id === event.task_id);
      if (!item || item.state !== event.from) throw new Error("EVENT_QUEUE_TRANSITION_INVALID");
      item.state = event.to;
      if (event.dependency_status) Object.assign(reduced.dependency_status, event.dependency_status);
      if (event.earliest_unsatisfied_node) reduced.earliest_unsatisfied_node = event.earliest_unsatisfied_node;
      if (event.next_external_action) reduced.next_external_action = event.next_external_action;
    }
    if (event.type === "task_claimed") {
      const item = reduced.queue.find((entry) => entry.task_id === event.task_id);
      if (!item) throw new Error("EVENT_CLAIM_TASK_MISSING");
      item.state = "claimed";
      item.claimed_at = event.at;
      reduced.active_claim = { task_id: event.task_id, owner: event.owner, claimed_at: event.at };
      reduced.writer_locks.push(...event.writer_locks);
      reduced.controller.status = "claimed";
      reduced.earliest_unsatisfied_node = `${event.task_id}:no_cost_preflight`;
      reduced.next_external_action = "no_cost_preflight_without_external_side_effect";
    }
    if (event.type === "user_decision_superseded") reduced.decisions.push({
      decision_id: event.decision_id,
      task_id: event.task_id,
      packet_sha256: event.packet_sha256,
      packet_mutated: event.packet_mutated,
    });
    if (event.type === "recovery_checkpoint") {
      reduced.writer_locks.push(event.source_writer_lock);
      reduced.controller.status = event.controller_status;
      reduced.earliest_unsatisfied_node = `${event.task_id}:${event.recovery_node}`;
      reduced.next_external_action = "local_internal_repair_candidate_only";
      reduced.repair_work_items.push(event.repair_work_item);
    }
    if (event.type === "repair_completed") {
      reduced.writer_locks = reduced.writer_locks.filter((lock) => !(lock.surface === event.release_writer_lock.surface && lock.owner === event.release_writer_lock.owner && lock.task_id === event.release_writer_lock.task_id));
      const repair = reduced.repair_work_items.find((item) => item.id === event.repair_work_item_id);
      if (!repair) throw new Error("REPAIR_WORK_ITEM_MISSING");
      repair.state = "completed_verified";
    }
    if (event.type === "resume_ready") {
      reduced.controller.status = event.controller_status;
      if (event.production_task_binding) reduced.production_task_binding = event.production_task_binding;
      reduced.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
      reduced.next_external_action = event.next_external_action;
    }
    if (event.type === "controller_writer_frozen") {
      reduced.controller_writer = { mode: "frozen", controller_id: event.controller_id, snapshot: event.snapshot };
    }
    if (event.type === "controller_writer_activated") {
      reduced.controller_writer = { mode: "active", controller_id: event.controller_id, controller_kind: event.controller_kind, snapshot: event.snapshot };
    }
    if (event.type === "controller_checkpoint") {
      if (!reduced.active_claim || reduced.active_claim.task_id !== event.task_id) throw new Error("DISPATCHER_CHECKPOINT_PARENT_CLAIM_MISSING");
      if (event.packet_sha256 !== reduced.queue.find((item) => item.task_id === event.task_id)?.packet_sha256) throw new Error("DISPATCHER_CHECKPOINT_PACKET_MISMATCH");
      if (!hasFutureEventWake({ ...event, observed_at: event.reconciliation?.observed_at }, "next_check_at")) throw new Error("DISPATCHER_CHECKPOINT_LIVENESS_INVALID");
      reduced.production_task_binding = event.production_task_binding;
      reduced.controller_liveness = {
        checkpoint_key: event.checkpoint_key,
        task_id: event.task_id,
        production_task_id: event.production_task_binding.production_task_id,
        resume_node: event.resume_node,
        next_check_at: event.next_check_at,
        observed_at: event.reconciliation.observed_at,
        worker_state: event.reconciliation.worker_state,
        provider_receipt_present: event.reconciliation.provider_receipt_present,
      };
      reduced.controller.status = "claimed";
      reduced.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
      reduced.next_external_action = event.next_external_action;
    }
    if (event.type === "resume_node_claimed") {
      if (!reduced.active_claim || reduced.active_claim.task_id !== event.task_id) throw new Error("RESUME_NODE_PARENT_CLAIM_MISSING");
      if (reduced.node_runs.some((run) => run.task_id === event.task_id && run.node_id === event.node_id && run.state === "claimed")) throw new Error("RESUME_NODE_DUPLICATE_CLAIM");
      reduced.node_runs.push({ task_id: event.task_id, packet_sha256: event.packet_sha256, node_id: event.node_id, state: "claimed", controller_id: event.controller_id, claimed_at: event.at });
      reduced.controller.status = "claimed";
      reduced.earliest_unsatisfied_node = `${event.task_id}:${event.node_id}`;
      reduced.next_external_action = event.next_external_action;
    }
    if (event.type === "resume_node_completed") {
      const run = reduced.node_runs.find((entry) => entry.task_id === event.task_id && entry.node_id === event.node_id && entry.state === "claimed");
      if (!run) throw new Error("RESUME_NODE_COMPLETION_MISSING_CLAIM");
      run.state = "completed_verified";
    }
    if (event.type === "child_work_item_started" || event.type === "background_work_started") {
      const collection = event.type === "child_work_item_started" ? reduced.child_work_items : reduced.background_work;
      if (!event.work_item?.id || collection.some((item) => item.id === event.work_item.id)) throw new Error("DISPATCHER_WORK_ITEM_INVALID");
      if (!event.next_wake_at || !event.resume_node || !hasFutureEventWake(event, "next_wake_at")) throw new Error("DISPATCHER_WORK_ITEM_WAKE_INVALID");
      collection.push({ ...event.work_item, state: "active", started_at: event.at });
      reduced.controller.status = event.controller_status;
      reduced.controller_liveness = { task_id: event.task_id, resume_node: event.resume_node, next_check_at: event.next_wake_at, observed_at: event.observed_at ?? event.at, worker_state: "not_applicable", provider_receipt_present: false };
      reduced.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
      reduced.next_external_action = "await_typed_child_or_background_result";
    }
    if (event.type === "child_work_item_completed" || event.type === "background_work_completed") {
      const collection = event.type === "child_work_item_completed" ? reduced.child_work_items : reduced.background_work;
      const item = collection.find((entry) => entry.id === event.work_item_id && entry.state === "active");
      if (!item) throw new Error("DISPATCHER_WORK_ITEM_COMPLETION_MISSING");
      if (!event.next_wake_at || !event.resume_node || !hasFutureEventWake(event, "next_wake_at")) throw new Error("DISPATCHER_WORK_ITEM_WAKE_INVALID");
      item.state = event.status;
      item.result = event.result;
      item.completed_at = event.at;
      reduced.controller.status = event.controller_status;
      reduced.controller_liveness = { task_id: event.task_id, resume_node: event.resume_node, next_check_at: event.next_wake_at, observed_at: event.observed_at ?? event.at, worker_state: "not_applicable", provider_receipt_present: false };
      reduced.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
      reduced.next_external_action = event.next_external_action;
    }
    if (event.type === "controller_transition") {
      assertTerminalTransition(event);
      if (!event.controller_status || !event.resume_node || !event.next_wake_at || !hasFutureEventWake(event, "next_wake_at")) throw new Error("DISPATCHER_TRANSITION_LIVENESS_INVALID");
      reduced.controller.status = event.controller_status;
      reduced.controller_liveness = { task_id: event.task_id, resume_node: event.resume_node, next_check_at: event.next_wake_at, observed_at: event.observed_at ?? event.at, worker_state: event.worker_state ?? "not_applicable", provider_receipt_present: Boolean(event.provider_receipt_present) };
      reduced.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
      reduced.next_external_action = event.next_external_action;
    }
    if (event.type === "master_handoff_delivered") applyMasterDeliveryProjection(reduced, event);
    if (event.type === "master_outbox_acked") applyOutboxAckProjection(reduced, event);
    if (event.type === "master_outbox_consumed") applyMasterOutboxConsumption(reduced, event);
    applyOutboxProjection(reduced, event);
    assertNoIdleWithActiveWork(reduced);
  }
  return reduced;
}

function applyDispatcherEvent(state, event) {
  state.revision = event.revision;
  state.updated_at = event.at;
  state.node_runs ??= [];
  state.child_work_items ??= [];
  state.background_work ??= [];
  state.controller_outbox ??= [];
  state.master_delivery_cursor ??= { delivered_dedupe_keys: [], last_dedupe_key: null, last_event_id: null, target_thread_id: null, delivered_at: null };
  state.master_ack_cursor ??= { acknowledged_dedupe_keys: [], last_dedupe_key: null, updated_at: null };
  state.master_handoffs ??= [];
  if (event.type === "controller_writer_frozen") {
    state.controller_writer = { mode: "frozen", controller_id: event.controller_id, snapshot: event.snapshot };
  } else if (event.type === "controller_writer_activated") {
    state.controller_writer = { mode: "active", controller_id: event.controller_id, controller_kind: event.controller_kind, snapshot: event.snapshot };
  } else if (event.type === "resume_ready") {
    if (!state.active_claim || state.active_claim.task_id !== event.task_id) throw new Error("RESUME_READY_PARENT_CLAIM_MISSING");
    state.controller.status = event.controller_status;
    if (event.production_task_binding) state.production_task_binding = event.production_task_binding;
    state.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
    state.next_external_action = event.next_external_action;
  } else if (event.type === "controller_checkpoint") {
    if (!state.active_claim || state.active_claim.task_id !== event.task_id) throw new Error("DISPATCHER_CHECKPOINT_PARENT_CLAIM_MISSING");
    const item = state.queue.find((entry) => entry.task_id === event.task_id);
    if (!item || item.packet_sha256 !== event.packet_sha256) throw new Error("DISPATCHER_CHECKPOINT_PACKET_MISMATCH");
    if (!hasFutureEventWake({ ...event, observed_at: event.reconciliation?.observed_at }, "next_check_at")) throw new Error("DISPATCHER_CHECKPOINT_LIVENESS_INVALID");
    state.production_task_binding = event.production_task_binding;
    state.controller_liveness = {
      checkpoint_key: event.checkpoint_key,
      task_id: event.task_id,
      production_task_id: event.production_task_binding.production_task_id,
      resume_node: event.resume_node,
      next_check_at: event.next_check_at,
      observed_at: event.reconciliation.observed_at,
      worker_state: event.reconciliation.worker_state,
      provider_receipt_present: event.reconciliation.provider_receipt_present,
    };
    state.controller.status = "claimed";
    state.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
    state.next_external_action = event.next_external_action;
  } else if (event.type === "resume_node_claimed") {
    state.node_runs.push({ task_id: event.task_id, packet_sha256: event.packet_sha256, node_id: event.node_id, state: "claimed", controller_id: event.controller_id, claimed_at: event.at });
    state.controller.status = "claimed";
    state.earliest_unsatisfied_node = `${event.task_id}:${event.node_id}`;
    state.next_external_action = event.next_external_action;
  } else if (event.type === "resume_node_completed") {
    const run = state.node_runs.find((entry) => entry.task_id === event.task_id && entry.node_id === event.node_id && entry.state === "claimed");
    if (!run) throw new Error("RESUME_NODE_COMPLETION_MISSING_CLAIM");
    run.state = "completed_verified";
  } else if (event.type === "child_work_item_started" || event.type === "background_work_started") {
    const collection = event.type === "child_work_item_started" ? state.child_work_items : state.background_work;
    if (!event.work_item?.id || collection.some((item) => item.id === event.work_item.id)) throw new Error("DISPATCHER_WORK_ITEM_INVALID");
    if (!event.next_wake_at || !event.resume_node || !hasFutureEventWake(event, "next_wake_at")) throw new Error("DISPATCHER_WORK_ITEM_WAKE_INVALID");
    collection.push({ ...event.work_item, state: "active", started_at: event.at });
    state.controller.status = event.controller_status;
    state.controller_liveness = { task_id: event.task_id, resume_node: event.resume_node, next_check_at: event.next_wake_at, observed_at: event.observed_at ?? event.at, worker_state: "not_applicable", provider_receipt_present: false };
    state.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
    state.next_external_action = "await_typed_child_or_background_result";
  } else if (event.type === "child_work_item_completed" || event.type === "background_work_completed") {
    const collection = event.type === "child_work_item_completed" ? state.child_work_items : state.background_work;
    const item = collection.find((entry) => entry.id === event.work_item_id && entry.state === "active");
    if (!item) throw new Error("DISPATCHER_WORK_ITEM_COMPLETION_MISSING");
    if (!event.next_wake_at || !event.resume_node || !hasFutureEventWake(event, "next_wake_at")) throw new Error("DISPATCHER_WORK_ITEM_WAKE_INVALID");
    item.state = event.status;
    item.result = event.result;
    item.completed_at = event.at;
    state.controller.status = event.controller_status;
    state.controller_liveness = { task_id: event.task_id, resume_node: event.resume_node, next_check_at: event.next_wake_at, observed_at: event.observed_at ?? event.at, worker_state: "not_applicable", provider_receipt_present: false };
    state.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
    state.next_external_action = event.next_external_action;
  } else if (event.type === "controller_transition") {
    assertTerminalTransition(event);
    if (!event.controller_status || !event.resume_node || !event.next_wake_at || !hasFutureEventWake(event, "next_wake_at")) throw new Error("DISPATCHER_TRANSITION_LIVENESS_INVALID");
    state.controller.status = event.controller_status;
    state.controller_liveness = { task_id: event.task_id, resume_node: event.resume_node, next_check_at: event.next_wake_at, observed_at: event.observed_at ?? event.at, worker_state: event.worker_state ?? "not_applicable", provider_receipt_present: Boolean(event.provider_receipt_present) };
    state.earliest_unsatisfied_node = `${event.task_id}:${event.resume_node}`;
    state.next_external_action = event.next_external_action;
  } else if (event.type === "master_handoff_delivered") {
    applyMasterDeliveryProjection(state, event);
  } else if (event.type === "master_outbox_acked") {
    applyOutboxAckProjection(state, event);
  } else if (event.type === "master_outbox_consumed") {
    applyMasterOutboxConsumption(state, event);
  } else {
    throw new Error("DISPATCHER_EVENT_TYPE_INVALID");
  }
  applyOutboxProjection(state, event);
  assertNoIdleWithActiveWork(state);
  return state;
}

async function readJsonIfPresent(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function hashFile(filePath) {
  try { return sha256(await readFile(filePath)); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function recoverPendingDispatcherCommit(harnessRoot) {
  const statePath = path.join(harnessRoot, "state.json");
  const ledgerPath = path.join(harnessRoot, "events.jsonl");
  const journalPath = path.join(harnessRoot, ".state.cas.transaction.json");
  const journal = await readJsonIfPresent(journalPath);
  if (!journal) return { recovered: false };
  if (journal.schema !== "niannian_dispatcher_cas_transaction_v1") throw new Error("CAS_TRANSACTION_SCHEMA_INVALID");
  const current = { state: await hashFile(statePath), ledger: await hashFile(ledgerPath) };
  const isBase = current.state === journal.base_state_sha256 && current.ledger === journal.base_ledger_sha256;
  const isTarget = current.state === journal.target_state_sha256 && current.ledger === journal.target_ledger_sha256;
  if (isTarget) {
    await Promise.all([rm(journal.state_temp, { force: true }), rm(journal.ledger_temp, { force: true }), rm(journalPath, { force: true })]);
    return { recovered: true, committed: true };
  }
  if (!isBase && current.state !== journal.target_state_sha256 && current.ledger !== journal.target_ledger_sha256) throw new Error("CAS_TRANSACTION_CONFLICT");
  if (current.ledger === journal.base_ledger_sha256) await rename(journal.ledger_temp, ledgerPath);
  if (current.state === journal.base_state_sha256) await rename(journal.state_temp, statePath);
  const completed = { state: await hashFile(statePath), ledger: await hashFile(ledgerPath) };
  if (completed.state !== journal.target_state_sha256 || completed.ledger !== journal.target_ledger_sha256) throw new Error("CAS_TRANSACTION_RECOVERY_FAILED");
  await Promise.all([rm(journal.state_temp, { force: true }), rm(journal.ledger_temp, { force: true }), rm(journalPath, { force: true })]);
  return { recovered: true, committed: true };
}

export async function appendDispatcherEventCas({ harnessRoot, expectedRevision, event: eventInput, faultInjection = null }) {
  const statePath = path.join(harnessRoot, "state.json");
  const ledgerPath = path.join(harnessRoot, "events.jsonl");
  const lockPath = path.join(harnessRoot, ".state.cas.lock");
  const journalPath = path.join(harnessRoot, ".state.cas.transaction.json");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("CAS_LOCK_BUSY");
    throw error;
  }
  const stateTemp = `${statePath}.${randomUUID()}.tmp`;
  const ledgerTemp = `${ledgerPath}.${randomUUID()}.tmp`;
  let journalWritten = false;
  try {
    await recoverPendingDispatcherCommit(harnessRoot);
    const [stateBytes, ledgerBytes] = await Promise.all([readFile(statePath), readFile(ledgerPath)]);
    const state = JSON.parse(stateBytes.toString("utf8"));
    const events = parseEventLedger(ledgerBytes.toString("utf8"));
    const chain = validateEventChain(events);
    if (state.revision !== expectedRevision || chain.revision !== expectedRevision) throw new Error("CAS_STALE_REVISION");
    const event = { ...eventInput, revision: expectedRevision + 1, previous_hash: chain.headHash };
    event.hash = eventHash(event);
    applyDispatcherEvent(state, event);
    const targetState = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    const targetLedger = Buffer.from(`${ledgerBytes.toString("utf8").trimEnd()}\n${JSON.stringify(event)}\n`, "utf8");
    await Promise.all([writeFile(stateTemp, targetState, { flag: "wx" }), writeFile(ledgerTemp, targetLedger, { flag: "wx" })]);
    const journal = {
      schema: "niannian_dispatcher_cas_transaction_v1",
      expected_revision: expectedRevision,
      event_hash: event.hash,
      base_state_sha256: sha256(stateBytes),
      base_ledger_sha256: sha256(ledgerBytes),
      target_state_sha256: sha256(targetState),
      target_ledger_sha256: sha256(targetLedger),
      state_temp: stateTemp,
      ledger_temp: ledgerTemp,
    };
    await writeFile(journalPath, `${JSON.stringify(journal)}\n`, { encoding: "utf8", flag: "wx" });
    journalWritten = true;
    if (faultInjection === "after_prepare") throw new Error("DISPATCHER_INJECTED_FAULT_AFTER_PREPARE");
    await rename(ledgerTemp, ledgerPath);
    if (faultInjection === "after_ledger_rename") throw new Error("DISPATCHER_INJECTED_FAULT_AFTER_LEDGER_RENAME");
    await rename(stateTemp, statePath);
    await rm(journalPath, { force: true });
    journalWritten = false;
    return { state, event };
  } finally {
    await lock?.close().catch(() => undefined);
    await rm(lockPath, { force: true });
    if (!journalWritten) await Promise.all([rm(stateTemp, { force: true }), rm(ledgerTemp, { force: true })]);
  }
}

function assertClaimGates(state, taskId, expectedRevision) {
  if (state.revision !== expectedRevision) throw new Error("CAS_STALE_REVISION");
  if (state.active_claim !== null) throw new Error("CAS_ACTIVE_CLAIM_CONFLICT");
  const item = state.queue.find((entry) => entry.task_id === taskId);
  if (!item) throw new Error("CAS_TASK_NOT_FOUND");
  if (!item.dependencies.every((dependency) => state.dependency_status?.[dependency] === "completed_verified")) throw new Error("CAS_DEPENDENCY_NOT_COMPLETED_VERIFIED");
  if (!Array.isArray(item.writer_surfaces) || item.writer_surfaces.length === 0) throw new Error("CAS_WRITER_SURFACES_MISSING");
  if (state.writer_locks.some((lock) => item.writer_surfaces.includes(lock.surface))) throw new Error("CAS_WRITER_SURFACE_LOCKED");
  if (item.state !== "ready") throw new Error("CAS_TASK_NOT_READY");
  return item;
}

export async function claimTaskCas({ harnessRoot, taskId, owner, expectedRevision, at, faultInjection = null }) {
  const statePath = path.join(harnessRoot, "state.json");
  const ledgerPath = path.join(harnessRoot, "events.jsonl");
  const lockPath = path.join(harnessRoot, ".state.cas.lock");
  const journalPath = path.join(harnessRoot, ".state.cas.transaction.json");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("CAS_LOCK_BUSY");
    throw error;
  }
  const stateTemp = `${statePath}.${randomUUID()}.tmp`;
  const ledgerTemp = `${ledgerPath}.${randomUUID()}.tmp`;
  let journalWritten = false;
  try {
    await recoverPendingDispatcherCommit(harnessRoot);
    const [stateBytes, ledgerBytes] = await Promise.all([readFile(statePath), readFile(ledgerPath)]);
    const state = JSON.parse(stateBytes.toString("utf8"));
    const events = parseEventLedger(ledgerBytes.toString("utf8"));
    const chain = validateEventChain(events);
    if (chain.revision !== state.revision) throw new Error("CAS_LEDGER_STATE_REVISION_MISMATCH");
    const item = assertClaimGates(state, taskId, expectedRevision);
    const writerLocks = item.writer_surfaces.map((surface) => ({ surface, owner, task_id: taskId }));
    const event = {
      revision: state.revision + 1,
      type: "task_claimed",
      at,
      task_id: taskId,
      owner,
      writer_locks: writerLocks,
      previous_hash: chain.headHash,
    };
    event.hash = eventHash(event);
    item.state = "claimed";
    item.claimed_at = at;
    state.revision = event.revision;
    state.updated_at = at;
    state.active_claim = { task_id: taskId, owner, claimed_at: at };
    state.writer_locks.push(...writerLocks);
    const targetState = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    const targetLedger = Buffer.from(`${ledgerBytes.toString("utf8").trimEnd()}\n${JSON.stringify(event)}\n`, "utf8");
    await Promise.all([writeFile(stateTemp, targetState, { flag: "wx" }), writeFile(ledgerTemp, targetLedger, { flag: "wx" })]);
    const journal = {
      schema: "niannian_dispatcher_cas_transaction_v1",
      expected_revision: expectedRevision,
      event_hash: event.hash,
      base_state_sha256: sha256(stateBytes),
      base_ledger_sha256: sha256(ledgerBytes),
      target_state_sha256: sha256(targetState),
      target_ledger_sha256: sha256(targetLedger),
      state_temp: stateTemp,
      ledger_temp: ledgerTemp,
    };
    await writeFile(journalPath, `${JSON.stringify(journal)}\n`, { encoding: "utf8", flag: "wx" });
    journalWritten = true;
    if (faultInjection === "after_prepare") throw new Error("DISPATCHER_INJECTED_FAULT_AFTER_PREPARE");
    await rename(ledgerTemp, ledgerPath);
    if (faultInjection === "after_ledger_rename") throw new Error("DISPATCHER_INJECTED_FAULT_AFTER_LEDGER_RENAME");
    await rename(stateTemp, statePath);
    await rm(journalPath, { force: true });
    journalWritten = false;
    return { state, event };
  } finally {
    await lock?.close().catch(() => undefined);
    await rm(lockPath, { force: true });
    if (!journalWritten) await Promise.all([rm(stateTemp, { force: true }), rm(ledgerTemp, { force: true })]);
  }
}
