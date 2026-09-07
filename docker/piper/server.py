"""
Slovene text-to-speech for Dober dan.

A thin HTTP wrapper around Piper. It exists for two reasons:

  1. Piper emits WAV, and the app stores Opus (small) with an mp3 fallback
     (compatible). Encoding here keeps ffmpeg out of the Next.js image, which
     is deliberately slim.
  2. It gives the app one stable contract to code against, so a different
     engine can be swapped in without touching application code.

Endpoints:
  GET  /health          -> {"status": "ok", "voice": ...}
  GET  /voices          -> installed voices
  POST /synthesize      -> audio bytes
       {"text": "...", "format": "opus"|"mp3"|"wav", "length_scale": 1.0}
"""

from __future__ import annotations

import io
import json
import logging
import os
import subprocess
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from piper import PiperVoice

LOG = logging.getLogger("piper-http")

VOICE_NAME = os.environ.get("PIPER_VOICE", "sl_SI-artur-medium")
DATA_DIR = os.environ.get("PIPER_DATA_DIR", "/voices")
HOST = os.environ.get("PIPER_HOST", "0.0.0.0")
PORT = int(os.environ.get("PIPER_PORT", "5000"))

# Anything longer is not a phrase a learner repeats; it is a runaway request.
MAX_TEXT_LENGTH = int(os.environ.get("PIPER_MAX_TEXT_LENGTH", "600"))

CONTENT_TYPES = {
    "wav": "audio/wav",
    "opus": "audio/ogg",
    "mp3": "audio/mpeg",
}

_voice: PiperVoice | None = None


def load_voice() -> PiperVoice:
    global _voice
    if _voice is None:
        model = os.path.join(DATA_DIR, f"{VOICE_NAME}.onnx")
        LOG.info("loading voice %s", model)
        _voice = PiperVoice.load(model)
    return _voice


def synthesize_wav(text: str, length_scale: float | None) -> bytes:
    voice = load_voice()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        kwargs: dict[str, Any] = {}
        if length_scale is not None:
            # Piper 1.x takes synthesis options through a config object; the
            # keyword is accepted directly by synthesize_wav in 1.8.
            kwargs["length_scale"] = length_scale
        try:
            voice.synthesize_wav(text, wav_file, **kwargs)
        except TypeError:
            # Older signatures do not accept length_scale; speed is then the
            # player's job, which is where the 0.75x control lives anyway.
            voice.synthesize_wav(text, wav_file)
    return buffer.getvalue()


def encode(wav_bytes: bytes, target: str) -> bytes:
    if target == "wav":
        return wav_bytes

    if target == "opus":
        args = ["-c:a", "libopus", "-b:a", "32k", "-vbr", "on", "-f", "ogg"]
    elif target == "mp3":
        args = ["-c:a", "libmp3lame", "-q:a", "6", "-f", "mp3"]
    else:
        raise ValueError(f"unsupported format {target}")

    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", *args, "pipe:1"],
        input=wav_bytes,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace")[:500])
    return result.stdout


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        LOG.info("%s - %s", self.address_string(), fmt % args)

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/health"):
            self._send_json(200, {"status": "ok", "voice": VOICE_NAME})
        elif self.path.startswith("/voices"):
            names = [
                f[:-5]
                for f in sorted(os.listdir(DATA_DIR))
                if f.endswith(".onnx")
            ]
            self._send_json(200, {"voices": names, "default": VOICE_NAME})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/synthesize"):
            self._send_json(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid JSON body"})
            return

        text = (payload.get("text") or "").strip()
        if not text:
            self._send_json(400, {"error": "text is required"})
            return
        if len(text) > MAX_TEXT_LENGTH:
            self._send_json(413, {"error": f"text longer than {MAX_TEXT_LENGTH} characters"})
            return

        target = (payload.get("format") or "opus").lower()
        if target not in CONTENT_TYPES:
            self._send_json(400, {"error": f"format must be one of {sorted(CONTENT_TYPES)}"})
            return

        length_scale = payload.get("length_scale")
        try:
            audio = encode(synthesize_wav(text, length_scale), target)
        except Exception as error:  # noqa: BLE001 - report, never crash the server
            LOG.exception("synthesis failed")
            self._send_json(500, {"error": str(error)[:500]})
            return

        self._send(200, audio, CONTENT_TYPES[target])


def self_test() -> None:
    """
    Synthesise once at startup.

    Piper phonemises through a bundled espeak-ng, and a mismatched build looks
    for its data at a path baked in at compile time. When that happens the
    process dies on the first real request instead of at boot, which would mean
    a healthy-looking container that fails on her first listening card. Better
    to find out here.
    """
    audio = synthesize_wav("Dober dan.", None)
    if len(audio) < 1024:
        raise RuntimeError("synthesis produced no audio")
    LOG.info("self-test ok (%d bytes of WAV)", len(audio))

    if os.environ.get("PIPER_SKIP_ENCODE_TEST") != "1":
        encoded = encode(audio, "opus")
        LOG.info("opus encoding ok (%d bytes)", len(encoded))


def main() -> None:
    logging.basicConfig(level=os.environ.get("PIPER_LOG_LEVEL", "INFO"))
    load_voice()

    try:
        self_test()
    except Exception:
        LOG.exception(
            "startup self-test failed — the voice loaded but speech could not be produced. "
            "The usual cause is a Piper build whose espeak-ng data path does not match "
            "this image; check the ESPEAK_DATA_PATH and the piper-tts wheel."
        )
        raise SystemExit(1)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    LOG.info("piper listening on %s:%s with voice %s", HOST, PORT, VOICE_NAME)
    server.serve_forever()


if __name__ == "__main__":
    main()
