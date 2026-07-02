import os
import uuid
import json
import logging
import asyncio
import httpx
from typing import List, Dict, AsyncGenerator
from ai_engine.tools import determine_context
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

# Simple cache to store responses
chat_cache: Dict[str, str] = {}

SUPPORTED_LANGUAGES = {
    "auto": "the same language or mix of languages the user uses",
    "hi-IN": "Hindi or natural Hinglish",
    "bn-IN": "Bengali",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
    "mr-IN": "Marathi",
    "en-IN": "Indian English"
}

# Fetch Gemini API key from environment
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

def build_personalization(memory: Dict[str, object] = None, preferred_language: str = None) -> str:
    memory = memory or {}
    language_label = SUPPORTED_LANGUAGES.get(preferred_language or "auto", SUPPORTED_LANGUAGES["auto"])
    safe_memory = {k: v for k, v in memory.items() if v not in (None, "", [], {})}

    return (
        "Personalization rules: "
        f"Respond in {language_label}. If the user mixes Hindi and English, match that Hinglish style. "
        "Use the user's remembered context only when it is relevant, and do not expose the raw memory object. "
        "For health topics, give general wellness guidance and encourage professional medical help for serious symptoms. "
        f"Remembered user context: {json.dumps(safe_memory, ensure_ascii=False)}"
    )

def get_system_prompt(is_simple: bool, memory: Dict[str, object] = None, preferred_language: str = None) -> Dict[str, str]:
    personalization = build_personalization(memory, preferred_language)
    if is_simple:
        return {
            "role": "system",
            "content": (
                "You are SERENOVA. Answer the user's question accurately and as briefly as possible. "
                "Do not include follow-up questions. "
                f"{personalization}"
            )
        }
    return {
        "role": "system", 
        "content": (
            "You are SERENOVA, an elite universal AI Assistant for a worldwide audience of all ages. "
            "You can help across science, technology, education, business, creativity, daily life, culture, and speculative worldbuilding. "
            "1. CHAIN OF VERIFICATION: Before answering complex questions, ensure your logic is verified and accurate. "
            "2. STRICT GROUNDING: If [System Info] real-time context is provided, you MUST base your answer strictly on that context. Do NOT hallucinate data outside the context. If the context contradicts your training, trust the context. "
            "3. TONE: Be professional, highly accurate, and concise. Format your output using markdown tables, bold text, and bullet points where helpful. "
            f"4. MEMORY AND LANGUAGE: {personalization} "
            "5. FOLLOW-UPS: At the absolute end of EVERY response, you MUST generate 3 predictive follow-up questions the user might want to ask next. Format exactly like this:\n\n"
            "**Suggested Follow-ups:**\n"
            "1. [Question 1]?\n"
            "2. [Question 2]?\n"
            "3. [Question 3]?"
        )
    }

async def call_gemini(system_prompt: str, history_messages: List[Dict[str, str]]) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}"
    
    contents = []
    for msg in history_messages:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({
            "role": role,
            "parts": [{"text": msg["content"]}]
        })
        
    payload = {
        "contents": contents
    }
    if system_prompt:
        payload["systemInstruction"] = {
            "parts": [{"text": system_prompt}]
        }
        
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            response = await client.post(url, json=payload)
            if response.status_code == 200:
                data = response.json()
                return data["candidates"][0]["content"]["parts"][0]["text"].strip()
            else:
                return f"Error: Gemini API returned status {response.status_code}. Details: {response.text}"
        except Exception as e:
            return f"Error: Failed to communicate with Gemini API. Details: {str(e)}"

async def stream_call_gemini(system_prompt: str, history_messages: List[Dict[str, str]]) -> AsyncGenerator[str, None]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?key={GEMINI_API_KEY}"
    
    contents = []
    for msg in history_messages:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({
            "role": role,
            "parts": [{"text": msg["content"]}]
        })
        
    payload = {
        "contents": contents
    }
    if system_prompt:
        payload["systemInstruction"] = {
            "parts": [{"text": system_prompt}]
        }
        
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, json=payload) as response:
                if response.status_code == 200:
                    buffer = ""
                    async for chunk in response.aiter_text():
                        buffer += chunk
                        while True:
                            start = buffer.find('{')
                            if start == -1:
                                break
                            
                            brace_count = 0
                            end = -1
                            in_string = False
                            escape = False
                            for i in range(start, len(buffer)):
                                char = buffer[i]
                                if escape:
                                    escape = False
                                    continue
                                if char == '\\':
                                    escape = True
                                    continue
                                if char == '"':
                                    in_string = not in_string
                                    continue
                                if not in_string:
                                    if char == '{':
                                        brace_count += 1
                                    elif char == '}':
                                        brace_count -= 1
                                        if brace_count == 0:
                                            end = i
                                            break
                            
                            if end != -1:
                                obj_str = buffer[start:end+1]
                                buffer = buffer[end+1:]
                                try:
                                    data = json.loads(obj_str)
                                    text_chunk = data["candidates"][0]["content"]["parts"][0]["text"]
                                    if text_chunk:
                                        escaped = json.dumps(text_chunk)
                                        yield f"data: {escaped[1:-1]}\n\n"
                                except Exception:
                                    pass
                            else:
                                break
                    yield "data: [DONE]\n\n"
                else:
                    yield f"data: Error: Gemini API returned status {response.status_code}\n\n"
    except asyncio.CancelledError:
        logger.warning("Gemini stream cancelled by user.")
        raise
    except Exception as e:
        yield f"data: Error connecting to Gemini API: {str(e)}\n\n"

async def call_ollama(messages: List[Dict[str, str]], retries: int = 3) -> str:
    url = "http://localhost:11434/api/chat"
    async with httpx.AsyncClient(timeout=120.0) as client:
        for attempt in range(retries):
            try:
                response = await client.post(url, json={
                    "model": "gemma:2b",
                    "messages": messages,
                    "stream": False
                })
                
                if response.status_code == 200:
                    return response.json().get("message", {}).get("content", "").strip()
                elif response.status_code == 429:
                    wait_time = 2 ** attempt
                    logger.warning(f"Ollama returned 429. Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    response.raise_for_status()
            except httpx.RequestError as e:
                if attempt == retries - 1:
                    return f"Error: Failed to connect to Ollama. Details: {str(e)}"
                wait_time = 2 ** attempt
                logger.warning(f"Connection error. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
                
    return "Error: Too many requests to LLM. Try again later."

async def stream_call_ollama(messages: List[Dict[str, str]]) -> AsyncGenerator[str, None]:
    url = "http://localhost:11434/api/chat"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, json={
                "model": "gemma:2b",
                "messages": messages,
                "stream": True
            }) as response:
                if response.status_code == 200:
                    async for line in response.aiter_lines():
                        if line:
                            data = json.loads(line)
                            chunk = data.get("message", {}).get("content", "")
                            if chunk:
                                escaped = json.dumps(chunk)
                                yield f"data: {escaped[1:-1]}\n\n"
                    yield "data: [DONE]\n\n"
                else:
                    yield f"data: Error {response.status_code}\n\n"
    except asyncio.CancelledError:
        logger.warning("Stream cancelled by user.")
        raise
    except Exception as e:
        yield f"data: Error connecting to model: {str(e)}\n\n"

async def chat_stream_SERENOVA(
    message: str,
    history: List[Dict[str, str]] = None,
    memory: Dict[str, object] = None,
    preferred_language: str = None
) -> AsyncGenerator[str, None]:
    if history is None:
        history = []
        
    import re
    is_simple = bool(re.search(r'\d+\s*[\+\-\*\/\=]\s*\d+', message) or len(message.split()) <= 2)
    system_prompt = get_system_prompt(is_simple, memory, preferred_language)
    
    live_context = determine_context(message)
    augmented_message = message
    if live_context:
        augmented_message = f"{message}\n\n[System Info: I have retrieved the following real-time data for you to use in your answer. Do not mention that you retrieved it, just use it to answer accurately:]\n{live_context}"

    if is_simple:
        messages = [system_prompt, {"role": "user", "content": augmented_message}]
    else:
        messages = [system_prompt] + history + [{"role": "user", "content": augmented_message}]
    
    # Check if Gemini key is available
    global GEMINI_API_KEY
    if not GEMINI_API_KEY:
        GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

    if GEMINI_API_KEY:
        logger.info("Routing stream chat to Google Gemini API")
        history_msgs = []
        for m in messages:
            if m["role"] != "system":
                history_msgs.append(m)
        async for chunk in stream_call_gemini(system_prompt["content"], history_msgs):
            yield chunk
    else:
        logger.info("Routing stream chat to local Ollama (Gemma)")
        async for chunk in stream_call_ollama(messages):
            yield chunk

async def chat_with_SERENOVA(
    message: str,
    session_id: str = None,
    history: List[Dict[str, str]] = None,
    memory: Dict[str, object] = None,
    preferred_language: str = None
) -> dict:
    if not session_id:
        session_id = str(uuid.uuid4())
    if history is None:
        history = []
        
    memory_key = json.dumps(memory or {}, sort_keys=True, ensure_ascii=False)
    cache_key = f"{session_id}_{preferred_language}_{memory_key}_{message.strip()}"
    if cache_key in chat_cache:
        logger.info("Returning cached response")
        return {"session_id": session_id, "response": chat_cache[cache_key]}
    
    import re
    is_simple = bool(re.search(r'\d+\s*[\+\-\*\/\=]\s*\d+', message) or len(message.split()) <= 2)
    system_prompt = get_system_prompt(is_simple, memory, preferred_language)
    
    live_context = determine_context(message)
    augmented_message = message
    if live_context:
        augmented_message = f"{message}\n\n[System Info: I have retrieved the following real-time data for you to use in your answer. Do not mention that you retrieved it, just use it to answer accurately:]\n{live_context}"

    if is_simple:
        messages = [system_prompt, {"role": "user", "content": augmented_message}]
    else:
        messages = [system_prompt] + history + [{"role": "user", "content": augmented_message}]
    
    # Check if Gemini key is available
    global GEMINI_API_KEY
    if not GEMINI_API_KEY:
        GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

    if GEMINI_API_KEY:
        logger.info("Routing chat to Google Gemini API")
        history_msgs = []
        for m in messages:
            if m["role"] != "system":
                history_msgs.append(m)
        response = await call_gemini(system_prompt["content"], history_msgs)
    else:
        logger.info("Routing chat to local Ollama (Gemma)")
        response = await call_ollama(messages)
    
    if not response.startswith("Error:"):
        chat_cache[cache_key] = response
    
    return {"session_id": session_id, "response": response}

