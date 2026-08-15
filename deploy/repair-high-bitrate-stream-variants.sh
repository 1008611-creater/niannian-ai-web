#!/usr/bin/env bash
set -eu

root=/var/lib/docker/volumes/niannian-ai-video-workbench_niannian-data/_data/video-outputs
for target in "$root"/*/downloads/*.stream.mp4; do
  [ -f "$target" ] || continue
  rate=$(ffprobe -v error -select_streams v:0 -show_entries format=bit_rate -of default=nw=1:nk=1 "$target" 2>/dev/null || true)
  case "$rate" in ''|*[!0-9]*) continue;; esac
  [ "$rate" -gt 1000000 ] || continue
  source="${target%.stream.mp4}.mp4"
  [ -f "$source" ] || continue
  temporary="$target.tmp.mp4"
  rm -f -- "$temporary"
  if ffmpeg -nostdin -v error -y -i "$source" \
    -map 0:v:0 -map 0:a? \
    -c:v libx264 -preset veryfast -b:v 650k -maxrate 800k -bufsize 1600k -pix_fmt yuv420p \
    -c:a aac -b:a 48k -movflags +faststart "$temporary"; then
    mv -- "$temporary" "$target"
    setfacl -m u:www-data:rx "$target"
  else
    rm -f -- "$temporary"
  fi
done
