# Post-Coding Review: Visible Mimo Completion

Date: 2026-07-14

## Requested Outcome

One previously authorized task must submit exactly once through the logged-in Mimo official page, obtain the real provider result, download and probe the MP4, create an execution ledger, pass administrator QA, and become available for its owning customer.

## Correct Path

The parent Mac worker owns readiness, claim, heartbeat and the unique provider task ID. The visible Safari session uploads only the locked, SHA-verified references, enters the required prompt in Mimo's actual prompt editor, and clicks Generate once. After the initial poll delay, the same authenticated browser session reads status and downloads the matching provider result. The worker then runs media probe, writes a ledger, uploads both to the service, and leaves the final state at `awaiting_content_qa`; only an administrator content-QA action completes delivery.

## Intentionally Changed Files

- `mac-agent/mimo-safari-visible-submit.mjs`
  - Retains a single workspace session checkpoint.
  - Waits for the generator instead of treating hidden login controls as proof of logout.
  - Clears stale references, normalizes a broken small Safari viewport, targets Mimo's real contenteditable task-prompt editor, focuses it before keystrokes, and dispatches model input events.
- `mac-agent/prepare-mimo-safari-session.mjs`
  - Recognizes the contenteditable generator prompt.
- `mac-agent/mimo-safari-visible-sync.mjs`
  - New browser-session status/download runner. It uses the already logged-in official page's in-memory authorization internally and never writes or prints credentials, tokens, cookies, or signed URLs.
- `mac-agent/niannian-mac-worker.mjs`
  - Uses the visible-session synchronizer for tasks that already have a provider ID, preventing a second submit and avoiding the obsolete direct-API credential dependency.
- `lib/mac-codex-worker.ts`
  - A post-submit sync failure preserves the provider ID and authorization rather than incorrectly converting the task to an untraceable manual fallback.
- `lib/admin.ts`, `app/admin/page.tsx`
  - Add a no-cost `resume_provider_sync` action. It can only resume an already-existing provider task; it does not clear the task ID, create a new task, or permit another generation submit.
- `scripts/mimo-safari-visible-submit.test.mjs`
  - Covers clearing stale page references and dispatching a prompt input event before Generate.

## Automated Verification

- `node --check mac-agent/mimo-safari-visible-submit.mjs`
- `node --check mac-agent/prepare-mimo-safari-session.mjs`
- `node --check mac-agent/mimo-safari-visible-sync.mjs`
- `node --check mac-agent/niannian-mac-worker.mjs`
- `npm run test:mimo-safari-visible-submit` (2 passing)
- `npm run test:mac-worker` (4 passing)
- `npm run lint`
- `npm run build`

## Real End-To-End Evidence

- Single controlled task: `Oyp350sZkXMxhigC9X1zqMRg`.
- Real Mimo provider ID: `716316150530`.
- Mimo reported status `1` with a video URL through the authenticated visible session.
- Downloaded MP4 SHA-256: `e81c2a7becab55c6e3b8470e29cdcdd771000539af3240b4b03f85200d99bb72`.
- `ffprobe`: 1280x720 video, AAC audio, 5.062 seconds.
- Execution ledger exists and records the locked prompt hash, locked reference hash, provider ID, media probe, and pending content QA.
- Two evidence-only frames at 1s and 3s show a stable 16:9 talking-head result with visible speech motion and no obvious frame corruption.
- Server accepted output and ledger, enforced QA, and the administrator completed delivery. Admin readback now shows the task as `已完成` / `已交付，无需处理`.

## Production Readback And Rollback

- `https://sd2.cauai.fun/api/health` is healthy after the scoped app rebuild.
- The active Mac parent is one `run-loop` process (PID recorded during the run), with the visible submitter and synchronizer hashes read back from the installed paths.
- Website source backups were retained under `/tmp/niannian-hotfix-visible-sync-*` and `/tmp/niannian-hotfix-provider-sync-*` on the production host.
- Mac binary rollback copies were retained beside their installed files with timestamped `.rollback-*` suffixes.
- No database migration, data-volume rebuild, task deletion, credit refund/recharge, or additional provider submission occurred in this repair.

## Remaining Verification Boundary

The server-side task is complete and its result is stored for the owning account. A customer-session browser playback and download check remains unverified here because the current administrator session belongs to a different account and no customer session was impersonated. This is the only remaining customer-surface evidence item; it must be tested by signing into the owning task account and opening the completed task.

## Follow-up: Fast Status Synchronization

- The first Mimo status check now starts after `60` seconds instead of a fixed seven-minute wait.
- A visible-session Mimo task now defaults to 60 sync cycles at the normal 15-second cadence, preserving the same provider ID and lease while a legitimate multi-minute generation runs.
- This reduces delivery latency after provider completion without creating a second task or another Mimo submission. The provider's own render queue is unchanged.
- Verification: `node --check mac-agent/niannian-mac-worker.mjs`, `npm run test:mac-worker` (4 passing), and `npm run lint` passed. The installed Mac worker hash was read back after restart; its recovery launcher now also pins the 60-second first poll and 60 sync cycles for future restarts.

## Follow-up: Artifact-First Completion Recovery

### Corrected Failure

The Mimo official task list exposed a real downloadable MP4 for provider task `716071936258` while the batch-status endpoint was still returning status `60`. The visible synchronizer correctly downloaded that MP4 and recorded `completedByVideoArtifact: true`, but the parent Worker then checked status `60` before checking that artifact marker and overwrote the local result as `running`. This made a completed provider result look unfinished on the website.

### Source Repair

- `mac-agent/mimo-safari-visible-sync.mjs` treats a matching downloadable MP4 from the official task list as the stronger completion signal when batch status lags.
- `mac-agent/niannian-mac-worker.mjs` no longer returns `running` for status `20`, `50`, or `60` when `completedByVideoArtifact` is true.
- The Mac parent now scans only its own locally locked Mimo jobs whose last result is `running` and whose local task/provider IDs agree, then performs sync/download/probe/report only. It never claims, restores a lease, or executes Mimo submission in this path. The explicit `resume-locked --task-id` command applies the same provider-sync-only contract to one named task.

### Verification And Current Result

- `node --check mac-agent/niannian-mac-worker.mjs`
- `node --check mac-agent/mimo-safari-visible-sync.mjs`
- `npm run test:mac-worker` (4 passing)
- `npm run lint`
- The new installed Mac binary SHA-256 is `91f75082b483c8c05b6708011fc33a20f97aaaecf7e3ec9d61decd06eea496a0`; the prior installed binary is retained in `backups/20260714-provider-sync-autoresume`.
- Controlled task `DQDP1lYhyXCznml5rzDVRNn6` kept its original provider ID `716071936258`; no second Mimo task was created and no additional Mimo cost was authorized or consumed.
- The recovered MP4 SHA-256 is `28c88fc3f8792a860badb7100574eb6ecd1f887083ec54bb3bf86cc5bd98bb99`. Production `ffprobe` confirmed H.264 1280x720 video, AAC audio, and 5.061950 seconds. Three evidence-only frames at 0.5s, 2.5s, and 4.5s show a stable single-shot talking-head result with no visible cut or frame corruption.
- The service accepted the real MP4 and JSON ledger, then the administrator content-QA action completed delivery. Production readback is `completed`, with event sequence `mac_worker_output_received` then `admin_review_output`.

### Remaining Boundary

The on-disk Mac Worker binary now contains the automatic locked-task recovery fix, but its already-running parent process was started before this hotfix. A remote LaunchAgent restart could not replace that process because the persistent LaunchAgent currently has no readable Mac agent-token Keychain item. Therefore the automatic-recovery behavior is source-verified and installed but not yet runtime-verified after a clean Mac GUI-session restart. The completed task above was safely reconciled from its existing downloaded artifact without a second provider submission. Owner-session playback/download is still not impersonated or verified from the administrator account.

## Follow-up: Mac GUI Token Repair And Runtime Verification

### Requested Outcome

Restore the missing Mac Worker agent-token Keychain item from the trusted production secret source, restart the worker only in the logged-in Mac GUI session, and prove the new parent is operational without creating a task or submitting Mimo.

### Correct Path

The server token must move through an existing encrypted SSH channel and a one-time, permission-`600` named pipe into a Mac Terminal process belonging to the active GUI user. That GUI process writes the Keychain item, stops the previous parent, bootstraps the existing LaunchAgent, and removes the pipe. The proof of success is the server's authenticated readback of a fresh heartbeat, ready status, empty active task, and Mimo readiness, not a local process listing alone.

### Changed File

- `mac-agent/repair-mac-agent-token-macos.command`
  - Reads one agent token from a named pipe and removes that pipe on every exit path.
  - Writes the token only to the logged-in user's Keychain with the system `security` tool; it never prints, writes, or logs the token.
  - Verifies Keychain metadata without reading the secret value, terminates the old `run-loop` parent, and restarts the existing GUI LaunchAgent.

### Verification

- `bash -n mac-agent/repair-mac-agent-token-macos.command`
- `/bin/zsh -n` passed on the Mac copy before execution.
- The Mac console session was confirmed as `lsb` / UID `501`; the execution queue was empty before restart.
- The GUI script reported `MAC_AGENT_TOKEN_REPAIRED_AND_WORKER_RESTARTED`.
- The prior Worker PID `99590` was replaced by LaunchAgent PID `7848`.
- Authenticated production status now reports: Worker `lsbmacbook-air-codex`, `status=idle`, `activeTaskId=null`, `version=1.4.8`, `readyToClaim=true`, no readiness blocker, Skill bundle `1.2.6`, Mimo reachable and authenticated, and zero queued/approved/running/stale Mac tasks.
- No video task was created, claimed, submitted, charged, downloaded, deleted, or modified during this repair.

## Follow-up: Desktop Three-Column Workbench

### Requested Outcome

Rename the customer-facing "生成工作台" entry to "工作台" and make the desktop video workbench fit its core workflow in one viewport, with source material, preview, and task controls visibly separated into three columns.

### Correct Path

At desktop widths, the document must not become a long canvas for the core workflow. The source column keeps the prompt and material lanes together, the preview column owns the current composition, and the task column owns settings, price, creation, and history. Long material/reference lists and task history scroll inside their respective panels. At narrower widths, the existing stacked, scrollable mobile workflow remains the fallback. This is presentation only: uploads still use `/api/assets`, task creation still uses `/api/video-tasks`, and pricing/credit state remain unchanged.

### Intentionally Changed Files

- `components/SiteHeader.tsx`: navigation label is now `工作台`.
- `app/guide/page.tsx`: guide CTA now says `进入工作台`; no customer-facing `生成工作台` text remains.
- `app/home/page.tsx`: semantic three-column workbench structure with a dedicated task-control region inside the task column.
- `app/globals.css`: desktop viewport containment, three column tracks, compact panel internals, and independent scroll regions for source material and task history. Mobile and tablet fallback rules remain in place.
- `.dockerignore`: ignores `releases/`, so retained release backups cannot be pulled into a Docker build context and treated as duplicate TypeScript source.

### Deployment Incident And Source Fix

The first production build correctly rejected a backup copy of `components/SiteHeader.tsx` under `releases/backups/` because that copy lacked its sibling imports when Next scanned the Docker build context. The existing running container was not replaced. Adding `releases/` to `.dockerignore` removes release backup artifacts from future Docker contexts. The rebuilt production image then completed successfully and the app was recreated normally.

### Verification

- Local `npm run lint` passed.
- Local `npm run build` passed after every source change.
- Production Docker build passed after the `.dockerignore` correction.
- Production app was recreated without database, volume, Mac Worker, Mimo, credit, or task changes.
- `http://127.0.0.1:18084/api/health` and `https://sd2.cauai.fun/api/health` both returned healthy responses after restart.
- `https://sd2.cauai.fun/home` returned HTTP `200`.
- Production source readback confirms the new navigation label, the `generator-three-column` structure and CSS, and guide CTA wording.
- A timestamped rollback copy of all four UI source files was retained at `/opt/niannian-ai-video-workbench/releases/backups/frontend-workbench-20260714-three-column`.

### Remaining Verification Boundary

An automated authenticated visual screenshot was not available because the local browser-control runtime failed before connecting. The code/build/readback evidence confirms the deployed structure and viewport rules, but the final visual judgment at an authenticated 1280px+ desktop viewport still needs an in-browser customer check. No task creation or paid provider work was used for this UI deployment.

## Follow-up: History-Only Right Column

### Requested Outcome

Keep the desktop right column exclusively for task history. The video setup, price, credit validation, and create action belong with the source material in the left column.

### Correct Path

The left column is the complete creation surface: description, references, format settings, price, validation feedback, and the submit action. The middle column remains preview-only. The right column renders only previously created tasks and the link to the full task-record page. Moving controls changes neither the state bindings nor task API payload.

### Intentionally Changed Files

- `app/home/page.tsx`: moved the existing interactive create-control block from `generator-history-card` into `generator-form-card`; renamed the columns to `制作`, `预览`, and `历史记录`.
- `app/globals.css`: renamed the compact control styling to `generator-create-controls` and made it a left-column section; the task history remains the only scrollable content in the right column.

### Verification

- `npm run lint` passed.
- A first local build reached successful compilation but hit a transient Windows `spawn UNKNOWN` while generating static pages; no source/type error was reported. The immediate clean retry of `npm run build` passed all 34 static pages.
- Production Docker build passed, the app container was recreated, and the production health endpoint recovered successfully.
- No upload, task, credit, worker, Mimo, database, or volume operation was performed.
- Rollback copies of both deployed files are retained at `/opt/niannian-ai-video-workbench/releases/backups/frontend-workbench-20260714-history-only`.

### Remaining Verification Boundary

The source, local build, production build, and health checks confirm the deployed ownership of controls. The final logged-in visual check remains a customer-browser check because no authenticated browser screenshot control is currently available.

## Follow-up: Wider Creation Column

### Requested Outcome

Reduce the cramped appearance of the left creation column without moving controls back into the history column or reintroducing page-level scrolling.

### Source Change

- `app/globals.css`: desktop grid tracks now give the creation column the largest share, keep the preview column substantial, and reduce the history column to an appropriate history-only width. Material groups gain more horizontal and vertical separation; upload rows and thumbnails are slightly larger for more usable visual breathing room.

### Verification

- `npm run lint` passed.
- `npm run build` passed all 34 static pages.
- Production Docker build passed and the app container was recreated.
- Production health recovered after restart. No API, task, credit, database, worker, or provider behavior changed.
- Previous production CSS is retained at `/opt/niannian-ai-video-workbench/releases/backups/frontend-workbench-20260714-left-width/app/globals.css`.

### Remaining Verification Boundary

The deployed CSS and production health were read back successfully. Final aesthetic judgment still requires the authenticated desktop browser viewport that the user is currently viewing.

## Follow-up: Native Task Video Controls

### Requested Outcome

Remove the duplicate task-card `播放视频` and `下载成片` controls and rely only on the browser's built-in video controls.

### Correct Path

The completed-task result should render one native `video` element with `controls`, `playsInline`, and metadata preloading. A second button layer must not call `video.play()` independently, because it can diverge from the native player's state and make an apparently clickable button look ineffective. The output URL remains unchanged; this change only removes the duplicate UI and its state handler.

### Intentionally Changed Files

- `app/home/page.tsx`: simplified `TaskVideoPlayer` to one native video element and removed the custom playback state, event handlers, download link, and duplicate `downloadUrl` prop.
- `app/globals.css`: removed styles that belonged exclusively to the deleted action row.

### Verification

- `npm run lint` passed.
- `npm run build` passed all 34 static pages.
- Source search confirms no `播放视频`, `下载成片`, `generator-task-video-actions`, or `downloadUrl` remains in the customer workbench implementation.
- Production Docker build passed, the app container was recreated, and the health endpoint recovered.
- No output URL, task status, credit, provider, Worker, database, or delivery artifact was changed.
- Rollback copies are retained at `/opt/niannian-ai-video-workbench/releases/backups/frontend-workbench-20260714-native-video-controls`.

### Remaining Verification Boundary

The native control-only DOM and production deployment are verified. Actual native download-menu availability remains browser-dependent, so it should be checked in the user's current browser using that browser's video overflow menu where provided.

## Follow-up: Flat Material Upload Surface

### Requested Outcome

Remove the cramped, double-framed appearance in the two-column material uploader while retaining the same four material roles and upload behavior.

### Correct Path

Each material role should present one clear label and one upload/drop surface. The surrounding generator column is already the panel boundary, so nesting an additional bordered material card around every dashed upload area adds visual noise and consumes useful width without adding a separate interaction. The material role, file input, uploaded reference list, and client upload contract remain unchanged.

### Intentionally Changed File

- `app/globals.css`: removed the background, border, radius, and padding from `.generator-reference-group`; increased material-grid gaps so role labels and their single upload surfaces have deliberate separation.

### Verification

- `npm run lint` passed.
- `npm run build` passed all 34 static pages.
- Production Docker build passed, the app was recreated, and the health endpoint recovered.
- No material role, input accept rule, upload endpoint, task payload, credit, Worker, database, or provider behavior changed.
- The previous production CSS is retained at `/opt/niannian-ai-video-workbench/releases/backups/frontend-workbench-20260714-flat-materials/app/globals.css`.

### Remaining Verification Boundary

Production source/build/readback are complete; the final visual assessment is limited to the authenticated viewport the user is using.

## Follow-up: Center-Preview Task Playback

### Requested Outcome

Keep the right-hand history column free of embedded players. A completed history item should open its result in the larger center preview area when selected.

### Correct Path

The task list remains a record list. Only completed tasks with an existing public output URL become keyboard-accessible preview selectors. Selecting one stores its task ID in local UI state and renders the same output URL in the center native video element. Clearing the selection returns the center area to the material preview. No task, output, download URL, or API request is modified by this client-only selection state.

### Intentionally Changed Files

- `app/home/page.tsx`: removed the right-column `TaskVideoPlayer`; added selected completed-task state, center native result video, a return-to-material-preview command, and accessible click/Enter/Space selection handling on completed history records.
- `app/globals.css`: added full-center result video layout and selected/hover feedback for previewable history items.

### Verification

- `npm run lint` passed after an explicit null-safe output URL correction.
- `npm run build` passed all 34 static pages.
- Production Docker build passed, the app container was recreated, and health recovered.
- No task, output URL, storage object, task status, credit, provider, Worker, database, or delivery artifact changed.
- Rollback copies are retained at `/opt/niannian-ai-video-workbench/releases/backups/frontend-workbench-20260714-preview-in-center`.

### Remaining Verification Boundary

The selected-task render path is type-checked and production-built. A user click in the authenticated current browser remains the final validation of native playback in that browser.

## Follow-up: Interaction Hardening For Embedded Playback

### Requested Outcome

Make the completed-task selection and center playback path reliably interactive in the embedded customer browser, rather than relying on non-semantic task cards and potentially obscured native control layers.

### Correct Path

Completed history records must be real buttons so they always receive click, keyboard, focus, and disabled-state behavior from the browser. Selecting one mounts a fresh, muted-autoplay center video so the customer immediately sees playback even when an embedded browser's native control affordances are unreliable. The center player and material-preview command must remain on an explicit interactive stacking layer. Noncompleted records stay disabled status entries.

### Intentionally Changed Files

- `app/home/page.tsx`: converted history records to native buttons; completed records select the result, while incomplete records are disabled. The selected center video remounts by task ID and starts muted automatically.
- `app/globals.css`: introduced button-card styling and explicit interactive stacking for center preview, video, and material-preview control.

### Verification

- `npm run lint` passed.
- `npm run build` passed all 34 static pages.
- Production Docker build passed, the app container was recreated, and health recovered.
- The delivery route remains range-capable and inline for native playback; the completed-task screenshot proves the output source can load metadata, duration, and a first frame.
- No task, output URL, download route, credit, provider, Worker, database, or media file changed.
- Rollback copies are retained at `/opt/niannian-ai-video-workbench/releases/backups/frontend-workbench-20260714-interaction-hardening`.

### Remaining Verification Boundary

Automated browser interaction could not be attached in this desktop runtime. The deployed source now uses actual buttons and autoplay fallback, but a single refresh in the user-authenticated embedded browser is still required to prove that browser accepts the interaction.

## Follow-up: Prompt Area Overflow

### Requested Outcome

Prevent the desktop video-description textarea from covering the material labels beneath it in the left creation column.

### Root Cause And Correction

The prompt wrapper had a fixed `118px` flex height while its textarea also claimed `height: 100%` and a `118px` minimum height. The label and character counter sit in the same wrapper, so the total layout exceeded the reserved wrapper height and visually flowed onto the next material section. The desktop prompt wrapper now reserves `122px`, while the textarea itself is explicitly `84px`; labels and the counter now fit inside the reserved block.

### Verification

- `npm run lint` passed.
- `npm run build` passed all 34 static pages.
- Production Docker build passed, the app was recreated, and health recovered.
- This is a CSS-only change. No task, asset, credit, worker, provider, database, or media behavior changed.
- Previous production CSS is retained at `/opt/niannian-ai-video-workbench/releases/backups/frontend-workbench-20260714-prompt-height/app/globals.css`.

### Remaining Verification Boundary

Production source and health are verified; the final visual readback needs the user's current authenticated viewport refresh.

## Follow-up: Prompt Height At Every Viewport

### Corrected Scope

The prior prompt-height correction was scoped to the desktop three-column media query. The customer's active viewport was outside that query, so it retained the legacy `height: 100%` textarea behavior and did not visibly change.

### Source Correction

- `app/globals.css`: moved the prompt's non-overflowing height contract into the base generator styles. Desktop/tablet now use a `96px` content textarea with an automatic-height wrapper; the existing mobile breakpoint explicitly restores a `150px` textarea. The three-column desktop override remains a slightly tighter `84px` content textarea within its reserved `122px` wrapper.

### Verification

- `npm run lint` passed.
- `npm run build` passed all 34 static pages.
- Production Docker build passed, the app was recreated, and health recovered.
- CSS-only; no task, asset, credit, worker, provider, database, or media operation changed.
- Previous production CSS is retained at `/opt/niannian-ai-video-workbench/releases/backups/frontend-workbench-20260714-prompt-all-widths/app/globals.css`.

### Remaining Verification Boundary

The actual customer viewport now receives the base correction rather than relying on the desktop-only selector. Final visual confirmation still needs its post-deploy refresh.
