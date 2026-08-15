# Task Spec: Mimo cost, asset reuse, and observable progress

Task size: `L`. This crosses customer task creation, Worker cost enforcement, persisted evidence, and customer-visible task state.

## Requirements

- `REQ-001`: Keep website pricing at 4 website credits per second for every integer duration from 4 through 15 seconds.
- `REQ-002`: Distinguish Provider cost evidence by `generation_type` and duration; the verified 4-second `image_to_video` contract has expected and maximum cost of 8 Mimo credits.
- `REQ-003`: Refuse Generate when a reliable live pre-submit estimate exceeds the locked Provider maximum; persist expected, maximum, balance-before, balance-after, and actual Provider cost without exposing them to normal users.
- `REQ-004`: Let a signed-in user choose an existing owned image from `我的素材库`; creation must reuse the immutable asset ID/SHA and must not upload bytes or create a duplicate asset row.
- `REQ-005`: Persist meaningful task progress events and show the current stage plus elapsed time. Do not show an ETA until at least five compatible completed samples exist.
- `REQ-006`: Preserve automatic delivery gates: download, ffprobe/duration, valid task ledger, COS upload, and COS SHA readback. Human visual/content QA is not a gate for new Windows Mimo automatic tasks.
- `REQ-007`: Preserve historical tasks waiting for content QA exactly as-is. Do not backfill, deliver, refund, requeue, or otherwise mutate them.

## Business and safety rules

- `RULE-BIZ-001`: Website price and Provider cost are different ledgers. Provider balance changes never alter the already reserved website price.
- `RULE-BIZ-002`: A task with `provider_task_id` is sync-only. No code in this change may create a second Generate path.
- `RULE-BIZ-003`: Provider cost evidence is internal/admin/ledger data and is omitted from the normal customer projection.
- `RULE-DATA-001`: Existing asset reuse is authorized only when the asset belongs to the current user and is an accepted image asset; the locked spec keeps the existing ID, SHA-256, bytes, role, and identity.
- `RULE-DATA-002`: Record these append-only milestones when they really occur: `provider_progress_observed`, `provider_completed_observed`, `download_started`, and `cos_verified`.
- `RULE-DATA-003`: Default Worker claim polling is 5 seconds and Provider reconciliation polling is 10 seconds. Existing environment overrides remain bounded and supported.
- `RULE-UX-001`: Replace misleading automatic-delivery wording such as `已通过验收` with `媒体检查通过，已自动交付`.
- `RULE-UX-002`: Elapsed time derives from persisted stage timestamps, not browser-only timers. Compatible ETA samples must match generation type, duration, resolution, and channel.

## Non-goals

- `NON-001`: No production deployment, real task creation, Provider submission, Generate click, credit spend, or production data write.
- `NON-002`: No database migration. Store new evidence in existing task spec, ledger, result metadata, or event structures unless a current schema already has dedicated fields.
- `NON-003`: No local image editing, new image generation, Dola/Mac routing, concurrency, retry, fallback, or visual QA feature.
- `NON-004`: No duplicate asset copying merely to make the UI simpler.

## Acceptance criteria

- `AC-001`: Focused tests prove all 4-15 second website prices remain `duration * 4` and the 4-second image-to-video Provider contract locks `expected=8`, `maximum=8`, with a different typed contract from text-to-video.
- `AC-002`: A live pre-submit estimate above maximum stops before Generate with a stable blocker; an existing Provider ID still performs sync-only; cost evidence never appears in the normal customer payload.
- `AC-003`: Worker/result evidence persists balance-before, balance-after, expected, maximum, and actual cost when readings exist; missing readings remain explicit `null/unknown`, never fabricated zero.
- `AC-004`: The asset API/UI lists only the current user's reusable accepted images; selecting one creates an image-to-video spec using the same asset row/SHA and does not call upload or insert another asset row.
- `AC-005`: Persisted progress events are idempotent, ordered, and tied to the exact task/Provider identity. The projects page shows stage plus elapsed time, and no ETA with fewer than five compatible samples.
- `AC-006`: Claim default is 5 seconds and Provider sync default is 10 seconds; focused tests verify both without using real timers or Provider traffic.
- `AC-007`: Automatic completion still fails closed if download, ffprobe/duration, ledger, COS upload, or COS readback is absent; successful customer wording is `媒体检查通过，已自动交付`.
- `AC-008`: Historical content-QA tasks are not selected or mutated by implementation or tests.
- `AC-009`: Focused tests, `npm run lint`, and `npm run build` pass, then mandatory Level 2 `post-coding-review` records verified and unverified boundaries.

## Confirmed decisions

- `1A`: Keep public pricing; add typed Provider expected/maximum/actual cost evidence.
- `2A`: Add `我的素材库` and reuse immutable owned assets without duplicate upload.
- `3A`: Show real stage and elapsed time; ETA waits for five compatible samples.
- `4B`: Leave historical content-QA tasks untouched.

No product decision remains open for local implementation.
