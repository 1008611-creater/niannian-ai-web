#!/bin/sh
set -eu

root=/opt/niannian-ai-video-workbench
image=${1:?app image is required}
current=niannian-ai-video-workbench-app-1
network=niannian-ai-video-workbench_default
nginx_conf=/etc/nginx/sites-enabled/sd2.cauai.fun
candidate="niannian-ai-video-workbench-app-candidate-$$"

docker image inspect "$image" >/dev/null
current_port=$(sudo grep -o 'proxy_pass http://127.0.0.1:[0-9]*;' "$nginx_conf" | sed -E 's/.*:([0-9]+);/\1/' | head -1)
[ -n "$current_port" ] || current_port=18084
if [ "$current_port" = 18084 ]; then new_port=18087; else new_port=18084; fi

env_file=$(mktemp)
cleanup() {
  rm -f "$env_file"
  if docker ps -a --format '{{.Names}}' | grep -qx "$candidate"; then
    docker rm -f "$candidate" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

sudo docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$current" > "$env_file"
sudo docker run -d --name "$candidate" --network "$network" --env-file "$env_file" \
  --add-host host.docker.internal:host-gateway \
  --health-cmd='wget -qO- http://127.0.0.1:3026/api/health >/dev/null || exit 1' \
  --health-interval=10s --health-timeout=5s --health-retries=12 \
  -v niannian-ai-video-workbench_niannian-data:/app/data \
  -p "127.0.0.1:${new_port}:3026" "$image" >/dev/null

for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -fsS "http://127.0.0.1:${new_port}/api/health" >/dev/null; then break; fi
  if [ "$attempt" = 12 ]; then exit 1; fi
  sleep 3
done

backup="/var/backups/sd2.cauai.fun.before-rolling-switch-$(date +%Y%m%d%H%M%S).conf"
sudo cp "$nginx_conf" "$backup"
sudo sed -i "s#proxy_pass http://127.0.0.1:${current_port};#proxy_pass http://127.0.0.1:${new_port};#" "$nginx_conf"
if ! sudo nginx -t; then
  sudo cp "$backup" "$nginx_conf"
  sudo nginx -t
  exit 1
fi
sudo systemctl reload nginx

sudo docker stop "$current" >/dev/null
sudo docker rm "$current" >/dev/null
sudo docker rename "$candidate" "$current"
trap - EXIT
rm -f "$env_file"
sudo docker ps --filter "name=$current" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
