"""Async orchestration of the three-phase Agentic CoVe 2.0 pipeline."""
from __future__ import annotations

import asyncio
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


async def phase1_plan(llm: LLMClient, query: str) -> Plan:
    """Phase 1: draft an answer and plan verification. Retries once on bad JSON."""
    system = _load_prompt("phase1.md")
    last_error: Exception | None = None
    for _ in range(2):
        raw = await llm.complete_json(system, query, PHASE1_JSON_SCHEMA)
        try:
            return parse_plan(raw)
        except ValueError as exc:
            last_error = exc
    raise last_error  # type: ignore[misc]
