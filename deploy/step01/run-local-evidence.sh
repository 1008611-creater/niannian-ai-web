#!/usr/bin/env bash
set -euo pipefail
root=/home/hermes/workspace/niannian-step01
out="$root/output/EP001"
python="$root/runtime/venv/bin/python"
source="$root/input/001.mp4"
test -r "$source"
mkdir -p "$out/audio"
ffmpeg -y -v error -i "$source" -vn -ac 1 -ar 16000 -c:a pcm_s16le "$out/audio/EP001_16k_mono.wav"
"$python" "$root/bundle/scripts/extract_episode_frames.py" --video "$source" --episode-id EP001 --out-dir "$out" --unbounded
"$python" "$root/bundle/scripts/enhance_episode_evidence.py" --video "$source" --episode-id EP001 --out-dir "$out" --skip-ocr --transnet-torch-threads 2
echo STEP01_LOCAL_EVIDENCE_PASS
