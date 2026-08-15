#!/bin/sh
set -eu

conf=/etc/nginx/sites-enabled/sd2.cauai.fun

if ! grep -q 'location /_niannian_video/' "$conf"; then
  backup="/var/backups/sd2.cauai.fun.before-media-accel-$(date +%Y%m%d%H%M%S).conf"
  sudo cp "$conf" "$backup"
  tmp=$(mktemp)
  sudo awk '
    /^[[:space:]]*location \/ \{/ && !location_done {
      print "    location /_niannian_video/ {"
      print "        internal;"
      print "        alias /var/lib/docker/volumes/niannian-ai-video-workbench_niannian-data/_data/video-outputs/;"
      print "        sendfile on;"
      print "        etag on;"
      print "        types { video/mp4 mp4; video/webm webm; video/quicktime mov; }"
      print "        default_type application/octet-stream;"
      print "    }"
      location_done=1
    }
    { print }
    /proxy_set_header X-Forwarded-Proto \$scheme;/ && !header_done {
      print "        proxy_set_header X-Niannian-Accel 1;"
      header_done=1
    }
  ' "$conf" > "$tmp"
  sudo cp "$tmp" "$conf"
  rm -f "$tmp"
  if ! sudo nginx -t; then
    sudo cp "$backup" "$conf"
    sudo nginx -t
    exit 1
  fi
  sudo systemctl reload nginx
fi

sudo nginx -t
sudo grep -n -E '(_niannian_video|X-Niannian-Accel)' "$conf"
