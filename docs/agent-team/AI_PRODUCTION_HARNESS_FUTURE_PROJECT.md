# AI Project Production Harness

## Status

- Lifecycle: `parked_future_project`.
- Start authority: only a future explicit user instruction to start the commercial Harness project.
- Priority: below the NianNian AI `FIRST_REAL_VIDEO_PLAYABLE` production line.
- Current effect: the operating rules below apply to NianNian master-control work; no commercial Harness product, service, UI, database, queue, or long-running task has been started.
- Isolation: no NianNian production writer, Provider session, wallet, task, customer asset, database row, Worker, service, or `/stage/01` package may be shared with this future project.

## Product hypothesis

Turn multi-agent project work into a repeatable, recoverable, measurable, and auditable production system:

```text
user
<-> master conversation owner
<-> persistent task-management and production executor
<-> bounded implementation agents / independent acceptance agents
```

The master conversation owns user decisions, priority, Harness routing, professional Skill routing, exact task packets, authority boundaries, and final acceptance. The production executor owns durable queueing, dependencies, one-writer ownership, bounded delegation, tests, post-coding review, controlled deployment, rollback, and authoritative readback. A child agent may implement or review a bounded packet but may never become a second master or inherit submit, spend, promotion, or deployment authority.

## NianNian master-control application

These rules take effect for current NianNian engineering and operations without starting the future commercial product:

1. Identify the earliest missing customer-visible artifact before selecting work. Code, a candidate, a receipt, or a healthy Worker is not delivery.
2. Persist an exact task packet before delegation. It binds owner, inputs, SHA/bytes where applicable, allowed writes, forbidden writes, idempotency identity, acceptance criteria, rollback, completion boundary, and notification target.
3. Assign one writer per mutable surface. Production release mutation belongs to the active deployment owner; Mimo task execution belongs to the claimed Windows Worker; Provider submit, wallet mutation, ledger mutation, and promotion remain serial and task-bound.
4. Route the Harness before the professional Skill. Harness owns state, dependencies, evidence, recovery, and promotion. The selected professional Skill owns domain method and quality. A Provider is an executor, never a source of method or authority.
5. Separate implementation from acceptance for `L` and `XL` work. The implementation owner may self-test but cannot independently accept its own result. Post-coding review is mandatory after code, script, pipeline, automation, deployment, or generated-workflow changes.
6. On interruption, reconcile by exact task/project/idempotency identity and resume from the earliest incomplete downstream node. Existing Provider receipt always means sync-only; never infer permission to resubmit.
7. Project only customer-safe state. Do not expose Provider identity, internal IDs, SHA values, paths, signed URLs, costs, balances, secrets, or raw errors.

## Writer surfaces

`single writer` is scoped per mutable surface, not interpreted as one process for the entire platform:

| Surface | One authoritative writer |
|---|---|
| User decision and priority | Master conversation owner |
| Production release mutation | Active deployment owner named in the exact task packet |
| NianNian task/spec/event state | Website controller under its database transaction contract |
| Claimed Mimo execution | One Windows Worker and one `activeTaskId` |
| Provider submit/receipt | The task-bound claimed Worker and idempotency identity |
| Wallet and ledger transaction | Server-side atomic billing contract |
| Independent acceptance result | Review owner, separate from implementation owner for `L/XL` work |

No lease or timer may manufacture completion, recreate a Provider task, advance a production node, or replace reconciliation. Duplicate prevention uses immutable identities, current-state compare-and-set checks, existing-receipt reconciliation, and append-only evidence.

A future machine writer lease must therefore be scoped to `project + task + node + mutable surface + owner_ref + idempotency identity`. Acquisition and takeover require an authoritative compare-and-set read. Lease loss immediately blocks further writes; recovery first reconciles the exact durable node and any existing Provider receipt, then reacquires ownership. Lease expiry may expose a blocker but may never submit, spend, promote, refund, or mark delivery by itself.

## Commercial validation gates

The future product may not be promoted beyond `parked_future_project` until a separately authorized implementation proves:

- repeatability across multiple real projects rather than one demonstration;
- measurable cycle time, human interventions, Provider cost, first-pass success, failure and rework rates;
- a real customer-visible download/playback/use and explicit acceptance record;
- recovery from interrupted login, permission, Provider, deployment, and Worker state at the same durable node;
- isolation across project, user, authority, budget, idempotency, write surface, and customer data.

## First action after future activation

Do not build an admin dashboard first. Extract the smallest machine-verifiable two-role contract from completed NianNian cases: durable task queue, writer ownership, evidence events, idempotent recovery, completion metrics, and customer-visible acceptance. Validate that core with one different domain before adding a commercial management surface.

## Explicit non-actions now

- No new Codex task or long-running commercial Harness thread.
- No schema migration, service, Worker, queue, API, UI, deployment, Provider request, or spend.
- No modification of current NianNian tasks, users, assets, balances, ledgers, credentials, or production state.
- No inclusion in `/stage/01` or any current release candidate.
