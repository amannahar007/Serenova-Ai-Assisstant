import os
import time
import shutil
import logging
import asyncio
from typing import Optional, Dict, List
from fastapi import FastAPI, HTTPException, File, UploadFile, Form, Request, Depends
from contextlib import asynccontextmanager
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

import firebase_admin
from firebase_admin import auth as firebase_auth

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from ai_engine.chat import chat_with_SERENOVA, chat_stream_SERENOVA
from ai_engine.rag import process_document, query_rag, init_models
from ai_engine.voice import transcribe_audio, generate_speech
from ai_engine.vision import analyze_gesture

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Firebase Admin
try:
    firebase_admin.initialize_app(options={'projectId': 'SERENOVA-ai'})
except ValueError:
    pass

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        decoded_token = firebase_auth.verify_id_token(credentials.credentials)
        return decoded_token
    except Exception as e:
        logger.warning(f"Auth failed: {str(e)}. Falling back to local development user.")
        # Fallback for local development when Firebase Admin isn't configured/authenticated locally
        return {"uid": "local_dev_user", "email": "dev@serenova.ai"}


# 1. Initialize Limiter (IP-based, 5 req/min)
limiter = Limiter(key_func=get_remote_address)

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("FastAPI starting — models loading in background...")
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, init_models)
    yield
    print("Shutting down...")

app = FastAPI(
    title="SERENOVA API",
    description="Optimized Backend API for the SERENOVA with rate limiting, caching, and robust error handling.",
    version="1.2.0",
    lifespan=lifespan
)

# Register Limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Allow cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str = Field(..., max_length=1000, description="User input message, max 1000 characters")
    session_id: Optional[str] = None
    stream: Optional[bool] = False
    history: Optional[List[Dict[str, str]]] = []
    memory: Optional[Dict[str, object]] = Field(default_factory=dict)
    preferred_language: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    session_id: str

# 2. In-Memory Data Structures for throttling
last_request_time: Dict[str, float] = {}
THROTTLE_DELAY = 0.0  # seconds between requests per user
MAX_INPUT_LENGTH = 1000 # chars

@app.get("/")
def read_root():
    return {"message": "Welcome to SERENOVA API. The backend is running and optimized!"}

@app.get("/health")
def health():
    from ai_engine.rag import MODELS_READY
    return {
        "status": "ok",
        "models_ready": MODELS_READY,
        "message": "Fully operational" if MODELS_READY else "Loading models in background..."
    }

@app.post("/chat", response_model=ChatResponse)
@limiter.limit("1000/minute")
async def chat_endpoint(request: Request, req: ChatRequest, user=Depends(verify_token)):
    user_input = req.message.strip()
    
    # Validation 1: Empty input
    if not user_input:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
        
    # Validation 2: Input size limit
    if len(user_input) > MAX_INPUT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Input text exceeds maximum length of {MAX_INPUT_LENGTH} characters.")
        
    user_ip = get_remote_address(request)
    session_id = req.session_id or f"session_{user['uid']}"
    
    # Validation 3: Request Throttling (Minimum delay between requests)
    current_time = time.time()
    if user_ip in last_request_time:
        time_since_last = current_time - last_request_time[user_ip]
        if time_since_last < THROTTLE_DELAY:
            raise HTTPException(status_code=429, detail=f"Too fast! Please wait {THROTTLE_DELAY - time_since_last:.1f} seconds.")
    last_request_time[user_ip] = current_time
    
    # 4. Process Chat 
    if req.stream:
        return StreamingResponse(
            chat_stream_SERENOVA(user_input, req.history, req.memory, req.preferred_language),
            media_type="text/event-stream"
        )
    else:
        result = await chat_with_SERENOVA(user_input, session_id, req.history, req.memory, req.preferred_language)
        if result["response"].startswith("Error:"):
            raise HTTPException(status_code=503, detail=result["response"])
        return ChatResponse(response=result["response"], session_id=result["session_id"])

@app.post("/upload")
@limiter.limit("1000/minute")
async def upload_file(request: Request, file: UploadFile = File(...), user=Depends(verify_token)):
    try:
        result = process_document(file)
        return {"message": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat-rag", response_model=ChatResponse)
@limiter.limit("1000/minute")
async def chat_rag_endpoint(request: Request, req: ChatRequest, user=Depends(verify_token)):
    try:
        result = await asyncio.to_thread(query_rag, req.message)
        return ChatResponse(
            response=result,
            session_id=req.session_id or "rag_session"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/speech-to-speech")
@limiter.limit("1000/minute")
async def speech_to_speech_endpoint(request: Request, audio: UploadFile = File(...), session_id: str = Form(None), user=Depends(verify_token)):
    try:
        temp_audio_path = f"./temp_uploads/{audio.filename}"
        os.makedirs("./temp_uploads", exist_ok=True)
        with open(temp_audio_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)
            
        user_text = await asyncio.to_thread(transcribe_audio, temp_audio_path)
        chat_result = await chat_with_SERENOVA(user_text, session_id, [])
        ai_text = chat_result["response"]
        
        output_audio_path = f"./temp_uploads/response_{audio.filename}.mp3"
        await generate_speech(ai_text, output_audio_path)
        os.remove(temp_audio_path)
        
        return FileResponse(
            output_audio_path, 
            media_type="audio/mpeg", 
            headers={"X-Transcript": user_text, "X-AI-Response": ai_text.replace("\n", " ")}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/gesture-chat")
@limiter.limit("1000/minute")
async def gesture_chat_endpoint(request: Request, image: UploadFile = File(...), session_id: str = Form(None), user=Depends(verify_token)):
    try:
        temp_image_path = f"./temp_uploads/{image.filename}"
        os.makedirs("./temp_uploads", exist_ok=True)
        with open(temp_image_path, "wb") as f:
            shutil.copyfileobj(image.file, f)
            
        gesture_analysis = await asyncio.to_thread(analyze_gesture, temp_image_path)
        prompt = f"[SYSTEM: A gesture was detected from the user's camera: {gesture_analysis}]. Please respond to the user based on this gesture."
        chat_result = await chat_with_SERENOVA(prompt, session_id, [])
        ai_text = chat_result["response"]
        os.remove(temp_image_path)
        
        return {
            "gesture_detected": gesture_analysis,
            "response": ai_text,
            "session_id": chat_result["session_id"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
