# Mimo Efficiency Rework Worker Report

## Executability

- Handoff `NIANNIAN-MIMO-EFFICIENCY-REWORK-C11-C17-20260728` executed locally under decisions `1A / 2A / 3A / 4B`.
- Input handoff SHA-256: `b2e9c589dcbebc966f1db910641b4a74a9d2cd221da8bd53beb3df52e2eee6ff`.
- No Git repository exists in this workspace, so no Git status or diff is claimed.

## Implemented Runtime Contract

- The only submit-capable cost contract is `image_to_video + 4s + 720P + Seedance 2.0 = expected 8 / maximum 8`, evidence `benchmark_20260728_image_to_video_4s_720p_seedance_2_0`.
- Missing live estimate, estimate above 8, every unknown Provider cost combination, and mismatched task/model/resolution fail before claim or Generate.
- `provider_receipt_observed` is emitted by submit receipt; `provider_progress_observed` is emitted only by a later sync. Event idempotency checks task, event, and Provider ID.
- Receipt-bound recovery is sync-only for at most 30 minutes, retains the Provider ID, and expires to `MIMO_PROVIDER_SYNC_RECOVERY_WINDOW_EXPIRED` without resubmission.
- Reusable assets use owner-authenticated preview URLs and owner-only hide/unhide. Customer payloads omit SHA, Provider evidence, internal paths, and Provider IDs. Asset bytes/rows are never deleted by this path; the new foreign key uses `ON DELETE RESTRICT`.
- Packaging excludes `.env*` except templates, `data/`, `runtime/`, `.codex_tmp/`, `node_modules/`, build output, and release output. An initial candidate that included `runtime/` was rejected locally and replaced.

## Acceptance Matrix

| ID | Result | Evidence |
|---|---|---|
| AC-R01 | PASS | Exact 8/8 benchmark; text, 5s, wrong resolution/model return unavailable; authorization and claim fail closed. |
| AC-R02 | PASS | Missing estimate and estimate-over-max blockers precede Generate; existing Provider ID stays sync-only. |
| AC-R03 | PASS | Asset/task customer projections omit SHA, cost, balance, path, signed URL, and Provider ID; locked server spec retains hashes. |
| AC-R04 | PASS | Submit emits receipt only; later sync emits progress; idempotency validates Provider identity. |
| AC-R05 | PASS | Fake clock proves before 30m and exactly 30m eligible, 30m+1ms expired; recovery contains no submit helper call. |
| AC-R06 | PASS | Owner-scoped hide/unhide, cross-user lookup rejection, no DELETE, additive `ON DELETE RESTRICT` migration. |
| AC-R07 | PASS | Authenticated non-empty preview URL; reuse keeps original asset ID and skips upload/insert. |
| AC-R08 | PASS | Focused regressions, Worker self-test, TypeScript, 48-page build, package, audit, and Level 2 review pass. |
| AC-R09 | PASS | Exact release identities and SHA-256 manifest; audit found 0 forbidden entries; no external side effects. |

## Verification

- PASS: `npm run test:mimo-efficiency` (8/8), `test:mimo-owner-authorization` (1/1), `test:video-task-public-state` (2/2), execution-stage tests (4/4), `test:mimo-windows-visible-sync` (7/7), `test:mimo-windows-background` (5/5), `test:mimo-text-queue` (6/6), four selected Windows contracts (4/4), `test:mimo-origin` (4/4), Worker self-test, and `test:release-candidate` (8/8).
- PASS: `npm run lint`; `npm run build` compiled and generated 48 static pages.
- PASS Level 2 local route check: `/home=200`; unauthenticated `GET /api/assets=401`; preview `=401`; PATCH `=401`; isolated server stopped.
- PASS: `npm run worker:mimo-windows:package`, `npm run release:build`, `npm run release:audit`; final audit: 516 website entries, 15 Worker entries, 0 forbidden entries, additive migration, legacy compatibility, rollback contract.

## Candidate Evidence

- Release: `niannian-mimo-efficiency-20260728-rc1`; website `2026.07.28-mimo-efficiency-rc1`; Worker `1.4.13-windows-mimo.3`; migration `20260728_asset_library_visibility_v1`.
- Manifest SHA-256: `4df0697689dd01745142e6e68baa7e8a132e412fa98233310f36aef1a4a03fb2`; bytes `50745`.
- Source tree SHA-256: `c0900e0124898e25bee8cec4194ad250dca607ec7a5f5d88e4156ef3562a1aae`.
- Website archive: SHA-256 `cb11a357cd85cdda881c176ba0b5c5e4268bc3b5d4af687f82471bc4b415e854`; bytes `52896743`.
- Windows Worker archive: SHA-256 `c78f5939d0e33cf1428d2115993b7b5b5ff0eb8d1737c78c2f23f20146f848c8`; bytes `15805`.
- Mac compatibility archive: SHA-256 `5d39bed9217a59c004e9bf390ed6d6089aa464b997becaf5761fa198ad276d86`; bytes `128360`; Mac code/version remained unchanged.

## Migration And Rollback

- Migration only creates `asset_library_visibility` and its index; it contains no data mutation or destructive statement.
- Application rollback may leave the compatibility table. Existing hidden items can be restored by setting `hidden=0`; uploaded asset rows and bytes stay intact.
- Production rollback must preserve PostgreSQL and data volumes and roll back only the app and Windows Worker binaries after confirming no active Provider state.

## Boundary

Production deployment and authenticated production readback were not executed. No Provider submission, real media upload, Generate, credit spend, customer task creation, credential access, SSH mutation, service restart, or historical task mutation occurred.
