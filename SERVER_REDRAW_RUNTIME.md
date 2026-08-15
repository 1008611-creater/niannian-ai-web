# Server Redraw Runtime

The `/redraw` workflow is the server-side production path for still-image redraw jobs. A browser request creates a PostgreSQL-backed job, enqueues `niannian-redraw-v1` in the project-owned Redis service, and the `redraw-worker` loads the immutable Skill Bundle before calling the configured GPT Responses profile and RunningHub image-to-image adapter.

## Runtime boundary

- PostgreSQL is authoritative for jobs, attempts, provider task IDs, artifacts, QA and events.
- Redis is only a dispatch/retry transport; a job is never considered complete from queue state alone.
- GPT produces `redraw_plan_v1` and `visual_qa_v1` JSON. It does not execute tools.
- RunningHub task IDs are persisted before polling. Existing IDs are reconciled instead of resubmitted.
- RunningHub upload URLs are ephemeral submission inputs and are never persisted; attempts retain only ordered asset IDs, SHA-256 values and MIME types for audit.
- Worker failures persist and expose only stable redraw error codes. Provider URLs, query signatures, authorization values, local upload paths and raw database errors are not written into the job blocker field or returned by the customer API.
- Accepted output is written to private COS and only then exposed through the owner-bound download route.
- A live Worker renews its durable claim during slow Provider, Vision QA and COS calls without changing the user-visible job timestamp. Heartbeat database calls have a bounded timeout, and every external-stage boundary also checks the elapsed lease age, so a hung heartbeat cannot let the old Worker continue after its recovery window.
- No Codex App, Mac worker, desktop GUI, local pixel editing, SSH or arbitrary shell is part of this path.

## Local verification

```powershell
npm run skills:redraw:build
npm run test:redraw-runtime
npm run lint
npm run build
```

Real McGrox, RunningHub and COS calls require deployment-only secret injection and explicit deployment/provider authorization. A successful build or mocked test is not `real_delivery`.

## Provider submission reconciliation gate

If a Worker crashes after marking an attempt `submitting` but before persisting a RunningHub task ID, it records `RUNNINGHUB_SUBMISSION_RECONCILIATION_REQUIRED` and fails closed. The customer API exposes this as `requiresProviderReconciliation: true`, suppresses the retry action, and the `/redraw` workspace tells the owner not to submit another generation. This state requires an authorized operator/provider reconciliation before any retry can be enabled; it is never evidence of a completed delivery.

After an authorized operator has independently found the existing Provider task, `POST /api/admin/redraw/reconcile-provider-task` binds the exact job, attempt number, transaction key and task ID in one database transaction. The task ID is written to both the attempt and job, one non-sensitive event is appended, and the exact durable job revision is dispatched for polling and QA. The endpoint is admin-session and same-origin protected, does not call the Provider, never exposes the task ID in its response or event, and rejects a different or stale binding.
