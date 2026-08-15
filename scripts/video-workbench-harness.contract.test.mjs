import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateHarness, validateJsonSchema } from "./validate-video-workbench-harness.mjs";
import { claimTaskCas, eventHash, parseEventLedger, recoverPendingDispatcherCommit, reduceEvents, validateEventChain } from "./video-workbench-harness-state.mjs";

const root = path.resolve(import.meta.dirname, "..");
const harness = (...parts) => readFile(path.join(root, "docs", "agent-team", "video-workbench-harness-v1", ...parts), "utf8").then(JSON.parse);

test("claimed parent keeps stable ownership and liveness invariants across append-only ledger revisions", async () => {
  const result = await validateHarness();
  const state = await harness("state.json");
  assert.equal(result.ok, true);
  assert.equal(result.executorId, "019fa6e9-e092-7962-afed-d2e35b6fa10a");
  assert.equal(result.queuedTasks, 1);
  assert.equal(result.activeClaim.task_id, "NIANNIAN-WB-REAL-I2V-4S-20260728-01");
  assert.equal(result.packetHashes.length, 1);
  assert.equal(result.packetHashes[0].taskId, "NIANNIAN-WB-REAL-I2V-4S-20260728-01");
  assert.ok(result.revision > 0);
  assert.equal(result.writerLocks.length, 4);
  assert.equal(result.eventCount, result.revision);
  assert.notEqual(state.controller.status, "idle_no_task");
  assert.equal(state.controller_liveness.task_id, state.active_claim.task_id);
  assert.ok(typeof state.controller_liveness.resume_node === "string" && state.controller_liveness.resume_node.length > 0);
  assert.ok(Date.parse(state.controller_liveness.next_check_at) > Date.parse(state.controller_liveness.observed_at));
  assert.deepEqual(new Set(state.writer_locks.map((lock) => lock.surface)), new Set(["queue_state", "provider_submission", "billing_ledger", "artifact_ledger"]));
});

test("reducer reconstructs work and outbox/ack projections without relying on the current resume node", async () => {
  const [state, eventText] = await Promise.all([
    harness("state.json"),
    readFile(path.join(root, "docs", "agent-team", "video-workbench-harness-v1", "events.jsonl"), "utf8"),
  ]);
  const events = parseEventLedger(eventText);
  const reduced = reduceEvents(events);
  assert.equal(state.active_claim.task_id, "NIANNIAN-WB-REAL-I2V-4S-20260728-01");
  assert.deepEqual(reduced.child_work_items, state.child_work_items);
  assert.deepEqual(reduced.controller_outbox, state.controller_outbox);
  assert.deepEqual(reduced.master_ack_cursor, state.master_ack_cursor);
  assert.ok(state.child_work_items.some((item) => item.state === "completed"));
  assert.ok(state.child_work_items.some((item) => item.state === "failed"));
  const activeProjection = reduceEvents([...events, {
    type: "child_work_item_started",
    at: "2099-01-01T00:00:00.000Z",
    task_id: state.active_claim.task_id,
    work_item: { id: "ephemeral-active-work", kind: "fixture", packet_sha256: state.queue[0].packet_sha256 },
    next_wake_at: "2099-01-01T00:30:00.000Z",
    resume_node: "fixture_resume",
    controller_status: "waiting_implementation",
    observed_at: "2099-01-01T00:00:00.000Z",
  }]);
  assert.equal(activeProjection.child_work_items.find((item) => item.id === "ephemeral-active-work").state, "active");
  assert.ok(state.controller_outbox.some((item) => item.event_type === "implementation_completed" && item.harness_task_id === state.active_claim.task_id));
  assert.ok(state.controller_outbox.some((item) => item.event_type === "independent_acceptance_failed" && item.acknowledged));
  for (const outbox of state.controller_outbox) {
    assert.equal(outbox.harness_task_id, state.active_claim.task_id);
    assert.equal(outbox.packet_sha, state.queue[0].packet_sha256);
  }
  for (const dedupeKey of state.master_ack_cursor.acknowledged_dedupe_keys) assert.ok(state.controller_outbox.find((item) => item.dedupe_key === dedupeKey && item.acknowledged));
});

test("contract makes dependency, writer, receipt, and delivery boundaries explicit", async () => {
  const contract = await harness("contract.json");
  assert.match(contract.queue.claim_rule, /all_dependencies_completed_verified/);
  assert.match(contract.queue.next_rule, /all_task_writer_locks_released/);
  assert.equal(contract.writer_ownership.one_writer_per_surface, true);
  assert.equal(contract.lease.receipt_recovery, "sync_only_never_resubmit");
  assert.equal(contract.gates.provider_submit, "authority_passed_and_cost_passed_and_no_reconciled_receipt");
  assert.deepEqual(contract.outcome_contract.completion_requires.slice(-2), ["website_playback_verified", "browser_download_matches_ledger"]);
});

test("typed packet schema is closed and binds authority, cost, dependencies, and replacement history", async () => {
  const schema = await harness("task-packet.schema.json");
  assert.equal(schema.additionalProperties, false);
  for (const field of ["dependencies", "authority_gate", "cost_gate", "writer_surfaces", "replaces_packet_sha256"]) {
    assert.ok(schema.required.includes(field), `${field} must be required`);
  }
  assert.equal(schema.properties.project.const, "niannian-ai-video-workbench");
});

test("the adopted packet exactly binds the authorized account, production spec, prompt, and one Generate ceiling", async () => {
  const packet = await harness("task-packets", "NIANNIAN-WB-REAL-I2V-4S-20260728-01.json");
  assert.equal(packet.user_binding.owner_account, "liusb0713@qq.com");
  assert.equal(packet.production_spec.reference_sha256, "59388ad9cc2e37e5d54b03b24f303fb0d83a6a740b4f0d1c9ab7e8af4c375454");
  assert.equal(packet.production_spec.maximum_generate_attempts, 1);
  assert.equal(packet.cost_gate.maximum, 8);
  assert.equal(packet.locked_prompt, "一名年轻男子在未来感便利店里拿起一瓶普通矿泉水，瓶盖打开瞬间，整个便利店像失重空间一样漂浮起来，零食和彩色包装缓慢环绕他旋转。他先惊讶地环顾四周，随后对镜头露出得意微笑，喝下一口水。电影感运镜，真实人物，动作自然，光影清晰，无文字，无水印。");
});

test("full schema validation rejects required, const, additionalProperties, enum, pattern, format, and prompt drift", async () => {
  const [schema, packet] = await Promise.all([
    harness("task-packet.schema.json"),
    harness("task-packets", "NIANNIAN-WB-REAL-I2V-4S-20260728-01.json"),
  ]);
  const mutations = [
    (value) => { delete value.task_id; },
    (value) => { value.project = "other"; },
    (value) => { value.unexpected = true; },
    (value) => { value.scope.external_actions = ["unknown"]; },
    (value) => { value.task_id = "!"; },
    (value) => { value.created_at = "not-a-date"; },
    (value) => { value.user_binding.owner_account = "not-email"; },
    (value) => { value.locked_prompt += "漂移"; },
  ];
  assert.deepEqual(validateJsonSchema(schema, packet), []);
  for (const mutate of mutations) {
    const candidate = structuredClone(packet);
    mutate(candidate);
    assert.ok(validateJsonSchema(schema, candidate).length > 0);
  }
});

test("event ledger hash chain rejects mutation and reducer binds the claim prerequisites", async () => {
  const [eventText, state] = await Promise.all([
    readFile(path.join(root, "docs", "agent-team", "video-workbench-harness-v1", "events.jsonl"), "utf8"),
    harness("state.json"),
  ]);
  const events = parseEventLedger(eventText);
  const chain = validateEventChain(events);
  assert.equal(chain.revision, state.revision);
  const mutated = structuredClone(events);
  mutated[3].dependency_status["HARNESS-INIT-20260728-01"] = "completed_verified";
  assert.throws(() => validateEventChain(mutated), /EVENT_HASH_INVALID/);
});

async function casFixture({ dependency = "completed_verified", locked = false, active = false } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "niannian-harness-cas-"));
  const fixtureRoot = path.join(temporary, "harness");
  await mkdir(fixtureRoot);
  const [sourceState, sourceEvents] = await Promise.all([
    harness("state.json"),
    readFile(path.join(root, "docs", "agent-team", "video-workbench-harness-v1", "events.jsonl"), "utf8"),
  ]);
  const events = parseEventLedger(sourceEvents).slice(0, 6);
  const state = {
    ...structuredClone(sourceState),
    ...reduceEvents(events),
    controller: { executor_id: sourceState.controller.executor_id, status: "idle_no_task" },
    artifact_ledger: [],
    gate_events: [],
  };
  state.next_external_action = "local_cas_claim_then_no_cost_preflight";
  state.dependency_status["HARNESS-INIT-20260728-01"] = dependency;
  if (locked) state.writer_locks.push({ surface: "provider_submission", owner: "other", task_id: "other" });
  if (active) state.active_claim = { task_id: "other", owner: "other", claimed_at: "2026-07-28T04:30:00.000Z" };
  await Promise.all([
    writeFile(path.join(fixtureRoot, "state.json"), `${JSON.stringify(state, null, 2)}\n`),
    writeFile(path.join(fixtureRoot, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`),
  ]);
  return { temporary, fixtureRoot };
}

async function assertCasFailureWithoutMutation(options, expectedCode) {
  const fixture = await casFixture(options);
  try {
    const statePath = path.join(fixture.fixtureRoot, "state.json");
    const eventsPath = path.join(fixture.fixtureRoot, "events.jsonl");
    const before = await Promise.all([readFile(statePath), readFile(eventsPath)]);
    await assert.rejects(
      claimTaskCas({
        harnessRoot: fixture.fixtureRoot,
        taskId: "NIANNIAN-WB-REAL-I2V-4S-20260728-01",
        owner: "019fa6e9-e092-7962-afed-d2e35b6fa10a",
        expectedRevision: options.expectedRevision ?? 6,
        at: "2026-07-28T04:31:00.000Z",
      }),
      new RegExp(expectedCode),
    );
    const after = await Promise.all([readFile(statePath), readFile(eventsPath)]);
    assert.deepEqual(after, before);
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true });
  }
}

test("CAS rejects stale revision without modifying state or ledger", () =>
  assertCasFailureWithoutMutation({ expectedRevision: 5 }, "CAS_STALE_REVISION"));

test("CAS rejects unmet completed_verified dependency without modifying state or ledger", () =>
  assertCasFailureWithoutMutation({ dependency: "waiting_independent_acceptance" }, "CAS_DEPENDENCY_NOT_COMPLETED_VERIFIED"));

test("CAS rejects a writer surface conflict without modifying state or ledger", () =>
  assertCasFailureWithoutMutation({ locked: true }, "CAS_WRITER_SURFACE_LOCKED"));

test("CAS rejects an active claim without modifying state or ledger", () =>
  assertCasFailureWithoutMutation({ active: true }, "CAS_ACTIVE_CLAIM_CONFLICT"));

test("concurrent CAS permits exactly one claimant", async () => {
  const fixture = await casFixture();
  try {
    const claim = () => claimTaskCas({
      harnessRoot: fixture.fixtureRoot,
      taskId: "NIANNIAN-WB-REAL-I2V-4S-20260728-01",
      owner: "019fa6e9-e092-7962-afed-d2e35b6fa10a",
      expectedRevision: 6,
      at: "2026-07-28T04:31:00.000Z",
    });
    const outcomes = await Promise.allSettled([claim(), claim()]);
    assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((entry) => entry.status === "rejected").length, 1);
    const state = JSON.parse(await readFile(path.join(fixture.fixtureRoot, "state.json"), "utf8"));
    assert.equal(state.revision, 7);
    assert.equal(state.active_claim.task_id, "NIANNIAN-WB-REAL-I2V-4S-20260728-01");
    assert.equal(state.writer_locks.length, 4);
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true });
  }
});

test("claim CAS recovers an interrupted two-file commit once without a duplicate task_claimed event", async () => {
  const fixture = await casFixture();
  try {
    await assert.rejects(claimTaskCas({
      harnessRoot: fixture.fixtureRoot,
      taskId: "NIANNIAN-WB-REAL-I2V-4S-20260728-01",
      owner: "019fa6e9-e092-7962-afed-d2e35b6fa10a",
      expectedRevision: 6,
      at: "2026-07-28T04:32:00.000Z",
      faultInjection: "after_ledger_rename",
    }), /DISPATCHER_INJECTED_FAULT_AFTER_LEDGER_RENAME/);
    const recovery = await recoverPendingDispatcherCommit(fixture.fixtureRoot);
    assert.deepEqual(recovery, { recovered: true, committed: true });
    const [stateText, eventText] = await Promise.all([
      readFile(path.join(fixture.fixtureRoot, "state.json"), "utf8"),
      readFile(path.join(fixture.fixtureRoot, "events.jsonl"), "utf8"),
    ]);
    const state = JSON.parse(stateText);
    const events = parseEventLedger(eventText);
    assert.equal(state.revision, 7);
    assert.equal(events.filter((event) => event.type === "task_claimed").length, 1);
    assert.equal(validateEventChain(events).revision, 7);
    await assert.rejects(claimTaskCas({
      harnessRoot: fixture.fixtureRoot,
      taskId: "NIANNIAN-WB-REAL-I2V-4S-20260728-01",
      owner: "019fa6e9-e092-7962-afed-d2e35b6fa10a",
      expectedRevision: 7,
      at: "2026-07-28T04:33:00.000Z",
    }), /CAS_ACTIVE_CLAIM_CONFLICT/);
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true });
  }
});
