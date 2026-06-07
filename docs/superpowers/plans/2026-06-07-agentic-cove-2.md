# Agentic CoVe 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `cove` skill into a three-phase, open-book Chain-of-Verification pipeline (adaptive draft & plan → tiered open-book verification → critique & finalize with citations), and ship a self-contained provider-agnostic Python reference implementation.

**Architecture:** Primary deliverable is `cove/SKILL.md` (agent-native protocol; "tools" = the agent's own parallel search-subagents). Secondary is `cove/reference/` — a hermetic Python package (`cove2`) demonstrating the same pipeline with async parallelism and pluggable `LLMClient`/`SearchProvider` protocols. The two share the same prompt contracts. Layered merge: a `needs_verification` gate sits on top; per-claim `deep`/`shallow` tier routing decides open-book search (deep) vs. conservative closed-book (shallow).

**Tech Stack:** Python ≥3.10 (stdlib `asyncio`, `dataclasses`; zero core deps), `pytest` (dev), optional provider SDKs (`anthropic`, `tavily-python`, etc.) behind lazy imports. Skill + docs are Markdown.

**Spec:** `docs/superpowers/specs/2026-06-07-agentic-cove-2-design.md` (constraints C1–C5 referenced throughout).

---

## File Structure

```
cove/
  SKILL.md                       # rewrite — three-phase agent protocol (Task 10)
  reference/
    pyproject.toml               # Task 1
    README.md                    # Task 9 — per-provider JSON-mode notes
    cove2/
      __init__.py                # Task 1
      schema.py                  # Task 2 — dataclasses, JSON schemas, parse_plan
      providers.py               # Task 3 — protocols + Tavily + Anthropic adapters
      prompts/
        phase1.md                # Task 4
        phase2_deep.md           # Task 4
        phase2_shallow.md        # Task 4
        phase3.md                # Task 4
      pipeline.py                # Tasks 5-8 — phase1/phase2/phase3/run
    tests/
      __init__.py                # Task 1
      fakes.py                   # Task 3 — FakeLLMClient, FakeSearchProvider
      test_schema.py             # Task 2
      test_providers.py          # Task 3
      test_prompts.py            # Task 4 — locks C2/C3/C4 into prompt text
      test_pipeline_phase1.py    # Task 5
      test_pipeline_phase2.py    # Task 6
      test_pipeline_phase3.py    # Task 7
      test_pipeline_run.py       # Task 8
.gitignore                       # Task 1 — Python caches (none exists yet)
README.md / README.en.md         # Task 11 — refresh cove section
```

**Commit convention (user default):** Conventional Commits + Gitmoji, e.g. `✨ feat(cove): ...`. Branch is `feat/agentic-cove-2` (already created). End commit messages with the `Co-Authored-By` trailer.

---

### Task 1: Scaffold the reference package

**Files:**
- Create: `.gitignore`
- Create: `cove/reference/pyproject.toml`
- Create: `cove/reference/cove2/__init__.py`
- Create: `cove/reference/cove2/prompts/.gitkeep`
- Create: `cove/reference/tests/__init__.py`

- [ ] **Step 1: Create root `.gitignore`** (no `.gitignore` exists in the repo yet)

```gitignore
# Python
__pycache__/
*.py[cod]
.pytest_cache/
.venv/
venv/
*.egg-info/
.env
```

- [ ] **Step 2: Create `cove/reference/pyproject.toml`**

```toml
[project]
name = "cove2-reference"
version = "0.1.0"
description = "Agentic CoVe 2.0 reference pipeline (open-book Chain-of-Verification)"
requires-python = ">=3.10"
dependencies = []

[project.optional-dependencies]
# Provider SDKs are optional; adapters lazy-import them. Verify current
# signatures via context7 before live use.
providers = ["anthropic>=0.39", "tavily-python>=0.5"]
dev = ["pytest>=8.0"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

- [ ] **Step 3: Create package + test `__init__.py` and a prompts placeholder**

`cove/reference/cove2/__init__.py`:
```python
"""Agentic CoVe 2.0 reference pipeline."""
```

`cove/reference/tests/__init__.py`:
```python
```

`cove/reference/cove2/prompts/.gitkeep`:
```
```

- [ ] **Step 4: Create the dev environment and verify pytest runs**

Run:
```bash
cd cove/reference && python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'
python -m pytest -q
```
Expected: pytest collects 0 tests and exits 0 ("no tests ran").

- [ ] **Step 5: Commit**

```bash
git add .gitignore cove/reference/pyproject.toml cove/reference/cove2 cove/reference/tests
git commit -m "$(printf '🏗️ chore(cove): scaffold reference Python package\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Data model & plan validation (`schema.py`)

**Files:**
- Create: `cove/reference/cove2/schema.py`
- Test: `cove/reference/tests/test_schema.py`

- [ ] **Step 1: Write the failing test**

`cove/reference/tests/test_schema.py`:
```python
import pytest
from cove2.schema import parse_plan, Plan


def test_parse_plan_valid():
    raw = {
        "draft": "d",
        "needs_verification": True,
        "claims": [
            {"text": "x", "tier": "deep", "verification_query": "what is x?"},
            {"text": "y", "tier": "shallow"},
        ],
    }
    plan = parse_plan(raw)
    assert isinstance(plan, Plan)
    assert plan.needs_verification is True
    assert plan.claims[0].verification_query == "what is x?"
    assert plan.claims[1].tier == "shallow"


def test_parse_plan_deep_requires_query():
    raw = {"draft": "d", "needs_verification": True,
           "claims": [{"text": "x", "tier": "deep"}]}
    with pytest.raises(ValueError):
        parse_plan(raw)


def test_parse_plan_rejects_non_bool_gate():
    with pytest.raises(ValueError):
        parse_plan({"draft": "d", "needs_verification": "yes", "claims": []})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cove/reference && python -m pytest tests/test_schema.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cove2.schema'`.

- [ ] **Step 3: Write `cove/reference/cove2/schema.py`**

```python
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
    claim without one cannot be open-book verified — constraint C2/C3).
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cove/reference && python -m pytest tests/test_schema.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add cove/reference/cove2/schema.py cove/reference/tests/test_schema.py
git commit -m "$(printf '✨ feat(cove): add CoVe 2.0 data model and plan validation\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Provider protocols, fakes & Tavily/Anthropic adapters (`providers.py`, `fakes.py`)

**Files:**
- Create: `cove/reference/cove2/providers.py`
- Create: `cove/reference/tests/fakes.py`
- Test: `cove/reference/tests/test_providers.py`

- [ ] **Step 1: Write the failing test**

`cove/reference/tests/test_providers.py`:
```python
import asyncio
from cove2.providers import TavilySearch


class _FakeTavilyClient:
    """Mimics tavily.TavilyClient.search() without network."""
    def search(self, query, max_results):
        return {"results": [{"title": "T", "content": "C", "url": "http://u"}]}


def test_tavily_maps_results_to_searchresult():
    s = TavilySearch(client=_FakeTavilyClient())
    out = asyncio.run(s.search("q"))
    assert len(out) == 1
    assert out[0].url == "http://u"
    assert out[0].snippet == "C"
    assert out[0].title == "T"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cove/reference && python -m pytest tests/test_providers.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cove2.providers'`.

- [ ] **Step 3: Write `cove/reference/cove2/providers.py`**

```python
"""Provider-agnostic transport protocols and concrete adapters.

The pipeline depends only on the ``LLMClient`` and ``SearchProvider`` protocols,
so any provider can be plugged in. Concrete SDKs are imported lazily so the core
package and its tests have zero third-party dependencies.

NOTE: Verify each SDK's current signature (JSON/tool-use mode) via context7 before
running live — provider APIs change and must not be relied on from memory.
"""
from __future__ import annotations

import asyncio
from typing import Optional, Protocol, runtime_checkable

from .schema import SearchResult


@runtime_checkable
class LLMClient(Protocol):
    async def complete(self, system: str, user: str) -> str: ...
    async def complete_json(self, system: str, user: str, schema: dict) -> dict: ...


@runtime_checkable
class SearchProvider(Protocol):
    async def search(self, query: str) -> list[SearchResult]: ...


class TavilySearch:
    """SearchProvider backed by Tavily (returns LLM-ready text + sources).

    To swap providers, implement ``async search(query) -> list[SearchResult]``:
      - Google CSE: call the Custom Search JSON API, map ``items[].{title,snippet,link}``.
      - RAG store: query your vector DB, map chunks to SearchResult(title, snippet, url).
    """

    def __init__(self, api_key: Optional[str] = None, *, max_results: int = 5, client=None):
        self._max_results = max_results
        if client is not None:
            self._client = client
        else:
            from tavily import TavilyClient  # lazy import
            self._client = TavilyClient(api_key=api_key)

    async def search(self, query: str) -> list[SearchResult]:
        raw = await asyncio.to_thread(self._client.search, query, max_results=self._max_results)
        return [
            SearchResult(title=r.get("title", ""), snippet=r.get("content", ""), url=r.get("url", ""))
            for r in raw.get("results", [])
        ]


class AnthropicLLM:
    """LLMClient backed by the Anthropic Messages API.

    JSON output is obtained via a forced tool call. Verify the tool-use signature
    against current docs via context7 before live use.
    """

    def __init__(self, *, model: str = "claude-opus-4-8", api_key: Optional[str] = None, client=None):
        self.model = model
        if client is not None:
            self._client = client
        else:
            from anthropic import AsyncAnthropic  # lazy import
            self._client = AsyncAnthropic(api_key=api_key)

    async def complete(self, system: str, user: str) -> str:
        msg = await self._client.messages.create(
            model=self.model, max_tokens=2048, system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    async def complete_json(self, system: str, user: str, schema: dict) -> dict:
        tool = {"name": "emit", "description": "Emit the structured result.", "input_schema": schema}
        msg = await self._client.messages.create(
            model=self.model, max_tokens=2048, system=system,
            messages=[{"role": "user", "content": user}],
            tools=[tool], tool_choice={"type": "tool", "name": "emit"},
        )
        for b in msg.content:
            if getattr(b, "type", "") == "tool_use":
                return b.input
        raise ValueError("model did not emit structured output")
```

- [ ] **Step 4: Write `cove/reference/tests/fakes.py`** (deterministic test doubles)

```python
"""Deterministic test doubles for hermetic pipeline tests."""
from __future__ import annotations

from cove2.schema import SearchResult


class FakeLLMClient:
    def __init__(self, *, json_responses=None, text_responses=None):
        self.json_responses = list(json_responses or [])
        self.text_responses = list(text_responses or [])
        self.complete_calls = []   # list[(system, user)]
        self.json_calls = []       # list[(system, user, schema)]

    async def complete(self, system: str, user: str) -> str:
        self.complete_calls.append((system, user))
        return self.text_responses.pop(0)

    async def complete_json(self, system: str, user: str, schema: dict) -> dict:
        self.json_calls.append((system, user, schema))
        return self.json_responses.pop(0)


class FakeSearchProvider:
    def __init__(self, *, results_by_query=None, default=None):
        self.results_by_query = results_by_query or {}
        self.default = default or []
        self.queries = []          # records every query searched

    async def search(self, query: str) -> list[SearchResult]:
        self.queries.append(query)
        return self.results_by_query.get(query, self.default)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd cove/reference && python -m pytest tests/test_providers.py -v`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit**

```bash
git add cove/reference/cove2/providers.py cove/reference/tests/fakes.py cove/reference/tests/test_providers.py
git commit -m "$(printf '✨ feat(cove): add provider protocols, fakes, Tavily/Anthropic adapters\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Phase prompts (4 files) + constraint regression test

**Files:**
- Create: `cove/reference/cove2/prompts/phase1.md`
- Create: `cove/reference/cove2/prompts/phase2_deep.md`
- Create: `cove/reference/cove2/prompts/phase2_shallow.md`
- Create: `cove/reference/cove2/prompts/phase3.md`
- Test: `cove/reference/tests/test_prompts.py`

- [ ] **Step 1: Write the failing test** (locks paper constraints C2/C3/C4 into the prompt text)

`cove/reference/tests/test_prompts.py`:
```python
from pathlib import Path

PROMPTS = Path(__file__).resolve().parent.parent / "cove2" / "prompts"


def _text(name):
    return (PROMPTS / name).read_text(encoding="utf-8").lower()


def test_phase1_requires_open_questions_not_yesno():
    t = _text("phase1.md")
    assert "open" in t and "yes/no" in t            # C2


def test_deep_verifier_is_isolated_from_draft():
    t = _text("phase2_deep.md")
    assert "do not have access" in t                # C3


def test_shallow_verifier_is_conservative():
    t = _text("phase2_shallow.md")
    assert "caveat" in t and "do not" in t          # C4


def test_phase3_requires_citations_and_honesty():
    t = _text("phase3.md")
    assert "citation" in t and "unable to verify" in t
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cove/reference && python -m pytest tests/test_prompts.py -v`
Expected: FAIL — `FileNotFoundError` (prompt files don't exist yet).

- [ ] **Step 3: Write `cove/reference/cove2/prompts/phase1.md`**

```markdown
You produce a draft answer to the user's query and a plan to fact-check it.

Output ONLY a single valid JSON object, no prose around it, matching this shape:

{
  "draft": "<your answer>",
  "needs_verification": true,
  "claims": [
    { "text": "<a specific assertion taken from the draft>",
      "tier": "deep",
      "verification_query": "<an open factual question for a search engine>" },
    { "text": "<a logic/reasoning assertion>", "tier": "shallow" }
  ]
}

Rules:
- Set "needs_verification" to false when the draft is chitchat, subjective opinion,
  or high-certainty common knowledge. In that case "claims" may be empty.
- Tag a claim "deep" if ANY of these apply: specific numbers/dates/versions/API
  signatures; named references (papers, people, URLs, packages); niche or
  post-training-cutoff content; legal/medical/financial/compliance content; the user
  will act on it without re-checking.
- Tag a claim "shallow" for logic/causal relationships, context-dependent claims,
  subjective statements, or common knowledge.
- Every "deep" claim MUST include a "verification_query" that is:
  - an OPEN factual question (e.g. "How tall is the Eiffel Tower?"), NEVER a yes/no
    question (e.g. "Is the Eiffel Tower 250m tall?"). Models tend to agree with a
    yes/no framing whether the stated fact is right or wrong.
  - SELF-CONTAINED: it must make sense to someone who has not seen the draft. Do not
    use pronouns or phrases like "the above" / "this claim".
```

- [ ] **Step 4: Write `cove/reference/cove2/prompts/phase2_deep.md`**

```markdown
You verify ONE factual question using ONLY the web-search evidence provided below.

You do NOT have access to any original draft or prior conversation — answer the
question purely on its own terms, grounded in the evidence.

If the evidence is insufficient, missing, or conflicting, answer exactly:
"unable to verify". Do NOT use unsupported prior knowledge to fill the gap.

Return exactly two lines:
Answer: <concise, evidence-based answer, or "unable to verify">
Confidence: High | Medium | Low
```

- [ ] **Step 5: Write `cove/reference/cove2/prompts/phase2_shallow.md`**

```markdown
You assess ONE reasoning/common-knowledge claim for internal consistency.

You have NO external evidence and NO original draft. Be conservative: relying on
self-assessment without external feedback can degrade an answer, so do NOT assert
new external facts and do NOT confidently rewrite the claim. Prefer flagging a
caveat or lower confidence over a confident verdict.

Return exactly two lines:
Answer: <a brief caveat or "looks internally consistent">
Confidence: High | Medium | Low
```

- [ ] **Step 6: Write `cove/reference/cove2/prompts/phase3.md`**

```markdown
You are a strict reviewer. You are given the original draft and per-claim
verification results. Some results are grounded in external evidence (deep), others
are internal-reasoning only (shallow, no external evidence).

Compare the draft against the verification results and produce a corrected answer.

Rules:
- For claims grounded in external evidence: where the evidence contradicts the draft,
  correct it confidently and attach an inline citation [n] to the supporting source.
- For shallow (no external evidence) claims: apply caveats only — do NOT confidently
  rewrite based on self-reflection.
- If the evidence cannot support a claim, say so honestly with "unable to verify".
  Never fabricate to fill a gap.

Output ONLY a single valid JSON object:

{
  "summary": {"checked": 0, "confirmed": 0, "corrected": 0, "uncertain": 0},
  "corrections": ["<original> -> <corrected> (basis: [n])"],
  "revised": "<final answer text with inline [n] citations>",
  "citations": ["<url for [1]>", "<url for [2]>"]
}

The inline [n] markers in "revised" are 1-indexed into "citations".
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd cove/reference && python -m pytest tests/test_prompts.py -v`
Expected: PASS (4 passed).

- [ ] **Step 8: Commit**

```bash
git add cove/reference/cove2/prompts cove/reference/tests/test_prompts.py
git commit -m "$(printf '✨ feat(cove): add phase prompts with paper-grounded constraints\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Pipeline — `phase1_plan` (+ retry, prompt loader)

**Files:**
- Create: `cove/reference/cove2/pipeline.py`
- Test: `cove/reference/tests/test_pipeline_phase1.py`

- [ ] **Step 1: Write the failing test**

`cove/reference/tests/test_pipeline_phase1.py`:
```python
import asyncio
from cove2.pipeline import phase1_plan
from tests.fakes import FakeLLMClient


def test_phase1_parses_plan():
    raw = {"draft": "hi there", "needs_verification": False, "claims": []}
    llm = FakeLLMClient(json_responses=[raw])
    plan = asyncio.run(phase1_plan(llm, "hi"))
    assert plan.needs_verification is False
    assert plan.draft == "hi there"


def test_phase1_retries_once_on_invalid_json():
    bad = {"draft": "d", "needs_verification": "nope", "claims": []}
    good = {"draft": "d", "needs_verification": True, "claims": []}
    llm = FakeLLMClient(json_responses=[bad, good])
    plan = asyncio.run(phase1_plan(llm, "q"))
    assert plan.needs_verification is True
    assert len(llm.json_calls) == 2
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cove/reference && python -m pytest tests/test_pipeline_phase1.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cove2.pipeline'`.

- [ ] **Step 3: Write `cove/reference/cove2/pipeline.py`** (initial version: loader + Phase 1)

```python
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cove/reference && python -m pytest tests/test_pipeline_phase1.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add cove/reference/cove2/pipeline.py cove/reference/tests/test_pipeline_phase1.py
git commit -m "$(printf '✨ feat(cove): add phase1_plan with retry\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: Pipeline — `phase2_verify` (open-book deep / conservative shallow)

**Files:**
- Modify: `cove/reference/cove2/pipeline.py` (append helpers + `phase2_verify`)
- Test: `cove/reference/tests/test_pipeline_phase2.py`

- [ ] **Step 1: Write the failing test** (guards C3 isolation + C4 no-search-for-shallow)

`cove/reference/tests/test_pipeline_phase2.py`:
```python
import asyncio
from cove2.schema import Plan, Claim, SearchResult
from cove2.pipeline import phase2_verify
from tests.fakes import FakeLLMClient, FakeSearchProvider


def test_deep_verifier_never_sees_draft():
    plan = Plan(
        draft="SECRET-DRAFT-TEXT",
        needs_verification=True,
        claims=[Claim("Paris is the capital", "deep", "what is the capital of France?")],
    )
    search = FakeSearchProvider(default=[SearchResult("t", "Paris is the capital", "http://x")])
    llm = FakeLLMClient(text_responses=["Answer: Paris\nConfidence: High"])

    results = asyncio.run(phase2_verify(plan, search, llm))

    assert results[0].externally_grounded is True
    assert results[0].sources == ["http://x"]
    assert results[0].answer == "Paris"
    assert results[0].confidence == "High"
    # C3: the verifier must not receive the draft in system or user
    system, user = llm.complete_calls[0]
    assert "SECRET-DRAFT-TEXT" not in system
    assert "SECRET-DRAFT-TEXT" not in user
    # the search used the open verification_query
    assert search.queries == ["what is the capital of France?"]


def test_shallow_claim_is_not_searched():
    plan = Plan(
        draft="d",
        needs_verification=True,
        claims=[Claim("therefore it follows", "shallow")],
    )
    search = FakeSearchProvider(default=[SearchResult("t", "s", "u")])
    llm = FakeLLMClient(text_responses=["Answer: looks internally consistent\nConfidence: Low"])

    results = asyncio.run(phase2_verify(plan, search, llm))

    assert search.queries == []                 # C4: no external search for shallow
    assert results[0].externally_grounded is False
    assert results[0].sources == []


def test_gate_false_returns_empty():
    plan = Plan(draft="hi", needs_verification=False, claims=[])
    search = FakeSearchProvider(default=[])
    llm = FakeLLMClient()
    assert asyncio.run(phase2_verify(plan, search, llm)) == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cove/reference && python -m pytest tests/test_pipeline_phase2.py -v`
Expected: FAIL — `ImportError: cannot import name 'phase2_verify'`.

- [ ] **Step 3: Append to `cove/reference/cove2/pipeline.py`**

```python
def _format_evidence(evidence: list[SearchResult]) -> str:
    if not evidence:
        return "(no results)"
    return "\n\n".join(
        f"[{i}] {r.title}\n{r.snippet}\n{r.url}" for i, r in enumerate(evidence, 1)
    )


def parse_verifier_output(text: str) -> tuple[str, str]:
    """Parse the two-line 'Answer: / Confidence:' verifier reply. Conservative defaults."""
    answer, confidence = "unable to verify", "Low"
    for line in text.splitlines():
        stripped = line.strip()
        lowered = stripped.lower()
        if lowered.startswith("answer:"):
            answer = stripped.split(":", 1)[1].strip()
        elif lowered.startswith("confidence:"):
            confidence = stripped.split(":", 1)[1].strip()
    return answer, confidence


async def _verify_deep(claim: Claim, search: SearchProvider, llm: LLMClient) -> ClaimResult:
    query = claim.verification_query or claim.text
    evidence = await search.search(query)
    system = _load_prompt("phase2_deep.md")
    # C3: the verifier receives only the question + evidence — never the draft.
    user = f"Question: {query}\n\nEvidence:\n{_format_evidence(evidence)}"
    answer, confidence = parse_verifier_output(await llm.complete(system, user))
    return ClaimResult(
        claim=claim, answer=answer, confidence=confidence,
        externally_grounded=True,
        sources=[r.url for r in evidence], evidence=evidence,
    )


async def _verify_shallow(claim: Claim, llm: LLMClient) -> ClaimResult:
    # C4: closed-book and conservative — no search, no draft, caveats only.
    system = _load_prompt("phase2_shallow.md")
    answer, confidence = parse_verifier_output(await llm.complete(system, f"Claim: {claim.text}"))
    return ClaimResult(
        claim=claim, answer=answer, confidence=confidence,
        externally_grounded=False, sources=[], evidence=[],
    )


async def phase2_verify(plan: Plan, search: SearchProvider, llm: LLMClient) -> list[ClaimResult]:
    """Phase 2: route by tier. Deep claims verify open-book in parallel; shallow stay closed-book."""
    if not plan.needs_verification:
        return []
    deep = [c for c in plan.claims if c.tier == "deep"]
    shallow = [c for c in plan.claims if c.tier != "deep"]
    deep_results = await asyncio.gather(*(_verify_deep(c, search, llm) for c in deep))
    shallow_results = await asyncio.gather(*(_verify_shallow(c, llm) for c in shallow))
    return list(deep_results) + list(shallow_results)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cove/reference && python -m pytest tests/test_pipeline_phase2.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add cove/reference/cove2/pipeline.py cove/reference/tests/test_pipeline_phase2.py
git commit -m "$(printf '✨ feat(cove): add phase2_verify with open-book deep / conservative shallow\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: Pipeline — `phase3_finalize` (citations + honesty)

**Files:**
- Modify: `cove/reference/cove2/pipeline.py` (append `phase3_finalize`)
- Test: `cove/reference/tests/test_pipeline_phase3.py`

- [ ] **Step 1: Write the failing test**

`cove/reference/tests/test_pipeline_phase3.py`:
```python
import asyncio
from cove2.schema import Claim, ClaimResult, SearchResult
from cove2.pipeline import phase3_finalize
from tests.fakes import FakeLLMClient


def test_phase3_emits_citations_and_sees_draft():
    results = [
        ClaimResult(
            claim=Claim("Eiffel is 250m", "deep", "how tall is the eiffel tower?"),
            answer="330 m", confidence="High", externally_grounded=True,
            sources=["http://x"], evidence=[SearchResult("t", "330 m", "http://x")],
        )
    ]
    out = {
        "summary": {"checked": 1, "confirmed": 0, "corrected": 1, "uncertain": 0},
        "corrections": ["250m -> 330m (basis: [1])"],
        "revised": "The Eiffel Tower is 330m tall [1].",
        "citations": ["http://x"],
    }
    llm = FakeLLMClient(json_responses=[out])

    final = asyncio.run(phase3_finalize(llm, "The Eiffel Tower is 250m tall.", results))

    assert final.citations == ["http://x"]
    assert "[1]" in final.revised
    assert final.summary["corrected"] == 1
    # the reviewer DOES receive the draft (its job is to compare draft vs evidence)
    _system, user, _schema = llm.json_calls[0]
    assert "The Eiffel Tower is 250m tall." in user
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cove/reference && python -m pytest tests/test_pipeline_phase3.py -v`
Expected: FAIL — `ImportError: cannot import name 'phase3_finalize'`.

- [ ] **Step 3: Append to `cove/reference/cove2/pipeline.py`**

```python
def _format_results(results: list[ClaimResult]) -> str:
    blocks = []
    for r in results:
        basis = "external evidence" if r.externally_grounded else "internal reasoning (no external evidence)"
        sources = ", ".join(r.sources) if r.sources else "(none)"
        blocks.append(
            f"- Claim: {r.claim.text}\n"
            f"  Verified answer: {r.answer}\n"
            f"  Confidence: {r.confidence}\n"
            f"  Basis: {basis}\n"
            f"  Sources: {sources}"
        )
    return "\n".join(blocks) if blocks else "(no claims verified)"


async def phase3_finalize(llm: LLMClient, draft: str, results: list[ClaimResult]) -> FinalAnswer:
    """Phase 3: strict review of draft vs. verification results; emit revision + citations."""
    system = _load_prompt("phase3.md")
    user = f"Original draft:\n{draft}\n\nVerification results:\n{_format_results(results)}"
    raw = await llm.complete_json(system, user, PHASE3_JSON_SCHEMA)
    return FinalAnswer(
        summary=raw.get("summary", {}),
        corrections=list(raw.get("corrections", [])),
        revised=raw.get("revised", draft),
        citations=list(raw.get("citations", [])),
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cove/reference && python -m pytest tests/test_pipeline_phase3.py -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add cove/reference/cove2/pipeline.py cove/reference/tests/test_pipeline_phase3.py
git commit -m "$(printf '✨ feat(cove): add phase3_finalize with citations\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: Pipeline — `run` orchestration + optional iteration (C5)

**Files:**
- Modify: `cove/reference/cove2/pipeline.py` (append `run`)
- Test: `cove/reference/tests/test_pipeline_run.py`

- [ ] **Step 1: Write the failing test**

`cove/reference/tests/test_pipeline_run.py`:
```python
import asyncio
from cove2.schema import SearchResult
from cove2.pipeline import run
from tests.fakes import FakeLLMClient, FakeSearchProvider

PLAN = {
    "draft": "The Eiffel Tower is 250m tall.",
    "needs_verification": True,
    "claims": [{"text": "Eiffel Tower is 250m", "tier": "deep",
                "verification_query": "how tall is the eiffel tower?"}],
}


def _final(corrections):
    return {
        "summary": {"checked": 1, "confirmed": 0, "corrected": len(corrections), "uncertain": 0},
        "corrections": corrections,
        "revised": "The Eiffel Tower is 330m tall [1].",
        "citations": ["http://x"],
    }


def test_gate_false_skips_verification():
    plan = {"draft": "Hello!", "needs_verification": False, "claims": []}
    llm = FakeLLMClient(json_responses=[plan])
    search = FakeSearchProvider(default=[])
    final = asyncio.run(run("hi", llm, search))
    assert final.revised == "Hello!"
    assert search.queries == []
    assert final.summary["checked"] == 0


def test_single_pass_is_default():
    search = FakeSearchProvider(default=[SearchResult("t", "330 m", "http://x")])
    llm = FakeLLMClient(
        json_responses=[PLAN, _final(["250m -> 330m"])],
        text_responses=["Answer: 330 m\nConfidence: High"],
    )
    final = asyncio.run(run("How tall is the Eiffel Tower?", llm, search))
    assert "330m" in final.revised
    assert search.queries.count("how tall is the eiffel tower?") == 1


def test_iteration_reverifies_once():
    search = FakeSearchProvider(default=[SearchResult("t", "330 m", "http://x")])
    llm = FakeLLMClient(
        json_responses=[PLAN, _final(["250m -> 330m"]), _final([])],
        text_responses=["Answer: 330 m\nConfidence: High", "Answer: 330 m\nConfidence: High"],
    )
    final = asyncio.run(run("q", llm, search, max_iterations=2))
    assert search.queries.count("how tall is the eiffel tower?") == 2   # C5: re-verified once
    assert final.corrections == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cove/reference && python -m pytest tests/test_pipeline_run.py -v`
Expected: FAIL — `ImportError: cannot import name 'run'`.

- [ ] **Step 3: Append to `cove/reference/cove2/pipeline.py`**

```python
async def run(query: str, llm: LLMClient, search: SearchProvider, *, max_iterations: int = 1) -> FinalAnswer:
    """End-to-end pipeline. ``max_iterations`` > 1 enables the optional CRITIC-style
    verify-then-correct loop (C5, default off): after finalizing, re-verify and
    re-finalize while corrections were made, up to ``max_iterations`` total passes."""
    plan = await phase1_plan(llm, query)
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
```

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `cd cove/reference && python -m pytest -v`
Expected: PASS (all tests across the 7 test files green).

- [ ] **Step 5: Commit**

```bash
git add cove/reference/cove2/pipeline.py cove/reference/tests/test_pipeline_run.py
git commit -m "$(printf '✨ feat(cove): add run orchestration with optional iteration\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 9: Reference README (per-provider JSON-mode notes)

**Files:**
- Create: `cove/reference/README.md`

- [ ] **Step 1: Write `cove/reference/README.md`**

````markdown
# CoVe 2.0 — Reference Implementation

A provider-agnostic Python implementation of the Agentic CoVe 2.0 pipeline used by the
`cove` skill. The pipeline depends only on two protocols (`LLMClient`,
`SearchProvider`), so it runs against any LLM/search backend.

## Pipeline

`run(query, llm, search, max_iterations=1)`:
1. **phase1_plan** — draft + JSON verification plan (`needs_verification` gate, per-claim
   `deep`/`shallow` tier).
2. **phase2_verify** — `deep` claims verified open-book in parallel (`asyncio.gather`),
   each verifier isolated from the draft; `shallow` claims stay closed-book and
   conservative.
3. **phase3_finalize** — strict review against evidence → revised answer with `[n]`
   citations.

`max_iterations > 1` enables the optional CRITIC-style verify-then-correct loop.

## Install & test

```bash
cd cove/reference
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'        # tests only (zero core deps)
python -m pytest -q
```

Live use also needs providers: `pip install -e '.[providers]'`.

## Usage

```python
import asyncio
from cove2.pipeline import run
from cove2.providers import AnthropicLLM, TavilySearch

final = asyncio.run(run(
    "How tall is the Eiffel Tower?",
    AnthropicLLM(api_key="..."),
    TavilySearch(api_key="..."),
))
print(final.revised)      # answer with [n] citations
print(final.citations)    # source URLs
```

## Swapping providers

`LLMClient` needs two async methods — `complete(system, user) -> str` and
`complete_json(system, user, schema) -> dict`. "Forced JSON" differs per provider;
**verify the current signature via context7 before relying on it:**

- **Anthropic** (shipped): forced tool call (`tools=[{...}], tool_choice={"type":"tool"}`),
  read `tool_use.input`.
- **OpenAI**: `chat.completions.create(..., response_format={"type":"json_schema",
  "json_schema":{"name":"plan","schema":schema}})`, then
  `json.loads(resp.choices[0].message.content)`. (Or the higher-level
  `client.chat.completions.parse(response_format=PydanticModel)` helper.)
- **Gemini** (`google-genai` SDK): `client.models.generate_content(...,
  config={"response_mime_type":"application/json", "response_json_schema": schema})`,
  then parse `response.text`. NOTE: the new `google-genai` SDK uses `config=` (NOT the
  legacy `google-generativeai` `generation_config=`), and `response_json_schema` for a
  raw dict schema (`response_schema` is for Pydantic/Enum types). Verified via context7.

`SearchProvider` needs one async method — `search(query) -> list[SearchResult]`. Tavily
is shipped; for Google CSE map `items[].{title,snippet,link}`; for a RAG store map your
retrieved chunks to `SearchResult(title, snippet, url)`.

## Relationship to the skill

`cove/SKILL.md` is the agent-native version of this same pipeline (its "tools" are the
agent's own parallel search-subagents). This package is for embedding CoVe 2.0 in your
own LLM application. Both share the same Phase 1 / Phase 3 prompt contracts.
````

- [ ] **Step 2: Commit**

```bash
git add cove/reference/README.md
git commit -m "$(printf '📝 docs(cove): add reference implementation README\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 10: Rewrite `cove/SKILL.md` (three-phase agent protocol)

**Files:**
- Modify (full rewrite): `cove/SKILL.md`

- [ ] **Step 1: Replace the entire contents of `cove/SKILL.md` with:**

````markdown
---
name: cove
description: Agentic Chain-of-Verification (CoVe 2.0) — open-book, tool-interactive self-verification. Manually triggered via /cove to verify and refine a response through a three-phase pipeline (adaptive draft & plan → tiered open-book verification → critique & finalize with citations). Grafts CRITIC's external-tool verification onto CoVe's structured deliberation. Ideal for fact-heavy answers where accuracy is critical.
---

# Agentic Chain-of-Verification (CoVe 2.0)

Verify and refine the most recent response (or a `/cove <text>` argument) through a
three-phase, **open-book** self-verification pipeline. This upgrades the original
closed-book CoVe by grafting CRITIC's tool-interactive critiquing onto it — exactly the
extension the CoVe paper proposes in its own conclusion: *"equip CoVe with tool-use,
e.g., to use retrieval augmentation in the verification execution step."*

## Why open-book

The CoVe paper verifies claims using only the model's own knowledge (closed-book). The
CRITIC paper finds that *"exclusive reliance on self-correction without external feedback
may yield modest improvements or even deteriorate performance."* So CoVe 2.0 verifies
high-risk claims against **external evidence** (web search) and reserves confident
rewriting for claims that evidence actually grounds.

## Pipeline overview

Phase 1 (Adaptive Draft & Plan) → Phase 2 (Tiered Verification) → Phase 3 (Critique &
Finalize with Citations). A `needs_verification` gate short-circuits chitchat and common
knowledge so cost is spent only where it matters.

---

## Phase 1 — Adaptive Draft & Plan

**Identify the draft:**
- `/cove <text>` → verify that argument text.
- no argument → verify the most recent substantive response in the conversation.

**Emit a plan as JSON.** (Enforced by instruction + the example below — you are following
instructions, not calling an API with a response schema.)

```json
{
  "draft": "the answer being verified",
  "needs_verification": true,
  "claims": [
    { "text": "a specific factual assertion from the draft",
      "tier": "deep",
      "verification_query": "an open factual question for a search engine" },
    { "text": "a logic / reasoning assertion",
      "tier": "shallow" }
  ]
}
```

**Rules:**
- `needs_verification: false` → the draft is chitchat, subjective, or high-certainty
  common knowledge. Report "no verification needed" and stop.
- Tag each claim `deep` if **any** signal applies; otherwise `shallow`:

  | deep signal | why |
  |---|---|
  | numbers, dates, versions, API signatures | most-hallucinated class |
  | named references (papers, people, URLs, packages) | frequently fabricated |
  | niche / post-training-cutoff content | high uncertainty |
  | legal / medical / financial / compliance | irreversible errors |
  | user will act on it without re-checking | high error cost |

  Use `shallow` for: logic/causal relationships, claims that depend on conversation
  context, subjective opinion, or common knowledge.
- Every `deep` claim MUST carry a `verification_query` that is:
  - an **open factual question**, NOT a yes/no "is X correct?" — the CoVe ablation shows
    models tend to agree with a yes/no framing whether the fact is right or wrong;
  - **self-contained** — no pronouns or references to "the draft", because the verifier
    will not see the draft (Phase 2).

---

## Phase 2 — Tiered Verification

Route each claim by `tier`.

### deep → open-book, parallel, isolated

Dispatch all `deep` claims **in parallel** (single message, multiple subagent calls).
Each subagent:
- receives **only its `verification_query`** — never the draft. This preserves CoVe's
  Factored isolation (a verifier that sees the draft tends to repeat its hallucination)
  while adding open-book grounding;
- runs web search and answers the question **from the retrieved evidence only**;
- returns `answer`, short quoted `evidence`, `source_urls`, and `confidence`
  (High/Medium/Low). If evidence is insufficient, it returns "unable to verify" rather
  than guessing.

**Platform tools:**
- Claude Code: `Agent` (subagent) + `WebSearch`.
- Gemini CLI: `invoke_agent` + `google_web_search`.

**Subagent prompt template:**

```
Answer this question using ONLY the web-search evidence you gather. You do NOT have
access to any prior draft — answer the question on its own terms.

Question: <verification_query>

Steps: run web search, read the top results, then answer.
If the evidence is insufficient or conflicting, answer exactly "unable to verify".
Do NOT use unsupported prior knowledge to fill gaps.

Return:
- Answer: <concise, evidence-based answer, or "unable to verify">
- Evidence: <1-3 short quoted snippets>
- Sources: <list of result URLs>
- Confidence: High | Medium | Low
```

### shallow → closed-book, in-context, conservative

Answer in-context WITHOUT searching and WITHOUT referencing the draft. Be
**conservative** (CRITIC: self-correction without external feedback can degrade output):
only **flag uncertainty or add a caveat** — do NOT confidently rewrite a shallow claim.
Confident correction is reserved for evidence-grounded deep claims.

---

## Phase 3 — Critique & Finalize with Citations

Act as a strict reviewer. Compare the draft against the verification results:

- For **deep** (evidence-grounded) claims: where evidence contradicts the draft, correct
  it confidently and cite the supporting source `[n]`.
- For **shallow** claims: apply caveats only; do not rewrite based on self-reflection.
- If external evidence cannot support a claim, **say so honestly** — never fabricate to
  fill the gap.

**Output:**

```
## Verification Summary
- Checked: N | Confirmed: X | Corrected: Y | Uncertain: Z

## Corrections
- [original] → [corrected]  (basis: [n])

## Sources
[1] <url>
[2] <url>

## Revised Response
<final text with inline [n] citations>
```

---

## Optional: iterate (default off)

Single pass is the default. For high-stakes long-form answers you may run one extra
verify→correct cycle (CRITIC-style): after Phase 3, re-verify only the corrected deep
claims once, then re-finalize. Cap at one extra iteration to bound latency.

## Cost-awareness

- The `needs_verification` gate skips chitchat / common knowledge entirely.
- Shallow stays closed-book (no search round-trip).
- For >10 verifiable claims, prioritize the highest-risk deep claims.

## Reference implementation

`cove/reference/` contains a provider-agnostic Python implementation of this pipeline
(async parallel verification, pluggable `LLMClient` / `SearchProvider`) for embedding
CoVe 2.0 in your own LLM app. See `cove/reference/README.md`.
````

- [ ] **Step 2: Sanity-check the front-matter parses** (name/description block intact)

Run: `head -4 cove/SKILL.md`
Expected: shows the `---` / `name: cove` / `description: ...` / `---` block.

- [ ] **Step 3: Commit**

```bash
git add cove/SKILL.md
git commit -m "$(printf '✨ feat(cove): rewrite SKILL.md as three-phase open-book CoVe 2.0\n\nUpgrade closed-book verification to open-book (CRITIC graft); add\nneeds_verification gate, parallel isolated search-subagents, and\ncitation-backed finalize. Tier routing and /cove interface preserved.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 11: Refresh `README.md` and `README.en.md` cove sections

**Files:**
- Modify: `README.md` (the `### ✅ \`cove\`` section, around lines 156–188)
- Modify: `README.en.md` (the equivalent cove section)

- [ ] **Step 1: Read both READMEs to locate the exact current cove sections**

Run: `grep -n "cove" README.md README.en.md`
Expected: prints the line numbers of the cove overview-table row and the `### ✅ \`cove\`` section in each file.

- [ ] **Step 2: In `README.md`, replace the entire `### ✅ \`cove\`` section** (from the `### ✅ \`cove\`` heading down to — but not including — the next top-level `---` or section) with:

````markdown
### ✅ `cove`

基於 Meta AI 的 [Chain-of-Verification（CoVe）](https://arxiv.org/abs/2309.11495) 與 Microsoft 的 [CRITIC](https://arxiv.org/abs/2305.11738)，將原本的**閉卷**自我驗證升級為**開卷（tool-interactive）**的三階段管線——正是 CoVe 論文結論自己提出的延伸方向。

以 `/cove` 手動觸發，對前一個回應（或指定內容）進行驗證與修訂。

#### 🔄 三階段管線

| Phase | 動作 | 目的 |
|---|---|---|
| **1️⃣ Draft & Plan** | 草擬回答並輸出 JSON 驗證計畫 | `needs_verification` 閘門短路閒聊／常識 |
| **2️⃣ Tiered Verify** | `deep` 走開卷平行 search-subagent、`shallow` 走保守閉卷 | 用外部證據接地，消滅閉卷幻覺 |
| **3️⃣ Critique & Finalize** | 對照證據嚴格審查、重寫並附 citations | 修正內容標明來源，無法佐證就誠實說明 |

#### 🎯 分層驗證（Tier Routing）

| Tier | 驗證方式 | 適用 |
|---|---|---|
| **🔬 `deep`** | 開卷：平行 search-subagent（fresh context，且**看不到原稿**） | 具體數字／版本／API、具名引用、法律醫療合規、冷門主題、User 會直接採用的結論 |
| **🪶 `shallow`** | 閉卷、保守（只加 caveat、不自信改寫） | 邏輯／推理、依賴對話 context、常識、主觀觀點 |

> 💡 `deep` 路徑同時保留 CoVe 的 **Factored 隔離**（驗證者看不到原稿，避免重複幻覺）與 CRITIC 的**開卷查證**（用搜尋證據接地）。`shallow` 之所以保守，是因為 CRITIC 實證「沒有外部回饋的自我修正可能無益甚至更糟」。

#### 🐍 Reference 實作

`cove/reference/` 附一份 provider-agnostic 的 Python 實作（`asyncio` 平行驗證、可插拔 `LLMClient` / `SearchProvider`），供將 CoVe 2.0 嵌入自家 LLM app。詳見 `cove/reference/README.md`。

#### 📥 安裝

```bash
npx skills add RayChang/agent-skills@cove
```
````

- [ ] **Step 3: Update the overview-table row in `README.md`** — change the `cove` description cell to reflect 2.0. Find the line:

```
| [✅ `cove`](#-cove) | Chain-of-Verification 自我驗證流程 | `/cove` |
```

Replace with:

```
| [✅ `cove`](#-cove) | Agentic CoVe 2.0：開卷三階段自我驗證 | `/cove` |
```

- [ ] **Step 4: In `README.en.md`, replace the equivalent cove section** with the English version:

````markdown
### ✅ `cove`

Built on Meta AI's [Chain-of-Verification (CoVe)](https://arxiv.org/abs/2309.11495) and
Microsoft's [CRITIC](https://arxiv.org/abs/2305.11738), this upgrades the original
**closed-book** self-verification into an **open-book (tool-interactive)** three-phase
pipeline — exactly the extension the CoVe paper proposes in its own conclusion.

Manually triggered with `/cove` to verify and refine the previous response (or supplied
text).

#### 🔄 Three-phase pipeline

| Phase | Action | Purpose |
|---|---|---|
| **1️⃣ Draft & Plan** | Draft the answer and emit a JSON verification plan | `needs_verification` gate short-circuits chitchat/common knowledge |
| **2️⃣ Tiered Verify** | `deep` → open-book parallel search-subagents; `shallow` → conservative closed-book | Ground claims in external evidence |
| **3️⃣ Critique & Finalize** | Strict review against evidence, rewrite with citations | Corrections cite sources; unsupported claims stated honestly |

#### 🎯 Tier routing

| Tier | How | When |
|---|---|---|
| **🔬 `deep`** | Open-book: parallel search-subagent (fresh context, **never sees the draft**) | numbers/versions/APIs, named references, legal/medical/compliance, niche topics, conclusions the user will act on |
| **🪶 `shallow`** | Closed-book, conservative (caveats only, no confident rewrite) | logic/reasoning, context-dependent, common knowledge, opinion |

> 💡 The `deep` path keeps CoVe's **Factored isolation** (the verifier can't see the
> draft, avoiding repeated hallucination) and adds CRITIC's **open-book grounding**.
> `shallow` is deliberately conservative because CRITIC shows self-correction without
> external feedback can fail to help or even degrade the answer.

#### 🐍 Reference implementation

`cove/reference/` ships a provider-agnostic Python implementation (`asyncio` parallel
verification, pluggable `LLMClient` / `SearchProvider`) for embedding CoVe 2.0 in your
own LLM app. See `cove/reference/README.md`.

#### 📥 Install

```bash
npx skills add RayChang/agent-skills@cove
```
````

- [ ] **Step 5: Update the overview-table row in `README.en.md`** similarly (change the cove description to "Agentic CoVe 2.0: open-book three-phase self-verification").

- [ ] **Step 6: Verify no broken anchors and the full test suite still passes**

Run:
```bash
grep -n "cove" README.md README.en.md
cd cove/reference && python -m pytest -q
```
Expected: cove anchors/links intact in both READMEs; pytest all green.

- [ ] **Step 7: Commit**

```bash
git add README.md README.en.md
git commit -m "$(printf '📝 docs(readme): document Agentic CoVe 2.0 open-book pipeline\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** Hybrid deliverable → Tasks 1-9 (reference) + Task 10 (SKILL.md). Three-phase layered merge → Tasks 5-8 + 10. C1 (thesis) → SKILL.md intro + README (Task 10/11). C2 (open questions) → `phase1.md` + `parse_plan` + test_prompts/test_schema. C3 (verifier blind to draft) → `_verify_deep` + `test_deep_verifier_never_sees_draft`. C4 (conservative shallow) → `_verify_shallow` + `phase2_shallow.md` + tests. C5 (optional iteration) → `run(max_iterations)` + `test_iteration_reverifies_once`. Provider-agnostic → `providers.py` protocols + reference README. Testing strategy (fakes, hermetic) → Task 3 fakes used throughout. Docs update → Task 11. All spec sections map to a task.
- **Placeholder scan:** No TBD/TODO; every code/prompt/doc step contains full content. SDK adapters intentionally instruct context7 verification (per user rule) rather than asserting signatures — not a placeholder, a guardrail.
- **Type consistency:** `Plan`/`Claim`/`SearchResult`/`ClaimResult`/`FinalAnswer` defined in Task 2 and used unchanged in Tasks 3/6/7/8. `phase1_plan`/`phase2_verify`/`phase3_finalize`/`run` signatures consistent across Tasks 5-8 and the reference README. `parse_verifier_output`, `_verify_deep`, `_verify_shallow`, `_format_evidence`, `_format_results`, `_load_prompt` all defined before use. Fake doubles' attributes (`complete_calls`, `json_calls`, `queries`) match every test that reads them.
````
