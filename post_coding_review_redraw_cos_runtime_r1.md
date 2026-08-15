# Post-Coding Review: Redraw COS Runtime R1

## Requested Outcome

Run the isolated Haika `/redraw` path through private COS delivery without changing the existing Step01/Step03 web runtime.

## Correct Runtime Path

`POST /api/redraw/jobs` persists an owner-scoped job, Redis dispatches it, the worker claims it, persists a RunningHub task before polling, downloads a provider result, runs visual QA, writes the accepted bytes below the `redraw/` COS prefix, reads those bytes back for SHA-256 verification, and finally persists an owner-bound artifact that the protected download route can serve.

## Changed Files

- `scripts/redraw-cos.mjs`: added strict relative COS key construction under `TENCENT_COS_PREFIX`.
- `scripts/redraw-task-worker.mjs`: uses that constructor for accepted output keys.
- `scripts/redraw-runtime.test.mjs`: covers canonicalization and traversal rejection.
- `deploy/niannian-redraw-web.service`: isolated Next runtime on `127.0.0.1:18084`.
- `deploy/niannian-redraw-worker.service`: isolated single-concurrency worker service.

## Review Findings

1. The worker no longer writes `niannian/redraw/...`, which the least-privilege COS policy would reject. Accepted output keys now resolve only to `redraw/<user>/<job>/<artifact>.<extension>`; malformed prefix or path segments fail before any COS call.
2. The services run under a dedicated local identity with a dedicated PostgreSQL database and Redis only on loopback. They do not replace the existing `niannian-ai.service` or Step03 worker.
3. The runtime intentionally stops before delivery when COS cannot authenticate. It does not mark a job completed from a RunningHub task, a queue event, or a local build.

## Verification

- `npm run test:redraw-runtime`: 23 passing tests, including the new COS-prefix test.
- `npm run lint`: passed.
- `npm run build`: passed.
- Release checksum matched the deployed `redraw-cos.mjs` and `redraw-task-worker.mjs`.
- Haika PostgreSQL, Redis, web service, and worker service are active; PostgreSQL/Redis bind only to loopback, and the web runtime binds only to `127.0.0.1:18084`.
- Local health endpoint and an auth/database write path responded successfully.

## COS Runtime Update

The dedicated active CAM identity has now passed a private COS preflight against the dedicated delivery bucket. The probe performed `PutObject`, `HeadObject`, `GetObject`, and SHA-256 readback successfully below the application-controlled `redraw/preflight/` prefix. The bucket remains private; the service identity has only data read/write access at the bucket ACL layer and the associated CAM policy is limited to `GetObject`, `HeadObject`, and `PutObject` for that dedicated bucket. Application code continues to constrain production keys to `redraw/<user>/<job>/<artifact>.<extension>`.

This removes the former COS identity blocker. It does not verify a real user job, RunningHub submission, provider reconciliation, visual QA, accepted artifact persistence, protected preview/download, or public HTTPS routing. Those remain required before claiming image-redraw delivery.
