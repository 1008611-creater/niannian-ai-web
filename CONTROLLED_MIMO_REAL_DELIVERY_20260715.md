# Controlled Mimo Real Delivery Evidence - 2026-07-15

## Result

Status: `real_delivery_verified_existing_provider_reconciled`

This run closed the previously submitted Mimo task `BGpCAtL0jSnVsRLZH0nSwyEn` without creating another provider generation. The existing provider receipt was preserved and reconciled through the repaired parent Mac Worker path:

- Site task: `BGpCAtL0jSnVsRLZH0nSwyEn`
- Mimo provider task: `716856369666`
- Provider list readback: `status=1`, `duration=5`, `aspectRatio=16:9`, created `2026-07-14 15:46:40`
- Current transaction mode: `provider_sync_only`; duplicate submission forbidden
- Mimo channel path: official visible Safari frontend session, then authenticated task-list/status/download synchronization

The original provider task had already been submitted on 2026-07-14. The 2026-07-15 work did not upload materials, did not click Generate, and did not create another provider task ID. It recreated the expired Safari session, authenticated the same approved account, downloaded the matching existing result, and completed the site QA/delivery gates.

## Locked Inputs

| Field | Locked value |
| --- | --- |
| Reference contract | v2 generic reference contract |
| Primary asset ID | `9QwppRmDgS5dwlhZuO6uAANy` |
| Asset SHA-256 | `59388ad9cc2e37e5d54b03b24f303fb0d83a6a740b4f0d1c9ab7e8af4c375454` |
| Source role | `character` |
| Reference intent | `identity` |
| Chinese duty | `Mimo 人物肖像兼容白线参考` |
| Upload eligibility | confirmed, primary, actual video input |
| Prompt SHA-256 | `80c21ee3168870c464a1cee7f7304c6cc52c527d4af212f8835063054078958f` |
| Model | Seedance 2.0 |
| Duration / ratio / resolution | 5 seconds / 16:9 / 720p |
| Provider task ID | `716856369666` |

The server re-hashed the asset and the trimmed locked prompt before moving the blocked task back to `approved_for_execution`. The transition verified that no other Mac task was approved or running. The worker then claimed this one task and retained its existing provider ID, which selected the sync-only path.

## Cost And Idempotency

- Site credit reservation is pre-existing: one `video_automatic_reservation` ledger entry of `-20` for this task. No new site reservation, refund, redemption, or recharge entry was created in this reconciliation.
- Owner site balance was `20` before and after the reconciliation; all credit-ledger rows remain `7`.
- The official Mimo visible page showed `480 积分` after authenticated session recovery and exposed the rate `1 积分 / 秒` (`8秒 × 1积分/秒 = 8积分`).
- The original 5-second submission was bounded at `最高 5 Mimo 额度`; the historical task receipt did not preserve a numeric pre-submit Mimo balance, so the original provider debit cannot be reconstructed as an exact before/after delta.
- The current reconciliation's provider debit is exactly `0`: it made no upload or Generate request, retained `716856369666`, and only called authenticated status/list/download routes.

Idempotency controls actually exercised:

1. Server transition required the exact existing provider ID and blocked state.
2. It rejected any active competing `approved_for_execution` or `running_on_mac` Mac task.
3. The Mac Worker selected `provider_sync_only` because `providerTaskId` already existed.
4. The repaired synchronizer has no upload or Generate code path; its automated test asserts it never calls either endpoint.

## Delivery Artifact

| Field | Evidence |
| --- | --- |
| Server output SHA-256 | `6d06128460c2f6b2548d027cca976430e31daa01a4574608430245621a8dedba` |
| Bytes | `5,511,368` |
| Container format | MP4 |
| Video | H.264, 1280x720, 24 fps, 121 frames, yuv420p |
| Audio | AAC LC, 44.1 kHz stereo |
| Duration | `5.085011` seconds (server gate `5.086`) |
| Downloaded local evidence copy | `output/controlled-mimo-real-delivery-20260715/BGpCAtL0jSnVsRLZH0nSwyEn.mp4` |
| Server ledger | `/app/data/video-outputs/BGpCAtL0jSnVsRLZH0nSwyEn/ledger/mac-codex-ledger.json` |

The final server event sequence is:

1. `admin_resume_provider_sync` at `2026-07-15T12:41:14.541Z`
2. `mac_worker_claimed` at `2026-07-15T12:41:33.903Z`
3. `mac_worker_output_received` at `2026-07-15T12:41:43.690Z`
4. `admin_review_output` at `2026-07-15T12:50:30.074Z`

## Media And Visual QA

Media gate passed on the Mac and independently on the local evidence copy:

- video and audio streams exist;
- duration is inside the 5-second server tolerance;
- SHA-256 and byte count match the server copy.

Visual QA used the approved white-line identity reference and three evidence-only decoded frames:

- `output/controlled-mimo-real-delivery-20260715/9QwppRmDgS5dwlhZuO6uAANy-reference.jpg`
- `output/controlled-mimo-real-delivery-20260715/qa-00.5s.png`
- `output/controlled-mimo-real-delivery-20260715/qa-02.5s.png`
- `output/controlled-mimo-real-delivery-20260715/qa-04.5s.png`

Result: pass. The same person, glasses, black shirt, desk, monitor, plants, lighting, and camera framing remain stable. No visible white-line overlay, watermark, synthetic text, frame corruption, cut, or unwanted person appears. The output has audible non-silent audio for its first roughly three seconds; exact spoken-word transcription was not independently ASR-verified.

## Website Delivery

The owning customer session at `https://sd2.cauai.fun/home` showed the `2026/7/14 15:43:44` record as `已完成`.

Selecting that record rendered the native center video with:

- source `/api/video-tasks/BGpCAtL0jSnVsRLZH0nSwyEn/download`
- `readyState=4`
- `1280x720`
- `duration=5.085011`
- native controls enabled and a decoded frame rendered

Browser media download from that same authenticated native source completed successfully. The delivered video was also observed at `currentTime=5.085011`, `ended=true`, with no media error after decode.

## Worker Recovery Fix

The original failure was not a provider-generation failure. The old Mac synchronizer referenced a dead Safari WebDriver session and failed with HTTP 404 after the provider task already existed. At the successful reconciliation checkpoint, the production Mac state was:

- Mac Worker `1.4.11`
- Skill bundle `1.2.7`
- `readyToClaim=true`, idle, no active task
- arm64 workspace and `ffprobe` available
- official Safari Mimo session reachable and authenticated

The 1.4.11 hotfix recreates an invalid Safari session, logs in through the Keychain-supplied account only when the page requires it, verifies the authenticated generator state, and then lets the synchronizer use only status/list/download calls. The frozen bundle was also rebuilt as 1.2.7 from the actual authoritative Skill files so that user-approved Skill updates no longer trigger a recurring hash mismatch.

Final readback caveat: after delivery was completed, the Mac's remote network session became unreachable. The parent loop correctly reported `blocked` with `MIMO_VISIBLE_FRONTEND_UNAVAILABLE`, no active task, and zero approved/running Mac tasks. This does not alter the completed delivery, but automatic processing of the separate queued task remains unavailable until the Mac is online again.

## Rollback

- Mac Worker 1.4.11 backup: `/Users/lsb/Library/Application Support/NiannianMacWorker/backups/pre-1.4.11-20260715T2115Z`
- Mac Worker 1.4.10 backup: `/Users/lsb/Library/Application Support/NiannianMacWorker/backups/pre-1.4.10-20260715T2048Z`
- Mac Worker 1.4.9 backup: `/Users/lsb/Library/Application Support/NiannianMacWorker/backups/pre-1.4.9-20260715T2026Z`
- Bundle installer retained its own timestamped `~/.codex/skill-bundle-backups` copies.
- The task-spec snapshots before reconciliation and before content QA remain beside the production task spec.

Rollback applies only to the Mac runtime files or Skill bundle. It must not delete the delivered MP4, task, asset, ledger, credit reservation, or provider ID. A task with an existing provider ID always returns to sync-only reconciliation, never a second submission.

## Explicit Boundaries

- No new Mimo generation was submitted in this reconciliation.
- No customer material was uploaded during this run.
- No database migration, app-container deployment, website visual change, DNS change, or data-volume rebuild occurred.
- The separate queued task `5ssvZnUgaADShGsJuAplAm1v` remains unapproved and was not claimed.
