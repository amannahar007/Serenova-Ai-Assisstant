"""Lazy voice helpers so optional Whisper support never blocks API startup."""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path

_whisper_model = None
_whisper_lock = threading.Lock()


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            try:
                import whisper
            except ImportError as exc:
                raise RuntimeError("Voice transcription is unavailable. Install openai-whisper and FFmpeg.") from exc
            _whisper_model = whisper.load_model("base")
    return _whisper_model


def transcribe_audio(file_path: str) -> str:
    result = _get_whisper_model().transcribe(file_path)
    text = str(result.get("text", "")).strip()
    if not text:
        raise RuntimeError("No speech was detected in this audio.")
    return text


async def generate_speech(text: str, output_path: str, voice: str = "en-US-AriaNeural") -> None:
    try:
        import edge_tts
    except ImportError as exc:
        raise RuntimeError("Speech synthesis is unavailable. Install edge-tts.") from exc
    await edge_tts.Communicate(text[:8_000], voice).save(output_path)
