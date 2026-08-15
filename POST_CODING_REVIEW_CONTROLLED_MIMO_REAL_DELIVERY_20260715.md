# Post-Coding Review: Controlled Mimo Recovery And Real Delivery

Date: 2026-07-15

## Requested Outcome

Recover the already paid, provider-ID-bearing Mimo test task through the real Mac Worker route, without resubmission, then prove downloaded media, visual QA, site QA completion, and customer playback/download.

## Correct Operating Path

The correct path is not to create a replacement task or submit again. The existing task already has provider ID `716856369666`, a locked prompt, a SHA-verified primary reference, and a historical credit reservation. The path must therefore be:

1. restore the Mac's frozen Skill/CLI readiness without overwriting unreviewed user Skill content;
2. authenticate or recreate the official Safari session without upload or Generate;
3. resume the exact task as `provider_sync_only`;
4. claim it only after the parent Worker reports ready and no account mutex exists;
5. download the existing provider artifact, probe it, write the ledger, and let the server hold it for QA;
6. independently inspect decoded evidence frames, perform the server's content-QA completion gate, and verify the owner's native playback/download route.

## Intentional Changes

- `mac-agent/prepare-mimo-safari-session.mjs`
  - reuses or recreates Safari WebDriver session state;
  - authenticates only the Keychain-supplied approved Mimo account when the login page is visible;
  - verifies token-bearing generator state; no upload or Generate code exists;
  - performs a bounded read-only wait for a visible provider balance badge.
- `mac-agent/mimo-safari-visible-sync.mjs`
  - runs the session preparer before status/list/download synchronization;
  - remains sync-only, with no provider submit path.
- `mac-agent/niannian-mac-worker.mjs`
  - Worker `1.4.11` treats actual authenticated Safari state as its readiness gate instead of treating WebDriver availability as authentication.
- `mac-agent/install-macos.sh`
  - resolves a valid Codex standalone/desktop CLI path when the mutable `~/.local/bin/codex` symlink is broken;
  - installs both visible submit and visible sync helpers.
- `mac-agent/deploy-existing-macos-hotfix.sh`
  - installs the session preparer and synchronizer and checks worker `1.4.11`.
- `mac-agent/skill-bundle/*`
  - bundle `1.2.7`, minimum Worker `1.4.11`, regenerated from the authoritative local Skill source;
  - records the approved `ai-video-channel-router` updates instead of leaving them as an untracked hash mismatch.
- `scripts/mimo-safari-visible-sync.test.mjs` and `package.json`
  - add a mock-WebDriver test proving stale-session recreation, login, status/download recovery, and the absence of upload/Generate calls.
- `scripts/mac-skill-bundle.test.mjs`
  - updates the expected bundle version.
- `release-candidates/niannian-mac-worker-1.4.11-hotfix/*`
  - final SHA-locked Mac-only release package.
- `CONTROLLED_MIMO_REAL_DELIVERY_20260715.md`
  - durable transaction evidence, QA findings, cost boundary, and rollback points.

No website app source, visual asset, database migration, DNS, Nginx, or production app container was changed in this recovery.

## Changed-Path Inspection

The session preparer deliberately contains no file-input mutation, upload endpoint, prompt editor write, or Generate command. The synchronizer calls the preparer, then only the provider batch status, list, proxy-token when required, and video download routes. The worker continues to choose the synchronizer only after `providerTaskId` exists.

The production Skill mismatch was traced to two authoritative `ai-video-channel-router` files changed outside the old 1.2.6 manifest. Reinstalling the old bundle temporarily restored readiness but the mismatch recurred, proving that merely overwriting the file would not be durable. Rebuilding bundle 1.2.7 from the authoritative skill source fixes the parity contract while preserving the user-approved Skill update.

The Codex CLI outage was traced to a mutable symlink whose target moved from `current/bin/codex` to `current/codex`. The installed launch wrapper now points to the executable standalone path. The old target is preserved in the Mac rollback backup.

## Automated Verification

Passed:

- `node --check mac-agent/prepare-mimo-safari-session.mjs`
- `node --check mac-agent/mimo-safari-visible-sync.mjs`
- `node --check mac-agent/niannian-mac-worker.mjs`
- `npm run test:mimo-safari-visible-sync`
- `npm run test:mimo-safari-visible-submit`
- `npm run test:mac-worker`
- `npm run test:mac-skill-bundle`

The new sync test creates a stale browser state, authenticates through the preparer, obtains an existing provider result, downloads it, and asserts no upload or generation request was made.

## Production Readback

- At the successful reconciliation checkpoint, Mac Worker `1.4.11` was `idle`, `readyToClaim=true`, with no active task. Final readback later became `blocked` with `MIMO_VISIBLE_FRONTEND_UNAVAILABLE` after the Mac remote network session became unreachable; it has no active task and did not claim the separate queued task.
- Skill bundle: `1.2.7`, hash `18ed36c5eda5e6c3a69d890e6fa30e063e4b417d8ff1615b9482b4e0a2dda4ab`.
- Mimo: official Safari session reachable and authenticated.
- Reconciled task: `BGpCAtL0jSnVsRLZH0nSwyEn`, provider ID `716856369666`, final site status `completed`.
- Output: H.264/AAC, 1280x720, `5.085011` seconds, `5,511,368` bytes, SHA `6d06128460c2f6b2548d027cca976430e31daa01a4574608430245621a8dedba`.
- Customer page: authenticated owner sees the record as completed; native media decoded at `readyState=4`; browser-native media download succeeded.

## Stops-Too-Early Check

This work did not stop at a provider task ID, a browser screenshot, a media URL, or a local MP4. The task reached all downstream states:

`existing provider receipt -> Worker sync-only claim -> MP4 download -> ffprobe -> worker ledger -> server output receipt -> independent visual QA -> server content-QA completion -> owner page native media decode -> browser media download`.

## Residual Risk And Unverified Items

- The 5-second output has an audio stream and non-silent first segment, but its exact spoken sentence was not separately transcribed by ASR.
- The Mimo page visibly reported `480 积分` and a rate of `1积分/秒`; the historic original submit did not retain a numeric before-balance, so its exact historic debit cannot be reconstructed. The current reconciliation submitted nothing and incurred zero new provider cost.
- The current Worker heartbeat's `channel.credits` remains null because the provider balance badge appears later than its short preflight window. This does not affect the authenticated execution gate; the explicit visible-page readback is recorded above. A future rate/credit dashboard improvement should cache this independent readback rather than make worker readiness wait longer.
- The distinct queued task `5ssvZnUgaADShGsJuAplAm1v` remains intentionally unapproved. It was neither claimed nor modified.
- Automatic execution is currently unavailable while the Mac is unreachable. Restore Mac network/GUI reachability and observe a fresh authenticated `readyToClaim=true` heartbeat before accepting another automatic customer task.

## Review Result

`real_delivery_verified_existing_provider_reconciled`

This is a real provider artifact and real customer delivery, but it is a reconciliation of an already submitted provider task, not evidence of a newly submitted Mimo generation on 2026-07-15.
