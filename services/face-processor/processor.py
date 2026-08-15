from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import cv2
import numpy as np

PROCESSOR_VERSION = "face-white-2px-v1"
LINE_COLOR = (255, 255, 255)
LINE_THICKNESS = 2


class FaceProcessor:
    def __init__(self, model_dir: Path) -> None:
        prototxt = model_dir / "deploy.prototxt"
        model = model_dir / "res10_300x300_ssd_iter_140000.caffemodel"
        if not prototxt.is_file() or not model.is_file():
            raise RuntimeError("FACE_MODEL_FILES_MISSING")
        self.net = cv2.dnn.readNetFromCaffe(str(prototxt), str(model))

    def detect(self, image: Any) -> list[tuple[int, int, int, int]]:
        height, width = image.shape[:2]
        blob = cv2.dnn.blobFromImage(
            cv2.resize(image, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0)
        )
        self.net.setInput(blob)
        detections = self.net.forward()
        faces: list[tuple[int, int, int, int]] = []
        for index in range(detections.shape[2]):
            if float(detections[0, 0, index, 2]) <= 0.5:
                continue
            raw = detections[0, 0, index, 3:7] * np.array([width, height, width, height])
            x1, y1, x2, y2 = raw.astype("int")
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(width, x2), min(height, y2)
            if x2 - x1 >= 18 and y2 - y1 >= 18:
                faces.append((x1, y1, x2 - x1, y2 - y1))
        return faces

    def process(self, source: bytes) -> tuple[bytes, int, int, int]:
        image = cv2.imdecode(np.frombuffer(source, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("IMAGE_DECODE_FAILED")
        height, width = image.shape[:2]
        overlay = np.zeros_like(image, dtype=np.uint8)
        faces = self.detect(image)
        for x, y, face_width, face_height in faces:
            step = max(12, min(40, int(min(face_width, face_height) / 3)))
            for yy in range(y, y + face_height, step):
                for xx in range(x, x + face_width, step):
                    points = np.array(
                        [[xx, yy + step // 2], [xx + step // 2, yy],
                         [xx + step, yy + step // 2], [xx + step // 2, yy + step]],
                        dtype=np.int32,
                    ).reshape((-1, 1, 2))
                    cv2.polylines(overlay, [points], True, LINE_COLOR, LINE_THICKNESS)
        result = cv2.addWeighted(image, 1, overlay, 0.4, 0)
        encoded, output = cv2.imencode(".jpg", result)
        if not encoded:
            raise RuntimeError("IMAGE_ENCODE_FAILED")
        return output.tobytes(), len(faces), width, height


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()
