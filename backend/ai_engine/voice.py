import os
import whisper
import edge_tts
import asyncio

# Load Whisper model globally to ensure fast inference on requests.
# "base" model is a good tradeoff between speed and accuracy for a backend.
print("Loading Whisper model (base)...")
whisper_model = whisper.load_model("base")

def transcribe_audio(file_path: str) -> str:
    """
    Transcribes spoken audio into text using OpenAI Whisper.
    Works across 99 languages automatically.
    """
    result = whisper_model.transcribe(file_path)
    return result["text"]

async def generate_speech(text: str, output_path: str, voice: str = "en-US-AriaNeural"):
    """
    Generates highly natural speech from text using Microsoft Edge TTS.
    Default voice is US English female (Aria).
    """
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)
