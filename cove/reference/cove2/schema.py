"""Typed data model + JSON schemas + plan validation for CoVe 2.0."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Claim:
    text: str
    tier: str  # "deep" | "shallow"
    verification_query: Optional[str] = None


@dataclass
class Plan:
    draft: str
    needs_verification: bool
    claims: list[Claim]


@dataclass
class SearchResult:
    title: str
    snippet: str
    url: str


@dataclass
class ClaimResult:
    claim: Claim
    answer: str
    confidence: str            # "High" | "Medium" | "Low"
    externally_grounded: bool  # True = open-book (deep); False = closed-book (shallow)
    sources: list[str] = field(default_factory=list)
    evidence: list[SearchResult] = field(default_factory=list)


@dataclass
class FinalAnswer:
    summary: dict
    corrections: list[str]
    revised: str
    citations: list[str]


# JSON schema for Phase 1 output (for providers that accept response schemas).
PHASE1_JSON_SCHEMA: dict = {
    "type": "object",
    "required": ["draft", "needs_verification", "claims"],
    "properties": {
        "draft": {"type": "string"},
        "needs_verification": {"type": "boolean"},
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["text", "tier"],
                "properties": {
                    "text": {"type": "string"},
                    "tier": {"type": "string", "enum": ["deep", "shallow"]},
                    "verification_query": {"type": "string"},
                },
            },
        },
    },
}

# JSON schema for Phase 3 output.
PHASE3_JSON_SCHEMA: dict = {
    "type": "object",
    "required": ["summary", "corrections", "revised", "citations"],
    "properties": {
        "summary": {"type": "object"},
        "corrections": {"type": "array", "items": {"type": "string"}},
        "revised": {"type": "string"},
        "citations": {"type": "array", "items": {"type": "string"}},
    },
}


def parse_plan(raw: dict) -> Plan:
    """Validate a raw Phase-1 dict and build a Plan. Raises ValueError on bad shape.

    Enforces that every ``deep`` claim carries a ``verification_query`` (a deep
    claim without one cannot be open-book verified -- constraint C2/C3).
    """
    if not isinstance(raw, dict):
        raise ValueError("plan must be a JSON object")
    if not isinstance(raw.get("draft"), str):
        raise ValueError("plan.draft must be a string")
    if not isinstance(raw.get("needs_verification"), bool):
        raise ValueError("plan.needs_verification must be a boolean")

    claims: list[Claim] = []
    for c in raw.get("claims") or []:
        if not isinstance(c, dict) or "text" not in c or c.get("tier") not in ("deep", "shallow"):
            raise ValueError(f"invalid claim: {c!r}")
        if c["tier"] == "deep" and not c.get("verification_query"):
            raise ValueError(f"deep claim missing verification_query: {c!r}")
        claims.append(Claim(text=c["text"], tier=c["tier"],
                            verification_query=c.get("verification_query")))

    return Plan(draft=raw["draft"],
                needs_verification=raw["needs_verification"],
                claims=claims)
