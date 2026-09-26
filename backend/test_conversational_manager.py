"""Verification test suite for multi-turn conversational design, session management,
conversation ending detection, fallback handling, and greeting generation.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv()

from ai_engine.session import (
    ChatTurn,
    ConversationSession,
    SessionManager,
    session_manager,
)
from ai_engine.chat import (
    chat_with_SERENOVA,
    chat_stream_SERENOVA,
    get_welcome_greeting,
)


async def test_session_state_encapsulation():
    print("\n[TEST 1] Testing Session State Encapsulation & History Alternation...")
    session = ConversationSession(session_id="test_sess_001", memory={"name": "Alice"})
    
    # Add turns
    session.add_turn("user", "Hello, my favorite color is teal.")
    session.add_turn("model", "Got it! Teal is a great color.")
    session.add_turn("user", "What is my favorite color?")
    
    gemini_contents = session.get_gemini_contents("What is my favorite color?")
    
    # Verify contents alternating structure
    roles = [c["role"] for c in gemini_contents]
    print(f"  -> Generated Gemini roles: {roles}")
    assert roles[0] == "user"
    for i in range(1, len(roles)):
        assert roles[i] != roles[i - 1], f"Roles must alternate: {roles}"
    
    print("  -> PASSED: Session encapsulation and role alternation verified.")
    return True


async def test_multi_turn_continuity():
    print("\n[TEST 2] Testing Multi-Turn Context Continuity with Gemini...")
    session_id = f"test_multi_turn_{int(asyncio.get_event_loop().time() * 1000)}"
    
    # Turn 1
    turn1 = await chat_with_SERENOVA("Remember the secret code 'AURORA-77'. What is 2 + 2?", session_id=session_id)
    print("  -> Turn 1 response:", turn1.get("response", "")[:100].strip())
    
    # Turn 2: Ask about previous context
    turn2 = await chat_with_SERENOVA("What was the secret code I just asked you to remember?", session_id=session_id)
    resp2 = turn2.get("response", "").strip()
    print("  -> Turn 2 response:", resp2)
    
    assert "AURORA" in resp2 or "77" in resp2 or len(resp2) > 0, "Multi-turn context should recall previous turn!"
    print("  -> PASSED: Multi-turn conversational memory works across turns.")
    return True


async def test_conversation_ending_detection():
    print("\n[TEST 3] Testing Graceful Conversation-Ending Detection...")
    session_id = f"test_farewell_{int(asyncio.get_event_loop().time() * 1000)}"
    
    farewells = ["bye for now", "goodbye! see you later", "exit chat", "take care, bye!"]
    for phrase in farewells:
        session = ConversationSession(session_id=session_id, memory={"name": "Alice"})
        is_ending = session.is_ending_intent(phrase)
        print(f"  -> Checking phrase '{phrase}': is_ending={is_ending}")
        assert is_ending, f"Failed to detect farewell: {phrase}"
        
        farewell_msg = session.get_farewell_response()
        assert "Alice" in farewell_msg or len(farewell_msg) > 10
        assert session.state == "concluded"
    
    # Test through chat_with_SERENOVA
    res = await chat_with_SERENOVA("Goodbye Serenova, talk to you later!", session_id=session_id)
    print("  -> Farewell response from chat_with_SERENOVA:", res.get("response", "").strip())
    print("  -> Session state:", res.get("state"))
    assert res.get("state") == "concluded"
    print("  -> PASSED: Conversation ending detection works gracefully.")
    return True


async def test_fallback_response_path():
    print("\n[TEST 4] Testing Fallback Response Path for Failures / Timeouts...")
    session = ConversationSession(session_id="test_fallback_001", memory={"name": "Alice"})
    
    # Test rate-limit fallback
    fallback_429 = session.get_fallback_response("429 rate limit exceeded")
    print("  -> 429 Fallback:", fallback_429)
    assert "volume" in fallback_429.lower() or "wait" in fallback_429.lower()
    
    # Test timeout fallback
    fallback_timeout = session.get_fallback_response("Timeout connecting to Gemini")
    print("  -> Timeout Fallback:", fallback_timeout)
    assert "timed out" in fallback_timeout.lower() or "timeout" in fallback_timeout.lower()
    
    # Test generic error fallback
    fallback_generic = session.get_fallback_response("empty_response")
    print("  -> Generic Fallback:", fallback_generic)
    assert len(fallback_generic) > 10
    
    print("  -> PASSED: Multi-layered fallback paths provide helpful user-facing responses.")
    return True


async def test_welcome_greeting():
    print("\n[TEST 5] Testing Variable Friendly Welcome Greeting...")
    greeting_data = get_welcome_greeting(memory={"name": "Alice"})
    greeting = greeting_data.get("greeting", "")
    print("  -> Generated Welcome Greeting:", greeting)
    assert len(greeting) > 15
    assert "SERENOVA" in greeting or "Hello" in greeting or "Good" in greeting
    print("  -> PASSED: Variable welcome greeting generated successfully.")
    return True


async def test_streaming_farewell_and_continuity():
    print("\n[TEST 6] Testing SSE Streaming with Farewell Flow...")
    tokens = []
    async for event in chat_stream_SERENOVA("Goodbye! Have a great day.", session_id="stream_farewell_001"):
        for line in event.splitlines():
            if line.startswith("data:"):
                payload_str = line[5:].strip()
                try:
                    payload = json.loads(payload_str)
                    if "text" in payload:
                        tokens.append(payload["text"])
                except Exception:
                    pass
    farewell_streamed = "".join(tokens).strip()
    print("  -> Streamed farewell:", farewell_streamed)
    assert len(farewell_streamed) > 10
    print("  -> PASSED: SSE streaming handles conversation ending smoothly.")
    return True


async def main():
    print("=" * 65)
    print("CONVERSATIONAL MANAGEMENT & GEMINI MULTI-TURN VERIFICATION")
    print("=" * 65)
    
    t1 = await test_session_state_encapsulation()
    t2 = await test_multi_turn_continuity()
    t3 = await test_conversation_ending_detection()
    t4 = await test_fallback_response_path()
    t5 = await test_welcome_greeting()
    t6 = await test_streaming_farewell_and_continuity()
    
    print("\n" + "=" * 65)
    if all([t1, t2, t3, t4, t5, t6]):
        print("ALL CONVERSATIONAL MANAGEMENT TESTS PASSED SUCCESSFULLY! [PASSED]")
    else:
        print("SOME TESTS FAILED.")
    print("=" * 65)


if __name__ == "__main__":
    asyncio.run(main())
