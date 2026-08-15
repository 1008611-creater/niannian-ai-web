#!/usr/bin/env python3
"""Validate an AI video plan against the ai-video-fundamentals method contract.

The validator is intentionally dependency-free so it can run anywhere Codex runs.
It is a guardrail, not a creative judge: it catches missing structure and lazy
style-only outputs before they become final plans.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


SCRIPT_PATH = Path(__file__).resolve()
SKILL_ROOT = SCRIPT_PATH.parents[1]
CONTRACT_PATH = SKILL_ROOT / "references" / "method-contract.json"


def load_contract(path: Path = CONTRACT_PATH) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def normalize(text: str) -> str:
    text = text.replace("\u3000", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return text.lower()


def contains_any(text: str, terms: list[str]) -> bool:
    lowered = normalize(text)
    return any(term.lower() in lowered for term in terms)


def count_present(text: str, terms: list[str]) -> int:
    lowered = normalize(text)
    return sum(1 for term in terms if term.lower() in lowered)


def detect_video_types(text: str, contract: dict[str, Any]) -> list[str]:
    found: list[str] = []
    for video_type, spec in contract["video_types"].items():
        if contains_any(text, spec.get("aliases", [video_type])):
            found.append(video_type)
    return found


def evaluate(text: str, contract: dict[str, Any], min_score: float | None = None) -> dict[str, Any]:
    min_score = float(min_score if min_score is not None else contract.get("minimum_score", 0.85))
    total_weight = 0
    passed_weight = 0
    missing: list[dict[str, str]] = []
    passed: list[str] = []

    for section in contract["required_sections"]:
        section_id = section["id"]
        weight = int(section["weight"])
        total_weight += weight

        if section_id == "three_part_prompt":
            labels = contract["three_part_prompt"]["required_labels"]
            ok = all(label in text for label in labels)
        else:
            ok = contains_any(text, section["terms"])

        if ok:
            passed_weight += weight
            passed.append(section_id)
        else:
            missing.append({"id": section_id, "name": section["name"]})

    detected_types = detect_video_types(text, contract)
    warnings: list[str] = []

    if not detected_types:
        warnings.append("没有识别到明确视频类型，容易把所有项目套成同一种风格。")
    else:
        for video_type in detected_types:
            spec = contract["video_types"][video_type]
            missing_focus = [term for term in spec["must_cover"] if term not in text]
            if missing_focus:
                warnings.append(f"{video_type} 缺少类型专属要点：{', '.join(missing_focus)}")

    generic_terms = ["电影感", "高级感", "大片感"]
    if contains_any(text, generic_terms) and count_present(text, ["基础设定", "氛围与画质", "画面内容", "资产卡", "质检"]) < 3:
        warnings.append("检测到泛化风格词，但结构不足：不要只用电影感/高级感代替方法。")

    narrow_style_terms = ["丧尸", "末日", "原子朋克", "复古科幻"]
    if count_present(text, narrow_style_terms) >= 2 and len(detected_types) == 0:
        warnings.append("检测到单一案例风格词，但没有类型判断：不要把方法退化成《丧尸清道夫》风格复刻。")

    fatal_ids = set(contract.get("fatal_requirements", []))
    missing_fatal = [item for item in missing if item["id"] in fatal_ids]
    score = round(passed_weight / total_weight, 4) if total_weight else 0.0
    ok = score >= min_score and not missing_fatal

    return {
        "ok": ok,
        "score": score,
        "min_score": min_score,
        "detected_video_types": detected_types,
        "passed": passed,
        "missing": missing,
        "missing_fatal": missing_fatal,
        "warnings": warnings,
    }


def read_input(args: argparse.Namespace) -> str:
    if args.text is not None:
        return args.text
    if args.file is not None:
        return Path(args.file).read_text(encoding="utf-8")
    if not sys.stdin.isatty():
        return sys.stdin.read()
    raise SystemExit("Provide a file path, --text, or stdin.")


def print_text_report(result: dict[str, Any]) -> None:
    status = "PASS" if result["ok"] else "FAIL"
    print(f"{status} score={result['score']:.2f} min={result['min_score']:.2f}")

    if result["detected_video_types"]:
        print("detected_video_types: " + ", ".join(result["detected_video_types"]))
    else:
        print("detected_video_types: none")

    if result["missing"]:
        print("missing:")
        for item in result["missing"]:
            fatal = " fatal" if item in result["missing_fatal"] else ""
            print(f"  - {item['id']} / {item['name']}{fatal}")

    if result["warnings"]:
        print("warnings:")
        for warning in result["warnings"]:
            print(f"  - {warning}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an AI video plan against the local method contract.")
    parser.add_argument("file", nargs="?", help="Markdown or text file to validate.")
    parser.add_argument("--text", help="Validate this text instead of reading a file.")
    parser.add_argument("--min-score", type=float, default=None, help="Override contract minimum score.")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="Report format.")
    args = parser.parse_args()

    contract = load_contract()
    text = read_input(args)
    result = evaluate(text, contract, min_score=args.min_score)

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print_text_report(result)

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
