"""Reliable chat-provider integration for SERENOVA with native multi-turn sessions."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from collections.abc import AsyncGenerator, Iterable
from dataclasses import dataclass
from typing import Any

import httpx
from dotenv import load_dotenv

from ai_engine.session import (
    ConversationSession,
    session_manager,
)

load_dotenv()
logger = logging.getLogger(__name__)

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_MAX_TOKENS", "8192"))
RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
SUPPORTED_LANGUAGES = {
    "auto": "the same language or language mix the user uses",
    "hi-IN": "Hindi or natural Hinglish",
    "bn-IN": "Bengali",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
    "mr-IN": "Marathi",
    "en-IN": "Indian English",
}


@dataclass
class AssistantError(Exception):
    """A safe, user-facing provider failure."""
    message: str
    status_code: int = 503
    retryable: bool = False


def sse_event(event: str, data: Any) -> str:
    """Return one valid server-sent event. JSON prevents newline corruption."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def normalise_history(history: Iterable[dict[str, Any]] | None) -> list[dict[str, str]]:
    """Legacy helper for backward compatibility; delegates to session normalization."""
    session = ConversationSession()
    session.sync_history(history)
    return [{"role": turn.role, "content": turn.content} for turn in session.history]


def build_system_instruction(
    memory: dict[str, Any] | None = None,
    preferred_language: str | None = None,
    grounded: bool = False,
) -> str:
    """Build high-performance system prompt with identity and behavioral directives."""
    language = SUPPORTED_LANGUAGES.get(preferred_language or "auto", SUPPORTED_LANGUAGES["auto"])
    user_name = (memory or {}).get("name")
    user_intro = f"\nUser Name: {user_name}" if user_name else ""

    return (
        "# SYSTEM PROMPT: SERENOVA / PROFI KNOWLEDGE ENGINE\n\n"
        "## IDENTITY & ROLE\n"
        "You are SERENOVA (v2.0), a high-performance autonomous personal AI assistant. "
        "Your objective is to deliver 100% accurate, precise, and instant responses to user requests.\n\n"
        f"Language Directive: Reply in {language}. Match the user's level of detail.{user_intro}\n\n"
        "## CORE OPERATIONAL RULES\n"
        "1. DIRECT ANSWER FIRST: Always state the core answer or solution in sentence 1. "
        "Never use warm-up phrases like 'Sure!', 'Hello!', 'As an AI language model...', or 'Here is the answer...'.\n"
        "2. TECHNICAL PRECISE DEFINITIONS:\n"
        "   - For Linux/Unix/Programming queries (e.g., `pwd`, `ls`, `git status`), give the exact command definition, usage, and short example immediately in code blocks.\n"
        "   - For basic math/logic, provide the exact calculated result directly.\n"
        "3. RAG CONTEXT INTEGRATION:\n"
        "   - If `RAG Context` is provided in the input prompt, use it as ground-truth user memory.\n"
        "   - If `RAG Context` is empty or missing, rely on core parametric knowledge without mentioning RAG or memory systems.\n"
        "4. EMOTIONAL ADAPTATION:\n"
        "   - Adapt response tone dynamically based on the `User Sentiment` parameter (Neutral, Happy, Frustrated, Sad).\n"
        "5. CONVERSATIONAL CONTINUITY:\n"
        "   - You have access to the multi-turn dialogue history. Maintain seamless continuity across all turns.\n"
        "6. FORMATTING:\n"
        "   - Use clean Markdown styling.\n"
        "   - Use triple backticks (```) for commands and code snippets.\n"
        "   - Use standard bullet points (`-`) for steps or lists."
    )


def build_contents(
    message: str,
    history: Iterable[dict[str, Any]] | None,
    document_context: str | None = None,
    memory: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Build multi-turn contents ensuring strict Gemini role alternation."""
    session = ConversationSession(memory=memory)
    session.sync_history(history)
    return session.get_gemini_contents(
        current_message=message,
        document_context=document_context,
    )


def _provider() -> str:
    return os.getenv("LLM_PROVIDER", "gemini").strip().lower()


def _gemini_configuration() -> tuple[str, str]:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise AssistantError("The assistant is not configured yet. Please ask the administrator to set GEMINI_API_KEY.")
    return key, os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL


def _gemini_payload(system_instruction: str, contents: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "contents": contents,
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
        },
    }


def _error_from_response(status_code: int, body: str) -> AssistantError:
    logger.warning("Gemini request failed: status=%s body=%s", status_code, body[:500])
    if status_code in {401, 403}:
        return AssistantError("The AI provider rejected the server configuration. Please check your API key.")
    if status_code == 429:
        return AssistantError("The assistant is busy. Please wait a moment and try again.", retryable=True)
    if status_code == 400:
        return AssistantError("I could not process that request format. Please rephrase and try again.", status_code=400)
    return AssistantError("The assistant is temporarily unavailable. Please try again shortly.", retryable=True)


async def _post_with_retries(url: str, headers: dict[str, str], payload: dict[str, Any]) -> httpx.Response:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
                response = await client.post(url, headers=headers, json=payload)
            if response.status_code not in RETRYABLE_STATUS_CODES or attempt == 2:
                return response
            await asyncio.sleep(0.5 * (2**attempt))
        except httpx.RequestError as exc:
            last_error = exc
            if attempt == 2:
                break
            await asyncio.sleep(0.5 * (2**attempt))
    logger.warning("Gemini connection failed after retries: %s", last_error)
    raise AssistantError("The assistant is temporarily unavailable. Please try again shortly.", retryable=True)


def _extract_text_and_finish_reason(payload: dict[str, Any]) -> tuple[str, str | None]:
    candidates = payload.get("candidates") or []
    if not candidates:
        return "", None
    candidate = candidates[0]
    finish_reason = candidate.get("finishReason")
    parts = candidate.get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict))
    return text, finish_reason


def _extract_text(payload: dict[str, Any]) -> str:
    text, _ = _extract_text_and_finish_reason(payload)
    return text


async def call_gemini(system_instruction: str, contents: list[dict[str, Any]]) -> str:
    key, model = _gemini_configuration()
    current_contents = list(contents)
    accumulated_text = ""
    max_continuations = 3

    for iteration in range(max_continuations + 1):
        response = await _post_with_retries(
            f"{GEMINI_API_BASE}/models/{model}:generateContent",
            {"x-goog-api-key": key, "content-type": "application/json"},
            _gemini_payload(system_instruction, current_contents),
        )
        if response.status_code != 200:
            raise _error_from_response(response.status_code, response.text)
        try:
            resp_json = response.json()
            chunk_text, finish_reason = _extract_text_and_finish_reason(resp_json)
        except (ValueError, TypeError) as exc:
            logger.warning("Gemini returned malformed JSON: %s", exc)
            chunk_text, finish_reason = "", "MALFORMED_JSON"

        accumulated_text += chunk_text
        logger.info(
            "Gemini response iteration=%d: chunk_len=%d total_len=%d finish_reason=%s",
            iteration,
            len(chunk_text),
            len(accumulated_text),
            finish_reason,
        )

        if finish_reason == "RECITATION" and not accumulated_text.strip():
            logger.info("Recitation detected; re-attempting with original synthesis directive...")
            retry_contents = list(contents)
            if retry_contents and isinstance(retry_contents[-1], dict) and "parts" in retry_contents[-1]:
                orig_text = retry_contents[-1]["parts"][0].get("text", "")
                retry_contents[-1] = {"role": "user", "parts": [{"text": orig_text + "\n(Provide original explanations and custom code examples in your own words.)"}]}
                resp2 = await _post_with_retries(
                    f"{GEMINI_API_BASE}/models/{model}:generateContent",
                    {"x-goog-api-key": key, "content-type": "application/json"},
                    _gemini_payload(system_instruction, retry_contents),
                )
                if resp2.status_code == 200:
                    c_text, f_reason = _extract_text_and_finish_reason(resp2.json())
                    if c_text:
                        accumulated_text = c_text
                        break

        if finish_reason != "MAX_TOKENS" or iteration == max_continuations:
            break

        # Continuation turn if truncated by MAX_TOKENS
        logger.info("MAX_TOKENS reached; issuing automatic continuation turn...")
        current_contents = list(current_contents) + [
            {"role": "model", "parts": [{"text": chunk_text}]},
            {
                "role": "user",
                "parts": [{"text": "Continue immediately and seamlessly from the exact word/sentence where you stopped. Do not repeat previous text."}],
            },
        ]

    if not accumulated_text.strip():
        raise AssistantError("I could not generate a response for that. Please rephrase and try again.", status_code=422)
    return accumulated_text.strip()


async def call_ollama(system_instruction: str, contents: list[dict[str, Any]]) -> str:
    """Explicit local-provider mode; it is never a silent Gemini fallback."""
    messages = [{"role": "system", "content": system_instruction}]
    for item in contents:
        parts_text = " ".join(p.get("text", "") for p in item.get("parts", []) if isinstance(p, dict))
        messages.append({"role": item["role"], "content": parts_text})
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=5.0)) as client:
            response = await client.post(
                os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat"),
                json={"model": os.getenv("OLLAMA_MODEL", "gemma3:4b"), "messages": messages, "stream": False},
            )
    except httpx.RequestError as exc:
        logger.warning("Ollama connection failed: %s", exc)
        raise AssistantError("The local assistant is not running. Start Ollama or configure Gemini.") from exc
    if response.status_code != 200:
        logger.warning("Ollama request failed: status=%s", response.status_code)
        raise AssistantError("The local assistant is temporarily unavailable.")
    text = response.json().get("message", {}).get("content", "").strip()
    if not text:
        raise AssistantError("The local assistant returned an empty response. Please try again.")
    return text


async def generate_response(
    message: str,
    history: Iterable[dict[str, Any]] | None = None,
    memory: dict[str, Any] | None = None,
    preferred_language: str | None = None,
    document_context: str | None = None,
    session_id: str | None = None,
) -> str:
    """
    Generate response with conversation management:
    - Multi-turn state encapsulation
    - Conversation-ending detection
    - Graceful fallback on API failure or empty output
    """
    session = session_manager.get_or_create_session(
        session_id=session_id,
        memory=memory,
        preferred_language=preferred_language,
        incoming_history=history,
    )

    # 1. Conversation Ending Detection ("bye", "exit", "quit", etc.)
    if session.is_ending_intent(message):
        farewell = session.get_farewell_response()
        session.add_turn("user", message)
        session.add_turn("model", farewell)
        return farewell

    # 2. Check for long-output risk or structural/quantitative constraints
    from ai_engine.structured_planner import analyze_prompt, generate_chunked_document
    analysis = analyze_prompt(message)

    if analysis.is_long_output_risk:
        logger.info("Structured Planner active (long-output / constraints): %s", analysis.reasons)
        instruction = build_system_instruction(session.memory, preferred_language, bool(document_context))

        async def llm_caller(sys_prompt: str, cnts: list[dict[str, Any]]) -> str:
            if _provider() == "gemini":
                return await call_gemini(sys_prompt, cnts)
            return await call_ollama(sys_prompt, cnts)

        doc, val_logs = await generate_chunked_document(
            prompt=message,
            analysis=analysis,
            call_llm_fn=llm_caller,
            system_instruction=instruction,
        )
        session.add_turn("user", message)
        session.add_turn("model", doc)
        return doc

    # 3. Standard Multi-turn payload construction (for fast single-pass generation)
    contents = session.get_gemini_contents(
        current_message=message,
        document_context=document_context,
    )
    instruction = build_system_instruction(session.memory, preferred_language, bool(document_context))

    # 3. Model Generation with Fallback Path
    response_text = ""
    try:
        if _provider() == "gemini":
            response_text = await call_gemini(instruction, contents)
        elif _provider() == "ollama":
            response_text = await call_ollama(instruction, contents)
        else:
            logger.error("Unsupported LLM_PROVIDER=%r", _provider())
            response_text = session.get_fallback_response("Provider configuration error")
    except AssistantError as exc:
        logger.warning("Assistant error encountered: %s", exc.message)
        response_text = session.get_fallback_response(exc.message)
    except Exception as exc:
        logger.exception("Unexpected error during response generation: %s", exc)
        response_text = session.get_fallback_response(str(exc))

    if not response_text:
        response_text = session.get_fallback_response("empty_response")

    # Record completed turn in session
    session.add_turn("user", message)
    session.add_turn("model", response_text)

    return response_text


async def _iter_gemini_sse(response: httpx.Response) -> AsyncGenerator[dict[str, Any], None]:
    data_lines: list[str] = []
    async for line in response.aiter_lines():
        if not line:
            if data_lines:
                raw, data_lines = "\n".join(data_lines), []
                try:
                    yield json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("Ignoring malformed Gemini SSE payload")
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    if data_lines:
        try:
            yield json.loads("\n".join(data_lines))
        except json.JSONDecodeError:
            logger.warning("Ignoring malformed trailing Gemini SSE payload")


async def _stream_gemini(system_instruction: str, contents: list[dict[str, Any]]) -> AsyncGenerator[str, None]:
    key, model = _gemini_configuration()
    url = f"{GEMINI_API_BASE}/models/{model}:streamGenerateContent?alt=sse"
    current_contents = list(contents)
    max_continuations = 3
    emitted_any = False

    for iteration in range(max_continuations + 1):
        last_finish_reason: str | None = None
        iteration_text = ""
        attempt_success = False

        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
                    async with client.stream(
                        "POST",
                        url,
                        headers={"x-goog-api-key": key, "content-type": "application/json"},
                        json=_gemini_payload(system_instruction, current_contents),
                    ) as response:
                        if response.status_code != 200:
                            if response.status_code in RETRYABLE_STATUS_CODES and attempt < 2:
                                await response.aread()
                                await asyncio.sleep(0.5 * (2**attempt))
                                continue
                            raise _error_from_response(response.status_code, (await response.aread()).decode("utf-8", "replace"))

                        async for event in _iter_gemini_sse(response):
                            text, f_reason = _extract_text_and_finish_reason(event)
                            if f_reason:
                                last_finish_reason = f_reason
                            if text:
                                emitted_any = True
                                iteration_text += text
                                yield sse_event("token", {"text": text})
                        attempt_success = True
                        break
            except httpx.RequestError as exc:
                logger.warning("Gemini streaming connection error (iteration %d attempt %d): %s", iteration, attempt, exc)
                if attempt < 2:
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                if not emitted_any:
                    raise AssistantError("The assistant is temporarily unavailable. Please try again shortly.", retryable=True) from exc
                return

        if not attempt_success and not emitted_any:
            raise AssistantError("The assistant is temporarily unavailable. Please try again shortly.", retryable=True)

        logger.info(
            "Stream iteration=%d complete: chunk_len=%d finish_reason=%s",
            iteration,
            len(iteration_text),
            last_finish_reason,
        )

        if last_finish_reason != "MAX_TOKENS" or iteration == max_continuations:
            break

        # Append continuation turn
        logger.info("Stream hit MAX_TOKENS limit; streaming auto-continuation...")
        current_contents = list(current_contents) + [
            {"role": "model", "parts": [{"text": iteration_text}]},
            {
                "role": "user",
                "parts": [{"text": "Continue immediately and seamlessly from the exact word/sentence where you stopped. Do not repeat previous text."}],
            },
        ]

    if not emitted_any:
        raise AssistantError("I could not generate a response for that. Please rephrase and try again.", status_code=422)

    yield sse_event("done", {"finished": True})


async def _stream_ollama(system_instruction: str, contents: list[dict[str, Any]]) -> AsyncGenerator[str, None]:
    yield sse_event("token", {"text": await call_ollama(system_instruction, contents)})
    yield sse_event("done", {"finished": True})


async def chat_stream_SERENOVA(
    message: str,
    history: Iterable[dict[str, Any]] | None = None,
    memory: dict[str, Any] | None = None,
    preferred_language: str | None = None,
    document_context: str | None = None,
    session_id: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream valid SSE token/done events with conversation ending and fallback handling."""
    session = session_manager.get_or_create_session(
        session_id=session_id,
        memory=memory,
        preferred_language=preferred_language,
        incoming_history=history,
    )

    try:
        # 1. Graceful Conversation-Ending Check
        if session.is_ending_intent(message):
            farewell = session.get_farewell_response()
            session.add_turn("user", message)
            session.add_turn("model", farewell)
            # Stream words with smooth cadence
            words = farewell.split(" ")
            for i, word in enumerate(words):
                chunk = word + (" " if i < len(words) - 1 else "")
                yield sse_event("token", {"text": chunk})
                await asyncio.sleep(0.015)
            yield sse_event("done", {"finished": True})
            return

        # 2. Check for long-output risk or structural/quantitative constraints
        from ai_engine.structured_planner import analyze_prompt, generate_chunked_document
        analysis = analyze_prompt(message)

        if analysis.is_long_output_risk:
            logger.info("Structured Planner active for streaming: %s", analysis.reasons)
            instruction = build_system_instruction(session.memory, preferred_language, bool(document_context))

            async def llm_caller(sys_prompt: str, cnts: list[dict[str, Any]]) -> str:
                if _provider() == "gemini":
                    return await call_gemini(sys_prompt, cnts)
                return await call_ollama(sys_prompt, cnts)

            queue: asyncio.Queue[str | None] = asyncio.Queue()

            async def on_progress(chunk: str):
                await queue.put(chunk)

            async def runner():
                try:
                    res, val_logs = await generate_chunked_document(
                        prompt=message,
                        analysis=analysis,
                        call_llm_fn=llm_caller,
                        system_instruction=instruction,
                        progress_callback=on_progress,
                    )
                    await queue.put(None)
                    return res
                except Exception as exc:
                    logger.exception("Structured generator streaming failed: %s", exc)
                    await queue.put(None)
                    raise

            runner_task = asyncio.create_task(runner())

            while True:
                item = await queue.get()
                if item is None:
                    break
                words = item.split(" ")
                for i, w in enumerate(words):
                    tok = w + (" " if i < len(words) - 1 else "")
                    yield sse_event("token", {"text": tok})
                    await asyncio.sleep(0.005)

            final_doc = await runner_task
            session.add_turn("user", message)
            session.add_turn("model", final_doc)
            yield sse_event("done", {"finished": True})
            return

        # 3. Native Multi-Turn Contents (for fast single-pass streaming)
        contents = session.get_gemini_contents(
            current_message=message,
            document_context=document_context,
        )
        instruction = build_system_instruction(session.memory, preferred_language, bool(document_context))

        # 3. Model Stream Execution
        stream = _stream_gemini(instruction, contents) if _provider() == "gemini" else _stream_ollama(instruction, contents) if _provider() == "ollama" else None
        if stream is None:
            raise AssistantError("The assistant provider is configured incorrectly. Please contact support.")

        emitted_any = False
        full_streamed_text: list[str] = []

        async for event in stream:
            yield event
            if "event: token" in event:
                emitted_any = True
                try:
                    # extract token text for session recording
                    for line in event.splitlines():
                        if line.startswith("data:"):
                            parsed = json.loads(line[5:].strip())
                            if "text" in parsed:
                                full_streamed_text.append(parsed["text"])
                except Exception:
                    pass

        # Update session history upon successful stream
        full_reply = "".join(full_streamed_text).strip()
        if full_reply:
            session.add_turn("user", message)
            session.add_turn("model", full_reply)

    except asyncio.CancelledError:
        logger.info("Chat stream cancelled by client")
        raise
    except Exception as exc:
        logger.warning("Chat stream error encountered, engaging fallback path: %s", exc)
        fallback = session.get_fallback_response(str(exc))
        session.add_turn("user", message)
        session.add_turn("model", fallback)

        # Stream fallback gracefully so the UI is never left with an empty or broken bubble
        words = fallback.split(" ")
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            yield sse_event("token", {"text": chunk})
            await asyncio.sleep(0.01)
        yield sse_event("done", {"finished": True})


async def chat_with_SERENOVA(
    message: str,
    session_id: str | None = None,
    history: Iterable[dict[str, Any]] | None = None,
    memory: dict[str, Any] | None = None,
    preferred_language: str | None = None,
    document_context: str | None = None,
) -> dict[str, Any]:
    """Execute multi-turn chat with SERENOVA returning response payload with session state."""
    sid = session_id or str(uuid.uuid4())
    session = session_manager.get_or_create_session(
        session_id=sid,
        memory=memory,
        preferred_language=preferred_language,
        incoming_history=history,
    )
    response = await generate_response(
        message=message,
        history=history,
        memory=memory,
        preferred_language=preferred_language,
        document_context=document_context,
        session_id=sid,
    )
    return {
        "session_id": sid,
        "response": response,
        "state": session.state,
        "turn_count": session.turn_count,
    }


def get_welcome_greeting(
    session_id: str | None = None,
    memory: dict[str, Any] | None = None,
    preferred_language: str | None = None,
) -> dict[str, Any]:
    """Provide a friendly, variable greeting for a new or refreshed chat session."""
    session = session_manager.get_or_create_session(
        session_id=session_id,
        memory=memory,
        preferred_language=preferred_language,
    )
    greeting = session.get_welcome_greeting()
    return {
        "session_id": session.session_id,
        "greeting": greeting,
        "state": session.state,
    }
