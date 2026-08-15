#!/usr/bin/env python3
"""Align an existing Mimo transcript against its source WAV with Qwen3 ForcedAligner.

This worker deliberately does not run Qwen3-ASR.  Its only production input is
Mimo transcript text plus the exact WAV.  The receipt is designed to be consumed
by the strict Step01 evidence finalizer.
"""

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path


ALIGNER_MODEL = "Qwen/Qwen3-ForcedAligner-0.6B"
RECEIPT_SCHEMA = "niannian.step01.qwen3_forced_aligner_receipt.v1"
ALLOWED_TRANSCRIPT_ORIGIN = "mimo_asr"
TOKEN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[A-Za-z0-9']+")


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(path, rows):
    fields = [
        "index", "speaker", "start", "end", "start_timecode", "end_timecode",
        "point_timestamp", "srt_display_start", "srt_display_end",
        "srt_display_derived", "text", "avg_logprob", "no_speech_prob",
        "source_tool", "notes",
    ]
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fields})


def srt_time(sec):
    millis = max(0, int(round(float(sec) * 1000)))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    seconds, millis = divmod(millis, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def display_time(sec):
    millis = max(0, int(round(float(sec) * 1000)))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    seconds, millis = divmod(millis, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def write_srt(path, rows):
    lines = []
    for index, row in enumerate(rows, 1):
        lines.extend([
            str(index),
            f"{srt_time(row['srt_display_start'])} --> {srt_time(row['srt_display_end'])}",
            str(row["text"]).strip(),
            "",
        ])
    Path(path).write_text("\n".join(lines), encoding="utf-8")


def transcript_units(text):
    return TOKEN_RE.findall(str(text or ""))


def normalized_unit(value):
    return "".join(transcript_units(value)).casefold()


def load_transcript_rows(path):
    path = Path(path)
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
    else:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            rows = payload
        elif isinstance(payload, dict):
            rows = payload.get("rows") or payload.get("segments") or []
        else:
            rows = []
    rows = [row for row in rows if isinstance(row, dict) and str(row.get("text", "")).strip()]
    if not rows:
        raise ValueError("MIMO_TRANSCRIPT_ROWS_EMPTY")
    return rows


def aligned_item_dict(item):
    if isinstance(item, dict):
        text = item.get("text", "")
        start = item.get("start_time", item.get("start", None))
        end = item.get("end_time", item.get("end", None))
    else:
        text = getattr(item, "text", "")
        start = getattr(item, "start_time", None)
        end = getattr(item, "end_time", None)
    if not str(text).strip() or start is None or end is None:
        raise ValueError("FORCED_ALIGNER_ITEM_MISSING_FIELDS")
    start = float(start)
    end = float(end)
    # Qwen3-ForcedAligner timestamps are quantized. A real aligned token can
    # therefore be a point timestamp (end == start), as observed on exact
    # source audio. Preserve that model evidence; only reversed ranges are
    # invalid. A display-only SRT interval is derived later without changing
    # the exact model timestamp stored in the segment evidence.
    if start < 0 or end < start:
        raise ValueError("FORCED_ALIGNER_ITEM_INVALID_RANGE")
    return {"text": str(text), "start_time": round(start, 3), "end_time": round(end, 3), "point_timestamp": end == start}


def map_rows_to_aligned_items(transcript_rows, aligned_items):
    items = [aligned_item_dict(item) for item in aligned_items]
    if not items:
        raise ValueError("FORCED_ALIGNER_ITEMS_EMPTY")
    item_units = [normalized_unit(item["text"]) for item in items]
    if any(not value for value in item_units):
        raise ValueError("FORCED_ALIGNER_ITEM_HAS_NO_TEXT_UNIT")

    expected_units = []
    row_unit_counts = []
    for row in transcript_rows:
        units = [unit.casefold() for unit in transcript_units(row.get("text", ""))]
        if not units:
            raise ValueError("MIMO_TRANSCRIPT_ROW_HAS_NO_ALIGNABLE_TEXT")
        expected_units.extend(units)
        row_unit_counts.append(len(units))
    if expected_units != item_units:
        raise ValueError(
            "FORCED_ALIGNER_TEXT_MISMATCH: "
            f"mimo_units={len(expected_units)} aligned_units={len(item_units)}"
        )

    rows = []
    offset = 0
    for index, (source_row, count) in enumerate(zip(transcript_rows, row_unit_counts), 1):
        first = items[offset]
        last = items[offset + count - 1]
        offset += count
        if last["end_time"] < first["start_time"]:
            raise ValueError("FORCED_ALIGNER_SEGMENT_INVALID_RANGE")
        point_timestamp = last["end_time"] == first["start_time"]
        # SRT players require end > start. For a quantized model point, use the
        # smallest representable SRT span strictly as display metadata. The
        # authoritative segment start/end remain equal and are never promoted
        # as a positive-duration ForcedAligner observation.
        srt_display_start = first["start_time"]
        srt_display_end = last["end_time"] if not point_timestamp else round(srt_display_start + 0.001, 3)
        rows.append({
            "index": index,
            "speaker": "speaker_unknown",
            "start": f"{first['start_time']:.3f}",
            "end": f"{last['end_time']:.3f}",
            "start_timecode": display_time(first["start_time"]),
            "end_timecode": display_time(last["end_time"]),
            "point_timestamp": point_timestamp,
            "srt_display_start": f"{srt_display_start:.3f}",
            "srt_display_end": f"{srt_display_end:.3f}",
            "srt_display_derived": point_timestamp,
            "text": str(source_row["text"]).strip(),
            "avg_logprob": "",
            "no_speech_prob": "",
            "source_tool": "qwen3_forced_aligner_on_mimo",
            "notes": (
                "Mimo transcript text aligned to the source WAV by Qwen3-ForcedAligner; "
                + ("exact model evidence is a point timestamp; 1 ms SRT span is display-only; " if point_timestamp else "")
                + "speaker unresolved"
            ),
        })
    return rows, items


def load_aligner(model_name, device_map, dtype_name, local_files_only):
    # librosa declares several numba helpers with cache=True. The immutable
    # Haika virtualenv has no numba source locator, so importing librosa raises
    # before audio loading. Keep JIT available but force these decorators to
    # use memory-only compilation for this worker process.
    import numba
    original_jit = numba.jit
    original_guvectorize = numba.guvectorize

    def jit_without_disk_cache(*args, **kwargs):
        kwargs["cache"] = False
        return original_jit(*args, **kwargs)

    def guvectorize_without_disk_cache(*args, **kwargs):
        kwargs["cache"] = False
        return original_guvectorize(*args, **kwargs)

    numba.jit = jit_without_disk_cache
    numba.guvectorize = guvectorize_without_disk_cache
    import torch
    from qwen_asr import Qwen3ForcedAligner

    if device_map == "auto":
        device_map = "cuda:0" if torch.cuda.is_available() else "cpu"
    if dtype_name == "auto":
        dtype_name = "bfloat16" if str(device_map).startswith("cuda") else "float32"
    dtype = getattr(torch, dtype_name, torch.float32)
    kwargs = {"device_map": device_map, "dtype": dtype}
    if local_files_only:
        kwargs["local_files_only"] = True
    return Qwen3ForcedAligner.from_pretrained(model_name, **kwargs), device_map, dtype_name


def build_receipt_base(args, transcript_path, transcript_rows):
    audio = Path(args.audio).resolve()
    transcript_path = Path(transcript_path).resolve()
    transcript_text = "".join(str(row.get("text", "")).strip() for row in transcript_rows)
    return {
        "schema": RECEIPT_SCHEMA,
        "episode_id": args.episode_id,
        "status": "blocked_evidence_incomplete",
        "ok": False,
        "blocker": None,
        "transcript_origin": args.transcript_origin,
        "timing_basis": "qwen3_forced_aligner_model_inference",
        "timestamps_are_forced_alignment": False,
        "asr_model_invoked": False,
        "model": args.model,
        "source_audio": {
            "path": str(audio),
            "sha256": sha256_file(audio),
            "bytes": audio.stat().st_size,
        },
        "mimo_transcript": {
            "path": str(transcript_path),
            "sha256": sha256_file(transcript_path),
            "bytes": transcript_path.stat().st_size,
            "text_sha256": sha256_text(transcript_text),
            "rows": len(transcript_rows),
        },
        "created_at": utc_now(),
        "test_only": False,
    }


def run(args):
    transcript_path = Path(args.transcript)
    transcript_rows = load_transcript_rows(transcript_path)
    receipt = build_receipt_base(args, transcript_path, transcript_rows)
    if args.transcript_origin != ALLOWED_TRANSCRIPT_ORIGIN:
        raise ValueError("FORCED_ALIGNER_REQUIRES_MIMO_TRANSCRIPT_ORIGIN")
    if args.model != ALIGNER_MODEL:
        raise ValueError("FORCED_ALIGNER_MODEL_NOT_EXACT")

    transcript_text = "".join(str(row["text"]).strip() for row in transcript_rows)
    if args.aligned_items_fixture:
        if os.environ.get("MX_STEP01_TEST_MODE") != "1":
            raise ValueError("ALIGNED_ITEMS_FIXTURE_FORBIDDEN_OUTSIDE_TEST_MODE")
        payload = json.loads(Path(args.aligned_items_fixture).read_text(encoding="utf-8"))
        aligned_items = payload.get("items", payload) if isinstance(payload, dict) else payload
        receipt["test_only"] = True
        device_map = "test_fixture"
        dtype_name = "test_fixture"
    else:
        aligner, device_map, dtype_name = load_aligner(
            args.model, args.device_map, args.dtype, args.local_files_only
        )
        result = aligner.align(
            audio=str(Path(args.audio).resolve()),
            text=transcript_text,
            language=args.language,
        )
        if not result or len(result) != 1:
            raise ValueError("FORCED_ALIGNER_RESULT_CARDINALITY_INVALID")
        aligned_items = list(result[0])

    rows, normalized_items = map_rows_to_aligned_items(transcript_rows, aligned_items)
    out_dir = Path(args.out_dir).resolve()
    tokens_path = out_dir / f"{args.episode_id}_qwen3_forced_aligner_tokens.json"
    segments_csv = out_dir / f"{args.episode_id}_transcript_segments.csv"
    segments_json = out_dir / f"{args.episode_id}_transcript_segments.json"
    srt_path = out_dir / f"{args.episode_id}_transcript.srt"
    write_json(tokens_path, {"episode_id": args.episode_id, "items": normalized_items})
    write_csv(segments_csv, rows)
    write_json(segments_json, {
        "episode_id": args.episode_id,
        "source_tool": "qwen3_forced_aligner_on_mimo",
        "timing_basis": "qwen3_forced_aligner_model_inference",
        "segments": rows,
    })
    write_srt(srt_path, rows)

    artifacts = {}
    for key, path in {
        "tokens": tokens_path,
        "segments_csv": segments_csv,
        "segments_json": segments_json,
        "srt": srt_path,
    }.items():
        artifacts[key] = {
            "path": str(path),
            "sha256": sha256_file(path),
            "bytes": path.stat().st_size,
        }
    receipt.update({
        "ok": True,
        "status": "completed",
        "blocker": None,
        "timestamps_are_forced_alignment": True,
        "device_map": device_map,
        "dtype": dtype_name,
        "aligned_items": len(normalized_items),
        "point_timestamp_items": sum(1 for item in normalized_items if item.get("point_timestamp") is True),
        "point_timestamp_segments": sum(1 for row in rows if row.get("point_timestamp") is True),
        "srt_display_derived_segments": sum(1 for row in rows if row.get("srt_display_derived") is True),
        "segments": len(rows),
        "coverage": {
            "start_sec": float(rows[0]["start"]),
            "end_sec": float(rows[-1]["end"]),
            "monotonic": all(float(a["end"]) <= float(b["start"]) for a, b in zip(rows, rows[1:])),
        },
        "artifacts": artifacts,
    })
    if not receipt["coverage"]["monotonic"]:
        raise ValueError("FORCED_ALIGNER_SEGMENTS_NOT_MONOTONIC")
    return receipt, rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--transcript", required=True, help="Mimo transcript rows as JSON or CSV")
    parser.add_argument("--transcript-origin", default=ALLOWED_TRANSCRIPT_ORIGIN)
    parser.add_argument("--episode-id", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--receipt")
    parser.add_argument("--model", default=ALIGNER_MODEL)
    parser.add_argument("--language", default="Chinese")
    parser.add_argument("--device-map", default="auto")
    parser.add_argument("--dtype", default="auto")
    parser.add_argument("--local-files-only", action="store_true")
    parser.add_argument("--aligned-items-fixture", help="Synthetic test seam; requires MX_STEP01_TEST_MODE=1")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    receipt_path = Path(args.receipt).resolve() if args.receipt else out_dir / f"{args.episode_id}_qwen3_forced_aligner_receipt.json"
    try:
        receipt, _ = run(args)
        exit_code = 0
    except Exception as exc:
        receipt = {
            "schema": RECEIPT_SCHEMA,
            "episode_id": args.episode_id,
            "ok": False,
            "status": "blocked_evidence_incomplete",
            "blocker": {
                "class": "evidence",
                "code": str(exc).split(":", 1)[0],
                "retryable": True,
                "message": f"{exc.__class__.__name__}: {exc}",
            },
            "transcript_origin": args.transcript_origin,
            "timing_basis": "qwen3_forced_aligner_model_inference",
            "timestamps_are_forced_alignment": False,
            "asr_model_invoked": False,
            "model": args.model,
            "created_at": utc_now(),
            "test_only": bool(args.aligned_items_fixture),
            "traceback": traceback.format_exc(),
        }
        audio_path = Path(args.audio).resolve()
        transcript_path = Path(args.transcript).resolve()
        if audio_path.exists():
            receipt["source_audio"] = {
                "path": str(audio_path),
                "sha256": sha256_file(audio_path),
                "bytes": audio_path.stat().st_size,
            }
        if transcript_path.exists():
            receipt["mimo_transcript"] = {
                "path": str(transcript_path),
                "sha256": sha256_file(transcript_path),
                "bytes": transcript_path.stat().st_size,
            }
        exit_code = 2
    write_json(receipt_path, receipt)
    print(json.dumps({
        "ok": receipt.get("ok", False),
        "status": receipt.get("status"),
        "receipt": str(receipt_path),
        "blocker": receipt.get("blocker"),
    }, ensure_ascii=False))
    if exit_code:
        raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
