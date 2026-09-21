"""FastAPI service for the production SERENOVA chat experience."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import firebase_admin
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as firebase_auth
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.background import BackgroundTask

from ai_engine.chat import AssistantError, chat_stream_SERENOVA, chat_with_SERENOVA
from ai_engine.rag import process_document, retrieve_document_context
from ai_engine.vision import analyze_gesture
from ai_engine.voice import generate_speech, transcribe_audio

load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

MAX_INPUT_LENGTH = 4_000
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
TEMP_UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parent / "temp_uploads"))


def _truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes"}


def _init_firebase() -> None:
    if firebase_admin._apps:
        return
    try:
        firebase_admin.initialize_app(options={"projectId": os.getenv("FIREBASE_PROJECT_ID", "serenova-ai")})
    except Exception as exc:
        # Authentication remains closed; a local bypass requires an explicit opt-in below.
        logger.warning("Firebase Admin initialization failed: %s", exc)


_init_firebase()
security = HTTPBearer(auto_error=False)
limiter = Limiter(key_func=get_remote_address)


async def verify_token(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict[str, Any]:
    """Verify every token. Local development must be deliberately opted into."""
    if _truthy("ALLOW_INSECURE_DEV_AUTH") and request.client and request.client.host in LOOPBACK_HOSTS:
        return {"uid": "local_dev_user", "email": "dev@localhost"}

    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in is required.", headers={"WWW-Authenticate": "Bearer"})
    try:
        return firebase_auth.verify_id_token(credentials.credentials, check_revoked=True)
    except Exception as exc:
        logger.info("Rejected Firebase token: %s", type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your sign-in token is invalid or expired.", headers={"WWW-Authenticate": "Bearer"}) from exc


@asynccontextmanager
async def lifespan(_: FastAPI):
    TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="SERENOVA API", version="2.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|model)$")
    content: str = Field(min_length=1, max_length=6_000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_INPUT_LENGTH)
    session_id: str | None = Field(default=None, max_length=128)
    stream: bool = False
    history: list[ChatMessage] = Field(default_factory=list, max_length=32)
    memory: dict[str, Any] = Field(default_factory=dict)
    preferred_language: str | None = Field(default=None, max_length=16)


class ChatResponse(BaseModel):
    response: str
    session_id: str


def _history_payload(history: list[ChatMessage]) -> list[dict[str, str]]:
    return [{"role": item.role, "content": item.content} for item in history]


def _ensure_nonempty(message: str) -> str:
    cleaned = message.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    return cleaned


def _remove_paths(*paths: Path) -> None:
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not remove temporary file %s", path)


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "SERENOVA API is running."}


@app.get("/health")
async def health() -> dict[str, Any]:
    from ai_engine import rag

    return {
        "status": "ok",
        "provider": os.getenv("LLM_PROVIDER", "gemini"),
        "provider_configured": bool(os.getenv("GEMINI_API_KEY")) if os.getenv("LLM_PROVIDER", "gemini") == "gemini" else True,
        "document_models_ready": rag.MODELS_READY,
    }


@app.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat_endpoint(request: Request, req: ChatRequest, _: dict[str, Any] = Depends(verify_token)):
    message = _ensure_nonempty(req.message)
    history = _history_payload(req.history)
    if req.stream:
        return StreamingResponse(
            chat_stream_SERENOVA(message, history, req.memory, req.preferred_language),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )
    try:
        result = await chat_with_SERENOVA(message, req.session_id, history, req.memory, req.preferred_language)
    except AssistantError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return ChatResponse(**result)


@app.post("/upload")
@limiter.limit("10/minute")
async def upload_file(request: Request, file: UploadFile = File(...), user: dict[str, Any] = Depends(verify_token)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Choose a PDF or TXT file to upload.")
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The document is larger than the 10 MB limit.")
    try:
        result = await asyncio.to_thread(process_document, file, user["uid"])
        return {"message": result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        await file.close()


@app.post("/chat-rag", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat_rag_endpoint(request: Request, req: ChatRequest, user: dict[str, Any] = Depends(verify_token)):
    message = _ensure_nonempty(req.message)
    try:
        context = await asyncio.to_thread(retrieve_document_context, message, user["uid"])
        if not context:
            return ChatResponse(response="I couldn't find relevant information in your uploaded documents.", session_id=req.session_id or str(uuid.uuid4()))
        result = await chat_with_SERENOVA(message, req.session_id, _history_payload(req.history), req.memory, req.preferred_language, context)
        return ChatResponse(**result)
    except AssistantError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/speech-to-speech")
@limiter.limit("10/minute")
async def speech_to_speech_endpoint(
    request: Request,
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    session_id: str | None = Form(default=None),
    user: dict[str, Any] = Depends(verify_token),
):
    input_path = TEMP_UPLOAD_DIR / f"{uuid.uuid4()}{Path(audio.filename or '').suffix or '.webm'}"
    output_path = TEMP_UPLOAD_DIR / f"{uuid.uuid4()}.mp3"
    try:
        with input_path.open("wb") as buffer:
            copied = 0
            while chunk := await audio.read(1024 * 1024):
                copied += len(chunk)
                if copied > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Audio is larger than the 10 MB limit.")
                buffer.write(chunk)
        transcript = await asyncio.to_thread(transcribe_audio, str(input_path))
        result = await chat_with_SERENOVA(transcript, session_id)
        await generate_speech(result["response"], str(output_path))
        background_tasks.add_task(_remove_paths, input_path, output_path)
        return FileResponse(
            output_path,
            media_type="audio/mpeg",
            background=background_tasks,
            headers={"X-Transcript": transcript, "X-AI-Response": result["response"].replace("\n", " ")[:2_000]},
        )
    except AssistantError as exc:
        _remove_paths(input_path, output_path)
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except HTTPException:
        _remove_paths(input_path, output_path)
        raise
    except Exception as exc:
        logger.exception("speech-to-speech failed")
        _remove_paths(input_path, output_path)
        raise HTTPException(status_code=503, detail="Voice processing is temporarily unavailable.") from exc
    finally:
        await audio.close()


@app.post("/gesture-chat")
@limiter.limit("10/minute")
async def gesture_chat_endpoint(
    request: Request,
    image: UploadFile = File(...),
    session_id: str | None = Form(default=None),
    _: dict[str, Any] = Depends(verify_token),
):
    image_path = TEMP_UPLOAD_DIR / f"{uuid.uuid4()}{Path(image.filename or '').suffix or '.jpg'}"
    try:
        with image_path.open("wb") as buffer:
            copied = 0
            while chunk := await image.read(1024 * 1024):
                copied += len(chunk)
                if copied > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Image is larger than the 10 MB limit.")
                buffer.write(chunk)
        gesture = await asyncio.to_thread(analyze_gesture, str(image_path))
        result = await chat_with_SERENOVA(f"The camera detected this hand gesture: {gesture}. Respond helpfully and do not infer mental state.", session_id)
        return {"gesture_detected": gesture, "response": result["response"], "session_id": result["session_id"]}
    except AssistantError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("gesture-chat failed")
        raise HTTPException(status_code=503, detail="Gesture analysis is temporarily unavailable.") from exc
    finally:
        _remove_paths(image_path)
        await image.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000)
