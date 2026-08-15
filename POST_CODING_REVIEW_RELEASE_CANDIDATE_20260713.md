# Post-Coding Review: Reference Contract 1.4.0 RC1

## Requested outcome

Produce a hash-locked, reviewable release candidate for the locally verified reference contract, additive database table, Mac Worker `1.4.0`, LaunchAgent, and Skill bundle `1.2.0`, with a proven rollback path and read-only post-deploy checks, while making no production change and spending no Mimo quota.

## Correct operating path

The correct path is: freeze one website/Mac release identity; inspect old tasks and live queue read-only; stop the old Mac worker before changing the website; create fresh server, database, data-volume, and Mac installation backups; deploy the additive table and app-only website update using the existing Compose project/volumes; validate the website; install Worker `1.4.0` and bundle `1.2.0`; run only preflight, heartbeat, readiness, queue, and UI checks; then either keep the atomic pair or roll both application and Mac worker back. A real provider task is a later, separately authorized test and is not evidence required for this deployment package.

## Actual files reviewed

This workspace has no `.git` directory, so the review used explicit file inventory, complete content reads, syntax checks, generated SHA manifests, archive listing, and source-tree hash comparison rather than `git diff`.

Release identity and diagnostics:

- `lib/release-version.ts`
- `app/api/health/route.ts`
- `lib/mac-codex-worker.ts`
- `app/api/internal/mac-codex/status/route.ts`
- `deploy/migrations/20260713_asset_reference_metadata.sql`
- `scripts/production-compat-readonly.mjs`
- `scripts/postdeploy-readonly-check.mjs`

Packaging and rollback:

- `scripts/build-release-candidate.mjs`
- `scripts/release-candidate-audit.mjs`
- `scripts/release-candidate.test.mjs`
- `scripts/mac-rollback.fixture.sh`
- `mac-agent/backup-before-upgrade.sh`
- `mac-agent/rollback-macos.sh`
- `mac-agent/install-macos.sh`
- `package.json`

Durable release documentation:

- `RELEASE_AUTHORIZATION_PACKAGE_20260713.md`
- `deploy/RELEASE_RUNBOOK_1.4.0_RC1.md`
- `PRODUCTION_RESOURCE_INVENTORY_20260713.md`

The earlier reference-contract implementation and browser evidence are reviewed separately in `POST_CODING_REVIEW_REFERENCE_CONTRACT_20260713.md`.

## Findings and corrections

1. The release builder originally passed an array directly to `crypto.update` for `sourceTreeSha256`, which would stop final packaging. It now hashes deterministic JSON and records every included source file SHA.
2. The original audit locked artifacts and critical files but could miss a post-build change to a noncritical source file. It now re-enumerates the complete allowed source set and verifies every file plus the aggregate tree SHA.
3. Mac rollback originally restored only entries that existed in the backup and could leave upgrade-only files behind. Backup metadata now records exact pre-upgrade presence; rollback clears the upgraded bin/allowlisted skill targets and reconstructs the old state. An isolated fixture proved Worker `1.3.0`, plist, bundle, and skills return while upgrade-only files disappear and no credentials are backed up.
4. The backup script used a zsh-only `print` for its result path. It now uses portable `printf`, so the script is syntax/fixture tested under bash while remaining valid zsh.
5. A staging-directory Compose run could silently change the project name and mount new empty volumes. The runbook now requires `-p niannian-ai-video-workbench` and explicit volume-name verification.
6. The post-deploy check is GET/read-only and does not claim, recover, create, or submit tasks. Recovery is described by diagnostics; the formal state mutation occurs only in the parent claim path.
7. The first final audit treated the valid foreign-key clause `ON DELETE CASCADE` and a comment containing “drop” as destructive SQL. The audit now strips line comments and rejects destructive DDL/DML only at statement boundaries; a focused test preserves the cascade while blocking `DROP`, `ALTER`, `DELETE FROM`, `UPDATE`, `TRUNCATE`, and `INSERT` statements.

No unresolved code defect was found in the prepared RC path.

## Verification completed

- Next.js production build passed with 34 routes.
- TypeScript `tsc --noEmit` passed after the build regenerated `.next/types`.
- Video Worker unit tests passed 9/9.
- Mimo contract/selection tests passed 2/2 without a provider request.
- Mac Worker tests passed 4/4.
- Mac Skill bundle tests passed 2/2.
- Release candidate tests passed 6/6, including additive-migration policy and functional simulated backup/rollback.
- Video Worker integration and delivery-route integration passed against isolated/local test state.
- All new `.mjs` files passed `node --check`; all changed shell scripts passed `bash -n`.
- Package JSON parsed successfully.
- Secret-pattern inspection found only the intentional environment-variable read for `MAC_CODEX_AGENT_TOKEN`; no credential value is present.
- A clean current build served on an isolated local port and returned the full RC release identity.

## Stops-too-early and downstream checks

- The release build must create two tarballs, `release-manifest.json`, and `SHA256SUMS.txt`; the audit verifies their bytes, hashes, required entries, exclusions, additive migration, legacy task compatibility, volume contract, authorization markers, and complete local source tree.
- A release audit is not a production deployment. No production health, Mac installed-state readback, or real generation success may be inferred from it.
- Read-only post-deploy success is not a real video result. Provider task ID, downloaded media, `ffprobe`, ledger, QA, and user playback remain deliberately absent until a separate cost authorization.

## Remaining external and production-only verification

- The exact Mac-installed `1.3.0` binaries, plist, bundle, and skills cannot be proven from the server copy; they must be backed up and hashed on the real Mac during the authorized deployment window.
- Production compatibility and fingerprints must be recaptured immediately before deployment inside the app container, because task specs use container `/app/data` paths.
- The authenticated post-deploy status check requires the production agent token at runtime; the token is intentionally absent from this package.
- `test:manual-task:integration` remains unavailable without `LDXP_REDEEM_SECRET`; `test:mac-worker:integration` remains unavailable without the dedicated agent token. These are external configuration gates, not claimed passes.
- No Mimo task was submitted and no real result was generated in this release-candidate task.
- `ai.cauai.fun` and `sd2.cauai.fun` still appear to use separate identity, credit, task, and asset domains. This high-risk product experience is documented but intentionally not changed by this RC.

## Review classification

The code and package path are suitable for final artifact freezing and audit. Production status remains unchanged until explicit deployment authorization; real generation remains unverified until separate cost authorization.
