#!/bin/sh
set -eu

source=${1:?source MP4 is required}
target=${2:-"${source%.mp4}.stream.mp4"}
temporary="$target.tmp.mp4"

rm -f "$temporary"
ffmpeg -nostdin -v error -y -i "$source" \
  -map 0:v:0 -map 0:a? \
  -c:v libx264 -preset veryfast -b:v 650k -maxrate 800k -bufsize 1600k -pix_fmt yuv420p \
  -c:a aac -b:a 48k -movflags +faststart "$temporary"
mv "$temporary" "$target"
ffprobe -v error -show_entries format=duration,size,bit_rate -of json "$target"
