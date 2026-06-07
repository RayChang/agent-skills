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

`max_iterations > 1` enables the optional CRITIC-style verify-then-correct loop. Note:
each extra iteration re-verifies *all* claims (a deliberate simplification over the
"re-verify only corrected claims" ideal described in the skill).

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
  raw dict schema (`response_schema` is for Pydantic/Enum types).

`SearchProvider` needs one async method — `search(query) -> list[SearchResult]`. Tavily
is shipped; for Google CSE map `items[].{title,snippet,link}`; for a RAG store map your
retrieved chunks to `SearchResult(title, snippet, url)`.

## Relationship to the skill

`cove/SKILL.md` is the agent-native version of this same pipeline (its "tools" are the
agent's own parallel search-subagents). This package is for embedding CoVe 2.0 in your
own LLM application. Both share the same Phase 1 / Phase 3 *semantic* contracts (same fields and rules —
open verification questions, draft-blind deep verification, citations, honest "unable
to verify"); they differ only in serialization: the skill renders Markdown, this
package emits JSON.
