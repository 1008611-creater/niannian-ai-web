from __future__ import annotations

import hmac
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from processor import FaceProcessor, PROCESSOR_VERSION, sha256

HOST = os.environ.get("FACE_PROCESSOR_HOST", "127.0.0.1")
PORT = int(os.environ.get("FACE_PROCESSOR_PORT", "9093"))
MAX_BYTES = int(os.environ.get("FACE_PROCESSOR_MAX_BYTES", str(20 * 1024 * 1024)))
MAX_DIMENSION = int(os.environ.get("FACE_PROCESSOR_MAX_DIMENSION", "8192"))
TOKEN_FILE = os.environ.get("FACE_PROCESSOR_TOKEN_FILE", "")
if "FACE_PROCESSOR_TOKEN" in os.environ:
    raise RuntimeError("FACE_PROCESSOR_TOKEN_ENV_FORBIDDEN")
TOKEN = ""
RUNTIME_UID = 10001
RUNTIME_GID = 10001
PRIVATE_NETWORK = os.environ.get("FACE_PROCESSOR_PRIVATE_NETWORK", "false").lower() == "true"
# The processor must be explicitly enabled for a specific authorized work item.
# Health/readiness remain available while it is disabled so deployment can be
# verified without accepting or transforming user material.
PROCESSING_ENABLED = os.environ.get("FACE_PROCESSOR_ENABLED", "false").lower() == "true"
if TOKEN_FILE:
    TOKEN = Path(TOKEN_FILE).read_text(encoding="utf-8").strip()
MODEL_DIR = Path(os.environ.get("FACE_PROCESSOR_MODEL_DIR", Path(__file__).parent / "models"))
PROCESSOR = FaceProcessor(MODEL_DIR)
PROCESS_LOCK = threading.BoundedSemaphore(1)


def drop_privileges_after_secret_bootstrap() -> None:
    """Keep the file-only token in process memory, then serve as non-root."""
    if os.geteuid() != 0:
        raise RuntimeError("FACE_PROCESSOR_BOOTSTRAP_ROOT_REQUIRED")
    os.setgroups([])
    os.setgid(RUNTIME_GID)
    os.setuid(RUNTIME_UID)
    if os.geteuid() == 0 or os.getegid() == 0:
        raise RuntimeError("FACE_PROCESSOR_PRIVILEGE_DROP_FAILED")


def mime_matches(mime: str, source: bytes) -> bool:
    if mime == "image/jpeg":
        return source.startswith(b"\xff\xd8\xff")
    if mime == "image/png":
        return source.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/webp":
        return len(source) >= 12 and source[:4] == b"RIFF" and source[8:12] == b"WEBP"
    return False


class Handler(BaseHTTPRequestHandler):
    server_version = "niannian-face-processor"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_json(self, status: int, value: dict[str, object]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authenticated(self) -> bool:
        supplied = self.headers.get("authorization", "")
        expected = f"Bearer {TOKEN}"
        return len(TOKEN) >= 32 and hmac.compare_digest(supplied, expected)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self.send_json(200, {"ok": True, "version": PROCESSOR_VERSION})
            return
        if self.path == "/readyz":
            self.send_json(200, {"ready": True, "version": PROCESSOR_VERSION})
            return
        self.send_json(404, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path != "/face":
            self.send_json(404, {"error": "NOT_FOUND"})
            return
        if not PROCESSING_ENABLED:
            self.send_json(503, {"error": "PROCESSING_DISABLED"})
            return
        if not self.authenticated():
            self.send_json(401, {"error": "UNAUTHORIZED"})
            return
        mime = self.headers.get("content-type", "").split(";", 1)[0].lower()
        if mime not in {"image/jpeg", "image/png", "image/webp"}:
            self.send_json(415, {"error": "IMAGE_MIME_UNSUPPORTED"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            length = 0
        if length < 1 or length > MAX_BYTES:
            self.send_json(413, {"error": "IMAGE_SIZE_INVALID"})
            return
        source = self.rfile.read(length)
        if not mime_matches(mime, source):
            self.send_json(422, {"error": "IMAGE_MIME_MISMATCH"})
            return
        expected_hash = self.headers.get("x-source-sha256", "").lower()
        if len(source) != length or sha256(source) != expected_hash:
            self.send_json(422, {"error": "SOURCE_HASH_MISMATCH"})
            return
        if not PROCESS_LOCK.acquire(blocking=False):
            self.send_json(429, {"error": "PROCESSOR_BUSY"})
            return
        try:
            output, faces, width, height = PROCESSOR.process(source)
            if width < 1 or height < 1 or width > MAX_DIMENSION or height > MAX_DIMENSION:
                self.send_json(422, {"error": "IMAGE_DIMENSIONS_INVALID"})
                return
            if len(output) < 4 or len(output) > MAX_BYTES or not output.startswith(b"\xff\xd8\xff"):
                self.send_json(422, {"error": "OUTPUT_SIZE_INVALID"})
                return
            output_hash = sha256(output)
            self.send_response(200)
            self.send_header("content-type", "image/jpeg")
            self.send_header("content-length", str(len(output)))
            self.send_header("cache-control", "no-store")
            self.send_header("x-processor-version", PROCESSOR_VERSION)
            self.send_header("x-source-sha256", expected_hash)
            self.send_header("x-output-sha256", output_hash)
            self.send_header("x-faces-detected", str(faces))
            self.send_header("x-image-width", str(width))
            self.send_header("x-image-height", str(height))
            self.end_headers()
            self.wfile.write(output)
        except ValueError as error:
            self.send_json(422, {"error": str(error)})
        except Exception:
            self.send_json(500, {"error": "PROCESSING_FAILED"})
        finally:
            PROCESS_LOCK.release()


if HOST not in {"127.0.0.1", "::1"} and not (HOST == "0.0.0.0" and PRIVATE_NETWORK):
    raise RuntimeError("FACE_PROCESSOR_MUST_BIND_LOOPBACK")
if len(TOKEN) < 32:
    raise RuntimeError("FACE_PROCESSOR_TOKEN_REQUIRED")

drop_privileges_after_secret_bootstrap()
server = ThreadingHTTPServer((HOST, PORT), Handler)
server.daemon_threads = True
server.serve_forever()
