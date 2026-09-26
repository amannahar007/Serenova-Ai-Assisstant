"""Encapsulated Conversation and Session Management for SERENOVA AI Assistant.

Provides:
- Native multi-turn history encapsulation with strict Gemini role alternation.
- Graceful conversation-ending intent detection and dynamic farewells.
- Friendly variable welcome greetings with time-of-day awareness.
- Robust multi-layered fallback response generation for API failures and empty responses.
- In-memory session store with synchronization, memory tracking, and TTL cleanup.
"""

from __future__ import annotations

import datetime
import logging
import random
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterable

logger = logging.getLogger(__name__)

# Constants
MAX_HISTORY_TURNS = 50
MAX_MESSAGE_CHARS = 100_000
DEFAULT_SESSION_TTL_SECONDS = 3600 * 24  # 24 hours

FAREWELL_PATTERNS = [
    r"\b(bye|goodbye|bye\s*bye|bbye)\b",
    r"\b(exit|quit|close(\s+chat)?)\b",
    r"\b(see\s+you(\s+later|\s+soon)?|cya|catch\s+you\s+later)\b",
    r"\b(have\s+a\s+(good|great|nice)\s+(day|night|evening|weekend))\b",
    r"\b(talk\s+to\s+you\s+later|ttyl|signing\s+off|i'?m\s+(leaving|done|heading\s+out))\b",
    r"\b(good\s*night|gnight|take\s+care)\b",
    r"\b(alvida|namaste|shubh\s+ratri|phir\s+milenge)\b",
]

FAREWELL_REGEX = re.compile("|".join(f"({p})" for p in FAREWELL_PATTERNS), re.IGNORECASE)


@dataclass
class ChatTurn:
    """A single turn in the conversation."""
    role: str  # "user" or "model"
    content: str
    timestamp: float = field(default_factory=time.time)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_gemini_part(self) -> dict[str, Any]:
        """Convert to Gemini API contents entry."""
        return {
            "role": "model" if self.role in {"assistant", "model"} else "user",
            "parts": [{"text": self.content.strip()}]
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }


class ConversationSession:
    """Encapsulates the state and behavior of a single multi-turn conversation."""

    def __init__(
        self,
        session_id: str | None = None,
        memory: dict[str, Any] | None = None,
        preferred_language: str | None = None,
    ):
        self.session_id: str = session_id or str(uuid.uuid4())
        self.history: list[ChatTurn] = []
        self.memory: dict[str, Any] = memory or {}
        self.preferred_language: str = preferred_language or "auto"
        self.state: str = "active"  # "active", "concluded"
        self.created_at: float = time.time()
        self.updated_at: float = time.time()
        self.turn_count: int = 0

    @property
    def user_name(self) -> str | None:
        name = self.memory.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
        return None

    def touch(self) -> None:
        self.updated_at = time.time()

    def sync_history(self, incoming_history: Iterable[dict[str, Any]] | None) -> None:
        """
        Synchronize history received from clients with internal session state.
        Ensures valid roles and alternating turns without duplicates.
        """
        if not incoming_history:
            return

        cleaned_turns: list[ChatTurn] = []
        for entry in list(incoming_history)[-MAX_HISTORY_TURNS:]:
            if not isinstance(entry, dict):
                continue
            raw_role = entry.get("role", "")
            if raw_role not in {"user", "assistant", "model"}:
                continue
            role = "model" if raw_role in {"assistant", "model"} else "user"
            content = entry.get("content", "")
            if not isinstance(content, str) or not content.strip():
                continue
            content = content.strip()[:MAX_MESSAGE_CHARS]

            # Merge consecutive turns of identical role to keep alternation valid
            if cleaned_turns and cleaned_turns[-1].role == role:
                cleaned_turns[-1].content = f"{cleaned_turns[-1].content}\n\n{content}"
            else:
                cleaned_turns.append(ChatTurn(role=role, content=content))

        # Gemini requires the conversation history to start with a 'user' turn
        while cleaned_turns and cleaned_turns[0].role != "user":
            cleaned_turns.pop(0)

        if cleaned_turns:
            self.history = cleaned_turns
            self.turn_count = len(self.history)
            self.touch()

    def add_turn(self, role: str, content: str, metadata: dict[str, Any] | None = None) -> ChatTurn:
        """Add a turn to history, maintaining alternation and sliding window."""
        normalized_role = "model" if role in {"assistant", "model"} else "user"
        cleaned_content = str(content).strip()[:MAX_MESSAGE_CHARS]
        if not cleaned_content:
            cleaned_content = "[No content]"

        self.touch()
        self.turn_count += 1

        if self.history and self.history[-1].role == normalized_role:
            # Merge if same role
            self.history[-1].content = f"{self.history[-1].content}\n\n{cleaned_content}"
            if metadata:
                self.history[-1].metadata.update(metadata)
            return self.history[-1]

        turn = ChatTurn(role=normalized_role, content=cleaned_content, metadata=metadata or {})
        self.history.append(turn)

        # Apply sliding window
        if len(self.history) > MAX_HISTORY_TURNS:
            self.history = self.history[-MAX_HISTORY_TURNS:]
            while self.history and self.history[0].role != "user":
                self.history.pop(0)

        return turn

    def get_gemini_contents(
        self,
        current_message: str,
        document_context: str | None = None,
        user_sentiment: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Build Gemini-compliant multi-turn contents list.
        Guarantees strict alternating `user` -> `model` -> `user` sequence.
        """
        contents: list[dict[str, Any]] = []

        # 1. Existing valid historical turns
        for turn in self.history:
            contents.append(turn.to_gemini_part())

        # 2. Format current turn with metadata / RAG context if applicable
        sentiment = user_sentiment or self.memory.get("last_mood") or self.memory.get("sentiment") or "Neutral"
        rag_text = document_context.strip()[:12_000] if document_context else ""

        if rag_text or (sentiment and sentiment != "Neutral"):
            formatted_prompt = (
                f"- User Sentiment: {sentiment}\n"
                f"- RAG Context: {rag_text if rag_text else 'None'}\n"
                f"- User Query: {current_message.strip()}"
            )
        else:
            formatted_prompt = current_message.strip()

        # If previous turn in history was 'user', merge or wrap properly
        if contents and contents[-1]["role"] == "user":
            contents[-1]["parts"][0]["text"] += f"\n\n{formatted_prompt}"
        else:
            contents.append({
                "role": "user",
                "parts": [{"text": formatted_prompt}]
            })

        # Ensure starting with user
        while contents and contents[0]["role"] != "user":
            contents.pop(0)

        return contents

    def is_ending_intent(self, message: str) -> bool:
        """Check if user message matches conversation-ending patterns."""
        cleaned = message.strip().lower()
        # Short message check or exact pattern match
        if len(cleaned.split()) <= 8 and FAREWELL_REGEX.search(cleaned):
            return True
        return False

    def get_farewell_response(self) -> str:
        """Return a warm, variable farewell response."""
        self.state = "concluded"
        name_clause = f", {self.user_name}" if self.user_name else ""
        hour = datetime.datetime.now().hour

        farewells = [
            f"Goodbye{name_clause}! It was a pleasure assisting you. Feel free to reach back out anytime you need support. Have a wonderful day!",
            f"Take care{name_clause}! Our conversation has been saved. Whenever you're ready to continue, I'll be right here.",
            f"Signing off for now{name_clause}. Stay productive and have a great time ahead! Let me know if you need anything else later.",
        ]

        if hour >= 21 or hour < 5:
            farewells.append(f"Goodnight{name_clause}! Wishing you restful sleep and a great day tomorrow. Take care!")
        elif hour >= 17:
            farewells.append(f"Have a pleasant evening{name_clause}! Feel free to check in whenever you need assistance.")

        return random.choice(farewells)

    def get_welcome_greeting(self) -> str:
        """Return a friendly, variable greeting based on time of day and user context."""
        hour = datetime.datetime.now().hour
        name_clause = f" {self.user_name}" if self.user_name else ""

        if 5 <= hour < 12:
            time_greeting = f"Good morning{name_clause}!"
        elif 12 <= hour < 17:
            time_greeting = f"Good afternoon{name_clause}!"
        elif 17 <= hour < 22:
            time_greeting = f"Good evening{name_clause}!"
        else:
            time_greeting = f"Hello{name_clause}!"

        intros = [
            f"{time_greeting} I'm SERENOVA, your personal AI assistant. How can I help you today?",
            f"{time_greeting} SERENOVA is online and ready. What are we working on right now?",
            f"{time_greeting} Welcome back. What can I assist you with today?",
            f"{time_greeting} All systems operational. How may I be of service?",
        ]

        return random.choice(intros)

    def get_fallback_response(self, error_context: str | None = None) -> str:
        """
        Generate a safe, high-quality fallback message when Gemini API is unavailable,
        timed out, or returned an empty response.
        """
        name_clause = f" {self.user_name}" if self.user_name else ""
        err_lower = (error_context or "").lower()

        if "429" in err_lower or "busy" in err_lower or "quota" in err_lower:
            return (
                f"I'm experiencing a high volume of requests at this moment{name_clause}. "
                "Your conversation context is safely preserved. Please wait a few seconds and try sending your message again."
            )
        if "timeout" in err_lower or "timed out" in err_lower:
            return (
                f"The request timed out while processing with the AI engine. "
                "Please retry your query or break it down into smaller parts."
            )
        if "safety" in err_lower or "blocked" in err_lower:
            return (
                "I was unable to generate a response for this request due to content safety policies. "
                "Please try rephrasing your question."
            )

        fallbacks = [
            f"I encountered a temporary connection issue while generating a response{name_clause}. Your conversation history is preserved—please try sending your request again in a moment.",
            "I'm currently unable to retrieve a complete response from the neural engine. Please rephrase or try again in a few moments.",
            "A temporary network glitch occurred while reaching the AI provider. Please re-send your message and I'll be happy to assist you.",
        ]
        return random.choice(fallbacks)

    def reset(self) -> None:
        """Reset history and session state while keeping user memory."""
        self.history.clear()
        self.state = "active"
        self.turn_count = 0
        self.touch()


class SessionManager:
    """Manages active conversation sessions with memory caching and lifecycle handling."""

    def __init__(self, ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS):
        self._sessions: dict[str, ConversationSession] = {}
        self.ttl_seconds = ttl_seconds

    def get_or_create_session(
        self,
        session_id: str | None = None,
        memory: dict[str, Any] | None = None,
        preferred_language: str | None = None,
        incoming_history: Iterable[dict[str, Any]] | None = None,
    ) -> ConversationSession:
        """Get an existing session or initialize a new one with synchronized history."""
        self.cleanup_expired()

        sid = session_id.strip() if (session_id and isinstance(session_id, str) and session_id.strip()) else str(uuid.uuid4())
        
        if sid not in self._sessions:
            session = ConversationSession(
                session_id=sid,
                memory=memory,
                preferred_language=preferred_language,
            )
            self._sessions[sid] = session
        else:
            session = self._sessions[sid]
            if memory:
                session.memory.update(memory)
            if preferred_language:
                session.preferred_language = preferred_language

        if incoming_history:
            session.sync_history(incoming_history)

        return session

    def get_session(self, session_id: str) -> ConversationSession | None:
        """Retrieve session by ID if exists."""
        return self._sessions.get(session_id)

    def delete_session(self, session_id: str) -> bool:
        """Remove a session from store."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False

    def cleanup_expired(self) -> int:
        """Purge sessions that have exceeded the TTL."""
        now = time.time()
        expired = [
            sid for sid, s in self._sessions.items()
            if (now - s.updated_at) > self.ttl_seconds
        ]
        for sid in expired:
            del self._sessions[sid]
        if expired:
            logger.info("Cleaned up %d expired chat sessions.", len(expired))
        return len(expired)


# Global singleton session manager
session_manager = SessionManager()
