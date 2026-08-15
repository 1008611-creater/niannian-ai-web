# Task Spec: Isolated Mimo Lease Recovery

## Goal

Recover only the named real-I2V task when an earlier Windows worker lease is
stale and no Mimo Provider receipt exists, without creating a task, changing
credits, uploading media, or submitting Generate.

## Scope

- The existing authenticated internal Windows Mimo claim route only.
- Opt-in runtime configuration must bind both one task ID and one worker ID.
- Candidate task must remain `codex_skill` + `mimo` + `running`, have
  `provider_task_id IS NULL`, authorized submit/cost flags, and an expired
  lease.
- A prior `mimo_worker_claimed` event must identify a different worker; a
  `provider_receipt_observed` event rejects recovery permanently.
- The compare-and-set update must preserve the running state and append a
  typed recovery event in the same transaction.

## Non-goals

- No deployment, environment enablement, database migration, task creation,
  credit mutation, Mimo upload, Provider submission, or Generate.
- No recovery for a task with a Provider ID or receipt; those remain sync-only.

## Acceptance

1. Disabled or mismatched runtime configuration cannot recover any task.
2. Recovery SQL has exact task/mode/channel/status/receipt/authorization/CAS
   predicates and rejects a same-worker prior claim.
3. Existing Mimo cost, receipt-sync, and queue contract tests remain passing.
