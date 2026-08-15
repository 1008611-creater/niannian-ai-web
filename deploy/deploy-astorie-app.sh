#!/bin/sh
set -eu

token_file=${1:?token file is required}
root=/opt/niannian-ai-video-workbench
token=$(sed -n 's/^ASTORIE_WINDOWS_AGENT_TOKEN=//p' "$token_file" | tail -n 1)
test "${#token}" -ge 24

runtime_env=/tmp/niannian-runtime-env-astorie-$$
trap 'rm -f "$runtime_env" "$token_file"' EXIT

docker ps --filter label=com.docker.compose.project=niannian-ai-video-workbench -q \
  | xargs docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sort -u > "$runtime_env"

sed -i '/^ASTORIE_WINDOWS_AGENT_TOKEN=/d' "$root/.env.production"
printf '%s\n' "ASTORIE_WINDOWS_AGENT_TOKEN=$token" >> "$root/.env.production"
sed -i '/^NIANNIAN_APP_IMAGE=/d' "$root/.env.production"
printf '%s\n' 'NIANNIAN_APP_IMAGE=niannian-ai-video-workbench:astorie-cdp-20260730-01' >> "$root/.env.production"
printf '%s\n' "ASTORIE_WINDOWS_AGENT_TOKEN=$token" 'NIANNIAN_APP_IMAGE=niannian-ai-video-workbench:astorie-cdp-20260730-01' >> "$runtime_env"

cp "$root/docker-compose.yml" "$root/docker-compose.yml.before-astorie-20260730-05"
cp /tmp/docker-compose.astorie-20260730-01.yml "$root/docker-compose.yml"
cd "$root"
docker compose --env-file "$runtime_env" up -d --no-deps app
docker compose --env-file "$runtime_env" ps app
