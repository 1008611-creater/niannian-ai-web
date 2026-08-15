# Image Redraw Runtime Contract v2

## Scope

`image_redraw` is the server-side still-image runtime. It is not a video workflow and it does not use the retired Mac/Codex App bridge path. Product redraw is one subject mode, not the runtime name or a global state machine.

## Create Job API

`POST /api/redraw/jobs`

Required request fields:

```json
{
  "source_asset_id": "owned-image-asset-id",
  "reference_asset_ids": ["optional-owned-reference-id"],
  "requirements": {
    "subject_mode": "product",
    "preserve_subject": true,
    "change_scene": false,
    "target_style": "",
    "scene": "",
    "aspect_ratio": "1:1"
  }
}
```

`idempotency-key` is required as a request header. Existing `preserve_product` is accepted only as an input compatibility alias; API responses use the generic runtime contract.

Allowed `subject_mode` values:

- `product`
- `character`
- `scene`
- `first_frame`

No `novel_video`, timeline, script, episode, or video-provider state is valid in this API.

## Immutable Planning And QA Schemas

The job snapshots `skill_bundle_version` at creation. The version must resolve to an immutable bundle whose manifest declares:

```text
runtime_kind=image_redraw
plan_schema=image_redraw_plan_v2
qa_schema=image_redraw_visual_qa_v2
```

`image_redraw_plan_v2` requires `subject_mode`, a permitted transformation, owned reference bindings, `subject_truth_constraints`, and `qa_requirements`.

`image_redraw_visual_qa_v2` requires `subject_mode`, `subject_identity_preserved`, `composition_passed`, `text_drift_detected`, `quality_passed`, evidence, and retry guidance.

## Delivery State Rule

`completed` is legal only after all of these are true:

1. A persisted RunningHub task has produced an output.
2. Vision QA passed: `quality_passed=true`, `subject_identity_preserved=true`, and `text_drift_detected=false`.
3. The accepted output was written to private COS.
4. A COS get/readback SHA-256 verification passed.
5. A `redraw_artifacts.role=accepted_output` record was persisted and is owner-bound.

`provider_submitted`, `generating`, `qa_running`, `qa_failed`, a successful deployment, a Skill Bundle build, or a provider task ID are never delivery.

## Public Statuses

| Internal status | Public status | Delivery meaning |
| --- | --- | --- |
| `created`, `queued` | `queued` | No delivery |
| `planning` | `planning` | No delivery |
| `provider_submitted`, `generating` | `generating` | No delivery |
| `qa_running` | `qa` | No delivery |
| `qa_failed` | `qa_failed` | Rejected, no preview/download |
| `failed` | `failed` | No delivery |
| `cancelled` | `cancelled` | No delivery |
| `completed` with accepted artifact | `completed` | Preview/download permitted |

## Current Deployment Boundary

The isolated Haika runtime has completed a private COS preflight against its dedicated delivery bucket: put, head, get, and SHA-256 readback succeeded for a non-production probe under the application-controlled `redraw/preflight/` prefix. The preflight does not create a user delivery, submit a RunningHub task, run visual QA, persist an accepted artifact, expose preview/download routes, or make the loopback runtime public. A real end-to-end job remains separately required before any delivery claim.
