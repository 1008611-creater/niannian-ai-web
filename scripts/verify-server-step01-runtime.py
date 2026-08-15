#!/usr/bin/env python3
"""Secret-free server Step01 runtime verification."""
import os

import cv2
import torch
from qwen_asr import Qwen3ForcedAligner

MODEL = "Qwen/Qwen3-ForcedAligner-0.6B"

assert torch.cuda.is_available() is False, "CPU_ONLY_RUNTIME_REQUIRED"
model = Qwen3ForcedAligner.from_pretrained(MODEL, device_map="cpu", dtype="float32")
assert model is not None
print("STEP01_RUNTIME_MODEL_LOAD_PASS")
print(f"torch={torch.__version__};cv2={cv2.__version__};model={MODEL};device=cpu")
