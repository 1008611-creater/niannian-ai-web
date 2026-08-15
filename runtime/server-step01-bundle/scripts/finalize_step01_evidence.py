#!/usr/bin/env python3
"""Strict Step01 evidence manifest generator and verifier.

The manifest is the only Step02-consumable Step01 handoff.  A blocked manifest
is still written for recovery, but only a fully verified hq_full manifest sets
``downstream_consumable`` to true.
"""

import argparse
import csv
import hashlib
import json
import os
import shutil
import struct
import subprocess
from datetime import datetime, timezone
from pathlib import Path


SCHEMA = "niannian.step01_evidence_manifest.v1"
ALIGNER_SCHEMA = "niannian.step01.qwen3_forced_aligner_receipt.v1"
OCR_SCHEMA = "niannian.step01.smart_selective_ocr_receipt.v1"
NATIVE_DIRS = (
    "reference_frames_original",
    "shotlevel_start_mid_end_frames",
    "transnet_shots/keyframes",
)
TRIAD_POINTS = ("start", "mid", "end")


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_csv(path):
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact(path, role, root=None):
    path = Path(path).resolve()
    record = {
        "role": role,
        "path": str(path),
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
    }
    if root is not None:
        try:
            record["relative_path"] = path.relative_to(Path(root).resolve()).as_posix()
        except ValueError:
            record["relative_path"] = ""
    return record


def png_size(path):
    with Path(path).open("rb") as handle:
        header = handle.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"PNG_HEADER_INVALID:{path}")
    return struct.unpack(">II", header[16:24])


def find_ffprobe(explicit=""):
    if explicit:
        candidate = Path(explicit).expanduser()
        if candidate.exists():
            return str(candidate.resolve())
        raise FileNotFoundError(f"FFPROBE_NOT_FOUND:{candidate}")
    found = shutil.which("ffprobe")
    if found:
        return found
    raise FileNotFoundError("FFPROBE_NOT_FOUND")


def ffprobe_source(video, ffprobe=""):
    executable = find_ffprobe(ffprobe)
    command = [
        executable, "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(Path(video).resolve()),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"FFPROBE_FAILED:{result.stderr.strip()[:500]}")
    payload = json.loads(result.stdout)
    video_streams = [stream for stream in payload.get("streams", []) if stream.get("codec_type") == "video"]
    if not video_streams:
        raise ValueError("FFPROBE_VIDEO_STREAM_MISSING")
    stream = video_streams[0]
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    if width <= 0 or height <= 0:
        raise ValueError("FFPROBE_RESOLUTION_INVALID")
    return {
        "tool": "ffprobe",
        "executable": executable,
        "width": width,
        "height": height,
        "duration_sec": float(stream.get("duration") or payload.get("format", {}).get("duration") or 0),
        "avg_frame_rate": stream.get("avg_frame_rate", ""),
        "r_frame_rate": stream.get("r_frame_rate", ""),
        "codec_name": stream.get("codec_name", ""),
        "pix_fmt": stream.get("pix_fmt", ""),
        "raw": payload,
    }


def validate_native_pngs(out_dir, expected_size):
    out_dir = Path(out_dir).resolve()
    rows = []
    errors = []
    for relative_dir in NATIVE_DIRS:
        folder = out_dir / relative_dir
        files = sorted(folder.glob("*.png")) if folder.exists() else []
        if not files:
            errors.append(f"NATIVE_PNG_SET_EMPTY:{relative_dir}")
            continue
        for path in files:
            try:
                size = png_size(path)
            except Exception as exc:
                errors.append(str(exc))
                continue
            if tuple(size) != tuple(expected_size):
                errors.append(
                    f"NATIVE_PNG_RESOLUTION_MISMATCH:{path}:{size[0]}x{size[1]}!={expected_size[0]}x{expected_size[1]}"
                )
            rows.append({**artifact(path, f"native_png:{relative_dir}", out_dir), "width": size[0], "height": size[1]})
    return rows, errors


def validate_frame_manifest(out_dir, episode_id, expected_size):
    out_dir = Path(out_dir).resolve()
    manifest_path = out_dir / f"{episode_id}_frame_manifest.csv"
    errors = []
    if not manifest_path.exists():
        return [], [f"FRAME_MANIFEST_MISSING:{manifest_path}"]
    rows = read_csv(manifest_path)
    if not rows:
        return [], ["FRAME_MANIFEST_EMPTY"]
    times = []
    orders = []
    seen = set()
    for row in rows:
        try:
            orders.append(int(row.get("order", "")))
            times.append(float(row.get("time_sec", "")))
        except ValueError:
            errors.append("FRAME_MANIFEST_NUMERIC_FIELD_INVALID")
            continue
        path = Path(row.get("path") or out_dir / "reference_frames_original" / row.get("file", "")).resolve()
        if path in seen:
            errors.append(f"FRAME_MANIFEST_DUPLICATE_PATH:{path}")
        seen.add(path)
        if not path.exists():
            errors.append(f"FRAME_MANIFEST_FILE_MISSING:{path}")
            continue
        try:
            relative = path.relative_to(out_dir / "reference_frames_original")
            if len(relative.parts) != 1:
                errors.append(f"FRAME_MANIFEST_PATH_OUTSIDE_NATIVE_REFERENCE_DIR:{path}")
        except ValueError:
            errors.append(f"FRAME_MANIFEST_PATH_OUTSIDE_NATIVE_REFERENCE_DIR:{path}")
        try:
            if png_size(path) != tuple(expected_size):
                errors.append(f"FRAME_MANIFEST_PNG_NOT_SOURCE_RESOLUTION:{path}")
        except Exception as exc:
            errors.append(str(exc))
    if orders != list(range(1, len(rows) + 1)):
        errors.append("FRAME_MANIFEST_ORDER_NOT_CONTIGUOUS")
    if times != sorted(times):
        errors.append("FRAME_MANIFEST_TIME_NOT_SORTED")
    return rows, errors


def validate_transnet_triads(transnet_rows, triad_rows, out_dir, expected_size):
    errors = []
    out_dir = Path(out_dir).resolve()
    expected = {(str(row.get("shot_id")), point) for row in transnet_rows for point in TRIAD_POINTS}
    actual = set()
    duplicates = set()
    for row in triad_rows:
        key = (str(row.get("shot_id")), str(row.get("point")))
        if key in actual:
            duplicates.add(key)
        actual.add(key)
        if row.get("source_detector") != "transnetv2":
            errors.append(f"SHOT_TRIAD_NOT_TRANSNET:{key[0]}:{key[1]}")
        path = Path(row.get("path") or out_dir / "shotlevel_start_mid_end_frames" / row.get("file", "")).resolve()
        if not path.exists():
            errors.append(f"SHOT_TRIAD_FILE_MISSING:{path}")
        else:
            try:
                if png_size(path) != tuple(expected_size):
                    errors.append(f"SHOT_TRIAD_PNG_NOT_SOURCE_RESOLUTION:{path}")
            except Exception as exc:
                errors.append(str(exc))
    if duplicates:
        errors.append(f"SHOT_TRIAD_DUPLICATE_KEYS:{sorted(duplicates)}")
    missing = expected - actual
    extra = actual - expected
    if missing:
        errors.append(f"SHOT_TRIAD_MISSING:{sorted(missing)}")
    if extra:
        errors.append(f"SHOT_TRIAD_EXTRA:{sorted(extra)}")
    return errors


def validate_aligner_receipt(payload, allow_test_only=False):
    errors = []
    exact = {
        "schema": ALIGNER_SCHEMA,
        "ok": True,
        "status": "completed",
        "transcript_origin": "mimo_asr",
        "timing_basis": "qwen3_forced_aligner_model_inference",
        "timestamps_are_forced_alignment": True,
        "asr_model_invoked": False,
        "model": "Qwen/Qwen3-ForcedAligner-0.6B",
    }
    for key, value in exact.items():
        if payload.get(key) != value:
            errors.append(f"ALIGNER_RECEIPT_FIELD_INVALID:{key}")
    if payload.get("test_only") and not allow_test_only:
        errors.append("ALIGNER_RECEIPT_TEST_ONLY_FORBIDDEN")
    if int(payload.get("aligned_items") or 0) <= 0 or int(payload.get("segments") or 0) <= 0:
        errors.append("ALIGNER_RECEIPT_EMPTY")
    coverage = payload.get("coverage") or {}
    if coverage.get("monotonic") is not True or float(coverage.get("end_sec") or 0) <= float(coverage.get("start_sec") or 0):
        errors.append("ALIGNER_RECEIPT_COVERAGE_INVALID")
    return errors


def validate_ocr_receipt(payload, allow_local_ocr=False):
    errors = []
    if payload.get("schema") != OCR_SCHEMA:
        errors.append("OCR_RECEIPT_SCHEMA_INVALID")
    if payload.get("ok") is not True or payload.get("status") != "completed":
        errors.append("OCR_RECEIPT_NOT_COMPLETED")
    if payload.get("engine") != "paddle-api" and not allow_local_ocr:
        errors.append("OCR_RECEIPT_NOT_PADDLE_API")
    if int(payload.get("errors") or 0) != 0:
        errors.append("OCR_RECEIPT_HAS_ERRORS")
    if int(payload.get("candidate_frames") or 0) <= 0:
        errors.append("OCR_RECEIPT_CANDIDATES_EMPTY")
    if int(payload.get("ocr_rows") or 0) <= 0:
        errors.append("OCR_RECEIPT_LEDGER_EMPTY")
    terminal = payload.get("terminal_coverage") or {}
    if terminal.get("complete") is not True or int(terminal.get("missing") or 0) != 0:
        errors.append("OCR_RECEIPT_CANDIDATE_NOT_TERMINAL")
    if payload.get("step02_completed") is not False:
        errors.append("OCR_RECEIPT_STEP02_BOUNDARY_INVALID")
    return errors


def validate_ocr_artifact_counts(payload):
    errors = []
    artifacts = payload.get("artifacts") or {}
    checks = [
        ("candidates", "candidate_frames"),
        ("ledger", "ocr_rows"),
        ("errors", "errors"),
    ]
    for artifact_key, receipt_key in checks:
        value = artifacts.get(artifact_key)
        path = Path(value.get("path", "")) if isinstance(value, dict) else Path(value or "")
        if not path.exists():
            continue
        try:
            rows = read_json(path)
        except Exception as exc:
            errors.append(f"OCR_ARTIFACT_JSON_INVALID:{artifact_key}:{exc}")
            continue
        if not isinstance(rows, list):
            errors.append(f"OCR_ARTIFACT_NOT_LIST:{artifact_key}")
            continue
        if len(rows) != int(payload.get(receipt_key) or 0):
            errors.append(
                f"OCR_ARTIFACT_COUNT_MISMATCH:{artifact_key}:{len(rows)}!={payload.get(receipt_key)}"
            )
    terminal_value = artifacts.get("terminal_jobs")
    terminal_path = Path(terminal_value.get("path", "")) if isinstance(terminal_value, dict) else Path(terminal_value or "")
    if terminal_path.exists():
        try:
            terminal_rows = read_json(terminal_path)
            terminal_count = sum(
                1 for row in terminal_rows
                if isinstance(row, dict) and row.get("terminal") is True and str(row.get("state", "")).startswith("done_")
            )
            claimed = int((payload.get("terminal_coverage") or {}).get("terminal") or 0)
            if terminal_count != claimed:
                errors.append(f"OCR_TERMINAL_COUNT_MISMATCH:{terminal_count}!={claimed}")
        except Exception as exc:
            errors.append(f"OCR_TERMINAL_ARTIFACT_INVALID:{exc}")
    return errors


def verify_artifact_records(records):
    errors = []
    for record in records:
        path = Path(record.get("path", ""))
        if not path.exists():
            errors.append(f"ARTIFACT_MISSING:{path}")
            continue
        if path.stat().st_size != int(record.get("bytes") or -1):
            errors.append(f"ARTIFACT_BYTES_MISMATCH:{path}")
        if sha256_file(path) != record.get("sha256"):
            errors.append(f"ARTIFACT_SHA_MISMATCH:{path}")
    return errors


def verify_receipt_artifacts(payload, prefix):
    errors = []
    records = []
    artifacts = payload.get("artifacts") or {}
    for role, value in artifacts.items():
        if isinstance(value, str):
            path = Path(value)
            expected_sha = ""
            expected_bytes = None
        elif isinstance(value, dict):
            path = Path(value.get("path", ""))
            expected_sha = value.get("sha256", "")
            expected_bytes = value.get("bytes")
        else:
            errors.append(f"{prefix}_ARTIFACT_RECORD_INVALID:{role}")
            continue
        if not path.exists() or not path.is_file():
            errors.append(f"{prefix}_ARTIFACT_MISSING:{role}:{path}")
            continue
        record = artifact(path, f"{prefix.lower()}:{role}")
        if expected_sha and record["sha256"] != expected_sha:
            errors.append(f"{prefix}_ARTIFACT_SHA_MISMATCH:{role}:{path}")
        if expected_bytes is not None and record["bytes"] != int(expected_bytes):
            errors.append(f"{prefix}_ARTIFACT_BYTES_MISMATCH:{role}:{path}")
        records.append(record)
    if not records:
        errors.append(f"{prefix}_ARTIFACTS_EMPTY")
    return records, errors


def verify_bound_file(binding, role, expected_path=None):
    errors = []
    records = []
    if not isinstance(binding, dict) or not binding.get("path"):
        return [], [f"BOUND_FILE_MISSING:{role}"]
    path = Path(binding["path"]).resolve()
    if expected_path is not None and path != Path(expected_path).resolve():
        errors.append(f"BOUND_FILE_PATH_MISMATCH:{role}:{path}!={Path(expected_path).resolve()}")
    if not path.exists():
        errors.append(f"BOUND_FILE_NOT_FOUND:{role}:{path}")
        return records, errors
    record = artifact(path, role)
    if record["sha256"] != binding.get("sha256"):
        errors.append(f"BOUND_FILE_SHA_MISMATCH:{role}:{path}")
    if record["bytes"] != int(binding.get("bytes") or -1):
        errors.append(f"BOUND_FILE_BYTES_MISMATCH:{role}:{path}")
    records.append(record)
    return records, errors


def collect_required_artifacts(out_dir, episode_id, extra_paths):
    out_dir = Path(out_dir).resolve()
    standard = {
        "frame_manifest_csv": out_dir / f"{episode_id}_frame_manifest.csv",
        "frame_manifest_json": out_dir / f"{episode_id}_frame_manifest.json",
        "shot_list_csv": out_dir / f"{episode_id}_shot_list.csv",
        "shot_list_json": out_dir / f"{episode_id}_shot_list.json",
        "evidence_pack_jsonl": out_dir / f"{episode_id}_evidence_pack.jsonl",
        "evidence_pack_sqlite": out_dir / f"{episode_id}_evidence_pack.sqlite",
        "evidence_pack_summary": out_dir / f"{episode_id}_evidence_pack_summary.json",
        "validation": out_dir / f"{episode_id}_evidence_validation.json",
        "wav": out_dir / "audio" / f"{episode_id}_16k_mono.wav",
        "audio_status": out_dir / f"{episode_id}_audio_tool_status.json",
        "vad_csv": out_dir / f"{episode_id}_vad_segments.csv",
        "dialogue_csv": out_dir / f"{episode_id}_dialogue_ledger.csv",
        "audio_event_csv": out_dir / f"{episode_id}_audio_event_ledger.csv",
        "mimo_raw": out_dir / f"{episode_id}_mimo_asr_raw.json",
        "mimo_dialogue": out_dir / f"{episode_id}_mimo_asr_dialogue_ledger.csv",
        "aligner_receipt": out_dir / f"{episode_id}_qwen3_forced_aligner_receipt.json",
        "aligner_tokens": out_dir / f"{episode_id}_qwen3_forced_aligner_tokens.json",
        "transcript_csv": out_dir / f"{episode_id}_transcript_segments.csv",
        "transcript_json": out_dir / f"{episode_id}_transcript_segments.json",
        "transcript_srt": out_dir / f"{episode_id}_transcript.srt",
        "transnet_csv": out_dir / "transnet_shots" / f"{episode_id}_transnet_shots.csv",
        "transnet_json": out_dir / "transnet_shots" / f"{episode_id}_transnet_shots.json",
        "shot_triads_csv": out_dir / "shotlevel_start_mid_end_manifest.csv",
        "shot_triads_json": out_dir / "shotlevel_start_mid_end_manifest.json",
        "paddle_receipt": Path(extra_paths["paddle_receipt"]),
        "checkpoint": Path(extra_paths["checkpoint"]),
        "artifact_ledger": Path(extra_paths["artifact_ledger"]),
    }
    records = []
    missing = []
    for role, path in standard.items():
        path = path.resolve()
        if not path.exists() or not path.is_file() or path.stat().st_size <= 0:
            missing.append(f"REQUIRED_ARTIFACT_MISSING_OR_EMPTY:{role}:{path}")
        else:
            records.append(artifact(path, role, out_dir))
    return records, missing, standard


def finalize(args):
    out_dir = Path(args.out_dir).resolve()
    video = Path(args.source_video).resolve()
    errors = []
    warnings = []
    if not video.exists():
        errors.append(f"SOURCE_VIDEO_MISSING:{video}")
        probe = {}
    else:
        try:
            probe = ffprobe_source(video, args.ffprobe)
        except Exception as exc:
            probe = {}
            errors.append(str(exc))
    source = artifact(video, "source_video") if video.exists() else {"path": str(video)}
    if probe:
        source["ffprobe"] = {key: value for key, value in probe.items() if key != "raw"}

    records, missing, paths = collect_required_artifacts(out_dir, args.episode_id, {
        "paddle_receipt": args.paddle_receipt,
        "checkpoint": args.checkpoint,
        "artifact_ledger": args.artifact_ledger,
    })
    errors.extend(missing)
    expected_size = (probe.get("width", 0), probe.get("height", 0))
    native_records = []
    frame_rows = []
    transnet_rows = []
    triad_rows = []
    if all(expected_size):
        native_records, native_errors = validate_native_pngs(out_dir, expected_size)
        errors.extend(native_errors)
        frame_rows, frame_errors = validate_frame_manifest(out_dir, args.episode_id, expected_size)
        errors.extend(frame_errors)
    if paths["transnet_csv"].exists():
        transnet_rows = read_csv(paths["transnet_csv"])
        if not transnet_rows:
            errors.append("TRANSNET_SHOTS_EMPTY")
    if paths["shot_triads_csv"].exists():
        triad_rows = read_csv(paths["shot_triads_csv"])
    if transnet_rows and all(expected_size):
        errors.extend(validate_transnet_triads(transnet_rows, triad_rows, out_dir, expected_size))

    aligner_payload = read_json(paths["aligner_receipt"]) if paths["aligner_receipt"].exists() else {}
    ocr_payload = read_json(paths["paddle_receipt"]) if paths["paddle_receipt"].exists() else {}
    validation_payload = read_json(paths["validation"]) if paths["validation"].exists() else {}
    aligner_artifacts, aligner_artifact_errors = verify_receipt_artifacts(aligner_payload, "ALIGNER") if aligner_payload else ([], [])
    ocr_artifacts, ocr_artifact_errors = verify_receipt_artifacts(ocr_payload, "OCR") if ocr_payload else ([], [])
    records.extend(aligner_artifacts)
    records.extend(ocr_artifacts)
    errors.extend(aligner_artifact_errors)
    errors.extend(ocr_artifact_errors)
    if aligner_payload:
        bound_records, bound_errors = verify_bound_file(
            aligner_payload.get("source_audio"), "aligner_source_wav", paths["wav"]
        )
        records.extend(bound_records)
        errors.extend(bound_errors)
        bound_records, bound_errors = verify_bound_file(
            aligner_payload.get("mimo_transcript"), "aligner_mimo_transcript"
        )
        records.extend(bound_records)
        errors.extend(bound_errors)
    if args.quality_profile == "hq_full":
        errors.extend(validate_aligner_receipt(aligner_payload, allow_test_only=args.allow_test_only))
        errors.extend(validate_ocr_receipt(ocr_payload))
        errors.extend(validate_ocr_artifact_counts(ocr_payload))
        if validation_payload.get("ok") is not True:
            errors.append("EPISODE_EVIDENCE_VALIDATION_NOT_OK")
        if validation_payload.get("source_ffprobe_resolution_verified") is not True:
            errors.append("VALIDATION_DID_NOT_VERIFY_SOURCE_FFPROBE_RESOLUTION")
        if paths["audio_status"].exists():
            try:
                audio_status = read_json(paths["audio_status"])
                quality_gate = audio_status.get("quality_gate") or {}
                if not (
                    quality_gate.get("profile") == "hq_full"
                    and quality_gate.get("ok") is True
                    and quality_gate.get("status") == "passed"
                ):
                    errors.append("AUDIO_HQ_FULL_QUALITY_GATE_NOT_PASSED")
            except Exception as exc:
                errors.append(f"AUDIO_STATUS_INVALID:{exc}")
    elif not args.stable_batch_authority_event:
        errors.append("STABLE_BATCH_EXPLICIT_AUTHORITY_EVENT_MISSING")

    for role in ("checkpoint", "artifact_ledger"):
        path = paths[role]
        if path.exists():
            try:
                payload = read_json(path)
                if not isinstance(payload, (dict, list)) or not payload:
                    errors.append(f"{role.upper()}_JSON_EMPTY_OR_INVALID")
                elif isinstance(payload, dict) and payload.get("node_id") != "step01_evidence":
                    errors.append(f"{role.upper()}_NODE_ID_INVALID")
            except Exception as exc:
                errors.append(f"{role.upper()}_JSON_INVALID:{exc}")

    duration = float(probe.get("duration_sec") or 0)
    minute_index = out_dir / "minute_chunks" / f"{args.episode_id}_minute_chunks_index.json"
    minute_records = []
    if duration > float(args.chunk_sec):
        if not minute_index.exists():
            errors.append(f"MINUTE_CHUNKS_INDEX_MISSING:{minute_index}")
        else:
            minute_records.append(artifact(minute_index, "minute_chunks_index", out_dir))
            index_payload = read_json(minute_index)
            chunk_rows = index_payload if isinstance(index_payload, list) else (
                index_payload.get("chunks") or index_payload.get("minutes") or []
            )
            for raw in chunk_rows:
                for key in ("csv", "json", "manifest_csv", "manifest_json"):
                    value = raw.get(key) if isinstance(raw, dict) else None
                    if not value:
                        continue
                    path = Path(value)
                    if not path.is_absolute():
                        path = out_dir / "minute_chunks" / path
                    if not path.exists():
                        errors.append(f"MINUTE_CHUNK_ARTIFACT_MISSING:{path}")
                    else:
                        minute_records.append(artifact(path, f"minute_chunk:{key}", out_dir))

    all_records = records + native_records + minute_records
    errors.extend(verify_artifact_records(all_records))
    gates = {
        "source_ffprobe": bool(probe),
        "native_png_exact_source_resolution": bool(native_records) and not any("PNG" in item or "RESOLUTION" in item for item in errors),
        "frame_manifest": bool(frame_rows),
        "transnet_shots": bool(transnet_rows),
        "transnet_start_mid_end": bool(transnet_rows) and not any(item.startswith("SHOT_TRIAD") for item in errors),
        "mimo_transcript": aligner_payload.get("transcript_origin") == "mimo_asr",
        "qwen3_forced_aligner": not validate_aligner_receipt(aligner_payload, allow_test_only=args.allow_test_only) if aligner_payload else False,
        "paddle_smart_ocr": not validate_ocr_receipt(ocr_payload) if ocr_payload else False,
        "episode_validation": validation_payload.get("ok") is True,
        "checkpoint": paths["checkpoint"].exists(),
        "artifact_ledger": paths["artifact_ledger"].exists(),
        "minute_chunks": duration <= float(args.chunk_sec) or bool(minute_records),
    }
    verified = not errors and all(gates.values())
    manifest = {
        "schema": SCHEMA,
        "node_id": "step01_evidence",
        "episode_id": args.episode_id,
        "quality_profile": args.quality_profile,
        "status": "verified" if verified else "blocked_evidence_incomplete",
        "downstream_consumable": verified,
        "source": source,
        "ffprobe": probe.get("raw", {}),
        "gates": gates,
        "errors": errors,
        "warnings": warnings,
        "counts": {
            "frame_manifest_rows": len(frame_rows),
            "native_pngs": len(native_records),
            "transnet_shots": len(transnet_rows),
            "shot_triad_rows": len(triad_rows),
            "minute_chunk_artifacts": len(minute_records),
        },
        "artifacts": all_records,
        "receipts": {
            "mimo_forced_alignment": artifact(paths["aligner_receipt"], "aligner_receipt") if paths["aligner_receipt"].exists() else None,
            "paddle_smart_ocr": artifact(paths["paddle_receipt"], "paddle_receipt") if paths["paddle_receipt"].exists() else None,
            "validation": artifact(paths["validation"], "validation") if paths["validation"].exists() else None,
            "checkpoint": artifact(paths["checkpoint"], "checkpoint") if paths["checkpoint"].exists() else None,
            "artifact_ledger": artifact(paths["artifact_ledger"], "artifact_ledger") if paths["artifact_ledger"].exists() else None,
        },
        "boundary": {
            "step02_completed": False,
            "step04_prompt_created": False,
            "step05_image_created": False,
            "provider_invoked": False,
        },
        "created_at": utc_now(),
    }
    return manifest


def verify_manifest(path, allow_test_only=False):
    manifest = read_json(path)
    errors = []
    if manifest.get("schema") != SCHEMA:
        errors.append("STEP01_MANIFEST_SCHEMA_INVALID")
    if manifest.get("node_id") != "step01_evidence":
        errors.append("STEP01_MANIFEST_NODE_INVALID")
    if manifest.get("status") != "verified" or manifest.get("downstream_consumable") is not True:
        errors.append("STEP01_MANIFEST_NOT_CONSUMABLE")
    if manifest.get("quality_profile") != "hq_full":
        errors.append("STEP01_MANIFEST_NOT_HQ_FULL")
    if not all((manifest.get("gates") or {}).values()):
        errors.append("STEP01_MANIFEST_GATE_FALSE")
    source = manifest.get("source") or {}
    source_path = Path(source.get("path", ""))
    if not source_path.exists():
        errors.append(f"STEP01_SOURCE_MISSING:{source_path}")
    else:
        if source_path.stat().st_size != int(source.get("bytes") or -1):
            errors.append("STEP01_SOURCE_BYTES_MISMATCH")
        if sha256_file(source_path) != source.get("sha256"):
            errors.append("STEP01_SOURCE_SHA_MISMATCH")
    errors.extend(verify_artifact_records(manifest.get("artifacts") or []))
    boundary = manifest.get("boundary") or {}
    if any(boundary.get(key) is not False for key in ("step02_completed", "step04_prompt_created", "step05_image_created", "provider_invoked")):
        errors.append("STEP01_MANIFEST_BOUNDARY_INVALID")
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-video")
    parser.add_argument("--episode-id")
    parser.add_argument("--out-dir")
    parser.add_argument("--quality-profile", choices=("hq_full", "stable_batch"), default="hq_full")
    parser.add_argument("--paddle-receipt")
    parser.add_argument("--checkpoint")
    parser.add_argument("--artifact-ledger")
    parser.add_argument("--ffprobe", default="")
    parser.add_argument("--chunk-sec", type=float, default=60.0)
    parser.add_argument("--stable-batch-authority-event", default="")
    parser.add_argument("--allow-test-only", action="store_true", help="Synthetic tests only; production manifests reject test receipts")
    parser.add_argument("--manifest")
    parser.add_argument("--verify-only")
    args = parser.parse_args()

    if args.verify_only:
        errors = verify_manifest(args.verify_only, allow_test_only=args.allow_test_only)
        print(json.dumps({"ok": not errors, "manifest": str(Path(args.verify_only).resolve()), "errors": errors}, ensure_ascii=False, indent=2))
        if errors:
            raise SystemExit(2)
        return
    required = ["source_video", "episode_id", "out_dir", "paddle_receipt", "checkpoint", "artifact_ledger"]
    missing = [name for name in required if not getattr(args, name)]
    if missing:
        raise SystemExit(f"Missing required arguments: {', '.join(missing)}")
    manifest = finalize(args)
    manifest_path = Path(args.manifest).resolve() if args.manifest else Path(args.out_dir).resolve() / "step01_evidence_manifest.json"
    write_json(manifest_path, manifest)
    print(json.dumps({
        "ok": manifest["downstream_consumable"],
        "status": manifest["status"],
        "manifest": str(manifest_path),
        "errors": manifest["errors"],
    }, ensure_ascii=False, indent=2))
    if not manifest["downstream_consumable"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
