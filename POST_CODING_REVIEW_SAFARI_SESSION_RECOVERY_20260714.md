# Post-Coding Review: Safari Session Recovery

Date: 2026-07-14

## Requested outcome

The already-authorized Mimo test task must use one recoverable Safari WebDriver session, rather than creating a new competing session whenever a task attempt is cleaned up or retried.

## Correct execution path

1. A single SafariDriver instance owns one Safari WebDriver session.
2. The session checkpoint is stored with mode `0600` in the protected Mac workspace, outside retryable task directories.
3. The parent Mac Worker claims only an authorized task, validates locked reference hashes, and invokes the visible official Mimo frontend path.
4. The submitter reuses that checkpoint, logs in through the visible Mimo page only when needed, uploads the locked material, and records a provider task ID only from the official generate response.
5. After a provider task ID exists, the Worker waits seven minutes before its first Mimo status request, then downloads, probes, writes a ledger, and reports for administrator QA.

## Changed files

- `mac-agent/prepare-mimo-safari-session.mjs`: a deliberately non-submitting session preparer. It has no credential, upload, or generation code; it only creates or reuses one Safari session and reports whether the Mimo page is at login or generation UI.
- `mac-agent/mimo-safari-visible-submit.mjs`: accepts both observed official Mimo main-prompt placeholders: the historical `描述视频内容` and the current `镜头语言、风格要求等固定描述...`.
- `mac-agent/niannian-mac-worker.mjs`: the visible Mimo submitter now receives `${NIANNIAN_MAC_WORKSPACE}/mimo-safari-visible-session.json`, not a task-local ledger path that is deleted on a retry.
- `mac-agent/niannian-mac-worker.mjs`: when the parent visible-browser bridge is enabled, SafariDriver readiness is the preflight authority. The retired direct API login is no longer allowed to reject a task before the official frontend path can run.
- `mac-agent/install-macos.sh`: installs the preparer with the rest of the worker tools.

## Evidence

- Source and installed Mac scripts passed `node --check`.
- `npm run lint` passed.
- `npm run test:mimo-safari-visible-submit` passed: 2 tests.
- `npm run test:mac-worker` passed: 4 tests.
- `npm run test:mimo-direct` passed: 2 tests.
- `npm run test:mimo-official-client` passed: 1 test.
- `npm run test:video-worker` passed: 9 tests.
- On Mac, the stale Safari `--automation` process was stopped, a single `safaridriver --diagnose -p 4444` instance was started, and the preparer successfully reused its workspace checkpoint. The Mimo page readback was `SESSION_READY_LOGIN`.
- The workspace checkpoint is mode `0600`. Keychain metadata confirms that the agent token and Mimo username/password records exist; no credential values were read or logged.
- The current visible official page successfully read back as `SESSION_READY_GENERATOR` using the reused session. Its current form contains the `镜头语言、风格要求等固定描述...` main prompt textarea; the older selector alone would have failed before upload.

## Review result

The previous repeated-session failure was caused by three layers: a stale Safari automation process remained paired after SafariDriver restart, the Worker stored its checkpoint inside a retry-cleaned task directory, and preflight still treated the retired direct API login as authoritative while execution used the official frontend. The recovery removes the stale process, makes the checkpoint workspace-scoped, and aligns readiness with the execution route. The code path still stops before any provider call if the session, locked prompt, hash check, upload, or Mimo response is invalid.

## Not yet proven

No success claim is made by this review. The current task must still obtain a new provider task ID, wait the seven-minute no-poll interval, produce an MP4, pass `ffprobe`, write the execution ledger, pass administrator QA, and play/download in the customer account.
