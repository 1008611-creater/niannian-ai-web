#!/usr/bin/env bash
set -euo pipefail
root=/home/hermes/workspace/niannian-step01
out="$root/output/EP001"
python="$root/runtime/venv/bin/python"
set -a
. "$root/runtime/step01.env"
set +a
exec "$python" "$root/bundle/scripts/build_audio_evidence.py" \
  --video "$root/input/001.mp4" \
  --episode-id EP001 \
  --out-dir "$out" \
  --quality-profile hq_full \
  --asr-backend mimo \
  --asr-fallback none \
  --asr-python "$python" \
  --skip-hq-audio \
  --asr-device-map cpu \
  --asr-dtype float32 \
  --mimo-concurrency 1 \
  --mimo-max-retries 1 \
  --mimo-timeout-sec 180 \
  --mimo-align-timeout-sec 1800 \
  --speaker-backend auto
