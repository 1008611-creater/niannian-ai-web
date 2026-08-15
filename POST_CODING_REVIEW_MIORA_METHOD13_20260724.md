# Post-Coding Review: Miora Method 13

Date: 2026-07-24

## Requested Outcome

Route an authorized Miora Seedance2 720P/15s task through the web application, submit it once through the logged-in CDP browser, then download, media-probe, ledger, and hold the MP4 for administrator content QA.

## Correct Execution Path

1. An application task is created with channel `miora`, locked prompt and reference SHA256 values, `720p`, `15s`, and the fixed Miora skill chain.
2. The administrator runs the read-only preflight. It opens a temporary CDP page in the existing browser context and reads the provider's own authenticated quota/model responses. It does not retain request headers or browser credentials.
3. The administrator supplies a current visible cost readback and max cost. The backend repeats preflight and only then writes `cost_gate.authorized=true` and `submit_allowed=true`.
4. The `server_auto` worker claims the task. It verifies the task spec, prompt/reference hashes, allowed channel, `720P`, and `15s` before connecting to Miora.
5. The Miora adapter reads quota/model state, reads visible model/resolution/duration before submit, and requires the separate `MIORA_PROVIDER_SUBMIT_ENABLED=true` process gate. It stores the provider id before any future sync.
6. A sync run can only download a result associated with the stored provider task id. It writes to this task's `downloads` directory, probes with `ffprobe`, hashes the file, and writes the task-scoped Miora ledger.
7. Technical success returns `blocked/awaiting_content_qa`; only the administrator review path can mark the task completed.

## Files Reviewed

- `lib/miora-channel.ts`
- `lib/video-tasks.ts`
- `lib/admin.ts`
- `app/api/admin/miora-preflight/route.ts`
- `app/admin/page.tsx`
- `scripts/miora-direct.mjs`
- `scripts/video-task-worker.mjs`
- `scripts/video-task-worker.test.mjs`
- `scripts/miora-direct.test.mjs`
- `docker-compose.yml`, `.env.example`, `.env.docker.example`, `package.json`
- `C:\Users\lsb\.codex\skills\miora-seedance2-channel\SKILL.md`

## Review Findings

- The worker does not treat a browser page as a completed video. The only completed transition still uses `validateCompletedOutput`, requiring output under the current task's downloads directory, a ledger, `ffprobe`, duration tolerance, and explicit content QA.
- The Miora adapter now returns `awaiting_content_qa` after a valid download/probe instead of setting `contentQaPassed=true` itself.
- Download selection no longer accepts an arbitrary video link from the open page. A matching provider id must first be observed in the authenticated workflow history response.
- Admin routing, fallback, retry, provider-sync resume, and the channel panel include `server_auto` so the Miora worker owns provider state instead of asking an operator to enter a provider id.
- Docker injects the CDP endpoint but leaves `MIORA_PROVIDER_SUBMIT_ENABLED=false` by default. The compose configuration parsed successfully with non-secret placeholder values.
- The local repository has no usable `.git` metadata, so review used direct inspection of the touched files and end-to-end entrypoints rather than a git diff.

## Verification

- `npm run lint`: passed.
- `node --check scripts/miora-direct.mjs`: passed.
- `npm run test:video-worker`: passed, including Miora route/parameter/skill-chain checks.
- `npm run test:miora-direct`: passed; unauthorized specs fail before a CDP connection is opened.
- `docker compose config --quiet`: passed with temporary placeholder values for required unrelated deployment variables.
- Live read-only Miora CDP preflight: passed. The authenticated provider responses reported 1,000 credits and Seedance2 model visibility. No upload, generation, or charge was performed.

## Remaining Blocker

No Miora application task was selected, authorized, or submitted during this review. Therefore there is no provider task id, downloaded MP4, `ffprobe` record, output hash, Miora task ledger, or administrator content-QA result yet. The channel is structurally integrated and preflight-verified, but it is not production-proven until a real authorized task runs through all downstream artifacts.
