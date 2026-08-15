#!/usr/bin/env bash
set -eu

root=/var/lib/docker/volumes/niannian-ai-video-workbench_niannian-data/_data/video-outputs

# Process one newest missing variant per run. Skip sources that already have a
# derivative so one completed file cannot block the rest of the queue.
source=""
while IFS= read -r candidate; do
  target="${candidate%.mp4}.stream.mp4"
  if [ ! -f "$target" ]; then
    source="$candidate"
    break
  fi
done < <(find "$root" -type f -name '*.mp4' ! -name '*.stream*.mp4' ! -name '*.playback*.mp4' -printf '%T@:%p\n' | sort -nr | cut -d: -f2-)
[ -n "$source" ] || exit 0
target="${source%.mp4}.stream.mp4"
[ -f "$target" ] && exit 0
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
