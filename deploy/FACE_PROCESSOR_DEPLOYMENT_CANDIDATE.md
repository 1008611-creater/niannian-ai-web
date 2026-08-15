# Private Face Processor Deployment Candidate

This candidate is additive. It adds the processor only on the internal
`face-private` Compose network. `niannian-face-processor` has no `ports:`
entry, so TCP `9093` is not published to the host or public Internet. The app
is the only production service attached to both the default and private
networks.

## Inputs

- Build the processor image from `services/face-processor` with immutable label
  `face-white-2px-v1`. Set `FACE_PROCESSOR_IMAGE_REFERENCE` to exactly one of:
  `niannian-face-processor@sha256:<64-lowercase-hex>` for a registry content
  address, or `sha256:<64-lowercase-hex>` for the local Docker image ID created
  by the controlled host build. Do not deploy a mutable tag, repository tag,
  shortened ID, or image name without an immutable content address.
- Set `FACE_PROCESSOR_TOKEN_FILE_HOST` to a root-managed secret file. The
  Compose secret is mounted as `/run/secrets/face_processor_token`; neither the
  application image nor logs contain its value.

## Controlled deployment

1. Read current app/queue/provider state and verify active Provider work is
   zero before changing the app or processor.
2. Run `docker compose -f docker-compose.yml -f deploy/face-processor-app-override.yml config`
   without printing the resolved secret.
   Before applying it, record the nonsecret rollback evidence: rendered Compose
   SHA-256, current app container ID and image ID, the previous Face Processor
   immutable reference (or its absence), and the new immutable processor
   reference. A local `sha256:` image ID is valid only when that exact ID is
   recorded as the released reference and remains present until rollback proof
   is complete.
3. Deploy the processor and app under the controller's current authority, then
   verify processor `/readyz` from the app network and that external `:9093`
   is closed. Do not treat a health response as delivery evidence.
4. A processor outage must leave ordinary text-to-video and unprocessed image
   tasks operational; only authorized preprocessing should fail closed.

## Rollback

1. Stop and remove only `niannian-face-processor`; do not delete database or
   application data volumes.
2. Roll the app image/override back to its recorded prior digest and remove the
   `face-private` app attachment only after the prior app is running.
3. Preserve manifests, task/credit/Provider evidence, and image digests. No
   database rollback or asset deletion is part of this processor rollback.
