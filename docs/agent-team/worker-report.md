# Worker Report: Text-to-video and Mimo-only queue contract

## Executability check

- Requirements clear: yes.
- Implementation plan reasonable: yes.
- Acceptance criteria executable locally: yes, except production deployment and real Provider execution, which are explicit non-goals.
- Additional product decision needed: no.

## Implementation summary

- `REQ-001`: Empty customer asset lists now lock `generation_type=text_to_video`, `references=[]`, an empty Mimo reference selection, prompt SHA, 720P, duration, aspect ratio, and the Mimo Skill route. Confirmed image assets remain `image_to_video`.
- `REQ-002`: The customer creation API always creates `codex_skill + mimo`; the customer page no longer exposes alternate channel selection.
- `REQ-003`: Owner confirmation no longer depends on Worker/CDP/login readiness or provider balance readback. It leaves the authorized task in `queued_skill`; the customer sees `正在排队` until claim.
- `REQ-004`: Existing Provider IDs still bypass submission and enter the sync loop only.
- `REQ-005`: Completion now fails closed unless COS upload/readback returns verified delivery metadata after ledger JSON and ffprobe checks.
- `REQ-006`: Provider cost readback remains optional information and is not an authorization or claim prerequisite.

## Changed files

- `lib/video-tasks.ts`
- `lib/mimo-windows-worker.ts`
- `lib/video-task-public-state.ts`
- `app/api/video-tasks/route.ts`
- `app/home/page.tsx`
- `app/projects/page.tsx`
- `scripts/niannian-windows-mimo-agent.mjs`
- `windows-mimo-agent/mimo-chrome-cdp-submit.mjs`
- `scripts/mimo-text-queue.contract.test.mjs`
- `scripts/mimo-owner-authorization.contract.test.mjs`
- `scripts/mimo-windows-reconciliation.contract.test.mjs`
- `scripts/video-task-public-state.test.mjs`
- `package.json`
- `README.md`
- `docs/agent-team/task-spec.md`

## Self-test results

- `npm run test:mimo-text-queue`: 5 passed.
- `npm run worker:mimo-windows:contract`: passed.
- `npm run test:video-task-public-state`: 2 passed.
- `npm run test:mimo-owner-authorization`: 1 passed.
- `node --test scripts/mimo-windows-reconciliation.contract.test.mjs`: 1 passed.
- `npm run test:video-cos`: 4 passed.
- `npm run test:mimo-windows-visible-sync`: 4 passed.
- `node --test scripts/mimo-windows-agent-preflight.test.mjs`: 1 passed.
- `node --test scripts/legacy-mimo-delivery-backfill.test.mjs`: 3 passed.
- `npm run lint`: passed.
- `npm run build`: passed; all 48 static pages generated and the affected API routes compiled.

## Not covered or executed

- No production deployment or Windows candidate installation.
- No database migration or historical task mutation.
- No local or production customer task creation.
- No Mimo login, upload, Provider Generate, credit use, download, or production COS write.
- No production browser playback/download acceptance.

## Risks and review focus

- The Mimo visible page's actual text-only Generate behavior still requires one separately authorized real task after deployment.
- The current working directory has no discoverable Git metadata, so review uses explicit changed-file readback and test/build evidence rather than `git diff`.
- Deployment must preserve existing production secrets and must not publish unrelated local cost-readback work as a hard gate.

## Follow-up correction: no-receipt failure boundary

- `lib/mimo-windows-worker.ts` no longer changes a failed Mimo task without a Provider ID to `manual_assist`. It preserves `execution_mode=codex_skill`, `channel=mimo`, records a safe blocker, sets `status=blocked` and `submit_allowed=0`, and records a no-automatic-retry policy.
- Added assertions to `scripts/mimo-text-queue.contract.test.mjs` and `scripts/mimo-windows-reconciliation.contract.test.mjs` proving the no-receipt branch does not contain `manual_assist` or `automatic_fallback_manual` and cannot be claimed again.
- Follow-up verification: `npm run test:mimo-text-queue` 6 passed; reconciliation contract 1 passed; Worker self-test passed; `npm run lint` passed; `npm run build` passed.
