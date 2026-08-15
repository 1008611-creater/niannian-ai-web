#!/usr/bin/env bash
set -euo pipefail
root=/home/hermes/workspace/niannian-step01
out="$root/output/EP001"
python="$root/runtime/venv/bin/python"
set -a
. "$root/runtime/step01.env"
set +a
exec "$python" "$root/bundle/scripts/smart_selective_ocr.py" \
  --episode-id EP001 \
  --step01-dir "$out" \
  --step02-dir "$out" \
  --dialogue-ledger "$out/EP001_dialogue_ledger.csv" \
  --out-dir "$out/smart_ocr" \
  --engine paddle-api \
  --paddle-model auto \
  --paddle-concurrency "${MX_PADDLEOCR_CONCURRENCY:-4}" \
  --paddle-timeout-sec 300 \
  --paddle-submit-retries 1 \
  --paddle-region-mode single
