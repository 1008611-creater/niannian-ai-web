# NianNian private face processor

This candidate contains only the fixed `white/2px` face processor and its two
OpenCV DNN model files. It accepts uploaded image bytes at `/face`; it never
accepts a file path or URL.

Required environment:

- `FACE_PROCESSOR_TOKEN_FILE`: a root-managed secret file containing a random
  shared secret of at least 32 characters. `FACE_PROCESSOR_TOKEN` is rejected.
- `FACE_PROCESSOR_HOST`: keep `127.0.0.1` for a host-local service. For the
  reviewed private Compose topology, use `0.0.0.0` together with
  `FACE_PROCESSOR_PRIVATE_NETWORK=true` and no published port.
- `FACE_PROCESSOR_PORT`: keep the default `9093` for the authorized task.
- `FACE_PROCESSOR_ENABLED`: defaults to `false`. While false, `/healthz` and
  `/readyz` remain available, but `/face` returns `503 PROCESSING_DISABLED`
  before reading or transforming image bytes. Production Compose explicitly
  starts with this setting false; it may only be changed for an exact
  controller-authorized work item.

Build and run without publishing a public port:

```sh
docker build -t niannian-face-processor:<immutable-version> .
docker run --read-only --tmpfs /tmp --network host \
  --mount type=bind,src=/etc/niannian-ai/face_processor_token,dst=/run/secrets/face_processor_token,readonly \
  -e FACE_PROCESSOR_TOKEN_FILE=/run/secrets/face_processor_token \
  niannian-face-processor:<immutable-version>
```

The production service manager mounts `FACE_PROCESSOR_TOKEN_FILE` without
printing its contents. The container starts as root solely to read that
root-owned file, then permanently drops to uid/gid `10001` before binding or
serving HTTP; the token is retained only in process memory. A container-network
deployment may instead omit a host port entirely and let only the website
backend join that private network.
Ordinary video routes must not depend on this service's health.
