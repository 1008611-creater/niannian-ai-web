# Post-Coding Review: Server Redraw Runtime

## Requested outcome

The website must be able to create a server-owned redraw job that can later produce a real QA-passed image and a verifiable COS download without a Windows/Mac Codex App thread.

## Correct path

`/redraw` uploads an owner-scoped image -> `POST /api/redraw/jobs` validates ownership and idempotency -> PostgreSQL records the job -> project Redis dispatches it -> `redraw-task-worker.mjs` locks a Skill Bundle, requests a strict GPT plan, uploads/submits to RunningHub, persists the provider task ID before polling, downloads the result, runs independent GPT Vision QA, writes accepted bytes to private COS, registers the SHA/artifact, and only then exposes the owner-bound download route.

## Changed and generated files

- Added `lib/redraw-contract.ts`, `lib/redraw-jobs.ts`, `lib/redraw-queue.ts` and additive auth schema tables.
- Added redraw API routes, COS artifact download route and the `/redraw` customer workspace.
- Added `scripts/redraw-runtime.mjs`, `scripts/redraw-task-worker.mjs`, Skill Bundle compiler and focused tests.
- Added the checked-in `runtime/skill-bundles/redraw-runtime-1` manifest and three reviewed instruction/reference files.
- Added project-owned Redis and redraw-worker Compose services, environment templates and runtime documentation.
- Added `bullmq`, `cos-nodejs-sdk-v5` and `image-size` dependencies.

## Verification performed

- `npm run lint`: passed.
- `npm run test:redraw-runtime`: 9 passed.
- Existing `npm run test:video-worker`: 9 passed.
- `npm run build`: passed; `/redraw` and all redraw API routes compiled.
- `node --check` passed for all new `.mjs` scripts.
- `docker compose config --quiet` passed with non-secret review placeholders.
- Skill Bundle hashes and per-file hashes verified by the runtime test.
- Secret scan of new runtime files found no credential literals.
- Provider crash-window review found and repaired: attempts now persist `submitting` before the HTTP call, send a deterministic idempotency key/request ID, and fail closed on restart when no task ID was persisted; output upload is followed by COS read-back SHA verification.
- Duplicate queue delivery review found and repaired: a durable worker claim token is written in the same Postgres transaction as claim; a live claim cannot be processed twice, while an old claim is automatically recoverable without user cleanup.
- Claim-fencing review found and repaired: every job-state, plan, provider-ID, QA and completion write is conditional on the active claim token. A displaced worker stops rather than overwriting the recovery worker's state.
- Added a disposable PostgreSQL + Redis integration test for the Provider commit boundary: cancel-before-submit prevents `submitting`, `submitting` prevents a false `cancelled` state, and duplicate Redis dispatch IDs collapse to one queue job.
- Provider-resume dispatch review found and repaired: a failed job with a persisted provider task can resume the same attempt even when the paid-attempt limit is already reached; retry queue IDs are derived from the durable job revision so an older retained BullMQ completion cannot swallow the new dispatch.
- Queue handoff failure review found and repaired: create/retry endpoints compensate an unclaimed queued state to a retryable `REDRAW_QUEUE_DISPATCH_FAILED` state when Redis dispatch fails, while a concurrently claimed worker is protected by the revision and claim predicates.

## Remaining limits

- No McGrox, RunningHub or COS request was made in this change.
- No server deployment, public route, DNS change, database migration on Tencent, or paid Provider call was made.
- The current local SQLite fallback can create/read the API contract, while the production Worker intentionally requires PostgreSQL and project Redis.
- Real delivery remains unverified until a user-owned image is authorized, secrets are injected into the server secret environment, and the complete website -> Worker -> Provider -> Vision -> COS -> download path is run.

## Review conclusion

Structural and local integrated readiness are present. `real_delivery` is not claimed. The next blocker is the protected deployment/provider authorization and capability probe, not another Mac bridge or HQ receipt.

## Follow-up Review: Cancellation State Fence

### Requested outcome

An owner can cancel a still-active redraw job without a concurrent request changing an already completed output into `cancelled`.

### Correct path and changed files

`POST /api/redraw/jobs/[id]/cancel` calls `cancelRedrawJob`; that operation must atomically change only active states, clear the claim token so the Worker fencing predicates stop any in-flight worker, write a cancellation event only when the state changed, and return the latest durable row. The Worker continues to require its claim token for plan, provider, QA, and completion writes.

Changed: `lib/redraw-contract.ts`, `lib/redraw-jobs.ts`, and `scripts/redraw-runtime.test.mjs`. The new `redrawCancellableStatuses` contract allows only `created`, `queued`, `planning`, `provider_submitted`, `generating`, and `qa_running`. The transaction's `UPDATE ... status IN (...)` prevents a stale cancel read from overwriting `completed`, `failed`, `qa_failed`, or an existing `cancelled` status, and suppresses a false cancellation event when no row changed.

### Verification and limits

- Changed files were inspected against the cancel API entrypoint and the Worker claim-token predicates.
- `npm run test:redraw-runtime`: 10 passed, including active-versus-terminal cancellation states.
- `node --check scripts/redraw-runtime.mjs` and `node --check scripts/redraw-task-worker.mjs`: passed.
- `npm run skills:redraw:build`: passed; bundle SHA `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- `npm run lint` and `npm run build`: passed; redraw API routes and `/redraw` compiled.
- No real PostgreSQL/Redis Worker, McGrox, RunningHub, COS, deployment, credential injection, or user media job was run. This is structural/integrated verification, not `real_delivery`.

## Follow-up Review: Retry State Fence

### Requested outcome

An owner retrying a failed redraw must not let a duplicate or stale retry request clear a live Worker claim, overwrite a newer state, or emit a second retry event.

### Correct path and changed files

The retry route reads an owner-bound failed or QA-failed job, derives the permitted retry target, performs one conditional state transition, then enqueues exactly that returned revision. The Worker may claim the resulting queued or provider-resume state. Any later retry based on the pre-transition row must fail closed, leaving the active claim and event history intact.

Changed: `lib/redraw-jobs.ts` and `scripts/redraw-runtime.test.mjs`. `retryRedrawJob` now requires the originally read status, attempt count, and `updated_at` revision to still match in its `UPDATE`; it only clears a claim and writes a retry event after exactly one row changed. A stale request returns `REDRAW_RETRY_NOT_ALLOWED`, so its route does not enqueue another delivery.

### Verification and limits

- Inspected the retry API -> conditional job update -> queue revision -> Worker claim path. The new predicate prevents a stale retry from changing a row already advanced by a Worker, cancellation, or concurrent retry.
- `npm run test:redraw-runtime`: 10 passed, including the non-retryable queued-state regression assertion.
- `npm run lint`, `npm run build`, and `node --check scripts/redraw-runtime.mjs` plus `node --check scripts/redraw-task-worker.mjs`: passed.
- `docker compose --env-file .env.docker.example config --quiet`: passed using committed non-secret placeholders only.
- No real PostgreSQL/Redis Worker, McGrox, RunningHub, COS, deployment, credential injection, or user media job was run. This remains structural/integrated verification, not `real_delivery`.

## Follow-up Review: Concurrent Create Idempotency

### Requested outcome

Two simultaneous `POST /api/redraw/jobs` requests from the same owner using the same idempotency key must expose one durable job as a new submission and report the other as an idempotent replay, without creating a second queue delivery.

### Correct path and changed file

`createRedrawJob` checks for a durable existing job, then repeats that check inside its database transaction. The transaction now returns whether it inserted the row. The final returned job is reloaded by owner/key with that transaction result, so a request that loses the concurrent-create race returns `created: false`. The API route already uses `created` to return `200` with `idempotentReplay: true`; its deterministic queue dispatch ID continues to prevent duplicate delivery when a queued replay is observed.

Changed: `lib/redraw-jobs.ts`.

### Verification and limits

- Inspected the create API -> transactional persistence -> queue handoff path, plus retry dispatch and Worker artifact/download continuation.
- `npm run test:redraw-runtime`: 10 passed.
- `npm run lint`, `npm run build`, and `node --check scripts/redraw-runtime.mjs` plus `node --check scripts/redraw-task-worker.mjs`: passed.
- `docker compose --env-file .env.docker.example config --quiet`: passed using committed non-secret placeholders only.
- No real PostgreSQL/Redis Worker, McGrox, RunningHub, COS, deployment, credential injection, or user media job was run. This remains structural/integrated verification, not `real_delivery`.

## Follow-up Review: Protected Preview and Delivery Hash

### Requested outcome

Once a redraw job is completed, its owner must be able to preview the accepted private-COS image in `/redraw` and explicitly download the same verified bytes. A stored SHA header alone is insufficient evidence when COS is read for delivery.

### Correct path and changed files

`publicRedrawJob` creates owner-bound, URL-escaped artifact routes for both modes. `/redraw` uses the inline route for its image preview and the explicit `?download=1` route for the download link. The protected route first authenticates the owner and requires a completed job/artifact relation, reads the private COS object, recomputes its SHA-256 against the database artifact hash, and only then returns either `Content-Disposition: inline` or `attachment`.

Changed: `lib/redraw-contract.ts`, `lib/redraw-jobs.ts`, `app/redraw/page.tsx`, `app/api/redraw/jobs/[id]/artifacts/[artifactId]/download/route.ts`, and `scripts/redraw-runtime.test.mjs`.

### Review and verification

- Inspected the complete public-job -> workspace preview/download -> owner-bound artifact route path. The former single attachment response could not reliably provide a browser preview; the new two-mode route preserves the old `outputUrl` as the inline URL while adding explicit `previewUrl` and `downloadUrl` fields.
- A COS byte/hash mismatch now fails closed as `REDRAW_ARTIFACT_UNAVAILABLE`; no unverified bytes are served to the user. The stored private artifact remains inaccessible without the authenticated owner and completed job relation.
- `npm run test:redraw-runtime`: 11 passed, including escaped inline/download URL construction.
- `npm run lint`, `npm run build`, `node --check scripts/redraw-runtime.mjs`, `node --check scripts/redraw-task-worker.mjs`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet` all passed. The immutable bundle manifest SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- The local SQLite database has no `redraw_jobs` table, so no local redraw job or output exists to inspect. No real PostgreSQL/Redis worker, McGrox, RunningHub, COS, deployment, credential injection, or user media request was run. This is structural/integrated verification, not `real_delivery`.

## Follow-up Review: Missing Source Asset Failure Fence

### Requested outcome

A queued redraw whose source asset is no longer present must become a visible durable failure instead of being silently acknowledged by BullMQ and remaining stuck in `queued`.

### Correct path and changed file

`redraw-task-worker.mjs` now locks the durable job with a `LEFT JOIN` to its owner-scoped source asset. For an active job with no matching asset row, the same transaction writes `failed` with blocker `REDRAW_SOURCE_ASSET_MISSING`, appends a `source_asset_missing` event, commits, and returns without attempting provider work. Existing claim recovery and worker-token fencing remain unchanged for valid assets.

Changed: `scripts/redraw-task-worker.mjs`.

### Verification and limits

- Inspected the queue entrypoint -> `claim()` -> source validation -> provider execution path; missing assets now terminate in an explicit durable state rather than the prior silent `skipped` path.
- `node --check scripts/redraw-task-worker.mjs`, `npm run test:redraw-runtime`, `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet` passed.
- No real PostgreSQL/Redis worker, McGrox, RunningHub, COS, deployment, credential injection, or user media job was run. This remains structural/integrated verification, not `real_delivery`.

## Follow-up Review: Strict RedrawPlan Schema And Asset Fence

### Requested outcome

The server Worker must be able to send a complete strict Structured Outputs schema to McGrox and must reject any plan that binds an asset outside the source and reference assets already authorized for that redraw job.

### Correct path and changed files

`redraw-task-worker.mjs` loads the immutable Skill Bundle and calls `createRedrawPlan` with the durable source/reference asset IDs. `redraw-runtime.mjs` now builds explicit plan and visual-QA schemas where every object disables additional properties and every object property is required. `reference_bindings` explicitly contains `asset_id` and a locked role enum. The returned plan is then checked against a per-job asset-ID allowlist before it can be persisted or reach RunningHub.

Changed: `scripts/redraw-runtime.mjs` and `scripts/redraw-runtime.test.mjs`.

### Review and verification

- Inspected the website job -> Worker claim -> immutable bundle -> `createRedrawPlan` -> persisted plan -> RunningHub submission path. The Worker still calls the changed runtime function directly; there is no plan-only completion path.
- OpenAI's Structured Outputs guidance was checked for the strict object requirements: every object uses `additionalProperties: false`, and all properties are required. Local runtime validation remains the final boundary for job-specific asset authorization.
- `npm run test:redraw-runtime`: 15 passed. The added mocked Responses request exercises `createRedrawPlan` without network access or a real credential and verifies that the actual request contains the nested strict schema.
- `node --check scripts/redraw-runtime.mjs`, `node --check scripts/redraw-runtime.test.mjs`, `node --check scripts/redraw-task-worker.mjs`, `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet` passed. The immutable bundle SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- No real McGrox schema acceptance was claimed. No PostgreSQL/Redis Worker, RunningHub, COS, deployment, secret injection, paid request, or user-media job was executed. This is structural/integrated verification, not `real_delivery`.

## Follow-up Review: Reference Asset Provider Handoff

### Requested outcome

Optional reference images uploaded by the owner in `/redraw` must actually reach the RunningHub image-to-image request in their durable order, while missing, foreign, malformed, or hash-mismatched references must fail before paid generation.

### Correct path and changed files

The website uploads the source and reference images, persists their asset IDs on the redraw job, and dispatches the durable revision. After claiming the job, the Worker validates the reference-ID array, queries every reference by the job owner, restores the original order, reads and SHA-checks each file, and uploads the source first followed by every reference before calling `submitRunningHub`. The claim token is now captured immediately after `claim()`, so source reads, bundle loads, JSON parsing, and reference preflight failures enter the fenced durable failure path instead of leaving a live claim until stale recovery.

Changed: `scripts/redraw-runtime.mjs`, `scripts/redraw-task-worker.mjs`, and `scripts/redraw-runtime.test.mjs`.

### Review and verification

- Inspected `/redraw` upload -> `POST /api/redraw/jobs` -> owner-scoped asset persistence -> PostgreSQL job -> Redis dispatch -> Worker reference lookup/SHA verification -> ordered RunningHub `imageUrls` -> existing task-ID persistence, Vision QA, COS SHA gate, and protected preview/download path.
- `npm run test:redraw-runtime`: 16 passed, including durable reference ordering plus missing, malformed, and duplicate reference rejection.
- `node --check scripts/redraw-runtime.mjs`, `node --check scripts/redraw-task-worker.mjs`, `node --check scripts/redraw-runtime.test.mjs`, `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet` passed. The immutable bundle SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- No real PostgreSQL/Redis Worker, McGrox, RunningHub, COS, deployment, secret injection, paid request, or user-media job was run. The provider handoff remains structurally/integrated verified only, not `real_delivery`.

## Follow-up Review: Provider Upload URL Secret Isolation

### Requested outcome

The Worker must submit every authorized source/reference image to RunningHub without retaining temporary Provider upload URLs, query signatures, or user filenames in PostgreSQL.

### Correct path and changed files

The Worker SHA-checks the owner-scoped local assets, uploads them only for the immediate RunningHub request, persists the Provider task ID before polling, and stores a non-secret `redraw_provider_input_audit_v1` record containing only ordered asset IDs, roles, SHA-256 values, and MIME types. The existing `input_urls_json` column is retained for schema compatibility, but no URL is written to it by the server redraw runtime.

Changed: `scripts/redraw-runtime.mjs`, `scripts/redraw-task-worker.mjs`, `scripts/redraw-runtime.test.mjs`, and `SERVER_REDRAW_RUNTIME.md`.

### Review and verification

- Inspected the `/redraw` asset/job path through Worker upload, RunningHub submit, task-ID persistence, polling, Vision QA, private COS write/read-back SHA gate, and protected preview/download. Submission still proceeds with the in-memory ordered `imageUrls`; only the durable attempt audit was narrowed, so the pipeline does not stop at an audit record.
- Repository search confirms the Worker no longer serializes `imageUrls`; the only `input_urls_json` write serializes the allowlisted audit object. A synthetic signed-URL/filename regression test confirms those fields cannot enter the stored JSON.
- `npm run test:redraw-runtime`: 17 passed. Existing `npm run test:video-worker`: 9 passed.
- `node --check` passed for the runtime, Worker, and runtime test. `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet` passed. Bundle SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- No real PostgreSQL/Redis Worker, McGrox, RunningHub, COS, deployment, secret injection, paid request, or user-media job was run. This is structural/integrated verification only, not `real_delivery`.

## Follow-up Review: Long-Running Worker Claim Heartbeat

### Requested outcome

A valid Worker that is still waiting on McGrox, RunningHub, Vision QA, or COS must retain its durable claim, while a crashed Worker must remain recoverable after the configured lease window.

### Correct path and changed files

After the PostgreSQL claim transaction writes a unique claim token, the Worker starts a bounded heartbeat that updates only `worker_claimed_at` under the same job ID, claim token, and active-status fence. The heartbeat runs at one third of the recovery window with a 30-second ceiling, tolerates transient database errors until the lease window is exhausted, and stops on claim loss. The Worker checks heartbeat health around plan generation, each Provider upload, paid submission, polling, Vision QA, and COS write/read-back. Existing claim-token predicates remain the authority for every state, attempt, artifact, QA, and completion write.

Changed: `scripts/redraw-runtime.mjs`, `scripts/redraw-task-worker.mjs`, `scripts/redraw-runtime.test.mjs`, and `SERVER_REDRAW_RUNTIME.md`.

### Review and verification

- Inspected the `/redraw` queue entrypoint -> PostgreSQL claim -> immutable bundle -> McGrox plan -> RunningHub upload/submit/poll -> Vision QA -> COS write/read-back -> artifact/completion path. The heartbeat does not create a plan-only or early-completion path, and a displaced Worker still fails every downstream write fence.
- `worker_claimed_at` is renewed without changing `updated_at`, so lease maintenance does not reorder jobs or masquerade as user-visible progress. A stopped process no longer renews and is recoverable through the existing stale-claim rule.
- `npm run test:redraw-runtime`: 18 passed, including the heartbeat interval/recovery-window boundary. Existing `npm run test:video-worker`: 9 passed.
- `node --check` passed for the runtime, Worker, and runtime test. `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet` passed. Bundle SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- No real PostgreSQL/Redis heartbeat timing run, McGrox, RunningHub, COS, deployment, secret injection, paid request, or user-media job was executed. This is structural/integrated verification only, not `real_delivery`.

## Follow-up Review: Hung Heartbeat Fail-Closed Fence

### Requested outcome

A Worker whose PostgreSQL heartbeat call hangs must stop crossing Provider, QA, and COS stage boundaries once its durable recovery window expires; it must not keep acting as if the claim were healthy while another Worker can recover the job.

### Correct path and changed files

The Worker obtains the PostgreSQL claim, renews `worker_claimed_at` under its token, and checks claim health before and after every external stage. Each heartbeat query now has a timeout shorter than its renewal interval. Claim-health checks also compare the elapsed time since the last successful renewal with the recovery window, independently of whether the current database promise has rejected, so a hung query cannot hide an expired lease. All existing token-fenced job, attempt, QA, artifact, and completion writes remain unchanged.

Changed: `scripts/redraw-runtime.mjs`, `scripts/redraw-task-worker.mjs`, `scripts/redraw-runtime.test.mjs`, and `SERVER_REDRAW_RUNTIME.md`.

### Review and verification

- Inspected the `/redraw` API -> Redis dispatch -> PostgreSQL claim -> bundle/plan -> RunningHub upload/submit/poll -> Vision QA -> COS write/read-back -> protected preview/download path. The new check does not introduce a plan-only completion or bypass the provider-ID, QA, COS SHA, or owner-bound download gates.
- Inspected the actual edited heartbeat code and its call sites. A timed-out heartbeat retries while still inside the lease, but every external-stage boundary fails with `REDRAW_WORKER_CLAIM_HEARTBEAT_FAILED` at the recovery threshold even if a heartbeat query remains unresolved.
- `npm run test:redraw-runtime`: 18 passed, including query-timeout bounds and the exact lease-expiry boundary. Existing `npm run test:video-worker`: 9 passed.
- `node --check` passed for the runtime, Worker, and runtime test. `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet` passed. Bundle SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- This workspace has no usable Git metadata for a diff, so changed-file review used direct file inspection. No real PostgreSQL timeout/lease race, Redis Worker, McGrox, RunningHub, COS, deployment, secret injection, paid request, or user-media job was executed. This remains structural/integrated verification only, not `real_delivery`.

## Follow-up Review: Durable Failure Secret Isolation

### Requested outcome

A Worker failure must leave a useful durable blocker without persisting or returning Provider URLs, query signatures, authorization values, customer upload paths, or raw database errors.

### Correct path and changed files

The Worker catches any preflight, Provider, QA, COS, filesystem, or database error and reduces it to an allowlisted redraw error-code family before writing `redraw_jobs.blocker` or rethrowing to BullMQ. The owner-facing job serializer applies the same allowlist to legacy or independently written blocker values, returning `REDRAW_JOB_FAILED` for anything unrecognized.

Changed: `scripts/redraw-runtime.mjs`, `lib/redraw-contract.ts`, `lib/redraw-jobs.ts`, `scripts/redraw-runtime.test.mjs`, and `SERVER_REDRAW_RUNTIME.md`.

### Review and verification

- Inspected the Worker catch -> PostgreSQL blocker -> `GET /api/redraw/jobs` -> `/redraw` status path. Stable operational codes such as `RUNNINGHUB_TASK_ERROR` and `SOURCE_ASSET_HASH_MISMATCH` remain visible; raw filesystem/database messages become generic codes before persistence or API serialization.
- Regression tests cover a private local upload path, a signed Provider URL, a bearer value, a known stable code, an unsafe legacy blocker, and a null blocker.
- `npm run test:redraw-runtime`: 18 passed. Existing `npm run test:video-worker`: 9 passed. `node --check` passed for the runtime, Worker, and runtime test; `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet` also passed. Bundle SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- No real PostgreSQL/Redis Worker, McGrox, RunningHub, COS, deployment, secret injection, paid request, or user-media job was executed. This remains structural/integrated verification only, not `real_delivery`.

## Follow-up Review: Paid Submission Cancellation Fence

### Requested outcome

Customer cancellation must not report success after the Worker has crossed the paid RunningHub submission boundary. A cancellation racing the submission request must leave the Worker able to persist the provider task ID, or fail closed without clearing the claim.

### Correct path and changed files

Cancellation is now allowed only for `created`, `queued`, and pre-submission `planning` jobs. The transactional update additionally requires that no attempt is `submitting` and no attempt already has a provider task ID. This closes the window where a user cancellation could clear the claim while RunningHub was creating a paid task. If the job still appears cancellable but the attempt fence rejected the update, the API returns `REDRAW_CANCEL_NOT_ALLOWED`; the workspace refreshes and explains that generation will continue.

Changed: `lib/redraw-contract.ts`, `lib/redraw-jobs.ts`, `app/redraw/page.tsx`, and `scripts/redraw-runtime.test.mjs`.

### Review and verification

- Inspected the website cancel action -> owner-scoped cancel transaction -> Worker claim-token fence -> `submitting` marker -> RunningHub task-ID persistence path. The cancel predicate cannot clear a claim after the attempt has entered the provider boundary, and the Worker still persists the task ID before polling.
- `node --check scripts/redraw-runtime.mjs`, `node --check scripts/redraw-task-worker.mjs`, and `node --check scripts/redraw-runtime.test.mjs`: passed.
- `npm run test:redraw-runtime`: 18 passed, including the pre-provider-only cancellation contract.
- `npm run test:video-worker`: 9 passed. `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet`: passed. Bundle SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- No real PostgreSQL race, Redis Worker, McGrox, RunningHub, COS, deployment, credential injection, paid request, or user-media job was executed. This is structural/integrated verification only, not `real_delivery`.

## Follow-up Review: Provider Submission Reconciliation Retry Gate

### Requested outcome

If the Worker may have crossed the paid RunningHub boundary but cannot prove a task ID was persisted, the customer must not be offered a retry that could create a second paid task. The state must remain visible and fail closed until an authorized reconciliation resolves it.

### Correct path and changed files

The Worker already marks an attempt `submitting` before the provider call and stores `RUNNINGHUB_SUBMISSION_RECONCILIATION_REQUIRED` when recovery cannot establish a task ID. `redrawRetryTarget` now treats that blocker as non-retryable, so both the retry API transaction and the `/redraw` button enforce the same gate. `publicRedrawJob` exposes only the boolean `requiresProviderReconciliation`; the workspace shows a non-sensitive instruction not to submit another generation. No provider URL, authorization value, or raw error is exposed.

Changed: `lib/redraw-contract.ts`, `lib/redraw-jobs.ts`, `app/redraw/page.tsx`, `scripts/redraw-runtime.test.mjs`, `SERVER_REDRAW_RUNTIME.md`.

### Review and verification

- Inspected `/redraw` -> owner-scoped retry route -> `retryRedrawJob` -> durable blocker predicate -> Redis revision dispatch, plus Worker `submitting`/task-ID persistence and claim fencing. A stale or direct retry request receives `REDRAW_RETRY_NOT_ALLOWED`; no new queue revision is created.
- `npm run test:redraw-runtime`: 18 passed, including the uncertain-submission regression. `npm run test:video-worker`: 9 passed.
- `node --check scripts/redraw-runtime.mjs`, `node --check scripts/redraw-task-worker.mjs`, and `node --check scripts/redraw-runtime.test.mjs`: passed. `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet`: passed. Immutable bundle SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- No real PostgreSQL race, Redis Worker, McGrox, RunningHub, COS, deployment, credential injection, paid request, or user-media job was executed. This remains structural/integrated verification only, not `real_delivery`.

## Follow-up Review: Atomic Provider Task Reconciliation

### Requested outcome

After an authorized Provider-side lookup finds the task created during an ambiguous RunningHub submission, an administrator must be able to bind that exact task to the uncertain attempt and resume processing without creating another paid task or exposing the task ID to the customer.

### Correct path and changed files

The new admin-session and same-origin `POST /api/admin/redraw/reconcile-provider-task` entrypoint requires the exact job ID, attempt number, durable transaction key and recovered Provider task ID. One database transaction checks the exact `failed` reconciliation blocker and `submitting` attempt, writes the same task ID to both attempt and job, advances the attempt/job to `submitted`/`provider_submitted`, appends a non-sensitive event, and returns the durable revision. The route dispatches only that revision; the Worker reuses the persisted task ID, polls the existing task, performs Vision QA, writes and reads back private COS bytes by SHA, and only then completes the owner-bound preview/download path.

Changed: `lib/redraw-contract.ts`, `lib/redraw-jobs.ts`, `app/api/admin/redraw/reconcile-provider-task/route.ts`, `scripts/redraw-runtime.test.mjs`, `SERVER_REDRAW_RUNTIME.md`, and `deploy/redraw-runtime-pilot/README.md`.

### Review and verification

- Inspected the actual changed files because this workspace has no Git metadata. The decision requires an exact blocker and exact attempt/transaction binding, rejects stale or different task IDs, and treats repeated or concurrent confirmation of the same fully bound task as idempotent.
- The API response uses `publicRedrawJob`, so it omits Provider task ID and transaction key. The event stores only the attempt number. Unexpected database/runtime errors are reduced to `REDRAW_PROVIDER_RECONCILIATION_FAILED` instead of returning raw messages.
- Queue handoff failure uses the existing revision fence and leaves the persisted Provider task recoverable through the ordinary provider-resume retry; it does not clear the task ID or consume another attempt.
- `npm run test:redraw-runtime`: 19 passed. `npm run test:video-worker`: 9 passed. `node --check` passed for the runtime, Worker and runtime test. `npm run lint`, `npm run build`, `npm run skills:redraw:build`, and `docker compose --env-file .env.docker.example config --quiet` passed. The immutable bundle SHA remains `7447412417c56af7de4c6cc30ba74f0e1303c99c4b7228b636edfa8b2f5ea6af`.
- No real Provider reconciliation lookup, PostgreSQL transaction, Redis dispatch, Worker poll, McGrox, RunningHub, COS, deployment, secret injection, paid request, or user-media job was executed. This is structural/integrated verification only, not `real_delivery`.
