#!/bin/sh
set -eu

root=/var/lib/docker/volumes/niannian-ai-video-workbench_niannian-data/_data/video-outputs
for parent in /var/lib/docker /var/lib/docker/volumes /var/lib/docker/volumes/niannian-ai-video-workbench_niannian-data; do
  sudo setfacl -m u:www-data:x "$parent"
done
sudo setfacl -R -m u:www-data:rx "$root"
sudo setfacl -R -d -m u:www-data:rx "$root"
sudo namei -l "$root/SETuGbVQhDCi_2GUXbROtu12/downloads/astorie-windows-1785395832058.mp4" | tail -n 8
