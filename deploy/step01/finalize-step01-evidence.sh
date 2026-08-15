#!/usr/bin/env bash
set -euo pipefail
root=/home/hermes/workspace/niannian-step01
out="$root/output/EP001"
python="$root/runtime/venv/bin/python"
checkpoint="$out/EP001_step01_checkpoint.json"
ledger="$out/EP001_step01_artifact_ledger.json"

"$python" "$root/bundle/scripts/validate_episode_evidence.py" \
  --video "$root/input/001.mp4" \
  --episode-id EP001 \
  --out-dir "$out" \
  --require-source-ffprobe \
  --require-asr \
  --require-audio-ledger

"$python" - "$out" "$checkpoint" "$ledger" <<'PY'
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

out = Path(sys.argv[1])
checkpoint = Path(sys.argv[2])
ledger = Path(sys.argv[3])

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

records = []
for path in sorted(out.rglob("*")):
    if not path.is_file():
        continue
    if path in {checkpoint, ledger, out / "step01_evidence_manifest.json"}:
        continue
    records.append({
        "path": str(path.resolve()),
        "relative_path": path.relative_to(out).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    })

now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
checkpoint.write_text(json.dumps({
    "node_id": "step01_evidence",
    "project_id": "NN-20260715083045-8120F5",
    "analysis_run_id": "analysis-1-0dc5c5d751592e9fd0656a81",
    "episode_id": "EP001",
    "status": "evidence_collected",
    "created_at": now,
}, ensure_ascii=False, indent=2), encoding="utf-8")
ledger.write_text(json.dumps({
    "node_id": "step01_evidence",
    "episode_id": "EP001",
    "created_at": now,
    "artifacts": records,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"checkpoint": str(checkpoint), "artifact_ledger": str(ledger), "artifact_count": len(records)}, ensure_ascii=False))
PY

exec "$python" "$root/bundle/scripts/finalize_step01_evidence.py" \
  --source-video "$root/input/001.mp4" \
  --episode-id EP001 \
  --out-dir "$out" \
  --quality-profile hq_full \
  --paddle-receipt "$out/smart_ocr/EP001_smart_ocr_receipt.json" \
  --checkpoint "$checkpoint" \
  --artifact-ledger "$ledger" \
  --manifest "$out/step01_evidence_manifest.json"
