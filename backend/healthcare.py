"""Non-diagnostic health and wellness response helper."""

from __future__ import annotations

from typing import Any

from ai_engine.chat import generate_response


async def analyze_health(user_msg: str, face_data: dict[str, Any] | None = None) -> str:
    """Offer general wellness guidance based on self-report, never facial diagnosis."""
    expression = (face_data or {}).get("expression", "not available")
    prompt = (
        "The user is asking for wellness support. Use only their own words as evidence. "
        f"A browser expression classifier reported '{expression}', which is noisy and not health data. "
        "Do not infer stress, fatigue, anxiety, depression, heart rate, or any diagnosis from it. "
        "Acknowledge the user's self-report, offer one low-risk practical suggestion, and recommend professional or emergency help when their words indicate urgent risk. "
        f"User message: {user_msg}"
    )
    return await generate_response(prompt)
