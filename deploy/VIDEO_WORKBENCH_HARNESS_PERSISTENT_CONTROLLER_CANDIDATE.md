# Video Workbench Persistent Controller Candidate

This is a deployment candidate only. It does not authorize a deployment, a task
claim, user image processing, billing, upload, Provider submission, or Generate.

## Cutover Contract

1. Capture the local `events.jsonl` byte hash, revision, event head, active
   claim, writer locks, queue packet SHA, and appended decision bindings.
2. Freeze the local controller writer with `controller_writer_frozen` before
   copying the snapshot. The server must not start while a local writer remains
   active.
3. Copy the exact harness directory to a persistent server volume, preserving
   the packet bytes and event ledger bytes. Run `reconstructHarness()` against
   that copy before activating a server writer.
4. Activate exactly one server controller writer with
   `controller_writer_activated`. A mismatch, active local writer, invalid hash
   chain, or state reconstruction failure aborts cutover with no write accepted.
5. Keep the exact pre-cutover snapshot and prior Compose configuration as the
   rollback handle. A dispatcher or service health failure restores that
   snapshot and leaves the Face Processor disabled.

## Dispatcher Boundary

`resume_ready` is consumed only by `dispatchResumeReady()`. It atomically
appends `resume_node_claimed` before any worker dispatch. Restart and duplicate
wake attempts return the existing claim instead of starting another node. The
dispatcher does not implement Provider, billing, deployment, or promotion
actions; those remain controller-gated nodes.

## Default-Disabled Release Boundary

The face processor remains in `deploy/face-processor-app-override.yml` with
`FACE_PROCESSOR_ENABLED: "false"`. It has no public port and is connected only
to the app through the internal `face-private` network. The release remains
additive and contains no database migration.
