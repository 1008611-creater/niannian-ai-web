#!/usr/bin/env python3
"""Retired production entrypoint.

Qwen3-ASR is deliberately unavailable in the redraw route. Chinese transcript
text must come from Mimo ASR; Qwen3-ForcedAligner-0.6B is invoked by its own
worker only to align the exact Mimo transcript.
"""

import sys


def main():
    print(
        "Qwen3-ASR-1.7B is forbidden in the redraw route; call Mimo ASR and "
        "use qwen3_forced_aligner_worker.py only for timing.",
        file=sys.stderr,
    )
    raise SystemExit(2)


if __name__ == "__main__":
    main()
