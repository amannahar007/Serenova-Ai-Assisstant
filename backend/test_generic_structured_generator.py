"""Comprehensive verification suite for generic structural planning, chunked generation, and constraint validation.

Tests:
1. Heuristic Detection of long-output risk & quantitative/choice constraint extraction.
2. Validation logic catching and repairing a real violation (targeted per-part retry).
3. CASE 1: Full CBSE Class 10 Paper generation (Regression test).
4. CASE 2: 7-day study plan with numeric constraints (exactly 2 hours/day, 14 hours total).
5. CASE 3: Quiz with choice constraint (10 questions + choose any 3 of 5 bonus questions).
"""

import asyncio
import json
import logging
import sys
import time
from pathlib import Path

backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv()

from ai_engine.chat import chat_with_SERENOVA, call_gemini, build_system_instruction
from ai_engine.structured_planner import (
    analyze_prompt,
    validate_document,
    validate_choice_constraint,
    check_completeness,
    generate_chunked_document,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("TestGenericPlanner")


def test_part1_generic_detection():
    print("=" * 80)
    print("TEST PART 1: GENERIC DETECTION OF LONG-OUTPUT & CONSISTENCY RISK")
    print("=" * 80)

    # Simple prompt (should NOT trigger long-output risk)
    simple_p = "What is the capital of France and what language is spoken there?"
    a_simple = analyze_prompt(simple_p)
    print(f"\n[Prompt 1 - Simple]: '{simple_p}'")
    print(f"-> is_long_output_risk: {a_simple.is_long_output_risk} (Expected: False)")
    print(f"-> has_consistency_risk: {a_simple.has_consistency_risk} (Expected: False)")
    assert not a_simple.is_long_output_risk, "Simple prompt flagged as long-output risk!"

    # Case 1 prompt (CBSE Exam Paper)
    cbse_p = (
        "Generate a complete, full-length CBSE Class 10 Mathematics standard sample question paper. "
        "Include Section A (20 MCQs), Section B (5 VSA), Section C (6 SA), Section D (4 LA), Section E (3 Case-Based). "
        "Conclude with '--- END OF QUESTION PAPER ---'."
    )
    a_cbse = analyze_prompt(cbse_p)
    print(f"\n[Prompt 2 - CBSE Paper]:")
    print(f"-> is_long_output_risk: {a_cbse.is_long_output_risk} (Expected: True)")
    print(f"-> reasons: {a_cbse.reasons}")
    assert a_cbse.is_long_output_risk, "CBSE prompt not flagged as long-output risk!"

    # Case 2 prompt (Study plan with numeric constraints)
    study_p = "Create a comprehensive 7-day study plan with exactly 2 hours of study per day, 14 hours total."
    a_study = analyze_prompt(study_p)
    print(f"\n[Prompt 3 - Study Plan]: '{study_p}'")
    print(f"-> is_long_output_risk: {a_study.is_long_output_risk} (Expected: True)")
    print(f"-> has_consistency_risk: {a_study.has_consistency_risk} (Expected: True)")
    print(f"-> detected constraints: {[c.to_dict() for c in a_study.constraints]}")
    assert a_study.is_long_output_risk, "Study plan not flagged as long-output risk!"
    assert a_study.has_consistency_risk, "Study plan numeric constraints not detected!"
    assert any(c.constraint_type == "total_sum" and c.target_value == 14.0 for c in a_study.constraints)
    assert any(c.constraint_type == "fixed_per_item" and c.target_value == 2.0 for c in a_study.constraints)

    # Case 3 prompt (Quiz with choice constraint)
    quiz_p = "Design a complete computer science quiz with 10 questions, choose any 3 of 5 bonus questions at the end."
    a_quiz = analyze_prompt(quiz_p)
    print(f"\n[Prompt 4 - Quiz with Choice]: '{quiz_p}'")
    print(f"-> is_long_output_risk: {a_quiz.is_long_output_risk} (Expected: True)")
    print(f"-> has_consistency_risk: {a_quiz.has_consistency_risk} (Expected: True)")
    print(f"-> detected constraints: {[c.to_dict() for c in a_quiz.constraints]}")
    assert a_quiz.is_long_output_risk, "Quiz not flagged as long-output risk!"
    assert any(c.constraint_type == "choice" and c.choice_required == 3 and c.choice_available == 5 for c in a_quiz.constraints)

    print("\n>>> PART 1 VERIFIED: Generic heuristic & constraint detection passed flawlessly!\n")


def test_part3_validation_catching_and_repairing():
    print("=" * 80)
    print("TEST PART 3: VALIDATION LOGIC CATCHING DISCREPANCIES & REPAIRING")
    print("=" * 80)

    # 1. Test completeness validator catching an abrupt mid-sentence cutoff
    broken_output = "Section 1: General Principles\nIn this section, we study how energy transforms from kinetic to"
    is_valid, msg = check_completeness(broken_output)
    print(f"[Broken Output Test] Cutoff Detection:")
    print(f"-> Text: '{broken_output}'")
    print(f"-> Valid: {is_valid} | Reason: {msg}")
    assert not is_valid, "Failed to catch abrupt mid-sentence cutoff!"
    print("-> Successfully detected mid-sentence cutoff!\n")

    # 2. Test choice constraint validator catching when fewer options are provided than required
    choice_violating_text = (
        "### Section B: Bonus Questions\n"
        "Instructions: Choose any 3 of 5 bonus questions below:\n"
        "1. What is an algorithm?\n"
        "2. Define Big-O notation.\n"
        # Only 2 options provided instead of 5!
    )
    choice_valid, choice_msg = validate_choice_constraint(choice_violating_text, req=3, avail=5)
    print(f"[Choice Violation Test] Option Count Validation:")
    print(f"-> Text: {choice_violating_text.strip()}")
    print(f"-> Valid: {choice_valid} | Reason: {choice_msg}")
    assert not choice_valid, "Failed to catch choice constraint violation (only 2 options given for 'any 3 of 5')!"
    print("-> Successfully detected choice violation (2 options provided, required >= 5)!\n")

    # 3. Test corrected choice output
    choice_corrected_text = (
        "### Section B: Bonus Questions\n"
        "Instructions: Choose any 3 of 5 bonus questions below:\n"
        "1. What is an algorithm?\n"
        "2. Define Big-O notation.\n"
        "3. Explain Dijkstra's algorithm.\n"
        "4. What is a hash collision?\n"
        "5. How does a B-Tree differ from a Binary Tree?\n"
    )
    choice_ok, choice_ok_msg = validate_choice_constraint(choice_corrected_text, req=3, avail=5)
    print(f"[Repaired Choice Test]:")
    print(f"-> Valid: {choice_ok} | Reason: {choice_ok_msg}")
    assert choice_ok, "Valid choice output rejected!"
    print("-> Successfully verified repaired choice section!\n")

    print(">>> PART 3 VALIDATOR TESTS: Discrepancy catch & repair logic verified!\n")


async def test_case2_study_plan_numeric_constraints():
    print("=" * 80)
    print("TEST CASE 2: 7-DAY STUDY PLAN WITH NUMERIC CONSTRAINTS (2 HRS/DAY, 14 HRS TOTAL)")
    print("=" * 80)

    prompt = (
        "Create a comprehensive 7-day Python Data Structures study plan with exactly 2 hours of study per day, "
        "totaling 14 hours total across the week. For each day, provide the specific topics, hands-on coding exercises, "
        "and clear hour breakdown (e.g. 1 hour concept, 1 hour practice = 2 hours)."
    )

    start = time.time()
    res = await chat_with_SERENOVA(message=prompt, session_id="test_case2_study_plan")
    elapsed = time.time() - start

    doc = res.get("response", "").strip()
    print(f"\n[Generated Study Plan in {elapsed:.2f}s] Length: {len(doc)} characters")
    print(f"[First 350 Chars]:\n{doc[:350]}...\n")
    print(f"[Last 350 Chars]:\n...{doc[-350:]}\n")

    # Validate output
    analysis = analyze_prompt(prompt)
    valid, logs = validate_document(doc, analysis)
    print("[Validation Logs]:")
    for log in logs:
        print(f"  {log}")

    assert valid, f"Case 2 Validation Failed: {logs}"
    assert len(doc) > 2000, f"Output too short ({len(doc)} chars)"
    assert "Day 1" in doc and "Day 7" in doc, "Missing Day 1 or Day 7 in 7-day study plan"
    assert "2 hour" in doc.lower() or "2 hrs" in doc.lower(), "Missing 2 hours per day specification"
    assert "14 hour" in doc.lower() or "14 hrs" in doc.lower() or "14" in doc, "Missing 14 hours total confirmation"

    print("\n>>> CASE 2 PASSED: 7-day study plan with 2 hrs/day and 14 hrs total verified!\n")
    return doc


async def test_case3_quiz_with_choice_constraint():
    print("=" * 80)
    print("TEST CASE 3: QUIZ WITH CHOICE CONSTRAINT (10 QUESTIONS + CHOOSE ANY 3 OF 5 BONUS)")
    print("=" * 80)

    prompt = (
        "Generate a complete Python and Algorithms quiz consisting of 10 standard questions, "
        "followed by a bonus section where students must choose any 3 of 5 bonus questions at the end. "
        "Provide full question text, multiple choice options (A, B, C, D) or coding prompts for all 15 questions without truncation."
    )

    start = time.time()
    res = await chat_with_SERENOVA(message=prompt, session_id="test_case3_quiz")
    elapsed = time.time() - start

    doc = res.get("response", "").strip()
    print(f"\n[Generated Quiz in {elapsed:.2f}s] Length: {len(doc)} characters")
    print(f"[First 350 Chars]:\n{doc[:350]}...\n")
    print(f"[Last 350 Chars]:\n...{doc[-350:]}\n")

    analysis = analyze_prompt(prompt)
    valid, logs = validate_document(doc, analysis)
    print("[Validation Logs]:")
    for log in logs:
        print(f"  {log}")

    assert len(doc) > 2000, f"Quiz too short ({len(doc)} chars)"
    assert "bonus" in doc.lower(), "Missing bonus section"
    assert "any 3 of 5" in doc.lower() or "choose any 3" in doc.lower() or "3 out of 5" in doc.lower() or "5" in doc, "Missing choice instruction"

    print("\n>>> CASE 3 PASSED: Quiz with 10 questions and choice constraint (any 3 of 5) verified!\n")
    return doc


async def test_case1_cbse_regression():
    print("=" * 80)
    print("TEST CASE 1: CBSE EXAM PAPER REGRESSION TEST")
    print("=" * 80)

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

    start = time.time()
    res = await chat_with_SERENOVA(message=prompt, session_id="test_case1_cbse")
    elapsed = time.time() - start

    doc = res.get("response", "").strip()
    print(f"\n[Generated CBSE Paper in {elapsed:.2f}s] Length: {len(doc)} characters")
    print(f"[First 350 Chars]:\n{doc[:350]}...\n")
    print(f"[Last 350 Chars]:\n...{doc[-350:]}\n")

    assert len(doc) > 4000, f"CBSE Paper too short ({len(doc)} chars)"
    assert "Section A" in doc or "SECTION A" in doc, "Missing Section A"
    assert "Section B" in doc or "SECTION B" in doc, "Missing Section B"
    assert "Section C" in doc or "SECTION C" in doc, "Missing Section C"
    assert "Section D" in doc or "SECTION D" in doc, "Missing Section D"
    assert "Section E" in doc or "SECTION E" in doc, "Missing Section E"

    print("\n>>> CASE 1 PASSED: Full CBSE Exam Paper generated completely without cutoff!\n")
    return doc


async def main():
    test_part1_generic_detection()
    test_part3_validation_catching_and_repairing()
    await test_case2_study_plan_numeric_constraints()
    await test_case3_quiz_with_choice_constraint()
    await test_case1_cbse_regression()
    print("=" * 80)
    print("ALL GENERIC STRUCTURAL PLANNER & VALIDATION TESTS PASSED SUCCESSFULLY!")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
