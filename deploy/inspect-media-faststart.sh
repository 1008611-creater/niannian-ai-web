#!/bin/sh
set -eu

video=/var/lib/docker/volumes/niannian-ai-video-workbench_niannian-data/_data/video-outputs/SETuGbVQhDCi_2GUXbROtu12/downloads/astorie-windows-1785395832058.mp4
sudo ffprobe -v error -show_entries format=duration,size,format_name -of json "$video"
sudo grep -abo 'moov' "$video" | head -n 1
sudo grep -abo 'mdat' "$video" | head -n 1
