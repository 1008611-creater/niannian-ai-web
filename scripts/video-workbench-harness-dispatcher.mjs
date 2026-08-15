import { createHash } from "node:crypto";
import { appendDispatcherEventCas, nextEligibleControllerOutbox, parseEventLedger, reduceEvents, validateEventChain } from "./video-workbench-harness-state.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

function fail(code) { throw new Error(code); }

const PROJECT_ID = "niannian-ai-video-workbench";
const FORMAL_TASK_ID = "aPh_FVncAV5fdhK3z8lCrCTv";
const LOCKED_PROMPT_SHA256 = "5cf55fb95b436768028c3e3e69745a17be8ee87759fbada8329fe6efe181e5af";
const DERIVED_REFERENCE_SHA256 = "ad87a15f8ada8cc0da952d0e0cfe754e1f2d539deb9708d30cb3528c89767fee";
const INTERNAL_EVENT_TYPES = new Set(["implementation_completed", "independent_acceptance_passed", "independent_acceptance_failed", "post_coding_review_completed", "deployment_verified", "worker_progressed", "progress_checkpoint", "auto_approve_and_continue"]);
const ESCALATION_OUTBOX_EVENT_TYPES = new Set(["user_action_blocked", "user_acceptance_required", "delivery_completed"]);

function validTimestamp(value) {
  return Number.isFinite(Date.parse(String(value)));
}

export function outboxFor({ binding, eventType, node, status, evidenceRefs = [], nextResume, occurredAt, dedupeKey }) {
  if (INTERNAL_EVENT_TYPES.has(eventType)) return undefined;
  if (!ESCALATION_OUTBOX_EVENT_TYPES.has(eventType) || !validTimestamp(occurredAt) || !Array.isArray(evidenceRefs) || !node || !status || !nextResume || !dedupeKey) fail("CONTROLLER_OUTBOX_INVALID");
  return {
    project_id: PROJECT_ID,
    formal_task_id: binding.production_task_id,
    harness_task_id: binding.packet_task_id,
    packet_sha: binding.packet_sha256,
    event_type: eventType,
    node,
    status,
    evidence_refs: evidenceRefs,
    next_resume: nextResume,
    occurred_at: occurredAt,
    dedupe_key: dedupeKey,
  };
}

async function readHarness(harnessRoot) {
  const [stateBytes, ledgerBytes] = await Promise.all([
    readFile(path.join(harnessRoot, "state.json")),
    readFile(path.join(harnessRoot, "events.jsonl")),
  ]);
  const state = JSON.parse(stateBytes.toString("utf8"));
  const events = parseEventLedger(ledgerBytes.toString("utf8"));
  const chain = validateEventChain(events);
  if (state.revision !== chain.revision) fail("DISPATCHER_LEDGER_STATE_REVISION_MISMATCH");
  return { state, events, chain };
}

export async function reconstructHarness(harnessRoot) {
  const { state, events, chain } = await readHarness(harnessRoot);
  const reduced = reduceEvents(events);
  for (const key of ["revision", "queue", "active_claim", "writer_locks", "controller", "dependency_status", "decisions", "repair_work_items", "node_runs", "controller_writer", "production_task_binding", "controller_liveness", "child_work_items", "background_work", "controller_outbox", "master_delivery_cursor", "master_ack_cursor", "earliest_unsatisfied_node", "next_external_action"]) {
    const actual = state[key] === undefined ? reduced[key] : state[key];
    if (JSON.stringify(actual) !== JSON.stringify(reduced[key])) fail(`DISPATCHER_RECONSTRUCTION_MISMATCH:${key}`);
  }
  return { state, revision: chain.revision, eventHeadHash: chain.headHash };
}

function assertControllerWriter(state, controllerId) {
  const writer = state.controller_writer;
  if (!writer || writer.mode !== "active") fail("DISPATCHER_CONTROLLER_NOT_ACTIVE");
  if (writer.controller_id !== controllerId) fail("DISPATCHER_DUAL_WRITER_REJECTED");
}

function assertCutoverSnapshot(state, chain, snapshot) {
  if (!snapshot || snapshot.revision !== state.revision || snapshot.event_head_hash !== chain.headHash) fail("DISPATCHER_SNAPSHOT_REVISION_OR_HEAD_MISMATCH");
  if (JSON.stringify(snapshot.active_claim) !== JSON.stringify(state.active_claim)) fail("DISPATCHER_SNAPSHOT_CLAIM_MISMATCH");
  if (JSON.stringify(snapshot.writer_locks) !== JSON.stringify(state.writer_locks)) fail("DISPATCHER_SNAPSHOT_LOCKS_MISMATCH");
  if (JSON.stringify(snapshot.decisions) !== JSON.stringify(state.decisions)) fail("DISPATCHER_SNAPSHOT_DECISIONS_MISMATCH");
  const activePacket = state.queue.find((item) => item.task_id === state.active_claim?.task_id)?.packet_sha256 ?? null;
  if (snapshot.packet_sha256 !== activePacket) fail("DISPATCHER_SNAPSHOT_PACKET_MISMATCH");
}

function assertProductionBinding(state, binding) {
  const item = state.queue.find((entry) => entry.task_id === state.active_claim?.task_id);
  if (!item || !binding) fail("DISPATCHER_PRODUCTION_BINDING_MISSING");
  if (binding.packet_task_id !== item.task_id || binding.packet_sha256 !== item.packet_sha256) fail("DISPATCHER_PRODUCTION_BINDING_PACKET_MISMATCH");
  if (binding.production_task_id !== FORMAL_TASK_ID) fail("DISPATCHER_PRODUCTION_TASK_ID_INVALID");
  if (binding.owner_account !== "liusb0713@qq.com") fail("DISPATCHER_PRODUCTION_OWNER_MISMATCH");
  if (binding.locked_prompt_sha256 !== LOCKED_PROMPT_SHA256) fail("DISPATCHER_PRODUCTION_PROMPT_INVALID");
  if (binding.derived_reference_sha256 !== DERIVED_REFERENCE_SHA256) fail("DISPATCHER_PRODUCTION_REFERENCE_INVALID");
  if (binding.duration_seconds !== 4 || binding.aspect_ratio !== "16:9" || String(binding.resolution).toUpperCase() !== "720P" || binding.website_credit_reservation !== 16) fail("DISPATCHER_PRODUCTION_SPEC_MISMATCH");
}

export async function activateControllerWriter({ harnessRoot, controllerId, controllerKind, expectedRevision, at, snapshot }) {
  const { state, eventHeadHash } = await reconstructHarness(harnessRoot);
  if (state.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertCutoverSnapshot(state, { headHash: eventHeadHash }, snapshot);
  if (state.controller_writer?.mode === "active") fail("DISPATCHER_DUAL_WRITER_REJECTED");
  if (controllerKind === "local") {
    if (state.controller_writer != null || controllerId !== state.controller.executor_id) fail("DISPATCHER_LOCAL_BOOTSTRAP_REJECTED");
  } else if (controllerKind === "server") {
    if (state.controller_writer?.mode !== "frozen") fail("DISPATCHER_LOCAL_FREEZE_REQUIRED");
    assertProductionBinding(state, snapshot.production_task_binding);
  } else fail("DISPATCHER_CONTROLLER_KIND_INVALID");
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: { type: "controller_writer_activated", at, controller_id: controllerId, controller_kind: controllerKind, snapshot } });
}

function nodeAlreadyClaimed(state, taskId, nodeId) {
  return (state.node_runs ?? []).find((run) => run.task_id === taskId && run.node_id === nodeId && run.state === "claimed") ?? null;
}

function assertFutureTimestamp(value) {
  const time = Date.parse(String(value));
  if (!Number.isFinite(time) || time <= Date.now()) fail("DISPATCHER_NEXT_CHECK_INVALID");
}

function assertLivenessCanAdvance(state, at) {
  const liveness = state.controller_liveness;
  if (!liveness?.next_check_at || !validTimestamp(liveness.next_check_at) || !validTimestamp(liveness.observed_at) || !validTimestamp(at)
    || Date.parse(liveness.next_check_at) <= Date.parse(liveness.observed_at)
    || Date.parse(liveness.next_check_at) <= Date.parse(at)) {
    fail("DISPATCHER_LIVENESS_OVERDUE_REFRESH_REQUIRED");
  }
}

export async function refreshOverdueControllerLiveness({ harnessRoot, controllerId, expectedRevision, at, nextWakeAt }) {
  const current = await reconstructHarness(harnessRoot);
  if (current.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertControllerWriter(current.state, controllerId);
  const taskId = current.state.active_claim?.task_id;
  const binding = current.state.production_task_binding;
  const liveness = current.state.controller_liveness;
  if (!taskId || !binding || binding.packet_task_id !== taskId || liveness?.task_id !== taskId) fail("DISPATCHER_PARENT_CLAIM_MISSING");
  if (!validTimestamp(at) || !validTimestamp(nextWakeAt) || Date.parse(nextWakeAt) <= Date.parse(at)) fail("DISPATCHER_REFRESH_WAKE_INVALID");
  if (Date.parse(liveness.next_check_at) > Date.parse(at)) return { idempotent: true, state: current.state };
  if (["idle", "idle_no_task", "completed_verified", "rejected"].includes(current.state.controller?.status)) fail("DISPATCHER_ACTIVE_WORK_IDLE_INVALID");
  const item = current.state.queue.find((entry) => entry.task_id === taskId);
  if (!item || item.packet_sha256 !== binding.packet_sha256) fail("DISPATCHER_REFRESH_PACKET_MISMATCH");
  const resumeNode = liveness.resume_node;
  if (!resumeNode) fail("DISPATCHER_REFRESH_RESUME_NODE_MISSING");
  const dedupeKey = `liveness-refresh:${taskId}:${resumeNode}:${at}`;
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: {
    type: "controller_transition",
    at,
    task_id: taskId,
    controller_status: current.state.controller.status,
    resume_node: resumeNode,
    next_wake_at: nextWakeAt,
    observed_at: at,
    worker_state: liveness.worker_state,
    provider_receipt_present: liveness.provider_receipt_present,
    next_external_action: current.state.next_external_action,
    controller_id: controllerId,
    outbox: outboxFor({
      binding,
      eventType: "progress_checkpoint",
      node: resumeNode,
      status: current.state.controller.status,
      evidenceRefs: ["controller_liveness_refresh"],
      nextResume: resumeNode,
      occurredAt: at,
      dedupeKey,
    }),
  } });
}

export function productionCheckpointKey(binding, reconciliation, userConfirmedNoSubmissionRecovery = false) {
  return createHash("sha256").update(JSON.stringify({
    production_task_id: binding.production_task_id,
    packet_sha256: binding.packet_sha256,
    updated_at: reconciliation.updated_at,
    status: reconciliation.status,
    provider_task_id: reconciliation.provider_task_id,
    provider_receipt_present: reconciliation.provider_receipt_present,
    worker_state: reconciliation.worker_state,
    user_confirmed_no_submission_recovery: userConfirmedNoSubmissionRecovery,
    observed_at: reconciliation.observed_at,
  })).digest("hex");
}

export function resumeNodeForProductionTruth(reconciliation, { userConfirmedNoSubmissionRecovery = false } = {}) {
  if (reconciliation.provider_task_id || reconciliation.provider_receipt_present) return "sync_only_provider_delivery";
  if (reconciliation.status === "completed") return "website_and_browser_delivery_acceptance";
  if (reconciliation.status === "running" && reconciliation.worker_state === "running") return "observe_windows_worker_progress";
  if (["running", "queued_skill", "approved_for_execution"].includes(reconciliation.status)) return "windows_worker_preflight_or_safe_recovery";
  if (userConfirmedNoSubmissionRecovery
    && reconciliation.status === "blocked"
    && reconciliation.blocker === "mimo_submit_unknown") return "recover_user_confirmed_same_task_no_cost_preflight";
  return "production_task_reconciliation_required";
}

export function nextExternalActionForProductionTruth(reconciliation, { userConfirmedNoSubmissionRecovery = false } = {}) {
  const resumeNode = resumeNodeForProductionTruth(reconciliation, { userConfirmedNoSubmissionRecovery });
  if (resumeNode === "recover_user_confirmed_same_task_no_cost_preflight") return "recover_existing_task_then_no_cost_preflight";
  return "observe_existing_windows_worker_or_reconcile_safe_recovery";
}

export async function checkpointProductionTruth({ harnessRoot, controllerId, expectedRevision, at, productionTaskBinding, reconciliation, nextCheckAt, nextExternalAction, userConfirmedNoSubmissionRecovery = false }) {
  const current = await reconstructHarness(harnessRoot);
  if (current.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertControllerWriter(current.state, controllerId);
  assertProductionBinding(current.state, productionTaskBinding);
  const taskId = current.state.active_claim?.task_id;
  if (!taskId || taskId !== productionTaskBinding.packet_task_id) fail("DISPATCHER_PARENT_CLAIM_MISSING");
  if (!reconciliation || reconciliation.production_task_id !== productionTaskBinding.production_task_id) fail("DISPATCHER_RECONCILIATION_TASK_MISMATCH");
  if (!validTimestamp(reconciliation.observed_at)) fail("DISPATCHER_RECONCILIATION_OBSERVED_AT_INVALID");
  const resumeNode = resumeNodeForProductionTruth(reconciliation, { userConfirmedNoSubmissionRecovery });
  assertFutureTimestamp(nextCheckAt);
  const checkpointKey = productionCheckpointKey(productionTaskBinding, reconciliation, userConfirmedNoSubmissionRecovery);
  if (current.state.controller_liveness?.checkpoint_key === checkpointKey) return { idempotent: true, state: current.state };
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: {
    type: "controller_checkpoint", at, task_id: taskId,
    packet_sha256: productionTaskBinding.packet_sha256,
    production_task_binding: productionTaskBinding,
    reconciliation,
    resume_node: resumeNode,
    checkpoint_key: checkpointKey,
    next_check_at: nextCheckAt,
    next_external_action: nextExternalAction,
    controller_id: controllerId,
    outbox: outboxFor({
      binding: productionTaskBinding,
      eventType: "progress_checkpoint",
      node: resumeNode,
      status: "active",
      evidenceRefs: ["production_reconciliation"],
      nextResume: resumeNode,
      occurredAt: at,
      dedupeKey: `checkpoint:${checkpointKey}`,
    }),
  } });
}

export async function dispatchCheckpointResume({ harnessRoot, controllerId, expectedRevision, at }) {
  const current = await reconstructHarness(harnessRoot);
  if (current.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertControllerWriter(current.state, controllerId);
  const taskId = current.state.active_claim?.task_id;
  const nodeId = current.state.controller_liveness?.resume_node;
  if (!taskId || !nodeId) fail("DISPATCHER_CHECKPOINT_MISSING");
  const existing = nodeAlreadyClaimed(current.state, taskId, nodeId);
  if (existing) return { idempotent: true, run: existing, state: current.state };
  const item = current.state.queue.find((entry) => entry.task_id === taskId);
  if (!item || item.state !== "claimed" || item.packet_sha256 !== current.state.production_task_binding?.packet_sha256) fail("DISPATCHER_PARENT_NOT_CLAIMED");
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: {
    type: "resume_node_claimed", at, task_id: taskId, packet_sha256: item.packet_sha256,
    node_id: nodeId, controller_id: controllerId,
    next_external_action: current.state.next_external_action,
    outbox: outboxFor({
      binding: current.state.production_task_binding,
      eventType: "worker_progressed",
      node: nodeId,
      status: "claimed",
      evidenceRefs: ["resume_node_claim"],
      nextResume: nodeId,
      occurredAt: at,
      dedupeKey: `resume-node:${taskId}:${nodeId}`,
    }),
  } });
}

export async function freezeControllerWriter({ harnessRoot, controllerId, expectedRevision, at, snapshot }) {
  const { state, eventHeadHash } = await reconstructHarness(harnessRoot);
  if (state.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertCutoverSnapshot(state, { headHash: eventHeadHash }, snapshot);
  assertControllerWriter(state, controllerId);
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: { type: "controller_writer_frozen", at, controller_id: controllerId, snapshot } });
}

export async function markResumeReady({ harnessRoot, controllerId, expectedRevision, at, resumeNode, nextExternalAction }) {
  const current = await reconstructHarness(harnessRoot);
  if (current.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertControllerWriter(current.state, controllerId);
  const taskId = current.state.active_claim?.task_id;
  const binding = current.state.production_task_binding ?? current.state.controller_writer?.snapshot?.production_task_binding;
  if (!taskId || !binding || binding.packet_task_id !== taskId) fail("DISPATCHER_PARENT_CLAIM_MISSING");
  if (!resumeNode || !nextExternalAction) fail("DISPATCHER_RESUME_NODE_MISSING");
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: {
    type: "resume_ready", at, task_id: taskId, production_task_binding: binding, resume_node: resumeNode, next_external_action: nextExternalAction, controller_status: "claimed",
    outbox: outboxFor({ binding, eventType: "progress_checkpoint", node: resumeNode, status: "resume_ready", evidenceRefs: ["resume_ready"], nextResume: resumeNode, occurredAt: at, dedupeKey: `resume-ready:${taskId}:${resumeNode}` }),
  } });
}

export async function dispatchResumeReady({ harnessRoot, controllerId, expectedRevision, at }) {
  const { state, events } = await readHarness(harnessRoot);
  const reduced = reduceEvents(events);
  if (JSON.stringify(reduced.node_runs) !== JSON.stringify(state.node_runs ?? [])) fail("DISPATCHER_RECONSTRUCTION_MISMATCH:node_runs");
  if (state.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertControllerWriter(state, controllerId);
  const taskId = state.active_claim?.task_id;
  if (!taskId) fail("DISPATCHER_PARENT_CLAIM_MISSING");
  const item = state.queue.find((entry) => entry.task_id === taskId);
  if (!item || item.state !== "claimed") fail("DISPATCHER_PARENT_NOT_CLAIMED");
  const nodeId = state.earliest_unsatisfied_node?.replace(`${taskId}:`, "");
  if (!nodeId || nodeId === state.earliest_unsatisfied_node) fail("DISPATCHER_RESUME_NODE_MISSING");
  const existing = nodeAlreadyClaimed(state, taskId, nodeId);
  if (existing) return { idempotent: true, run: existing, state };
  if (!events.some((event) => event.type === "resume_ready" && event.task_id === taskId && event.resume_node === nodeId)) fail("DISPATCHER_RESUME_READY_EVENT_MISSING");
  const binding = state.production_task_binding ?? state.controller_writer?.snapshot?.production_task_binding;
  if (!binding || binding.packet_task_id !== taskId) fail("DISPATCHER_PRODUCTION_BINDING_MISSING");
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: {
    type: "resume_node_claimed", at, task_id: taskId, packet_sha256: item.packet_sha256, node_id: nodeId,
    controller_id: controllerId, next_external_action: state.next_external_action,
    outbox: outboxFor({
      binding,
      eventType: "worker_progressed",
      node: nodeId,
      status: "claimed",
      evidenceRefs: ["resume_ready"],
      nextResume: nodeId,
      occurredAt: at,
      dedupeKey: `resume-ready-claim:${taskId}:${nodeId}`,
    }),
  } });
}

export function pendingControllerOutbox(state) {
  return (state.controller_outbox ?? []).filter((item) => ESCALATION_OUTBOX_EVENT_TYPES.has(item.event_type) && !item.acknowledged);
}

export function createResumeEnvelope({ outbox, resumeNode, occurredAt }) {
  const base = {
    schema: "niannian_controller_resume_envelope_v1",
    project_id: outbox.project_id,
    formal_task_id: outbox.formal_task_id,
    harness_task_id: outbox.harness_task_id,
    packet_sha: outbox.packet_sha,
    parent_dedupe_key: outbox.dedupe_key,
    resume_node: resumeNode,
    occurred_at: occurredAt,
  };
  return { ...base, immutable_sha256: createHash("sha256").update(JSON.stringify(base), "utf8").digest("hex") };
}

function assertResumeEnvelopeMatchesOutbox(envelope, outbox) {
  if (!envelope || envelope.schema !== "niannian_controller_resume_envelope_v1" || !envelope.immutable_sha256 || !envelope.resume_node) fail("MASTER_OUTBOX_ENVELOPE_INVALID");
  for (const key of ["project_id", "formal_task_id", "harness_task_id", "packet_sha", "parent_dedupe_key"]) {
    const expected = key === "parent_dedupe_key" ? outbox.dedupe_key : outbox[key];
    if (envelope[key] !== expected) fail("MASTER_OUTBOX_ENVELOPE_BINDING_MISMATCH");
  }
  const { immutable_sha256: _sha, ...withoutHash } = envelope;
  if (createHash("sha256").update(JSON.stringify(withoutHash), "utf8").digest("hex") !== envelope.immutable_sha256) fail("MASTER_OUTBOX_ENVELOPE_HASH_INVALID");
}

export async function consumeControllerOutbox({ harnessRoot, controllerId, expectedRevision, dedupeKey, disposition, nextEnvelope = null, at }) {
  const current = await reconstructHarness(harnessRoot);
  if (current.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertControllerWriter(current.state, controllerId);
  const item = (current.state.controller_outbox ?? []).find((entry) => entry.dedupe_key === dedupeKey);
  if (!item) fail("MASTER_ACK_OUTBOX_NOT_FOUND");
  if (item.acknowledged) return { idempotent: true, state: current.state };
  if (!item.delivery
    || item.delivery.event_id == null
    || item.delivery.delivery_id == null
    || !(current.state.master_delivery_cursor?.delivered_dedupe_keys ?? []).includes(dedupeKey)) fail("MASTER_ACK_DELIVERY_REQUIRED");
  if (nextEligibleControllerOutbox(current.state)?.dedupe_key !== dedupeKey) fail("MASTER_OUTBOX_NOT_ELIGIBLE");
  if (!["user_acceptance_required", "auto_approve_and_continue", "user_action_blocked"].includes(disposition)) fail("MASTER_OUTBOX_DISPOSITION_INVALID");
  if (disposition === "auto_approve_and_continue") {
    if (!nextEnvelope) fail("MASTER_OUTBOX_ENVELOPE_REQUIRED");
    assertResumeEnvelopeMatchesOutbox(nextEnvelope, item);
  }
  const resumeNodeClaim = disposition === "auto_approve_and_continue" ? {
    task_id: current.state.active_claim.task_id,
    packet_sha256: nextEnvelope.packet_sha,
    node_id: nextEnvelope.resume_node,
  } : null;
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: { type: "master_outbox_consumed", causal_version: 2, at, dedupe_key: dedupeKey, disposition, next_envelope: nextEnvelope, resume_node_claim: resumeNodeClaim, controller_id: controllerId } });
}

export async function startChildWorkItem({ harnessRoot, controllerId, expectedRevision, at, workItem, nextWakeAt, resumeNode, controllerStatus = "waiting_implementation" }) {
  const current = await reconstructHarness(harnessRoot);
  if (current.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertControllerWriter(current.state, controllerId);
  assertLivenessCanAdvance(current.state, at);
  const binding = current.state.production_task_binding;
  if (!binding || current.state.active_claim?.task_id !== binding.packet_task_id) fail("DISPATCHER_PARENT_CLAIM_MISSING");
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: {
    type: "child_work_item_started", at, task_id: binding.packet_task_id, work_item: { ...workItem, parent_task_id: binding.packet_task_id, packet_sha256: binding.packet_sha256 }, next_wake_at: nextWakeAt, resume_node: resumeNode, controller_status: controllerStatus, observed_at: at,
    outbox: outboxFor({ binding, eventType: "progress_checkpoint", node: resumeNode, status: controllerStatus, evidenceRefs: ["child_work_item"], nextResume: resumeNode, occurredAt: at, dedupeKey: `child-start:${workItem.id}` }),
  } });
}

export async function completeChildWorkItem({ harnessRoot, controllerId, expectedRevision, at, workItemId, result, nextWakeAt, resumeNode, controllerStatus = "waiting_independent_acceptance", transitionEventType = "implementation_completed" }) {
  const current = await reconstructHarness(harnessRoot);
  if (current.revision !== expectedRevision) fail("CAS_STALE_REVISION");
  assertControllerWriter(current.state, controllerId);
  assertLivenessCanAdvance(current.state, at);
  const binding = current.state.production_task_binding;
  if (!binding || current.state.active_claim?.task_id !== binding.packet_task_id) fail("DISPATCHER_PARENT_CLAIM_MISSING");
  return appendDispatcherEventCas({ harnessRoot, expectedRevision, event: {
    type: "child_work_item_completed", at, task_id: binding.packet_task_id, work_item_id: workItemId, result, status: "completed", next_wake_at: nextWakeAt, resume_node: resumeNode, controller_status: controllerStatus, observed_at: at, next_external_action: "consume_typed_result_then_continue_parent",
    outbox: outboxFor({ binding, eventType: transitionEventType, node: resumeNode, status: "completed", evidenceRefs: result?.evidence_refs ?? [], nextResume: resumeNode, occurredAt: at, dedupeKey: `child-complete:${workItemId}` }),
  } });
}
