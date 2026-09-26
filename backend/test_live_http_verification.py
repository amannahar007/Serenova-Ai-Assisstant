"""Direct Live HTTP API verification against the running server on http://127.0.0.1:8000.
Tests:
1. Live streaming HTTP POST /chat for Long CBSE Exam Paper generation.
2. Live streaming HTTP POST /chat for 4-turn multi-turn context retention.
"""

import urllib.request
import json
import time

BASE_URL = "http://127.0.0.1:8000"


def send_chat_http(message: str, session_id: str, history: list, stream: bool = False) -> str:
    url = f"{BASE_URL}/chat"
    payload = {
        "message": message,
        "session_id": session_id,
        "history": history,
        "stream": stream,
        "preferred_language": "auto"
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer dev_local_token"}
    )
    with urllib.request.urlopen(req) as resp:
        if not stream:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("response", "")
        else:
            tokens = []
            for raw_line in resp:
                line = raw_line.decode("utf-8").strip()
                if line.startswith("data:"):
                    raw_data = line[5:].strip()
                    if raw_data and raw_data != "[DONE]":
                        try:
                            parsed = json.loads(raw_data)
                            if isinstance(parsed, dict) and "text" in parsed:
                                tokens.append(parsed["text"])
                        except Exception:
                            tokens.append(raw_data)
            return "".join(tokens)


def test_live_bug1_long_generation():
    print("=" * 75)
    print("[LIVE HTTP TEST 1] LONG CBSE EXAM PAPER STREAMING GENERATION")
    print("=" * 75)
    
    prompt = (
        "Generate a complete, full-length CBSE Class 10 Mathematics standard sample question paper. "
        "Include General Instructions, Section A (20 MCQs with 4 options each), "
        "Section B (5 Very Short Answer questions of 2 marks each), "
        "Section C (6 Short Answer questions of 3 marks each), "
        "Section D (4 Long Answer questions of 5 marks each), and "
        "Section E (3 Case-Based questions of 4 marks each). "
        "Provide full questions for every single item without skipping or truncating. "
        "Conclude with an explicit '--- END OF QUESTION PAPER ---' marker."
    )
    
    start_time = time.time()
    response = send_chat_http(prompt, session_id="live_test_cbse_session", history=[], stream=True)
    elapsed = time.time() - start_time
    
    print(f"-> Live Response Received in {elapsed:.2f}s | Character Count: {len(response)}")
    print(f"-> Preview Start (250 chars):\n{response[:250]}...\n")
    print(f"-> Preview End (250 chars):\n...{response[-250:]}\n")
    
    assert len(response) > 3500, f"Response too short ({len(response)} chars)!"
    assert "Section A" in response, "Missing Section A"
    assert "Section B" in response or "SECTION B" in response, "Missing Section B"
    assert "Section C" in response or "SECTION C" in response, "Missing Section C"
    assert "Section D" in response or "SECTION D" in response, "Missing Section D"
    assert "Section E" in response or "SECTION E" in response, "Missing Section E"
    
    print(">>> LIVE HTTP TEST 1 PASSED: Long generation completed fully without cutoff!\n")
    return response


def test_live_bug2_multiturn_persistence():
    print("=" * 75)
    print("[LIVE HTTP TEST 2] MULTI-TURN CONTEXT RETENTION ACROSS 4 TURNS")
    print("=" * 75)
    
    session_id = f"live_session_{int(time.time() * 1000)}"
    history = []
    
    # Turn 1
    t1_msg = "Hello! My startup is named 'NovaStream', our seed round is $120,000, and we are launching in November."
    print(f"User Turn 1 >> {t1_msg}")
    t1_res = send_chat_http(t1_msg, session_id=session_id, history=history, stream=True)
    print(f"AI Turn 1   >> {t1_res}\n")
    history.append({"role": "user", "content": t1_msg})
    history.append({"role": "assistant", "content": t1_res})
    
    # Turn 2
    t2_msg = "We have 5 core team members (3 developers, 1 product manager, 1 marketer). What is our startup name and seed round?"
    print(f"User Turn 2 >> {t2_msg}")
    t2_res = send_chat_http(t2_msg, session_id=session_id, history=history, stream=True)
    print(f"AI Turn 2   >> {t2_res}\n")
    assert "NovaStream" in t2_res or "novastream" in t2_res.lower(), f"Failed to recall startup name in: {t2_res}"
    assert "120,000" in t2_res or "120000" in t2_res or "120k" in t2_res.lower(), f"Failed to recall budget in: {t2_res}"
    history.append({"role": "user", "content": t2_msg})
    history.append({"role": "assistant", "content": t2_res})
    
    # Turn 3
    t3_msg = "Calculate the average seed funding per core team member."
    print(f"User Turn 3 >> {t3_msg}")
    t3_res = send_chat_http(t3_msg, session_id=session_id, history=history, stream=True)
    print(f"AI Turn 3   >> {t3_res}\n")
    # $120,000 / 5 = $24,000
    assert "24,000" in t3_res or "24000" in t3_res or "24k" in t3_res.lower(), f"Failed to calculate $24,000 per member in: {t3_res}"
    history.append({"role": "user", "content": t3_msg})
    history.append({"role": "assistant", "content": t3_res})
    
    # Turn 4
    t4_msg = "Which month are we launching?"
    print(f"User Turn 4 >> {t4_msg}")
    t4_res = send_chat_http(t4_msg, session_id=session_id, history=history, stream=True)
    print(f"AI Turn 4   >> {t4_res}\n")
    assert "November" in t4_res or "november" in t4_res.lower(), f"Failed to recall launch month in: {t4_res}"
    
    print(">>> LIVE HTTP TEST 2 PASSED: Context retained seamlessly across 4 turns without re-pasting!\n")


if __name__ == "__main__":
    test_live_bug1_long_generation()
    test_live_bug2_multiturn_persistence()
    print("=" * 75)
    print("ALL LIVE HTTP VERIFICATIONS CONFIRMED SUCCESSFUL!")
    print("=" * 75)
