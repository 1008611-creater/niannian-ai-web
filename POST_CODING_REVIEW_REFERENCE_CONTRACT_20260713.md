# Post-Coding Review: Reference Contract and Mac Worker Reliability

Date: 2026-07-13

## Requested outcome

The customer workbench must preserve generic image/video reference semantics and multi-reference evidence, route only locked authorized work to a continuously available parent Mac Worker, keep internal production strategy out of customer copy, and prove a real provider result only after submission, download, media probe, ledger, QA, and customer playback.

## Correct operating path

1. The customer adds one or more image references and optional video references, with each video carrying a declared semantic intent.
2. The asset API persists role, intent, duty, primary/supplemental order, file hash, and ownership.
3. Task creation writes a versioned `reference_guided_video` spec without deriving action transfer from file presence.
4. The spec retains every authority reference and writes an evidence-backed Mimo selection capped at the verified 12-material limit.
5. An administrator authorizes cost and submission; the parent Mac Worker alone performs readiness, heartbeat, stale-lease recovery, claim, and child orchestration.
6. The child executes only the locked task and reports the real provider task ID. Completion still requires download, `ffprobe`, ledger, administrator content QA, and customer playback/download.

## Changed surfaces

- Additive asset metadata schema and reference task contract: `lib/auth.ts`, `lib/video-tasks.ts`, `app/api/assets/route.ts`.
- Multi-reference customer UI and wording: `app/home/page.tsx`, `app/globals.css`, `app/guide/page.tsx`, `app/page.tsx`, `app/layout.tsx`.
- Mimo material selection and tests: `scripts/mimo-direct.mjs`, `scripts/mimo-direct.test.mjs`.
- Mac parent/child boundaries, continuous service, installer and skill bundle: `lib/mac-codex-worker.ts`, `mac-agent/niannian-mac-worker.mjs`, `mac-agent/install-macos.sh`, `mac-agent/README.md`, `mac-agent/skill-bundle/**`.
- Integration expectations and stale lease fixture: `scripts/manual-task.integration.mjs`, `scripts/mac-worker-api.integration.mjs`, `scripts/mac-codex-worker.test.mjs`.

## Verified

- `npm run lint`: passed.
- `npm run build`: passed; all 34 routes generated/compiled.
- Video Worker: 9/9 passed.
- Mimo direct adapter: 2/2 passed, including 14 authority references with only the planned 12 selected for upload.
- Mac Worker: 4/4 passed; the staged child instruction explicitly rejects parent preflight/heartbeat/claim/run-once repetition.
- Mac skill bundle: 2/2 passed; rebuilt bundle version `1.2.0`, minimum worker `1.4.0`.
- Node syntax checks and read-only shell syntax check for the macOS installer: passed.
- Browser: protected-route redirect passed; authenticated workbench showed generic video intents, primary plus supplemental references, revised recharge copy, and correct desktop/mobile layout. Evidence: `output/playwright/reference-contract-desktop.png` and `output/playwright/reference-contract-mobile-fixed.png`.
- Local production server health: `http://localhost:3026/api/health` returned 200.

## Stops-too-early review

- UI creation, task-spec construction, Mac claim, or a provider task ID is not completion.
- No real Mimo submit was performed in this change. Therefore no new provider task ID, output, media probe, ledger, content QA, or customer playback evidence exists for this revision.
- `test:manual-task:integration` reached the payment fixture and then stopped at `LDXP_REDEEM_SECRET_REQUIRED`; this is a missing local integration secret, not a provider-generation result.
- `test:mac-worker:integration` could not start because the local environment has no `NIANNIAN_MAC_AGENT_TOKEN`; the stale-lease assertion is implemented but still needs a configured integration environment.
- Production contains an older Mimo output/ledger/QA artifact, but it is historical evidence and cannot validate this contract revision.

## Deployment and rollback

- Nothing from this revision was deployed to `sd2.cauai.fun`.
- The schema change is additive (`asset_reference_metadata`); rollback can run the previous app without deleting that table.
- Historical `motion`, `image_to_video`, and `action_transfer` specs remain readable. Do not rewrite or delete old task specs during rollout.
- Production source backups exist under `/opt/niannian-ai-video-workbench/backups`, but no database-volume backup was verified in this review. A database and `/app/data` snapshot is required before deployment.

## Remaining gate

After controller review, back up PostgreSQL and the `niannian-data` volume, deploy app plus Mac Worker bundle together, reinstall/restart the Mac launchd worker, then run one explicitly cost-authorized controlled task through provider ID, output download, media probe, ledger, admin QA, and customer playback. Until that succeeds, status remains `code_verified_real_generation_unverified`.
