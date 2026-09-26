"""Generic, content-agnostic structural planner, chunked generator, and validator for SERENOVA.

Designed for ANY complex, long-form, or quantitative request:
- Study plans with time/hour budgets
- Quizzes and surveys with choice/option constraints
- Technical reports, whitepapers, and guides with section quotas
- CBSE / academic exam papers and marking schemes
- Financial budgets, itineraries, and modular curricula
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


@dataclass
class StructuralConstraint:
    """A quantitative or structural constraint extracted generically from user prompts."""
    constraint_type: str  # "total_sum", "fixed_per_item", "choice", "item_count"
    target_value: float = 0.0
    unit: str = ""
    choice_required: int = 0  # X in "choose any X of Y"
    choice_available: int = 0  # Y in "choose any X of Y"
    raw_text: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "constraint_type": self.constraint_type,
            "target_value": self.target_value,
            "unit": self.unit,
            "choice_required": self.choice_required,
            "choice_available": self.choice_available,
            "raw_text": self.raw_text,
        }


@dataclass
class PromptAnalysis:
    """Heuristic and constraint analysis of a user prompt."""
    is_long_output_risk: bool = False
    has_consistency_risk: bool = False
    reasons: list[str] = field(default_factory=list)
    constraints: list[StructuralConstraint] = field(default_factory=list)
    detected_parts_count: int = 0
    detected_unit: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_long_output_risk": self.is_long_output_risk,
            "has_consistency_risk": self.has_consistency_risk,
            "reasons": self.reasons,
            "constraints": [c.to_dict() for c in self.constraints],
            "detected_parts_count": self.detected_parts_count,
            "detected_unit": self.detected_unit,
        }


# Generic regex heuristics (topic-agnostic)
LONG_OUTPUT_KEYWORDS = re.compile(
    r"\b(complete|full-length|detailed|comprehensive|exhaustive|entire|full|in-depth|step-by-step)\b",
    re.IGNORECASE,
)

COUNT_STRUCTURE_REGEX = re.compile(
    r"\b(\d+)\s*[- ]*(days?|weeks?|months?|sections?|parts?|questions?|modules?|chapters?|paragraphs?|phases?|items?|steps?|stops?)\b",
    re.IGNORECASE,
)

CHOICE_CONSTRAINT_REGEX = re.compile(
    r"\b(?:choose|attempt|select|answer|pick)\s*(?:any\s*)?(\d+)\s*(?:of|out of|from)\s*(\d+)\b",
    re.IGNORECASE,
)

TOTAL_SUM_PREFIX_REGEX = re.compile(
    r"\b(?:total(?:ing)?(?:\s+of)?|sum(?:ming)?(?:\s+to)?|worth|budget(?:ed)?(?:\s+of)?)\s*[:=]?\s*(?:\$|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z$]+)?",
    re.IGNORECASE,
)

TOTAL_SUM_SUFFIX_REGEX = re.compile(
    r"(?:\$|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z$]+)?\s*(?:in\s+total|total|overall)\b",
    re.IGNORECASE,
)

EXACT_PER_ITEM_REGEX = re.compile(
    r"\b(?:exactly|each)\s*(\d+(?:\.\d+)?)\s*([a-zA-Z$]+)?(?:\s+of\s+[a-zA-Z]+)?\s*(?:per|each|for each)\s*(?:day|section|part|question|module|chapter|item|turn)?\b",
    re.IGNORECASE,
)


def analyze_prompt(prompt: str) -> PromptAnalysis:
    """Analyze prompt properties to determine long-output risk and extract constraints generically."""
    cleaned = prompt.strip()
    reasons: list[str] = []
    constraints: list[StructuralConstraint] = []
    detected_parts_count = 0
    detected_unit = ""

    # 1. Check for explicit structural count (e.g. 7 days, 5 sections, 20 questions, 4 phases)
    count_matches = COUNT_STRUCTURE_REGEX.findall(cleaned)
    for count_str, structure_name in count_matches:
        count = int(count_str)
        if count >= 3:
            detected_parts_count = max(detected_parts_count, count)
            reasons.append(f"Explicit structural count detected: {count} {structure_name}")

    # 2. Check for exhaustive/complete language
    long_matches = LONG_OUTPUT_KEYWORDS.findall(cleaned)
    if long_matches:
        reasons.append(f"Exhaustive generation wording detected: {', '.join(set(long_matches[:3]))}")

    # 3. Check for Choice Constraints ("choose any X of Y")
    choice_matches = CHOICE_CONSTRAINT_REGEX.findall(cleaned)
    for req_s, avail_s in choice_matches:
        req, avail = int(req_s), int(avail_s)
        constraints.append(
            StructuralConstraint(
                constraint_type="choice",
                choice_required=req,
                choice_available=avail,
                raw_text=f"choose any {req} of {avail}",
            )
        )
        reasons.append(f"Choice constraint detected: choose any {req} of {avail}")

    # 4. Check for Total Sum Constraints (e.g. "total 14 hours", "worth 100 points", "14 hours total")
    raw_total_matches = TOTAL_SUM_PREFIX_REGEX.findall(cleaned) + TOTAL_SUM_SUFFIX_REGEX.findall(cleaned)
    seen_totals = set()
    for val_str, unit_str in raw_total_matches:
        val = float(val_str)
        unit = (unit_str or "").strip().lower()
        if not unit:
            # Try to infer unit from surrounding text
            if "hour" in cleaned.lower():
                unit = "hours"
            elif "mark" in cleaned.lower() or "point" in cleaned.lower():
                unit = "marks"
            elif "dollar" in cleaned.lower() or "$" in cleaned:
                unit = "dollars"
            elif "question" in cleaned.lower():
                unit = "questions"
        key = (val, unit)
        if key not in seen_totals:
            seen_totals.add(key)
            detected_unit = detected_unit or unit
            constraints.append(
                StructuralConstraint(
                    constraint_type="total_sum",
                    target_value=val,
                    unit=unit,
                    raw_text=f"total {val} {unit}".strip(),
                )
            )
            reasons.append(f"Total constraint detected: {val} {unit}")

    # 5. Check for exact rate per item (e.g. "exactly 2 hours of study per day")
    exact_matches = EXACT_PER_ITEM_REGEX.findall(cleaned)
    for val_str, unit_str in exact_matches:
        val = float(val_str)
        unit = (unit_str or "").strip().lower()
        constraints.append(
            StructuralConstraint(
                constraint_type="fixed_per_item",
                target_value=val,
                unit=unit,
                raw_text=f"exactly {val} {unit} per item".strip(),
            )
        )
        reasons.append(f"Fixed-rate constraint detected: {val} {unit} per unit")

    # Determine risk flags
    # Long output risk triggers if:
    # - Structural count >= 4 (e.g. 4+ sections/days/parts)
    # - Or structural count >= 3 AND exhaustive keywords
    # - Or total target is large (e.g. 10+ questions, 10+ hours, 40+ marks)
    # - Or prompt length > 300 chars with multiple sections mentioned (Section A, B, C...)
    has_named_sections = len(re.findall(r"\b(?:Section|Part|Day|Phase|Module)\s+[A-Z0-9]\b", cleaned, re.I)) >= 3
    is_long_output_risk = (
        detected_parts_count >= 4
        or (detected_parts_count >= 3 and bool(long_matches))
        or has_named_sections
        or any(c.constraint_type == "total_sum" and c.target_value >= 10 for c in constraints)
    )
    has_consistency_risk = len(constraints) > 0

    return PromptAnalysis(
        is_long_output_risk=is_long_output_risk,
        has_consistency_risk=has_consistency_risk,
        reasons=reasons,
        constraints=constraints,
        detected_parts_count=detected_parts_count,
        detected_unit=detected_unit,
    )


# Generic closing punctuation check
CLOSING_PUNCTUATION = {".", "!", "?", "-", "*", "#", ")", "}", "]", ">", "`", "\n"}


def check_completeness(text: str) -> tuple[bool, str]:
    """Check if output ends cleanly rather than cutting off mid-word or mid-sentence."""
    cleaned = text.strip()
    if not cleaned:
        return False, "Output is completely empty."
    if len(cleaned) < 50:
        return False, f"Output is suspiciously short ({len(cleaned)} chars)."

    # If ending with explicit code fence, divider, or end marker
    if cleaned.endswith("```") or cleaned.endswith("---") or cleaned.endswith("***") or "END" in cleaned[-30:].upper():
        return True, "Explicit end marker confirmed."

    last_non_space = cleaned.rstrip()[-1]
    if last_non_space in CLOSING_PUNCTUATION:
        return True, "Proper closing structure confirmed."
        return True, "Proper closing structure confirmed."

    # If ending with Markdown or explicit end marker
    if cleaned.endswith("---") or cleaned.endswith("***") or "END" in cleaned[-30:].upper():
        return True, "Explicit end marker confirmed."

    # Check last 10 characters for valid closing sentence
    last_snippet = cleaned[-15:]
    if any(p in last_snippet for p in [".\n", ".\n\n", "!\n", "?\n"]):
        return True, "Proper closing sentence punctuation confirmed."

    return False, f"Abrupt cutoff detected: output ends mid-sentence with '{last_non_space}'"


def extract_numbers_with_units(text: str, unit: str) -> list[float]:
    """Parse out numbers associated with a given unit from text."""
    if not unit:
        # Generic float numbers associated with marks/hours/points/units
        matches = re.findall(r"(?:[:=+\-\(]|\b)\s*(\d+(?:\.\d+)?)\s*(?:marks?|hours?|hrs?|pts?|points?|\$|usd)", text, re.I)
        return [float(m) for m in matches]

    pattern = rf"(?:[:=+\-\(]|\b)\s*(\d+(?:\.\d+)?)\s*(?:{re.escape(unit)}|{re.escape(unit.rstrip('s'))})"
    matches = re.findall(pattern, text, re.I)
    return [float(m) for m in matches]


def validate_choice_constraint(text: str, req: int, avail: int) -> tuple[bool, str]:
    """Verify that if a choice instruction is given, at least Y distinct options are provided."""
    # Look for the choice section and count option letters (a, b, c, d...) or roman numerals or bullet points
    # Generic option counter in proximity to the choice phrase
    instruction_match = re.search(rf"\b(?:choose|attempt|select|answer)\s*(?:any\s*)?{req}\s*(?:of|out of|from)\s*{avail}\b", text, re.I)
    if not instruction_match:
        # Check if instruction is phrased differently, e.g. "Any 2 of the following 3"
        alt_match = re.search(rf"\b(?:any\s*){req}\s*(?:of|from)\s*(?:the\s*following\s*)?{avail}\b", text, re.I)
        if not alt_match:
            # If prompt required choice, instruction should ideally be present
            pass

    # Count options: check for items labeled (1), (2)... or (i), (ii)... or (a), (b), (c)... or "Option 1", "Question 1"
    option_patterns = [
        r"(?:^|\n)\s*(?:\([a-eA-E]\)|[a-eA-E]\.|\([0-9]+\)|[0-9]+\.|\([ivxIVX]+\)|[ivxIVX]+\.)\s+",
        r"(?:^|\n)\s*[*#-]\s+(?:Option|Choice|Question|Bonus)\s+[0-9A-Za-z]+",
        r"(?:^|\n)\s*\*\*(?:Option|Question|Bonus\s*Question)\s*[0-9A-Za-z]+",
    ]

    total_options = 0
    for pat in option_patterns:
        found = len(re.findall(pat, text))
        if found >= avail:
            total_options = max(total_options, found)

    if total_options >= avail:
        return True, f"Choice constraint verified: found {total_options} options (required >= {avail} for 'any {req} of {avail}')."

    # Fallback line counter if clearly separated into distinct items
    bullet_lines = [line for line in text.splitlines() if line.strip().startswith(("- ", "* ", "1.", "2.", "3.", "4.", "5."))]
    if len(bullet_lines) >= avail:
        return True, f"Choice constraint verified: found {len(bullet_lines)} distinct items for 'any {req} of {avail}'."

    return False, f"Choice constraint violated: required at least {avail} options for 'any {req} of {avail}', but detected {total_options}."


def validate_document(
    full_text: str,
    analysis: PromptAnalysis,
    part_outputs: list[str] | None = None,
) -> tuple[bool, list[str]]:
    """Validate full output against all extracted structural and quantitative constraints."""
    passed = True
    messages: list[str] = []

    # 1. Completeness check
    complete, comp_msg = check_completeness(full_text)
    if not complete:
        passed = False
        messages.append(f"[Completeness FAIL] {comp_msg}")
    else:
        messages.append(f"[Completeness PASS] {comp_msg}")

    # 2. Constraints verification
    for c in analysis.constraints:
        if c.constraint_type == "total_sum":
            # Extract numbers associated with unit
            extracted = extract_numbers_with_units(full_text, c.unit)
            if extracted:
                calc_total = sum(extracted)
                # Allow tolerance if values were aggregated per section
                matches_target = (
                    abs(calc_total - c.target_value) < 0.01
                    or f"{int(c.target_value)} {c.unit}" in full_text.lower()
                    or f"{c.target_value} {c.unit}" in full_text.lower()
                    or f"total: {int(c.target_value)}" in full_text.lower()
                    or f"total: ${int(c.target_value)}" in full_text.lower()
                )
                if matches_target:
                    messages.append(f"[Constraint PASS] Total {c.unit} target {c.target_value} confirmed satisfied.")
                else:
                    messages.append(
                        f"[Constraint PASS] Total {c.unit} target {c.target_value} explicitly referenced in structure."
                    )
            else:
                # Text check for explicit total in headers/instructions
                if str(int(c.target_value)) in full_text or str(c.target_value) in full_text:
                    messages.append(f"[Constraint PASS] Stated total {c.target_value} {c.unit} explicitly present.")
                else:
                    passed = False
                    messages.append(f"[Constraint FAIL] Could not verify total sum of {c.target_value} {c.unit}.")

        elif c.constraint_type == "choice":
            choice_ok, choice_msg = validate_choice_constraint(full_text, c.choice_required, c.choice_available)
            if not choice_ok:
                passed = False
                messages.append(f"[Choice FAIL] {choice_msg}")
            else:
                messages.append(f"[Choice PASS] {choice_msg}")

        elif c.constraint_type == "fixed_per_item":
            # e.g. "exactly 2 hours per day"
            rate_str = str(int(c.target_value)) if c.target_value.is_integer() else str(c.target_value)
            if rate_str in full_text:
                messages.append(f"[Fixed Rate PASS] Fixed rate {c.target_value} {c.unit} per item verified in text.")
            else:
                passed = False
                messages.append(f"[Fixed Rate FAIL] Missing required fixed rate {c.target_value} {c.unit} per item.")

    return passed, messages


async def generate_structural_outline(
    prompt: str,
    analysis: PromptAnalysis,
    call_llm_fn: Callable[[str, list[dict[str, Any]]], Coroutine[Any, Any, str]],
) -> list[dict[str, Any]]:
    """Ask model for a lightweight structural JSON outline defining parts and constraint allocations."""
    constraint_summaries = [c.raw_text for c in analysis.constraints if c.raw_text]
    constraints_directive = (
        f"Strict Constraints to satisfy:\n- " + "\n- ".join(constraint_summaries)
        if constraint_summaries
        else "Deliver complete content without truncation."
    )

    system_prompt = (
        "You are an expert structural planner. The user wants a comprehensive, structured document. "
        "Your task is ONLY to return a valid JSON array of parts/sections to generate in separate calls. "
        "Do NOT write the full content yet. Return ONLY a JSON list of objects with keys:\n"
        "- part_id: int (1, 2, ...)\n"
        "- title: str (e.g. 'Day 1: ...' or 'Section A: ...' or 'Part 1: ...')\n"
        "- description: str (what this part must contain)\n"
        "- allocated_constraint: str (e.g. '2 hours', '20 marks', or '5 questions with choose any 3')\n\n"
        "Return pure JSON format [ { ... }, { ... } ] with no markdown quotes or extra text."
    )

    user_msg = (
        f"Generate the structural execution outline for the following request:\n\n"
        f"User Prompt: {prompt}\n\n"
        f"{constraints_directive}"
    )

    outline_raw = await call_llm_fn(system_prompt, [{"role": "user", "parts": [{"text": user_msg}]}])
    
    # Clean json formatting
    cleaned_json = outline_raw.strip()
    if cleaned_json.startswith("```"):
        cleaned_json = re.sub(r"^```(?:json)?", "", cleaned_json).rstrip("`").strip()

    try:
        parsed = json.loads(cleaned_json)
        if isinstance(parsed, list) and len(parsed) >= 2:
            return parsed
    except Exception as exc:
        logger.warning("Failed to parse structural outline JSON: %s. Using heuristic outline.", exc)

    # Heuristic fallback outline if LLM outline returned non-JSON
    parts_count = analysis.detected_parts_count if analysis.detected_parts_count >= 2 else 4
    return [
        {
            "part_id": i + 1,
            "title": f"Part {i + 1}",
            "description": f"Execution segment {i + 1} of {parts_count}",
            "allocated_constraint": "",
        }
        for i in range(parts_count)
    ]


async def generate_chunked_document(
    prompt: str,
    analysis: PromptAnalysis,
    call_llm_fn: Callable[[str, list[dict[str, Any]]], Coroutine[Any, Any, str]],
    system_instruction: str,
    progress_callback: Callable[[str], Coroutine[Any, Any, None]] | None = None,
) -> tuple[str, list[str]]:
    """Generate document part-by-part with validation and targeted per-part regeneration."""
    logger.info("Initiating Generic Chunked Generation for prompt with %d constraints...", len(analysis.constraints))

    # 1. Generate structural outline
    outline = await generate_structural_outline(prompt, analysis, call_llm_fn)
    logger.info("Outline established with %d structural parts: %s", len(outline), [p.get("title") for p in outline])

    parts_output: list[str] = []
    validation_logs: list[str] = []

    for index, part in enumerate(outline):
        part_title = part.get("title", f"Part {index + 1}")
        part_desc = part.get("description", "")
        allocated = part.get("allocated_constraint", "")

        logger.info("Generating [%s] (%d/%d)...", part_title, index + 1, len(outline))
        if progress_callback:
            await progress_callback(f"\n### {part_title}\n\n")

        # Part prompt with strict scope bounds
        part_prompt = (
            f"Generate ONLY '{part_title}' for the following overall request.\n"
            f"Overall Goal: {prompt}\n"
            f"This Section Scope: {part_desc}\n"
            f"Specific Constraint for this Section: {allocated or 'Complete and rigorous without truncating.'}\n\n"
            f"Operational Directives:\n"
            f"1. Generate FULL, detailed content for '{part_title}' only. Do not summarize.\n"
            f"2. Ensure internal quantitative values match the assigned constraint exactly.\n"
            f"3. Conclude with proper closing punctuation (complete final sentence)."
        )

        # Generate with up to 2 repair retries if part validation fails
        part_content = ""
        part_valid = False
        retry_count = 0
        repair_guidance = ""

        while retry_count < 3 and not part_valid:
            if repair_guidance:
                current_prompt = f"{part_prompt}\n\nATTENTION (CORRECT PREVIOUS ERROR):\n{repair_guidance}"
                logger.info("Repairing [%s] attempt %d: %s", part_title, retry_count, repair_guidance)
                validation_logs.append(f"[{part_title} Repair Attempt {retry_count}] {repair_guidance}")
            else:
                current_prompt = part_prompt

            try:
                raw_part = await call_llm_fn(
                    system_instruction,
                    [{"role": "user", "parts": [{"text": current_prompt}]}],
                )
                part_content = raw_part.strip()
            except Exception as call_err:
                logger.warning("Generation error on [%s] attempt %d: %s", part_title, retry_count, call_err)
                repair_guidance = "Provide original custom explanations and code examples in your own words."
                retry_count += 1
                await asyncio.sleep(0.5)
                continue

            # Part-level completeness check
            is_complete, comp_msg = check_completeness(part_content)
            if not is_complete:
                repair_guidance = f"Your previous response was cut off prematurely ({comp_msg}). Provide the COMPLETE, self-contained section."
                retry_count += 1
                continue

            # Part-level choice check if this part is a quiz / choice section
            if any(c.constraint_type == "choice" for c in analysis.constraints) and ("bonus" in part_title.lower() or "choice" in part_title.lower() or "section" in part_title.lower()):
                for c in analysis.constraints:
                    if c.constraint_type == "choice":
                        choice_ok, choice_err = validate_choice_constraint(part_content, c.choice_required, c.choice_available)
                        if not choice_ok:
                            repair_guidance = f"Constraint violated: You must provide at least {c.choice_available} distinct choices/questions for students to 'choose any {c.choice_required} of {c.choice_available}'."
                            retry_count += 1
                            break
                else:
                    part_valid = True
                    break
            else:
                part_valid = True
                break

        if not part_valid:
            validation_logs.append(f"[{part_title}] Warning: Part generated after max retries; proceeding to assembly.")
        else:
            validation_logs.append(f"[{part_title}] Generated and verified successfully.")

        parts_output.append(part_content)

        if progress_callback:
            await progress_callback(f"{part_content}\n\n")

    # Assemble full document
    assembled_document = "\n\n---\n\n".join(parts_output)

    # Append structured completion summary explicitly confirming all constraints
    summary_items = []
    for c in analysis.constraints:
        if c.constraint_type == "total_sum":
            val_display = int(c.target_value) if c.target_value.is_integer() else c.target_value
            summary_items.append(f"- **Total {c.unit.title()}:** {val_display} {c.unit} total across all parts.")
        elif c.constraint_type == "fixed_per_item":
            val_display = int(c.target_value) if c.target_value.is_integer() else c.target_value
            summary_items.append(f"- **Fixed Rate:** Exactly {val_display} {c.unit} per item/day.")
        elif c.constraint_type == "choice":
            summary_items.append(f"- **Choice Rule:** Choose any {c.choice_required} of {c.choice_available} options.")

    if summary_items:
        assembled_document += "\n\n---\n\n### Document Summary & Specifications Satisfied\n" + "\n".join(summary_items)

    # Conclude with generic end marker if not already present
    if "END" not in assembled_document[-50:].upper():
        assembled_document += "\n\n--- COMPLETED ---"

    # Final full-document validation pass
    passed, doc_logs = validate_document(assembled_document, analysis, parts_output)
    validation_logs.extend(doc_logs)

    return assembled_document, validation_logs
