# Rework Spec: Evidence-only cost, downstream recovery, and immutable assets

Task size: `L`. This rework corrects the reviewed local candidate before an authorized production deployment.

## Confirmed decisions

- `DEC-001 / 1A`: Generate requires a reliable visible Mimo cost estimate. If the estimate is absent, stop before Generate. The estimate must not exceed an exact locked maximum.
- `DEC-002 / 2A`: After a Provider receipt exists, automatically retry only reconcile/download/ffprobe/ledger/COS work for at most 30 minutes. Never Generate again.
- `DEC-003 / 3A`: An asset referenced by a task is immutable and cannot be physically deleted. The owner may hide it from `我的素材库`; locked historical tasks remain valid.
- `DEC-004 / 4B`: After review, deploy the website and Windows Worker without creating a real task, uploading to Mimo, clicking Generate, or spending Provider credits.

## Required corrections

- `REQ-R01`: Remove inferred `1 credit/second` and `2 credits/second` Provider rates. The only current exact default contract is `image_to_video + 4 seconds + 720P + Seedance 2.0 = expected 8 / maximum 8 Mimo credits`, backed by the 2026-07-28 benchmark. Every other combination remains `unknown/unavailable` unless an exact evidence-backed contract or explicit scoped maximum exists.
- `REQ-R02`: A task without an exact positive Provider maximum must not be authorized or claimed. A submitter without a reliable visible estimate must stop with a stable blocker before Generate. A visible estimate above the locked maximum must also stop before Generate.
- `REQ-R03`: Remove Provider SHA/cost/balance evidence from normal customer asset/task projections. Exact SHA remains server-side in the locked task spec and Worker ledger.
- `REQ-R04`: Record `provider_receipt_observed` when the Generate response supplies an ID. Record `provider_progress_observed` only after a later sync actually observes the Provider task as running. Preserve idempotency by task, Provider ID, and event.
- `REQ-R05`: Implement a 30-minute receipt-bound recovery window. Worker restarts and task recovery reuse the existing Provider ID and retry only C13-C17 downstream work. Expiry produces a stable sync-only blocker and preserves all receipts/files/evidence.
- `REQ-R06`: Add owner-only hide/unhide behavior for reusable assets without deleting the `uploaded_assets` row or bytes. Referenced assets remain usable by existing locked tasks. Any additive schema change must have a reviewed migration, no destructive SQL, and a rollback/readback plan.
- `REQ-R07`: Existing reusable assets must not render an empty `src`. Use an authenticated controlled preview URL or a neutral non-image state; never expose local paths or signed COS URLs.
- `REQ-R08`: Preserve website pricing, delivery gates, historical content-QA isolation, 5-second claim polling, 10-second sync polling, server-derived elapsed time, and the five-compatible-sample ETA threshold.

## Acceptance criteria

- `AC-R01`: Source and tests contain no generalized Mimo per-second Provider rate. The exact 4-second image contract returns 8/8; unknown combinations fail closed before authorization/claim.
- `AC-R02`: Missing visible estimate and estimate-over-maximum both stop before Generate. Existing Provider ID remains sync-only.
- `AC-R03`: Authenticated customer payloads omit SHA, Provider cost, Provider balance, internal paths, and Provider IDs while server task specs retain exact evidence.
- `AC-R04`: Receipt and progress events have distinct names and timing; submit cannot emit `provider_progress_observed`.
- `AC-R05`: Fake-clock tests prove receipt-bound downstream recovery continues up to 30 minutes, never invokes submit, and then blocks safely without losing the Provider ID.
- `AC-R06`: Owner hide/unhide works; referenced and unreferenced asset rows/bytes are never physically deleted; another user cannot hide or reuse the asset.
- `AC-R07`: Reused-asset UI never renders an empty image URL and still creates a task with the original asset ID without a duplicate upload/insert.
- `AC-R08`: Focused regressions, Worker self-test, TypeScript, production build, Worker packaging, release audit, and Level 2 post-coding review pass.
- `AC-R09`: The candidate package contains no secret and declares exact website/Worker identities and SHA-256. No production or Provider side effect occurs inside the implementation handoff.

## Production boundary

After the implementation owner returns a reviewed candidate, `/root` is the only deployment operator. Deployment is app/Worker only, serial, with queue/provider hard gates, rollback fingerprints, and read-only postdeploy verification. No real task or paid Provider test is authorized.
