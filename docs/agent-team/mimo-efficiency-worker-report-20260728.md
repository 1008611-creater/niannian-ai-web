# Mimo Efficiency Worker Report - 2026-07-28

Verification level: `structural` with a local Level 2 unauthenticated route check. Production is unchanged.

## Implemented

- Website pricing remains 4 credits/second for every integer duration from 4 through 15.
- Mimo Provider cost is a separate typed contract. Image-to-video is 2 Mimo credits/second (`4s expected=8, maximum=8`); text-to-video is a distinct 1 Mimo credit/second contract.
- The CDP submitter reads a reliable visible pre-submit estimate when present and stops before Generate with `MIMO_PROVIDER_COST_ESTIMATE_EXCEEDS_MAXIMUM` when it exceeds the locked maximum.
- Provider expected/maximum/live estimate/balance before/balance after/actual cost are written to task spec and the task-local delivery ledger. Missing observations remain `null`; Provider cost is omitted from the normal customer task projection.
- `GET /api/assets` returns only the signed-in owner's supported image rows. `我的素材库` reuses the selected immutable asset ID/SHA and skips upload/insert.
- Progress milestones are append-only and idempotent for the exact task/Provider identity: `provider_progress_observed`, `provider_completed_observed`, `download_started`, and `cos_verified`.
- `/projects` shows the persisted current stage and server-derived elapsed time. ETA remains hidden; the helper requires at least five compatible samples.
- Worker defaults are 5 seconds for claim and 10 seconds for Provider sync, with bounded environment overrides.
- New Windows Mimo automatic delivery still requires ledger JSON, ffprobe/duration, COS upload, and COS readback. Customer wording is `媒体检查通过，已自动交付`.
- Claim selection still includes only queued/approved Windows Mimo work. Historical `awaiting_content_qa` tasks are neither selected nor mutated.

## Acceptance Matrix

| AC | Result | Evidence |
|---|---|---|
| AC-001 | PASS | `mimo-efficiency.contract.test.mjs`: 4-15 website prices and typed 4s image cost |
| AC-002 | PASS | Live estimate cap, provider-ID mismatch guard, customer projection exclusion |
| AC-003 | PASS | Task spec + delivery ledger cost fields; nullable evidence sanitizer |
| AC-004 | PASS | Owner-scoped asset API and upload-skipping existing asset UI path |
| AC-005 | PASS | Idempotent milestone events, persisted stage timestamp, five-sample ETA gate |
| AC-006 | PASS | 5s claim / 10s sync source contract without real timers or Provider traffic |
| AC-007 | PASS | Ledger/ffprobe/duration/COS gates and revised automatic-delivery wording |
| AC-008 | PASS | Claim query excludes historical content-QA tasks; forbidden backfill files untouched |
| AC-009 | PASS | Focused tests, TypeScript, production build, and Level 2 review completed |

## Commands

- Focused and regression suites passed after correcting one stale route-contract expectation; 0 final failures.
- `npm run lint`: passed.
- `npm run build`: passed; 48 routes built, including `GET /api/assets` and the Windows Mimo result route.
- Local built server: `GET /api/assets` without a session returned `401 {"error":"UNAUTHORIZED"}`; `/home` returned HTTP 200.

## Boundary

No production deployment, SSH, Worker installation, Provider traffic, Generate, credit spend, task creation, database migration, credential access, or historical task mutation was performed. An authenticated local asset-list/create flow was not executed because this scope did not authorize reading credentials or mutating production-backed data. Worker packaging was not run because the handoff forbids writes under `release-candidates/**`.
