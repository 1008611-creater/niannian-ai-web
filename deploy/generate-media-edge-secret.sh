#!/bin/sh
set -eu

env_file=/opt/niannian-ai-video-workbench/.env.production
if ! sudo grep -q '^MEDIA_EDGE_SHARED_SECRET=' "$env_file"; then
  secret=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')
  printf '%s\n' "MEDIA_EDGE_SHARED_SECRET=$secret" | sudo tee -a "$env_file" >/dev/null
fi
sudo sed -n 's/^MEDIA_EDGE_SHARED_SECRET=//p' "$env_file" | tail -n 1
