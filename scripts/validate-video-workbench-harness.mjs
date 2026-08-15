import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEventLedger, reduceEvents, validateEventChain } from "./video-workbench-harness-state.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harnessRoot = path.join(projectRoot, "docs", "agent-team", "video-workbench-harness-v1");

async function readJson(name) {
  return JSON.parse(await readFile(path.join(harnessRoot, name), "utf8"));
}

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function isType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

export function validateJsonSchema(schema, value, location = "$") {
  const errors = [];
  const fail = (keyword) => errors.push(`${location}:${keyword}`);
  const types = schema.type === undefined ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && !types.some((type) => isType(value, type))) {
    fail("type");
    return errors;
  }
  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) fail("const");
  if (schema.enum && !schema.enum.some((entry) => Object.is(value, entry))) fail("enum");
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail("minLength");
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail("pattern");
    if (schema.format === "date-time" && (!Number.isFinite(Date.parse(value)) || !/[zZ]|[+-]\d\d:\d\d$/.test(value))) fail("format");
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail("format");
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) fail("minimum");
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail("minItems");
    if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) fail("uniqueItems");
    if (schema.items) value.forEach((entry, index) => errors.push(...validateJsonSchema(schema.items, entry, `${location}[${index}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) errors.push(`${location}.${required}:required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) errors.push(`${location}.${key}:additionalProperties`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) errors.push(...validateJsonSchema(childSchema, value[key], `${location}.${key}`));
    }
  }
  return errors;
}

export async function validateHarness() {
  const [contract, schema, state, eventText] = await Promise.all([
    readJson("contract.json"),
    readJson("task-packet.schema.json"),
    readJson("state.json"),
    readFile(path.join(harnessRoot, "events.jsonl"), "utf8"),
  ]);

  invariant(contract.schema_version === "niannian_video_workbench_harness_v1", "CONTRACT_VERSION_INVALID");
  invariant(contract.identity.executor_id === "019fa6e9-e092-7962-afed-d2e35b6fa10a", "EXECUTOR_IDENTITY_INVALID");
  invariant(contract.identity.project === "niannian-ai-video-workbench", "PROJECT_BOUNDARY_INVALID");
  invariant(contract.identity.customer_origin === "https://sd2.cauai.fun", "CUSTOMER_ORIGIN_INVALID");
  invariant(contract.scope_boundary.forbidden.includes("/stage/01") && contract.scope_boundary.forbidden.includes("ai.cauai.fun"), "FORBIDDEN_BOUNDARY_MISSING");
  invariant(contract.task_packets.write_policy === "create_once_exclusive", "PACKET_IMMUTABILITY_INVALID");
  invariant(contract.queue.busy_rule.includes("never_interrupt"), "BUSY_QUEUE_RULE_INVALID");
  invariant(contract.writer_ownership.one_writer_per_surface === true, "SINGLE_WRITER_INVALID");
  invariant(contract.lease.receipt_recovery === "sync_only_never_resubmit", "RECEIPT_RECOVERY_INVALID");
  invariant(contract.lease.expiry_may_submit === false && contract.lease.expiry_may_claim_next === false, "LEASE_AUTHORITY_INVALID");
  invariant(contract.recovery.controller_states.includes("waiting_internal_repair") && contract.recovery.idle_requires.includes("terminal"), "RECOVERY_LIVENESS_CONTRACT_INVALID");
  invariant(schema.$id === "niannian-video-workbench-task-packet-v1" && schema.additionalProperties === false, "TASK_SCHEMA_INVALID");
  invariant(state.contract_version === contract.schema_version, "STATE_CONTRACT_MISMATCH");
  invariant(state.controller.executor_id === contract.identity.executor_id, "CONTROLLER_IDENTITY_INVALID");
  invariant(Array.isArray(state.queue) && Array.isArray(state.writer_locks) && Array.isArray(state.artifact_ledger), "STATE_COLLECTION_INVALID");
  const events = parseEventLedger(eventText);
  const chain = validateEventChain(events);
  const reduced = reduceEvents(events);
  invariant(chain.revision === state.revision && reduced.revision === state.revision, "EVENT_STATE_REVISION_MISMATCH");
  invariant(JSON.stringify(reduced.queue) === JSON.stringify(state.queue), "EVENT_STATE_QUEUE_MISMATCH");
  invariant(JSON.stringify(reduced.active_claim) === JSON.stringify(state.active_claim), "EVENT_STATE_CLAIM_MISMATCH");
  invariant(JSON.stringify(reduced.writer_locks) === JSON.stringify(state.writer_locks), "EVENT_STATE_WRITER_LOCK_MISMATCH");
  invariant(JSON.stringify(reduced.controller) === JSON.stringify(state.controller), "EVENT_STATE_CONTROLLER_MISMATCH");
  invariant(JSON.stringify(reduced.dependency_status) === JSON.stringify(state.dependency_status), "EVENT_STATE_DEPENDENCY_MISMATCH");
  invariant(JSON.stringify(reduced.decisions) === JSON.stringify(state.decisions), "EVENT_STATE_DECISIONS_MISMATCH");
  invariant(JSON.stringify(reduced.repair_work_items) === JSON.stringify(state.repair_work_items ?? []), "EVENT_STATE_REPAIR_ITEMS_MISMATCH");
  invariant(JSON.stringify(reduced.child_work_items) === JSON.stringify(state.child_work_items ?? []), "EVENT_STATE_CHILD_WORK_ITEMS_MISMATCH");
  invariant(JSON.stringify(reduced.background_work) === JSON.stringify(state.background_work ?? []), "EVENT_STATE_BACKGROUND_WORK_MISMATCH");
  invariant(JSON.stringify(reduced.controller_outbox) === JSON.stringify(state.controller_outbox ?? []), "EVENT_STATE_CONTROLLER_OUTBOX_MISMATCH");
  invariant(JSON.stringify(reduced.master_delivery_cursor) === JSON.stringify(state.master_delivery_cursor ?? reduced.master_delivery_cursor), "EVENT_STATE_MASTER_DELIVERY_CURSOR_MISMATCH");
  invariant(JSON.stringify(reduced.master_ack_cursor) === JSON.stringify(state.master_ack_cursor ?? reduced.master_ack_cursor), "EVENT_STATE_MASTER_ACK_CURSOR_MISMATCH");
  if (state.active_claim && state.controller.status === "idle_no_task") throw new Error("CLAIMED_CONTROLLER_IDLE_INVALID");
  if ((state.child_work_items ?? []).some((item) => item.state === "active") && state.controller.status === "idle_no_task") throw new Error("ACTIVE_CHILD_CONTROLLER_IDLE_INVALID");
  invariant(reduced.earliest_unsatisfied_node === state.earliest_unsatisfied_node, "EVENT_STATE_EARLIEST_NODE_MISMATCH");
  invariant(reduced.next_external_action === state.next_external_action, "EVENT_STATE_NEXT_ACTION_MISMATCH");
  invariant(reduced.updated_at === state.updated_at, "EVENT_STATE_UPDATED_AT_MISMATCH");

  const packetRoot = path.join(harnessRoot, "task-packets");
  const packetNames = await readdir(packetRoot).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  invariant(packetNames.every((name) => name.endsWith(".json")), "TASK_PACKET_EXTENSION_INVALID");
  const packetHashes = [];
  for (const name of packetNames.sort()) {
    const bytes = await readFile(path.join(packetRoot, name));
    const packet = JSON.parse(bytes.toString("utf8"));
    const schemaErrors = validateJsonSchema(schema, packet);
    invariant(schemaErrors.length === 0, `TASK_PACKET_SCHEMA_INVALID:${schemaErrors.join(",")}`);
    invariant(packet.project === contract.identity.project, "TASK_PACKET_PROJECT_INVALID");
    invariant(`${packet.task_id}.json` === name, "TASK_PACKET_FILENAME_INVALID");
    invariant(!packet.scope.allowed_paths.some((entry) => entry.includes("stage/01") || entry.includes("ai.cauai.fun")), "TASK_PACKET_SCOPE_ESCAPE");
    packetHashes.push({ taskId: packet.task_id, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  for (const item of state.queue) {
    const boundPacket = packetHashes.find((entry) => entry.taskId === item.task_id);
    invariant(Boolean(boundPacket), "QUEUE_PACKET_MISSING");
    invariant(item.packet_sha256 === boundPacket.sha256, "QUEUE_PACKET_HASH_MISMATCH");
    if (item.state === "claimed") {
      invariant(item.claimed_at !== null && state.active_claim?.task_id === item.task_id, "CLAIM_PROJECTION_INVALID");
    } else {
      invariant(item.claimed_at === null, "QUEUE_CLAIM_TIMESTAMP_INVALID");
    }
    invariant(item.dependencies.includes("HARNESS-INIT-20260728-01"), "HARNESS_INIT_DEPENDENCY_MISSING");
  }

  return {
    ok: true,
    schemaVersion: contract.schema_version,
    executorId: contract.identity.executor_id,
    queuedTasks: state.queue.length,
    activeClaim: state.active_claim,
    packetHashes,
    earliestUnsatisfiedNode: state.earliest_unsatisfied_node,
    revision: state.revision,
    writerLocks: state.writer_locks,
    eventCount: events.length,
    eventHeadHash: chain.headHash,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateHarness()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
