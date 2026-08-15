#!/bin/sh
set -eu

root=/opt/niannian-ai-video-workbench
env_file="$root/.env.production"
image=${1:-niannian-ai-video-workbench:media-accel-20260730-01}

docker image inspect "$image" >/dev/null
sudo cp "$env_file" "$root/.env.production.before-media-accel-20260730-01"
sudo sed -i '/^NIANNIAN_APP_IMAGE=/d' "$env_file"
printf '%s\n' "NIANNIAN_APP_IMAGE=$image" | sudo tee -a "$env_file" >/dev/null

cd "$root"
runtime_env=$(mktemp)
trap 'rm -f "$runtime_env"' EXIT
docker ps --filter label=com.docker.compose.project=niannian-ai-video-workbench -q \
  | xargs docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sort -u > "$runtime_env"
sed -i '/^MEDIA_EDGE_SHARED_SECRET=/d' "$runtime_env"
sudo grep '^MEDIA_EDGE_SHARED_SECRET=' "$env_file" >> "$runtime_env" || true
printf '%s\n' "NIANNIAN_APP_IMAGE=$image" >> "$runtime_env"
sudo docker compose --env-file "$runtime_env" up -d --no-deps app
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:18084/api/health >/dev/null; then
    sudo docker compose --env-file "$runtime_env" ps app
    exit 0
  fi
  sleep 3
done

exit 1
