# Mimo text-to-video handoff preflight (read-only)

Date: 2026-07-28 Asia/Shanghai  
Scope: one future production task; no task creation, upload, Generate, credit charge, or production state mutation was performed.

## Current result

`BLOCKED_PRE_SUBMISSION_INPUT`

- Unique user-provided input missing: the locked Chinese/English `prompt`.
- Duration contract was updated locally to accept every integer from `4` through `15` seconds; 4 seconds is now a valid candidate value. This change is not deployed.
- A Mimo Worker failure without a Provider ID now remains `codex_skill + mimo`, becomes blocked with submission disabled, and is not switched or automatically retried. This change is not deployed.

## Fixed handoff values

These values are ready to bind once the prompt is supplied and the local candidate is separately reviewed/deployed:

```json
{
  "task_id": null,
  "generation_type": "text_to_video",
  "asset_ids": [],
  "references": [],
  "channel": "mimo",
  "execution_mode": "codex_skill",
  "allowed_channels": ["mimo"],
  "model": "Seedance 2.0",
  "duration": "4s",
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "max_provider_cost_credits": 5,
  "submit_allowed": false,
  "cost_gate": {
    "authorized": false,
    "max_cost": "5 Mimo credits",
    "provider_submission": "not_submitted"
  },
  "failure_policy": "remain queued; no channel switch; no retry after unknown submission",
  "content_qa": "not_required",
  "delivery_gates": ["download", "ledger_json", "ffprobe", "cos_upload", "cos_readback"]
}
```

The following fields remain null until the user supplies the prompt and a task is explicitly created and authorized: `task_id`, `prompt_sha256`, `prompt_path`, `created_at`, `worker_id`, `heartbeat_at`, `provider_task_id`, `provider_receipt`, `output_path`, `output_sha256`, `output_bytes`, `ffprobe_json`, `ledger_path`, `ledger_sha256`, `cos_object_key`, `cos_object_sha256`, `cos_readback_at`, `website_playback`, and `website_download`.

## C00-C18 earliest-node review

| Node | Contract check | Current result | Evidence or blocker |
| --- | --- | --- | --- |
| C00 | Scope, authorization, no side effect | pass | This preflight is read-only; no task or Provider call. |
| C01 | User prompt supplied and locked | blocked | `prompt` is the only missing user content; server requires a non-empty prompt. |
| C02 | Task identity and idempotency | partial | Server creates a fresh random task ID; owner authorization is idempotent, but creation has no client idempotency key/dedupe contract. |
| C03 | Text route and empty references | pass locally | `text_to_video` with `references=[]` is supported by the reviewed candidate. |
| C04 | Mimo-only route | pass locally | Customer API binds `codex_skill + mimo`; claim query is Mimo-only. |
| C05 | Model, duration, ratio, resolution | pass locally | Model/ratio/resolution match; local candidate accepts every integer duration from 4 through 15 seconds. |
| C06 | Prompt SHA and locked spec | waiting | Computed only after the prompt is supplied; Worker verifies SHA before staging. |
| C07 | Cost and submit gate | partial | Worker requires `submit_allowed` and `cost_gate.authorized`; numeric `5 credits` is not currently enforced by server-side comparison. |
| C08 | Windows readiness | read-only available | Production deployment report records Worker `1.4.13-windows-mimo.1`, ready/idle; must be freshly re-read immediately before execution. |
| C09 | Queue claim and lease | pass locally | Claim is restricted to `codex_skill + mimo` and authorized queue rows; no claim was made. |
| C10 | CDP/Mimo login | not executed | Requires Windows local preflight; no credentials or browser session were read. |
| C11 | One Generate and Provider receipt | not executed | Must be separately authorized after C01/C05/C07 and failure policy repair. |
| C12 | Sync/download | not executed | Existing Provider ID must select sync-only; unknown submission must never resubmit. |
| C13 | JSON ledger | not executed | Required before server completion; ledger path/hash must be recorded. |
| C14 | ffprobe and duration | not executed | Required before COS and completion. |
| C15 | COS upload | not executed | Required; no production write performed. |
| C16 | COS readback SHA/bytes | not executed | Required; no production readback performed. |
| C17 | Website playback/download | not executed | Must read the same completed task through native player and native download. |
| C18 | Rollback and evidence closure | prepared only | Preserve task/provider IDs and local ledger on failure; no rollback state exists because no task was created. |

## Handoff packet field draft

Required before an authorized handoff:

- `handoff_id`, `task_id` and `created_at`.
- Exact `prompt`, normalized `prompt_sha256`, and `prompt_path`.
- `generation_type=text_to_video`, `asset_ids=[]`, `references=[]`.
- `channel=mimo`, `execution_mode=codex_skill`, `allowed_channels=["mimo"]`, exact Skill route, model, duration, aspect ratio, and resolution.
- Website credit reservation ID and amount; provider max cost authorization `5` credits; `submit_allowed`, `cost_gate.authorized`, and authorization timestamp.
- Fresh Worker readiness: worker ID/version, heartbeat, `readyToClaim`, `authenticated`, `activeTaskId`, CDP loopback, ffprobe, workspace, and queue counts. Do not include tokens, cookies, passwords, or balance secrets.
- Provider receipt fields after submission: visible Provider task ID, submitted timestamp, one-submit marker, and before/after cost evidence if the provider exposes it.
- Delivery evidence: output path/name, SHA-256, bytes, ffprobe JSON, ledger path/SHA, COS key/SHA/bytes/readback timestamp, website playback result, and browser download SHA/bytes.
- Failure/rollback fields: first failure code, whether Provider ID exists, retry decision (`sync-only` or `no-resubmit`), task status, preserved local evidence paths, and rollback checkpoint.

## Read-only preflight commands

Expected results and side effects:

```powershell
# Local contract checks: no Provider/network side effect.
npm run test:mimo-text-queue
npm run worker:mimo-windows:contract
npm run lint
npm run build

# Public production identity only; expected HTTP 200, no auth or mutation.
Invoke-WebRequest -UseBasicParsing https://sd2.cauai.fun/api/health

# Windows host only; reports heartbeat/preflight and must not claim.
npm run worker:mimo-windows:preflight

# Server read-only release/Worker/queue check; requires the existing secure
# environment token but must not print it or create a task.
npm run release:postdeploy:readonly -- --origin https://sd2.cauai.fun --worker windows-mimo
```

Expected production readback before any future authorization:

```text
release=niannian-windows-mimo-1.4.13-rc1
worker=1.4.13-windows-mimo.1
status=idle
readyToClaim=true
authenticated=true
activeTaskId=null
queue.approvedForExecution=0
queue.runningOnMimo=0
activeMimoProviderTasks=0
```

The final command must be run with the secure deployment environment already configured; do not pass a token on the command line and do not run it if doing so would expose credentials.
