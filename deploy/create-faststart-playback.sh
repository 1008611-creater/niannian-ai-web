#!/bin/sh
set -eu

source=/var/lib/docker/volumes/niannian-ai-video-workbench_niannian-data/_data/video-outputs/SETuGbVQhDCi_2GUXbROtu12/downloads/astorie-windows-1785395832058.mp4
target=/var/lib/docker/volumes/niannian-ai-video-workbench_niannian-data/_data/video-outputs/SETuGbVQhDCi_2GUXbROtu12/downloads/astorie-windows-1785395832058.playback.mp4
temporary="$target.tmp.mp4"

sudo rm -f "$temporary"
sudo ffmpeg -v error -y -i "$source" -map 0 -c copy -movflags +faststart "$temporary"
sudo mv "$temporary" "$target"
sudo setfacl -m u:www-data:rx "$target"
sudo ffprobe -v error -show_entries format=duration,size -of json "$target"
sudo grep -abo 'moov' "$target" | head -n 1
sudo grep -abo 'mdat' "$target" | head -n 1
