# Post-Coding Review: Image Redraw Runtime v2

## Requested Outcome

The independent server runtime must support product, character, scene, and first-frame image redraw without using Windows, Mac, Codex App, local pixel editing, or a video-workflow state machine. It must never report delivery from a Provider task, QA failure, test, installation, or queue event.

## Correct Operating Path

Owned image upload -> authenticated redraw API with idempotency key -> PostgreSQL job with immutable bundle version -> dedicated Redis/BullMQ dispatch -> server worker -> strict `image_redraw_plan_v2` -> persisted RunningHub task before polling -> downloaded output -> strict `image_redraw_visual_qa_v2` -> private COS put and get/SHA verification -> accepted artifact row -> owner-bound preview/download. `completed` is the last transition only.

## Changed Files

- `lib/redraw-contract.ts`
- `lib/redraw-jobs.ts`
- `scripts/redraw-runtime.mjs`
- `scripts/redraw-task-worker.mjs`
- `scripts/build-redraw-skill-bundle.mjs`
- `scripts/redraw-runtime.test.mjs`
- `runtime/skill-bundles/image-redraw-runtime-2/` (generated immutable bundle)
- `IMAGE_REDRAW_RUNTIME_CONTRACT.md`

## Review Findings

- The former product-only planning and QA field names could not safely represent character, scene, or first-frame identity gates. They are replaced by `subject_mode`, `subject_truth_constraints`, and `subject_identity_preserved` in strict v2 schemas.
- Existing browser input may still send `preserve_product`; server input normalization accepts it only as a compatibility alias and persists generic `preserve_subject` with a default `subject_mode=product`.
- Novel/video values are rejected by the image-redraw contract. No video provider, timeline, episode, or script state was added to `redraw_jobs`.
- `completed` remains protected by both worker paths: normal completion requires QA pass plus COS put/get SHA verification and accepted-artifact insertion; crash recovery repeats COS SHA verification before it can mark a persisted artifact complete.
- The public job DTO exposes preview/download only when internal status is `completed` and an accepted artifact ID exists. The download route independently joins against `j.status='completed'` and the owner ID.
- No new TTL, lease, or manual-unlock admission gate was introduced. Existing worker claim recovery remains execution ownership only and does not create delivery.

## Verification

- `node --check scripts/redraw-runtime.mjs`: passed.
- `node --check scripts/redraw-task-worker.mjs`: passed.
- `node --check scripts/build-redraw-skill-bundle.mjs`: passed.
- `npm run test:redraw-runtime`: 22/22 passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `image-redraw-runtime-2` manifest SHA-256: `954511c20323f64511f029679ea35779394bb26526d9dcb7fe60b8018e1358a4`.

## Verification Boundary

This is structural and local integrated verification only. No worker was started, no deployment occurred, no RunningHub/McGrox/Mimo/Paddle call was made, no secret was read or changed, and no COS write was attempted. It is not real delivery.

## Remaining Blocker

`REDRAW_COS_WRITE_IDENTITY_REQUIRED` remains the earliest external blocker for real customer delivery: the server needs a dedicated COS identity limited to the redraw prefix with `GetObject` and `PutObject`; prior real probes received `AccessDenied`.
