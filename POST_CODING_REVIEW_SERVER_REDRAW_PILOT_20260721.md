# Post-Coding Review: Server Redraw Pilot (2026-07-21)

## Requested outcome

A signed-in website user uploads an owned product image and receives a real RunningHub redraw that passes GPT-5.6 Vision QA, is verified after upload to private COS, and is previewable and downloadable from `/redraw` without Windows or Mac participating in job execution.

## Correct operating path

`/redraw` upload -> authenticated API -> PostgreSQL job -> dedicated BullMQ/Redis queue -> server `redraw-worker` -> immutable Skill Bundle -> McGrox GPT-5.6 strict `RedrawPlan` -> one persisted RunningHub task per attempt -> output download -> GPT-5.6 Vision QA -> private COS put/get SHA verification -> owner-bound preview and download.

## Files changed in this continuation

- `scripts/redraw-cos.mjs`: converts validated environment fields into COS SDK credentials and supports optional short-lived `SecurityToken`.
- `scripts/redraw-task-worker.mjs`: uses the shared COS credential contract.
- `docker-compose.yml`: passes optional `TENCENT_COS_SECURITY_TOKEN` to the worker.
- `scripts/redraw-runtime.mjs`: treats structurally empty RunningHub `failedReason` values as in-progress, not failure.
- `scripts/redraw-runtime.test.mjs`: covers temporary COS credentials and empty/non-empty RunningHub failure shapes.
- `tools/request-redraw-pilot-sts.ps1`: requests prefix-scoped temporary COS credentials through Tencent STS and transfers them to the server without printing values.
- `tools/install-redraw-mcgrox-secret.ps1`: accepts the model credential through a hidden local prompt and installs it through SSH standard input without logging the value.
- `deploy/redraw-runtime-pilot/README.md`: documents temporary COS credential support and the long-lived-credential prohibition.

## Verification performed

- `node --check scripts/redraw-cos.mjs`: passed.
- `node --check scripts/redraw-runtime.mjs`: passed.
- `node --check scripts/redraw-task-worker.mjs`: passed.
- PowerShell parser checks for both new tools: passed.
- `npm run test:redraw-runtime`: 21/21 passed after the Provider-status fix.
- `npm run test:video-worker`: 9/9 passed.
- `npm run lint`: passed.
- `npm run build`: passed locally and in the server worker image.
- Tencent STS returned and installed a temporary identity limited to the intended redraw object prefix; server secret file mode is `0600`.
- Server-only McGrox strict JSON probe: passed.
- Server-only McGrox image input and strict Vision QA probe: passed.
- `redraw-worker` is running in the existing `niannian-ai-video-workbench` Compose project and uses the dedicated Redis service.
- A signed-in browser created one real website job. The first Provider task was persisted before polling. The initial polling failure was traced to `failedReason: {}`, fixed, reviewed, redeployed, and the same task was resumed without resubmission.
- Vision QA rejected attempt 1 and the single allowed automatic retry (attempt 2). No third Provider task was created.
- A real COS put/get prefix probe returned `AccessDenied`. The existing Windows broker identity also failed its own fixed return-prefix put probe with HTTP 403, proving that the parent identity cannot delegate the missing bucket write permission. No accepted output was written.
- `redraw-worker` was stopped after this result so another website submission cannot spend Provider credit and then fail at delivery. The app, PostgreSQL, dedicated Redis, and existing video worker remain running.

## Stops-too-early review

The runtime must not call code, tests, deployment, Provider completion, or a QA-failed image `real_delivery`. The pilot source was a website hero composite containing a person and an inset product, not a clean product-subject image. Both generated attempts changed/cropped the product and failed identity/composition checks. The job correctly ended at `qa_failed`; no accepted artifact exists, no COS delivery object was written, and the website exposes no preview/download for that job.

## Current verification level

`integrated`, not `real_delivery`.

The only earliest blocker is `REDRAW_COS_WRITE_IDENTITY_REQUIRED`: provision a server-specific Tencent COS identity with `GetObject` and `PutObject` limited to bucket `niannian-step01-artifacts-prod-1412440010`, region `ap-beijing`, prefix `niannian/redraw/*`. Its values must be entered through a local/server secret prompt, never chat. After a put/get probe passes, restart only `redraw-worker`; the next content input must be one owned, clean product-subject image rather than the rejected hero composite. The McGrox test credential was disclosed in chat and must be rotated before long-term production use.
