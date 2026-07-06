"""Async orchestration of the three-phase Agentic CoVe 2.0 pipeline."""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

from .providers import LLMClient, SearchProvider
from .schema import (
    PHASE1_JSON_SCHEMA,
    PHASE3_JSON_SCHEMA,
    Claim,
    ClaimResult,
    FinalAnswer,
    Plan,
    SearchResult,
    parse_plan,
)

_PROMPT_DIR = Path(__file__).parent / "prompts"


def _load_prompt(name: str) -> str:
    return (_PROMPT_DIR / name).read_text(encoding="utf-8")


async def phase1_plan(llm: LLMClient, query: str, *, today: str | None = None) -> Plan:
    """Phase 1: draft an answer and plan verification. Retries once on bad JSON.

    ``today`` (e.g. "2026-07-06") anchors freshness-sensitive verification queries:
    the prompt requires date-anchored queries for claims that drift over time, and
    the model cannot know "now" unless the caller supplies it.
    """
    system = _load_prompt("phase1.md")
    user = f"Today's date: {today}\n\n{query}" if today else query
    last_error: Exception | None = None
    for _ in range(2):
        raw = await llm.complete_json(system, user, PHASE1_JSON_SCHEMA)
        try:
            return parse_plan(raw)
        except ValueError as exc:
            last_error = exc
            # feed the validation error back so the retry can fix the exact problem
            user = (
                f"{user}\n\nYour previous plan was invalid: {exc}. "
                "Emit a corrected JSON object with the required shape."
            )
    raise last_error  # type: ignore[misc]


def _format_evidence(evidence: list[SearchResult]) -> str:
    if not evidence:
        return "(no results)"
    return "\n\n".join(
        f"[{i}] {r.title}\n{r.snippet}\n{r.url}" for i, r in enumerate(evidence, 1)
    )


def parse_verifier_output(text: str) -> tuple[str, str, list[int] | None]:
    """Parse the 'Answer: / Confidence: / Supported-by:' verifier reply.

    Conservative defaults. ``supported`` holds the 1-indexed evidence numbers the
    verifier says ground its answer; ``[]`` when it explicitly answered "none";
    ``None`` when the line is absent or unparseable (callers fall back to citing
    all retrieved results).
    """
    answer, confidence, supported = "unable to verify", "Low", None
    for line in text.splitlines():
        stripped = line.strip()
        lowered = stripped.lower()
        if lowered.startswith("answer:"):
            answer = stripped.split(":", 1)[1].strip()
        elif lowered.startswith("confidence:"):
            confidence = stripped.split(":", 1)[1].strip().capitalize()
        elif lowered.startswith("supported-by:"):
            raw = stripped.split(":", 1)[1]
            nums = [int(tok) for tok in re.findall(r"\d+", raw)]
            if nums or "none" in raw.lower():
                supported = nums
    return answer, confidence, supported


async def _verify_deep(claim: Claim, search: SearchProvider, llm: LLMClient) -> ClaimResult:
    query = claim.verification_query or claim.text
    evidence = await search.search(query)
    system = _load_prompt("phase2_deep.md")
    # C3: the verifier receives only the question + evidence -- never the draft.
    # Boundary protection: the question is derived from an untrusted draft and the
    # evidence is untrusted web content, so both are fenced in <untrusted_*> tags that
    # phase2_deep.md tells the model to treat as data, not instructions.
    user = (
        f"<untrusted_question>\n{query}\n</untrusted_question>\n\n"
        f"<untrusted_evidence>\n{_format_evidence(evidence)}\n</untrusted_evidence>"
    )
    answer, confidence, supported = parse_verifier_output(await llm.complete(system, user))
    if supported is None:
        sources = [r.url for r in evidence]
    else:
        sources = [evidence[i - 1].url for i in supported if 1 <= i <= len(evidence)]
    return ClaimResult(
        claim=claim, answer=answer, confidence=confidence,
        externally_grounded=True,
        sources=sources, evidence=evidence,
    )


async def _verify_shallow(claim: Claim, llm: LLMClient) -> ClaimResult:
    # C4: closed-book and conservative -- no search, no draft, caveats only.
    system = _load_prompt("phase2_shallow.md")
    answer, confidence, _ = parse_verifier_output(await llm.complete(system, f"Claim: {claim.text}"))
    return ClaimResult(
        claim=claim, answer=answer, confidence=confidence,
        externally_grounded=False, sources=[], evidence=[],
    )


def _degraded_result(claim: Claim, error: Exception) -> ClaimResult:
    # No external grounding actually happened, so the claim is treated like an
    # unverified one downstream: Phase 3 may only caveat it, never rewrite on it.
    return ClaimResult(
        claim=claim,
        answer=f"unable to verify (verifier error: {error})",
        confidence="Low",
        externally_grounded=False, sources=[], evidence=[],
    )


async def phase2_verify(plan: Plan, search: SearchProvider, llm: LLMClient) -> list[ClaimResult]:
    """Phase 2: route by tier. Deep claims verify open-book in parallel; shallow stay closed-book.

    A verifier failure (search outage, provider error) degrades that ONE claim to a
    conservative "unable to verify" result instead of aborting the whole phase.
    Results come back in plan-claim order.
    """
    if not plan.needs_verification:
        return []
    # any tier other than "deep" is treated conservatively (closed-book) by design
    tasks = [
        _verify_deep(c, search, llm) if c.tier == "deep" else _verify_shallow(c, llm)
        for c in plan.claims
    ]
    outcomes = await asyncio.gather(*tasks, return_exceptions=True)
    results: list[ClaimResult] = []
    for claim, outcome in zip(plan.claims, outcomes):
        if isinstance(outcome, Exception):
            results.append(_degraded_result(claim, outcome))
        elif isinstance(outcome, BaseException):  # KeyboardInterrupt, CancelledError
            raise outcome
        else:
            results.append(outcome)
    return results


def _truncate(text: str, limit: int = 200) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _format_results(results: list[ClaimResult]) -> str:
    blocks = []
    for r in results:
        basis = "external evidence" if r.externally_grounded else "internal reasoning (no external evidence)"
        sources = ", ".join(r.sources) if r.sources else "(none)"
        # short evidence quotes let the reviewer weigh how strongly a source backs
        # the verified answer, instead of trusting the answer line blindly
        evidence = "".join(
            f"\n  Evidence: {_truncate(e.snippet)} ({e.url})"
            for e in r.evidence[:3]
        )
        blocks.append(
            f"- Claim: {r.claim.text}\n"
            f"  Verified answer: {r.answer}\n"
            f"  Confidence: {r.confidence}\n"
            f"  Basis: {basis}\n"
            f"  Sources: {sources}"
            f"{evidence}"
        )
    return "\n".join(blocks) if blocks else "(no claims verified)"


async def phase3_finalize(llm: LLMClient, draft: str, results: list[ClaimResult]) -> FinalAnswer:
    """Phase 3: strict review of draft vs. verification results; emit revision + citations."""
    system = _load_prompt("phase3.md")
    # Boundary protection: the draft may be attacker-supplied and the results embed
    # untrusted web evidence, so both are fenced in <untrusted_*> tags that phase3.md
    # tells the reviewer to treat as data, not instructions.
    user = (
        f"<untrusted_draft>\n{draft}\n</untrusted_draft>\n\n"
        f"<untrusted_results>\n{_format_results(results)}\n</untrusted_results>"
    )
    raw = await llm.complete_json(system, user, PHASE3_JSON_SCHEMA)
    return FinalAnswer(
        summary=raw.get("summary", {}),
        corrections=list(raw.get("corrections", [])),
        revised=raw.get("revised", draft),
        citations=list(raw.get("citations", [])),
    )


async def run(
    query: str,
    llm: LLMClient,
    search: SearchProvider,
    *,
    today: str | None = None,
    max_iterations: int = 1,
) -> FinalAnswer:
    """End-to-end pipeline. ``today`` anchors freshness-sensitive verification
    queries (see ``phase1_plan``). ``max_iterations`` > 1 enables the optional
    CRITIC-style verify-then-correct loop (C5, default off): after finalizing,
    re-verify and re-finalize while corrections were made, up to
    ``max_iterations`` total passes. Values <= 1 run a single pass.

    Simplification: each iteration re-verifies *all* claims, not only the corrected
    ones (the plan and SKILL.md describe "re-verify corrected claims" as the ideal).
    This keeps the reference simple; selective re-verification is left as an extension.
    """
    plan = await phase1_plan(llm, query, today=today)
    if not plan.needs_verification:
        return FinalAnswer(
            summary={"checked": 0, "confirmed": 0, "corrected": 0, "uncertain": 0},
            corrections=[], revised=plan.draft, citations=[],
        )

    results = await phase2_verify(plan, search, llm)
    final = await phase3_finalize(llm, plan.draft, results)

    iterations = 1
    while iterations < max_iterations and final.corrections:
        results = await phase2_verify(plan, search, llm)
        final = await phase3_finalize(llm, final.revised, results)
        iterations += 1
    return final
