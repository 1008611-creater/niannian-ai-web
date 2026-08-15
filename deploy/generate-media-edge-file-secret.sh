#!/bin/sh
set -eu

docker exec niannian-ai-video-workbench-app-1 sh -lc '
  umask 077
  node -e '\''process.stdout.write(require("crypto").randomBytes(48).toString("base64url"))'\'' > /app/data/media-edge-secret
  test -s /app/data/media-edge-secret
'
