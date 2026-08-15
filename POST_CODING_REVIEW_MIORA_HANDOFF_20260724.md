# Post-Coding Review: Miora Human Handoff and Recoverable S2 Video Execution

Date: 2026-07-24

## Requested outcome

Turn the previously real-verified Miora / S2 Video route into a workbench flow where the operator handles only login, OTP, CAPTCHA and other platform-mandated human steps; the system resumes the exact task and completes controlled submission, task-id sync, download, probe, QA and ledger work.

## Correct end-to-end path

1. A task locks `video_task_spec.json`, prompt/reference hashes, Miora-only channel policy, 720p/15s constraints and a cost gate.
2. Read-only Miora preflight writes only session/model/credit readbacks. It never persists a credential or performs upload/submission.
3. On platform login/verification blockers, the worker creates an active `channel_handoffs` record and transitions to `awaiting_human_login` or `awaiting_human_verification` without removing the existing authorization or provider id.
4. The owner or administrator opens the visible Miora session, completes the platform step, and selects “我已完成，继续任务”. The server resolves the handoff and returns the same task to `approved_for_execution`.
5. If no provider id exists, the Miora adapter uses the verified canvas route: short Agent entry → `视频容器` → generator dialog → S2 Video/参考/16:9/720p/15s readback → image action → `从本地上传图片` → prompt binding → `arrow-run` submission. If an id exists, it only syncs.
6. A response from `/api/ai/media-generate/video` must yield the provider `taskId`. A later `/api/ai/media-generate/progress` read must yield the matching `resultSignUrl`; no “latest page video” is accepted.
7. The downloaded MP4 must be inside the task's own `downloads` directory, pass `ffprobe`, receive a SHA-256 and task ledger, then wait in `awaiting_content_qa`. Only explicit QA can transition it to `completed`.

## Files reviewed

- `lib/auth.ts`
- `lib/miora-session.ts`
- `lib/miora-channel.ts`
- `lib/video-tasks.ts`
- `lib/admin.ts`
- `app/admin/page.tsx`
- `app/projects/page.tsx`
- `app/api/video-tasks/[id]/handoff/route.ts`
- `scripts/miora-direct.mjs`
- `scripts/video-task-worker.mjs`
- `scripts/miora-direct.test.mjs`
- `scripts/video-task-worker.test.mjs`
- `MIORA_HUMAN_HANDOFF_RUNBOOK.md`

## Findings and safeguards

- The session/handoff tables store state, instructions, task association and safe readbacks only; no password, OTP, cookie, token or OAuth datum is modelled or written.
- A human blocker preserves `submit_allowed` and cost authorization but is not eligible for the worker until the explicit resume operation. This prevents accidental retries while the user is at the platform page.
- Existing provider ids choose sync-only recovery. The worker does not refund the workbench reservation after a provider id exists, because the external provider may already have consumed quota.
- The adapter rejects ambiguous generator dialogs and ambiguous `arrow-run` buttons. It no longer relies on `.model-select-btn`, arbitrary hidden file inputs or generic “latest video” links.
- `completed` remains gated by `validateCompletedOutput`, which validates the task-local MP4 path, ledger path, `ffprobe` duration and positive content QA.

## Validation performed

- `node --check scripts/miora-direct.mjs`: passed.
- `node --check scripts/video-task-worker.mjs`: passed.
- `npm run lint`: passed.
- `npm run test:miora-direct`: 2/2 passed.
- `npm run test:video-worker`: 14/14 passed.
- `npm run worker:video:dry-run` with a task-local alternate state file: passed; no task was claimed, uploaded or submitted.
- `npm run build`: passed; the new owner resume route `/api/video-tasks/[id]/handoff` is present in the production route manifest.

## Not verified in this review

No new billable Miora generation was submitted. The live provider `progress` request/response shape and the complete user-visible handoff recovery should be verified in the next user-authorized controlled task. That future run must leave a fresh provider task id, submission receipt, MP4, `ffprobe`, SHA-256, QA file, ledger and `channel_execution_receipts` row before it is counted toward the concurrency promotion thresholds.

## Addendum: direct workbench creation and compounding loop

### Requested outcome

Remove the avoidable "create a default Mimo task, then re-route it" hop so an authorized operator can create a Miora Method13 task directly from the workbench, while keeping platform-required login, OTP, CAPTCHA and human confirmation as a short, explicit user handoff.

### Changed files reviewed

- `app/home/page.tsx`
- `app/api/video-tasks/route.ts`
- `MIORA_HUMAN_HANDOFF_RUNBOOK.md`

### Correct path checked

1. Only an administrator can select `Miora · S2 Video（方法13）` at `/home`.
2. The page fixes the Miora creation contract at `720P`, `15 秒` and `16:9`; the API repeats that check and rejects other Miora specs.
3. The creation API uses `channel=miora`, `executionMode=server_auto` and `chargeCredits=false`. This means the workbench does not confuse its customer-credit system with Miora provider credits. It does not bypass the separately required preflight and maximum-cost gate.
4. A blocker still creates the task-specific human handoff; after the person completes the platform step, recovery continues that exact locked task. A task with a saved provider task id only syncs and does not submit again.
5. Completion still needs the provider-matched MP4 in the task directory, `ffprobe`, SHA-256, ledger and content QA; a task card or a submit response is not treated as an output.

### Validation performed after this addendum

- `npm run lint`: passed (including the nullable customer-credit display fix in `app/home/page.tsx`).
- `npm run test:miora-direct`: passed, 2/2.
- `npm run test:video-worker`: passed, 14/14, including Miora fixed-spec routing and human-handoff classification.
- `npm run worker:video:dry-run` with `VIDEO_WORKER_STATE_PATH=data\\video-worker-state.dry-run.json`: passed; it claimed no task and made no provider request.
- `npm run build`: passed; the production route manifest includes `/home`, `/api/video-tasks`, `/api/admin/miora-preflight`, and `/api/video-tasks/[id]/handoff`.

### Stops-too-early check

The direct creation change only creates a locked task. It cannot mark a task completed and does not call Miora from the browser. The downstream worker retains the preflight, explicit cost gate, task-id persistence, same-id result download, media probe, ledger and QA gates. No new live billable task was submitted by this addendum.

## Addendum: evidence-only compounding profile and verified-template candidates

### Requested outcome

Let the Miora route improve from real runs without treating a tutorial, an incomplete browser page, an unprobed download, or a guessed provider price as production evidence.

### Changed files reviewed

- `lib/miora-learning.ts` (new)
- `lib/admin.ts`
- `app/admin/page.tsx`
- `app/api/admin/miora-templates/route.ts` (new)
- `app/home/page.tsx`
- `C:\\Users\\lsb\\.codex\\skills\\miora-seedance2-channel\\SKILL.md`

### Correct execution path checked

1. The worker writes one `channel_execution_receipts` row per task, preserving its provider task id, local output/ledger paths and probe/QA flags.
2. The learning profile joins those rows to their own locked Miora tasks. A task can become a template only if it has: provider task id, media-probe pass, content-QA pass and `video_tasks.status=completed`.
3. The profile reports receipt count, task-id count, download-and-probe count, content-QA count, QA pass rate, active human handoffs, verification frequency and a concurrency ceiling. Promotion uses the **newest consecutive** verified receipt streak, not a lifetime count: fewer than three = 1, three = 3, ten = 10. A newer failed/blocked receipt resets the profile to verification mode rather than being hidden by historic wins.
4. The per-task provider price is still not visible in the verified Miora UI. The profile explicitly reports `not_observed`, so a manually authorized maximum never becomes a false actual-cost baseline.
5. Creating an automatic test from an existing Miora task now keeps `chargeCredits=false`; it cannot incorrectly reserve the website's customer-credit balance for an external Miora provider run. Mimo/Dola behavior remains unchanged.
6. The dashboard renders this profile and only the source-task prompt/specification candidates derived from those verified receipts. It does not expose cookies, OTP, passwords, browser profiles or provider tokens.
7. The authority channel Skill now carries the same evidence-only template, consecutive-streak concurrency, truthful-cost and no-workbench-credit rules, so future Miora execution cannot silently revert to tutorial-based promotion.
8. The administrator workbench can request only those verified template candidates and apply a selected candidate's locked prompt/specification to a new Miora task. It never copies the old task's uploaded asset ids, white-line output, cost authorization or provider task id; the new task must upload its own inputs and pass every preflight/gate again.
9. The administrator's `智能路由（仅用真实证据）` choice resolves to Miora only for the fixed S2 spec and only if the latest Miora receipt is a complete verified closure. Otherwise it resolves to the normal Mimo route. It never silently changes an explicit Miora selection, exposes credentials, or bypasses Miora's fresh preflight/cost gate.

### Addendum: locked 9093/face preprocessing

The workbench Miora adapter previously verified the source image SHA before upload, but it did not yet enact the Miora SOP's required `9093/face` preprocessing. This was a real downstream gap: the task could have a correct route and provider submission yet still upload the unprocessed source reference.

The repaired path is now: locked source SHA verification → `GET /admin/api/face/status` → user-authorized `POST /admin/api/face/process` with white/2px settings → download the service result to the task's `ledger/face-line-references` directory → record original and derived paths/SHA, service URL and detected-face count in `ledger/face_preprocess_manifest.json` → upload only those derived paths to the Miora canvas. The adapter performs no PIL/OpenCV/ImageMagick/canvas/ffmpeg image manipulation and returns `face_line_service_not_ready` rather than a local fallback.

For an existing provider task id, the adapter remains sync-only: it does not rerun preprocessing or submit again. The submission receipt records the derived reference lineage; the output ledger points to the preprocessing manifest.

The human-handoff classifier now treats Miora service-agreement/privacy-term blockers as `action=terms`, with a task card labeled “确认平台条款”. This is deliberately distinct from login and CAPTCHA: it instructs the person to read and accept the platform terms themselves, never automatically accepts it, then resumes the existing task only after the explicit continue action.

### Validation performed after this addendum

- Reviewed the changed source and the downstream worker/receipt path directly.
- `npm run lint`: passed.
- `npm run test:miora-direct`: passed, 2/2.
- `npm run test:video-worker`: passed, 14/14.
- `npm run worker:video:dry-run` with task-local `VIDEO_WORKER_STATE_PATH`: passed; no task was claimed and no provider request was made.
- `npm run build`: passed; `/admin` and the existing controlled Miora API/worker routes compiled into the production build.
- A final production build after the template-selection API was added passed; its route manifest contains `/api/admin/miora-templates` and `/home`.
- A final production build after the evidence-backed smart-route addition passed; `/api/video-tasks`, `/api/admin/miora-templates` and `/home` are present in its manifest.
- After the 9093/face integration: `node --check scripts/miora-face-line.mjs`, `node --check scripts/miora-direct.mjs`, `npm run lint`, `npm run test:miora-direct` (2/2), `npm run test:video-worker` (14/14), the isolated worker dry-run, and `npm run build` all passed. `npm run test:miora-face-line` also passed 2/2 against a local 9093-compatible HTTP fixture: it proved the adapter stages only the service response and writes original/derived SHA lineage, while refusing an unapproved request. A read-only status request confirmed the locked real service is currently ready; no new provider submission was made.

### Stops-too-early check and remaining evidence

The profile is intentionally a read model and cannot manufacture a task completion or promote a submission-only result. No new Miora task was submitted for this code change. The next user-authorized Miora task remains the required live recovery acceptance: it must exercise workbench creation, any actual human blocker if the platform presents one, same-task resume, provider-id capture, same-id MP4 download, probe, SHA/ledger and content QA. Only then will it become the first workbench-native template/metric record and may count toward the 3-concurrency threshold.

## Addendum: live homepage S2 Video completion and current-canvas compatibility

### Requested outcome

Generate a new non-person homepage hero through the controlled Miora Method13 route, use the locked `9093/face` service, and replace the legacy BMW landing-page sample only after the exact provider result passed media and content checks.

### Changed files and generated artifacts reviewed

- `scripts/miora-direct.mjs`
- `app/page.tsx`
- `public/demo-miora-obsidian-s2-720p15s.mp4`
- `C:\Users\lsb\.codex\skills\miora-seedance2-channel\SKILL.md`
- `data/video-server-queue/pending/miora-homepage-hero-20260724102838-f193a04b.json`
- `data/video-outputs/miora-homepage-hero-20260724102838-f193a04b/`
- `data/niannian-auth.sqlite` task, receipt, session and event records

### Correct path reconstructed and checked

1. The task locked the non-person obsidian/pearl scene reference, prompt SHA, `miora`-only channel policy, `S2 Video / 参考 / 16:9 / 720p / 15s`, and a provider-balance maximum authorization. The workbench's customer-credit reservation stayed at zero.
2. The visible Miora page read back a 200 status for its protected credit/model endpoints, `S2 Video`, and a current pre-submit balance of `887.38`; no separate per-task price was displayed, so the balance was recorded only as a ceiling.
3. The locked local service processed the source reference. `ledger/face_preprocess_manifest.json` records source SHA `c774…286d27`, derived SHA `d1cd…2b38ba`, white/2px settings and `facesDetected=0`; the submission receipt identifies only the derived asset as the uploaded input.
4. Live Miora UI behavior differed from the older exact selectors: `视频容器 S`, a page-portal parameter menu, a `15s` slider, and an icon-only reference-image action. The direct adapter was revised to read those controls, resume an already open dialog instead of creating another project, close the parameter popover before upload, and avoid an unhandled chooser rejection.
5. The real POST returned provider task id `KOUeSTBOiGyLTlE8sh2UTgxpuoi1gqdxvKVg`. The task event, `events/submission.json`, `video_task_spec.json`, `video_tasks` row and execution receipt all bind to that same id before any result handling.
6. The visible completion state reported `使用 S2 Video 生成视频`. A captured native progress response for the same provider id reached `completed / 100` and supplied the signed result URL. The system downloaded only that response's MP4—never a page “latest” asset.
7. `ffprobe` verified H.264/AAC MP4, `1280x720`, `24fps`, video duration `15.041667s`, container duration `15.092971s`; SHA-256 is `a57dfdcd1263bb5e97ea52e5795ebfa1fc1e0aa146471e692b4644eca9d5b0bf`. Three evidence-only frames at 00.5/07.5/14.5 seconds passed the no-face, no-readable-text/logo/watermark, no-blank/truncation, material-continuity and stable-motion checks.
8. Only after QA pass was the task/receipt moved to `completed`, and the identical verified MP4 was copied to the public homepage asset. `app/page.tsx` now references it and labels it as a real Miora S2 Video sample.

### Validation performed after this addendum

- Live controlled provider execution completed as described above; it is a real delivery, not a smoke test.
- `node --check scripts/miora-direct.mjs`: passed.
- `npm run lint`: passed.
- `npm run test:miora-direct`: 2/2 passed.
- `npm run test:miora-face-line`: 2/2 passed.
- `npm run test:video-worker`: 14/14 passed.
- `npm run worker:video:dry-run` with a task-local state path: passed; no worker-side provider submission occurred.
- `npm run build`: passed after the landing-page asset change.
- Skill validation with `quick_validate.py`: passed.

### Stops-too-early check and remaining limitation

The requested customer-visible MP4 exists in its task-local downloads directory, is SHA/ledger/probe/QA bound, is recorded as `completed`, and is the exact file used by the homepage. The live submission, task-id capture, same-id native-progress read and download all occurred.

One reconnect-only adapter validation remains incomplete: an immediately reconnected `runMioraDirectTask` sync call returned `MIORA_PROGRESS_READBACK_FAILED:0`, although the visible page retained the exact native progress event and the same-task download was subsequently completed from that event without any arbitrary-page fallback. The new adapter code contains the observed-event-first path, but this particular reconnect behavior must be tested again on the next already-submitted task before claiming unattended process-restart sync is fully proven. It did not affect this completed task, and no duplicate submission was made.

## Addendum: current-balance Miora authorization and safe CDP disconnect

### Requested outcome

When the operator explicitly asks for one Miora S2 Video without a numeric Miora-credit question, create one locked `720P / 15s / 16:9` task using the authenticated provider's current balance as the hard ceiling, while still stopping for login, CAPTCHA, unavailable model or no usable balance.  Do not silently convert that one-task instruction into an unlimited provider-spend permission.

### Files reviewed

- `app/api/video-tasks/route.ts`
- `lib/video-tasks.ts`
- `app/home/page.tsx`
- `lib/miora-channel.ts`
- `scripts/miora-direct.mjs`
- `scripts/miora-direct.test.mjs`
- `C:\Users\lsb\.codex\skills\miora-seedance2-channel\SKILL.md`

### Correct path checked

1. A Miora create request performs an authenticated read-only session/credit/model preflight before a task is created.  If it is not `ready`, no asset is uploaded and no task is submitted.
2. A successful Miora create persists `cost_gate.authorized=true` only for that task, with `max_cost` described as current provider-visible cost within current balance.  A numeric balance, if present, is stored only as a ceiling; the implementation does not derive or advertise a per-video price.
3. The task is immediately `approved_for_execution`, so the normal workbench no longer asks the operator to type a second numeric cap.  The worker's existing `submit_allowed`, Miora-only skill route, provider-id, download, probe, ledger and QA gates remain unchanged.
4. The direct adapter requires the preflight credit readback to parse to a positive value before it can submit.  An empty, zero or unavailable balance returns `MIORA_CREDITS_NOT_AVAILABLE` instead of submitting.
5. A CDP-attached Miora browser is user-owned.  The preflight and direct adapter now release only their transport rather than call Playwright `browser.close()`, and the recorder is installed on an already-open canvas as well as future navigations.  This prevents the automation from closing the visible canvas between submit and a later exact-id sync attempt.

### Validation performed

- Inspected the edited route, task-spec construction, CDP lifecycle, direct adapter and skill text.
- `npm run lint`: passed.
- `node --check scripts/miora-direct.mjs`: passed.
- `npm run test:miora-direct`: 2/2 passed, including the new recorder/credit/disconnect assertions.
- `npm run test:miora-face-line`: 2/2 passed.
- `npm run test:video-worker`: 14/14 passed.
- `npm run worker:video:dry-run` with `VIDEO_WORKER_STATE_PATH=data\\video-worker-state.dry-run.json`: passed; it submitted nothing.
- `npm run build`: passed.
- `quick_validate.py` for the revised Miora channel Skill: still required after this addendum.

### Live-task status at review time

An exact new homepage task `miora-homepage-aurora-20260724133227-3c959e34` was prepared from the unedited generated aurora source image with the current-task white/2px `9093/face` policy, locked prompt SHA and one-task current-balance authorization.  Its first controlled adapter call stopped at `MIORA_AUTHENTICATION_REQUIRED` before white-line processing, upload, provider submission or any deduction.  A new visible Miora page was opened in the existing CDP Chrome for the operator.  Therefore this addendum is structurally and integration-tested, but **not** a second real delivery yet; the earliest missing action is the operator's platform login in that visible page, followed by the existing task's submit/download/QA chain.
