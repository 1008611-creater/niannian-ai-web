# Post-Coding Review: Mimo Parent Bridge 1.4.6

Date: 2026-07-13

## Requested outcome

An already cost-authorized Mimo task must submit once through the official frontend upload path without exposing Mimo credentials to the child Codex process, persist the provider task ID, wait seven minutes without status polling while keeping its lease alive, then synchronize, download, probe, ledger, and return the result for server-side QA.

## Correct execution path

1. The parent Mac Worker performs readiness, cost-gate validation, claim, and SHA-verified asset staging.
2. For an authorized `mimo` task, the parent invokes the installed Mimo client directly with its existing Keychain-backed environment. The child Codex never receives that environment.
3. The client uses `upload-apply -> object storage upload -> upload-commit`, calls generate once, and writes `mimo-submission-receipt.json` immediately after a provider task ID exists.
4. The parent reports `running` before any later poll can cause a retry. It then holds the saved provider ID for seven minutes, sending only worker heartbeats during that window, before it makes its first provider status request.
5. When complete, the parent downloads to the current task directory, probes the file, writes `execution-ledger.json`, and reports `completed`; the site still holds the result for administrator QA.

## Reviewed changes

- `mac-agent/niannian-mac-worker.mjs`: Worker `1.4.6` keeps the parent-only Mimo bridge and adds `NIANNIAN_MIMO_INITIAL_POLL_DELAY_MS`, defaulting to seven minutes (bounded to 0-30 minutes). After a successful submission it performs no Mimo poll until the window expires, while emitting lease-preserving heartbeats every 30 seconds by default; when that exact window ends, the next cycle starts the first status sync immediately rather than adding the normal 15-second inter-cycle delay. On same-Mac restart, it restores the original submission timestamp from the saved matching receipt; without that receipt it applies a conservative new seven-minute hold rather than polling early.
- `mac-agent/skill-bundle/skills/mimo-8001-video-channel/scripts/mimo_client.mjs`: `--submit-only` completes official upload and generation, writes both receipt and manifest, and deliberately returns without calling batch status.
- `mac-agent/skill-bundle/*`: Bundle `1.2.6`, minimum Worker `1.4.6`, regenerated SHA manifest.
- `mac-agent/backup-before-upgrade.sh` and `mac-agent/rollback-macos.sh`: backup naming now records the actual installed semantic version and preserves rollback compatibility from legacy `1.3.x` through current `1.4.x` installs; no credential material is backed up.

## Verification

- Shell rollback regression: `npm run test:release-candidate` (6 passing), including a simulated legacy `1.3.0` rollback without credentials.
- Node syntax: Worker and Mimo client; TypeScript check: `npm run lint`; production build: `npm run build`.
- Worker regression: `npm run test:mac-worker` (4 passing); bundle install/tamper regression: `npm run test:mac-skill-bundle` (2 passing); existing direct Mimo contract: `npm run test:mimo-direct` (2 passing); video-worker regression: `npm run test:video-worker` (9 passing).
- Official-upload client regression: `npm run test:mimo-official-client` (1 passing), proving a first submission writes a receipt and manifest with `finalStatus: null` after official upload/generate while making zero status-poll requests.
- Candidate bundle: `niannian-mac-production-skills` `1.2.4`; it and the Worker are SHA-verified before installation.
- Mac-only hotfix archive verification: `release-candidates/niannian-mac-worker-1.4.6-hotfix/niannian-mac-worker-1.4.6-hotfix.tar.gz`, SHA-256 `d08a0b79bc189a74b5d30728ce691c10c72af05b031c3dc10622c9eafedef478`, contains no `.env`, `auth.json`, task data, logs, or job directories.

## Candidate state and residual blocker

Before this `1.4.6` candidate, the active Mac Worker was `1.4.5`. A prior remote restart attempt exposed a macOS constraint: an SSH process cannot bootstrap the logged-in user's `gui/501` LaunchAgent, returning `Bootstrap failed: 5: Input/output error`. The upgrade therefore uses an atomic binary replacement only while the queue is empty, then terminates the existing process so its already-installed `KeepAlive` LaunchAgent restarts inside its own GUI/Keychain context.

The Mac-only deployment completed after an empty-queue log gate. A new rollback backup was created at `/Users/lsb/Library/Application Support/NiannianMacWorker/backups/pre-1.4.5-20260713T145328Z`; its manifest records `credentials_included=false` and verified checksums. The active LaunchAgent restarted from PID `83491` to PID `83758` with exit code `0`. Readback verified Worker SHA-256 `8c821836cae7215fe7ff209418ac158d23c3e5fcb20d64d5e2d7f840391763e7`, installed bundle-manifest SHA-256 `a117c460bb227de77e04e30fdf2b68475e11d44e831c5fe7d1689853df5e17e8`, Worker `1.4.6`, bundle `1.2.6`, and fresh empty-task log entries. The observed `SKILL_BUNDLE_REQUIRES_NEWER_WORKER` log lines occurred only in the deliberate short interval after the new bundle was installed but before the previous process was atomically replaced; they were followed by fresh successful empty-task entries from `1.4.6`.

`https://sd2.cauai.fun/api/health` remains HTTP `200`; it correctly still reports website release `1.4.1-rc2`, because this was a Mac Worker hotfix only and no website/container or database deployment was performed. No task was created, claimed, submitted to Mimo, polled, charged, downloaded, or delivered during this deployment.

The Mac Desktop launcher was run and the LaunchAgent is now running. The first local bridge attempt found a historical task-payload compatibility gap and did not reach Mimo; that gap was corrected with `1.4.3`. The second authorized bridge attempt used the official upload path and reached Mimo's generate endpoint, which returned provider error `ad.creative.aic_gen` before a provider task ID was created.

## Official-Frontend Control Validation

With a separate explicit authorization of up to 5 Mimo credits, Safari WebDriver controlled the visible official Mimo frontend. It uploaded only the SHA-verified white-line reference, waited for the page readback `图 1/9`, set the locked prompt, `5` seconds, and `16:9`, then invoked the same visible frontend generation handler after Safari's own video-preview layer intercepted physical pointer input.

Evidence obtained from the official page:

- Provider task ID: `715993896194`.
- The account credit display changed from `495` to `490`.
- The task progressed from queued to generating and then completed.
- The official direct download completed to `/Users/lsb/Downloads/715993896194.mp4` and was copied as the current task output.
- `ffprobe` passed: `1280x720`, video and audio streams present, `5.062` seconds, `1,441,016` bytes, SHA-256 `3ef5f414b7242a2d3969c1b4cd40bc594dc333ec117ffdc428fd7041b24bea8b`.
- A valid execution ledger exists at `/Users/lsb/niannian-mac-worker/jobs/tKTFw9eWtx2v9wxOt4XRjZOh/ledger/official-frontend-execution-ledger.json`.

The user viewed the completed clip in the official Mimo frontend. The sd2 task remains deliberately unmarked as delivered because this externally submitted provider task still needs reconciled site-side provider-task linkage and administrator delivery review; no false delivery status was written.
