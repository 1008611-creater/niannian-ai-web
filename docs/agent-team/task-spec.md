# Task Spec: Text-to-video and Mimo-only queue contract

## Background and goal

Task size: `L`. This changes the customer task contract, Windows worker claim boundary, provider submission path, and delivery state.

- `REQ-001`: A customer can create a locked text-to-video task without reference assets.
- `REQ-002`: New customer tasks use only the Windows Mimo route.
- `REQ-003`: An unavailable Windows Worker, CDP session, or Mimo login keeps an authorized task queued and presents `正在排队` to the customer.
- `REQ-004`: A task with a Provider task ID is reconciliation-only and cannot be submitted again.
- `REQ-005`: Automatic completion still requires a downloaded output, valid JSON ledger, ffprobe duration gate, and COS upload/readback verification.
- `REQ-006`: Mimo balance and unit-price readback are informational only and do not block owner authorization.

## Scope

- `TASK-001`: Permit `assetIds=[]`; lock `generation_type=text_to_video`, `references=[]`, prompt SHA, duration, aspect ratio, 720P, Mimo channel, and Mimo Skill route.
- `TASK-002`: Preserve `image_to_video` for tasks with confirmed image references.
- `TASK-003`: Make the Windows Mimo server payload and Agent staging/submission support an empty reference set only for `text_to_video`.
- `TASK-004`: Make the customer creation API and UI Mimo-only.
- `TASK-005`: Keep owner confirmation, but remove Worker readiness and provider cost readback as authorization prerequisites; store the authorized task as `queued_skill` until claim.
- `TASK-006`: Show an authorized Mimo task as `正在排队` while the Worker is unavailable.
- `TASK-007`: Add focused contract and behavior tests.

## Non-goals

- `NON-001`: No production deployment, database migration, real task creation, Provider submission, or credit consumption.
- `NON-002`: No changes to historical tasks, including the frozen handshake and clothing tasks.
- `NON-003`: No Dola, Miora, Mac fallback, concurrency, or multi-worker support.
- `NON-004`: No weakening of output, ledger, ffprobe, COS upload, or COS readback gates.

## Business and data rules

- `RULE-BIZ-001`: `assetIds=[]` means `text_to_video`; a non-empty set of accepted image assets means `image_to_video`.
- `RULE-BIZ-002`: User task creation locks `execution_mode=codex_skill`, `channel=mimo`, `allowed_channels=[mimo]`, and the Mimo Skill route.
- `RULE-BIZ-003`: Owner confirmation authorizes one later Worker submission but does not itself contact Mimo.
- `RULE-BIZ-004`: Worker unavailability affects claim readiness only. It does not fail or reroute the task.
- `RULE-DATA-001`: Text-to-video specs contain an explicit empty `references` array and a valid empty Mimo reference selection plan.
- `RULE-DATA-002`: Prompt SHA, duration, aspect ratio, resolution, model, route, authorization, Provider receipt, and delivery evidence remain locked/auditable.
- `RULE-DATA-003`: A Provider ID always selects sync-only behavior.
- `RULE-DATA-004`: Provider balance and pricing may be observed but are never required to authorize or claim a task.

## Acceptance criteria

- `AC-001` (`REQ-001`): Empty assets create a spec with `generation_type=text_to_video`, `references=[]`, a locked prompt SHA, requested duration/aspect ratio, `720p`, and the Mimo-only route.
- `AC-002` (`REQ-001`): Confirmed image assets create `generation_type=image_to_video` and retain their locked references.
- `AC-003` (`REQ-002`): The customer API cannot create Dola, Miora, Mac, or server-auto tasks; Mimo claim selects only `codex_skill + mimo`.
- `AC-004` (`REQ-003`): Text-to-video reaches Agent staging without asset download and submission contains no `--image`; unavailable readiness makes no claim and customer-visible state is `正在排队` after authorization.
- `AC-005` (`REQ-004`): A claimed task with `providerTaskId` bypasses submit and enters synchronization only.
- `AC-006` (`REQ-005`): Missing/invalid output, ledger, ffprobe result, COS upload, or COS readback prevents `completed`; the valid path writes `completed` only after all gates.
- `AC-007` (`REQ-006`): Owner authorization does not require Worker readiness, balance, unit price, or pricing timestamp, while still atomically setting `submit_allowed=1` and `cost_authorized=1`.
- `AC-008`: `npm run lint` and `npm run build` pass, followed by a Level 2 post-coding review.

## Confirmed decisions

All requirements above were explicitly confirmed by the user. No open product decision remains for this candidate.
