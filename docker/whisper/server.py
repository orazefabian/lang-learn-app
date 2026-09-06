"""
Slovene speech recognition for Slovenščina.

A thin HTTP wrapper around faster-whisper. It exists so the app has one stable
contract to code against: when a better Slovene model appears, it replaces this
service and nothing in the application changes.

Endpoints:
  GET  /health      -> {"status": "ok"|"loading", "model": ..., "loaded": bool}
  POST /transcribe  -> {"text": ..., "language": "sl", "duration": ...}
                       body is raw audio bytes (webm, ogg, mp4, wav, ...)

The language is forced to Slovene. Whisper's language detection on a beginner
speaking a low-resource language is unreliable, and a transcript in the wrong
language is worse than a bad one in the right language.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from faster_whisper import WhisperModel

LOG = logging.getLogger("whisper-http")

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "medium")
MODEL_DIR = os.environ.get("WHISPER_MODEL_DIR", "/models")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "sl")
HOST = os.environ.get("WHISPER_HOST", "0.0.0.0")
PORT = int(os.environ.get("WHISPER_PORT", "5001"))
BEAM_SIZE = int(os.environ.get("WHISPER_BEAM_SIZE", "5"))

# A learner repeating a phrase; anything longer is a mistake or an attack.
MAX_UPLOAD_BYTES = int(os.environ.get("WHISPER_MAX_UPLOAD_BYTES", str(12 * 1024 * 1024)))

_model: WhisperModel | None = None
_model_error: str | None = None
_lock = threading.Lock()


def load_model() -> None:
    """
    Loads the model in the background.

    The first start downloads it (medium is roughly 1.5 GB), so the service
    reports "loading" rather than blocking or appearing dead. The app treats
    speech recognition as optional, so a slow start degrades speaking exercises
    to self-assessment instead of breaking the session.
    """
    global _model, _model_error
    try:
        LOG.info("loading whisper model %s (%s, %s)", MODEL_SIZE, DEVICE, COMPUTE_TYPE)
        model = WhisperModel(
            MODEL_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            download_root=MODEL_DIR,
        )
        with _lock:
            _model = model
        LOG.info("model ready")
    except Exception as error:  # noqa: BLE001 - reported through /health
        LOG.exception("model failed to load")
        _model_error = str(error)


def transcribe(audio_path: str) -> dict[str, Any]:
    with _lock:
        model = _model
    if model is None:
        raise RuntimeError(_model_error or "model is still loading")

    segments, info = model.transcribe(
        audio_path,
        language=LANGUAGE,
        beam_size=BEAM_SIZE,
        # Beginners leave long pauses; VAD trims them so they are not
        # transcribed as hallucinated words.
        vad_filter=True,
        condition_on_previous_text=False,
    )

    parts = []
    for segment in segments:
        parts.append(
            {
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": segment.text.strip(),
                # Whisper's own confidence. Reported, never presented to her as
                # a pronunciation score.
                "avg_logprob": round(segment.avg_logprob, 4),
                "no_speech_prob": round(segment.no_speech_prob, 4),
            }
        )

    return {
        "text": " ".join(part["text"] for part in parts).strip(),
        "language": info.language,
        "duration": round(info.duration, 3),
        "segments": parts,
        "model": MODEL_SIZE,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        LOG.info("%s - %s", self.address_string(), fmt % args)

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if not self.path.startswith("/health"):
            self._send_json(404, {"error": "not found"})
            return

        with _lock:
            loaded = _model is not None

        self._send_json(
            200 if loaded else 503,
            {
                "status": "ok" if loaded else "loading",
                "model": MODEL_SIZE,
                "language": LANGUAGE,
                "loaded": loaded,
                **({"error": _model_error} if _model_error else {}),
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/transcribe"):
            self._send_json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send_json(400, {"error": "empty body"})
            return
        if length > MAX_UPLOAD_BYTES:
            self._send_json(413, {"error": "audio too large"})
            return

        audio = self.rfile.read(length)

        suffix = ".webm"
        content_type = (self.headers.get("Content-Type") or "").lower()
        if "ogg" in content_type:
            suffix = ".ogg"
        elif "mp4" in content_type or "m4a" in content_type:
            suffix = ".m4a"
        elif "wav" in content_type:
            suffix = ".wav"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as handle:
            handle.write(audio)
            handle.flush()
            try:
                self._send_json(200, transcribe(handle.name))
            except RuntimeError as error:
                # Still loading, or failed to load: a retryable condition.
                self._send_json(503, {"error": str(error)})
            except Exception as error:  # noqa: BLE001
                LOG.exception("transcription failed")
                self._send_json(500, {"error": str(error)[:500]})


def main() -> None:
    logging.basicConfig(level=os.environ.get("WHISPER_LOG_LEVEL", "INFO"))
    threading.Thread(target=load_model, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    LOG.info("whisper listening on %s:%s (model %s)", HOST, PORT, MODEL_SIZE)
    server.serve_forever()


if __name__ == "__main__":
    main()
