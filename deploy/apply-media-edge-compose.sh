#!/bin/sh
set -eu

compose=/opt/niannian-ai-video-workbench/docker-compose.yml
if ! grep -q 'MEDIA_EDGE_SHARED_SECRET:' "$compose"; then
  backup="/var/backups/niannian-docker-compose.before-media-edge-$(date +%Y%m%d%H%M%S).yml"
  sudo cp "$compose" "$backup"
  tmp=$(mktemp)
  sudo awk '
    { print }
    /LDXP_REDEEM_SECRET:/ && !inserted {
      print "      MEDIA_EDGE_SHARED_SECRET: ${MEDIA_EDGE_SHARED_SECRET:-}";
      inserted=1
    }
  ' "$compose" > "$tmp"
  sudo cp "$tmp" "$compose"
  rm -f "$tmp"
fi
grep -n 'MEDIA_EDGE_SHARED_SECRET:' "$compose"
