# Agentic CoVe 2.0 — Design Spec

- **Date:** 2026-06-07
- **Skill:** `cove` (upgrade of the existing Chain-of-Verification skill)
- **Status:** Approved design, pending implementation plan
- **Authors:** Ray Chang + Claude

---

## 1. Context & Motivation

`cove` is a **platform-agnostic agent skill** (Markdown the agent follows in Claude
Code / Gemini CLI). It implements the four-step Chain-of-Verification (CoVe) flow.
Its "verification tools" are subagents the agent dispatches; "parallelism" is
dispatching multiple subagents in one message. It is **closed-book** — subagents
answer from internal knowledge only.

We are upgrading it to **Agentic CoVe 2.0** by grafting CRITIC's *open-book,
tool-interactive* verification onto CoVe's structured self-verification, fixing the
original's two weaknesses: closed-book verification and no external grounding.

### Source papers (read in full; load-bearing facts cited)

**CoVe** — *Chain-of-Verification Reduces Hallucination in LLMs* (arXiv:2309.11495v2,
Meta AI — first author also ETH Zürich):
- Four steps: Generate Baseline → Plan Verifications → Execute Verifications →
  Generate Final Verified Response. Step-3 variants: joint / 2-step / factored /
  factor+revise.
- **Closed-book by design**: §"Execute Verifications" — *"techniques such as
  retrieval-augmentation could be used … in this work we do not explore tool-use.
  Instead, we consider only using the LLM itself in all steps."*
- **Factored** (best variant): answer each verification question in an independent
  prompt that **must not condition on the baseline response** — otherwise the model
  repeats the same hallucination. Independent prompts can be **run in parallel**.
- Ablation: **open verification questions outperform yes/no questions** — in a yes/no
  frame the model tends to agree with the stated fact whether right or wrong.
- **Conclusion / future work (the thesis for this upgrade):** *"An obvious extension
  to our work is to equip CoVe with tool-use, e.g., to use retrieval augmentation in
  the verification execution step which would likely bring further gains."*

**CRITIC** — *Self-Correcting with Tool-Interactive Critiquing* (arXiv:2305.11738v4;
Microsoft — inferred from the code-release repo `github.com/microsoft/ProphetNet`, not
an explicit affiliation line in the paper body):
- Two steps, iterated: **Verify** (interact with external text-to-text tools — search
  engines, code interpreters, APIs — to produce critiques) → **Correct** (revise
  conditioned on input + previous output + critiques). Iterate verify-then-correct
  until a stopping condition (critique satisfied / max iterations / env feedback).
- QA tasks use **Google search** as the verification tool.
- **Key empirical finding driving our conservative shallow path:** *"exclusive
  reliance on self-correction without external feedback may yield modest improvements
  or even deteriorate performance."* LLMs are unreliable at validating their own
  outputs without external evidence.

---

## 2. Goals / Non-Goals

**Goals**
1. Rewrite `cove/SKILL.md` as a three-phase, agent-native, open-book protocol that
   preserves the existing deep/shallow tier routing (layered merge).
2. Ship an optional `cove/reference/` Python implementation demonstrating the async
   glue code and provider-agnostic abstractions, for users embedding CoVe 2.0 in
   their own LLM apps.
3. Stay platform-agnostic (Claude Code + Gemini CLI for the skill; Anthropic / OpenAI
   / Gemini APIs for the reference).

**Non-Goals**
- Not turning the skill itself into a runnable program — the agent is the runtime.
- No code-interpreter tool (CRITIC supports it; out of scope — QA/fact verification
  only).
- No multi-provider second language (TypeScript) in v1 — Python only.

---

## 3. Paper-Grounded Design Constraints

These five constraints come directly from reading the papers and are binding on the
implementation:

| # | Constraint | Source |
|---|---|---|
| C1 | Lead the skill with CoVe's own "equip CoVe with tool-use" future-work line as the rationale. | CoVe Conclusion |
| C2 | `verification_query` must be an **open factual question**, never a yes/no "is X correct?" frame. | CoVe ablation |
| C3 | The open-book deep verifier (search-subagent / reference critique call) **must not see the draft** — only the query. Preserves Factored isolation. | CoVe Factored |
| C4 | The **shallow closed-book path is conservative**: flag uncertainty / add caveats, do **not** confidently rewrite. Confident correction is reserved for externally-grounded (deep) claims. | CRITIC degradation finding |
| C5 | Provide an **optional** CRITIC-style iterate (re-verify corrected claims), **default off**, `max_iterations` default 1. | CRITIC iteration |

---

## 4. Architecture — Hybrid

```
cove/
  SKILL.md            ← PRIMARY: 3-phase agent protocol (layered merge)
  reference/          ← OPTIONAL: Python demo for API consumers
    pipeline.py       ← async orchestrator (phase1/phase2/phase3)
    providers.py      ← LLMClient + SearchProvider protocols + adapters
    prompts/
      phase1.md       ← shared prompt contract (Draft & Plan)
      phase3.md       ← shared prompt contract (Critique & Finalize)
    README.md         ← JSON-mode vs function-calling per provider
```

The SKILL and the reference share the **same Phase 1 / Phase 3 prompt contracts** so
the two stay conceptually identical.

---

## 5. `cove/SKILL.md` Design (three-phase × layered merge)

### Phase 1 — Adaptive Draft & Plan (forced JSON)

The agent evaluates the target response (latest substantive reply, or `/cove <text>`
argument) and emits:

```json
{
  "draft": "the initial answer",
  "needs_verification": true,
  "claims": [
    { "text": "a specific assertion from the draft",
      "tier": "deep",
      "verification_query": "open factual question (NOT yes/no)" },
    { "text": "a logic / reasoning assertion",
      "tier": "shallow" }
  ]
}
```

- `needs_verification: false` (chitchat / high-certainty common knowledge) →
  short-circuit, report "no verification needed", stop.
- Each claim carries its `tier` (deep | shallow) — the existing tier signals
  (numbers, dates, versions, named refs, niche/post-cutoff, legal/medical, high
  action-cost) decide deep vs shallow.
- Only `deep` claims carry a `verification_query` (constraint C2: open question).
- JSON is enforced by **instruction + worked example** (the agent is not calling an
  API with `response_format`). This distinction is stated explicitly in the skill.

### Phase 2 — Tiered Verification (the merge)

Route each claim by `tier`:

- **deep → open-book parallel search-subagent.** Dispatch all deep claims in a
  single message (parallel). Each subagent receives **only its `verification_query`,
  never the draft** (C3), runs native search, and returns:
  ```
  { answer, evidence (short quoted snippets), source_urls[], confidence }
  ```
  Isolation = CoVe Factored; native search = CRITIC open-book.
- **shallow → closed-book in-context, conservative** (C4): answer without referencing
  the draft; only flag uncertainty or add a caveat; do not confidently rewrite.

**Platform-agnostic tool naming** (existing repo convention):
- Claude Code: `Agent` (subagent) + `WebSearch`.
- Gemini CLI: `invoke_agent` + `google_web_search`.

### Phase 3 — Critique & Finalize with Citations

Act as a strict reviewer. Cross-check the draft against the **retrieved external
evidence** (CoVe factor+revise cross-check, grounded by CRITIC evidence). Output:

```
## Verification Summary
- Checked: N claims | Confirmed: X | Corrected: Y | Uncertain: Z

## Corrections
- [original claim] → [corrected claim]  (basis: [n])

## Revised Response
<text with inline citations [n] mapping to source URLs>
```

- Every correction cites the supporting source `[n]`.
- If external evidence **cannot** support a claim, say so honestly — never fabricate
  to fill the gap (aligns with user's fact-check rules).
- **Optional iteration (C5, default off):** after revision, re-verify the corrected
  deep claims once (`max 1`). Documented as an advanced variant; default single pass
  to keep latency bounded.

### Backward-compat note
The valuable parts of the current skill (tier signals, routing, cost-awareness) are
**folded in**, not discarded — see §6 for the full migration mapping. The `/cove`
trigger and "verify the latest response" default are unchanged.

---

## 6. Migration — Relationship to the Original `cove`

**Verdict: this is an evolution of the existing skill, not a ground-up rewrite.** The
only *directional* change is the deep-verification pivot from closed-book to open-book
— which is precisely CoVe's own stated future work. Everything else is preserved,
upgraded in the same spirit, or regrouped.

Caveat to set expectations: the `SKILL.md` **prose** is ~70%+ rewritten (to insert the
JSON schema, open-book flow, and citation format), so the **design lineage is
incremental** even though the **file diff will look like a large rewrite**. These are
not in conflict — lineage and churn are different axes.

| Original `cove` element | Fate | Notes |
|---|---|---|
| deep/shallow tier signals table | **Kept** — folded into Phase 1 `claims[].tier` | classification logic carried over verbatim |
| deep→subagent / shallow→in-context routing | **Kept** — becomes Phase 2 routing | structure unchanged |
| Parallel subagent dispatch | **Kept** | single message, multiple calls |
| Factored "don't see the draft" isolation | **Kept** + made explicit (C3) | was implicit, now a hard constraint |
| `/cove` trigger + verify-latest default | **Unchanged** | user-facing interface stable |
| Cost-Awareness (skip common knowledge) | **Upgraded** → Phase 1 `needs_verification` gate | same intent, clearer mechanism |
| 4-step Workflow (draft→plan→verify→revise) | **Restructured** → 3 phases (draft+plan merge into Phase 1) | relabel + regroup; same underlying CoVe loop |
| deep verification = closed-book (internal knowledge) | **Changed — the one core pivot → open-book search** | the CRITIC graft; basis of the whole upgrade |
| Phase 3 revision | **Upgraded** — now requires citations + evidence-grounded factor+revise | |
| shallow rewrite behavior | **New constraint** — conservative, caveat-not-rewrite (C4) | from CRITIC degradation finding |
| Variant selection (joint/2-step/factored/factor+revise) | **Subsumed** — open-book deep path ≈ factored+tool-use; iteration (C5) covers factor+revise | table dropped; behavior retained where it matters |
| — | **New & purely additive:** `reference/` Python | touches no existing file |
| — | **New:** optional iteration (C5, default off) | |

---

## 7. `cove/reference/` Design (Python primary)

### `pipeline.py` — async orchestrator
- `phase1_plan(llm, query) -> Plan` — one LLM call returning the Phase-1 JSON
  (validated against the `claims[]` schema).
- `phase2_verify(plan, search, llm) -> list[ClaimResult]` — `asyncio.gather` over the
  **deep** claims; per claim: `await search(query)` then `await llm.critique(query,
  evidence)` — **the draft is never passed in** (C3). Shallow claims handled inline,
  conservatively (C4).
- `phase3_finalize(llm, draft, results) -> FinalAnswer` — revision + citations.
- `run(query, *, max_iterations=1)` — wires the three phases; `max_iterations>1`
  enables the optional re-verify loop (C5).

### `providers.py` — provider-agnostic abstractions
- `LLMClient` protocol: `async complete_json(system, user, schema) -> dict` and
  `async complete(system, user) -> str`. Adapters: **Anthropic**, **OpenAI**,
  **Gemini** — each maps to its own JSON-mode / function-calling mechanism.
- `SearchProvider` protocol: `async search(query) -> list[SearchResult]`
  (`SearchResult = {title, snippet, url}`). **Tavily** adapter shipped as the example
  (returns clean LLM-ready text + sources); inline comments show how to swap in
  Google CSE or a RAG store.

### `prompts/phase1.md`, `prompts/phase3.md`
The full system-prompt text, shared verbatim (conceptually) with `SKILL.md`.

### `reference/README.md`
Per-provider notes: Anthropic tool-use, OpenAI `response_format`/function calling,
Gemini `responseSchema` — the concrete mechanisms behind "forced JSON".

---

## 8. Testing Strategy

- **Reference (Python):** unit tests with a **fake `LLMClient`** and **fake
  `SearchProvider`** (deterministic stubs) covering:
  - Phase 1 JSON parses & validates against `claims[]` schema; `needs_verification:
    false` short-circuits.
  - Phase 2 `asyncio.gather` runs deep claims concurrently; draft is **not** passed to
    the critique call (assert via the fake) — guards C3.
  - Shallow path adds caveats and does not rewrite — guards C4.
  - `max_iterations=1` runs single pass; `>1` re-verifies — guards C5.
  - Phase 3 emits citations mapping to `source_urls`; unsupported claim → honest
    "unable to verify".
- **Skill (Markdown):** no executable tests; validate by a worked end-to-end example
  embedded in the spec / PR description and a manual `/cove` dry-run.

---

## 9. Documentation Updates

- `README.md` + `README.en.md`: refresh the `cove` section to describe the three-phase
  open-book flow, the CoVe×CRITIC lineage, and the new `reference/` directory. Keep
  the install snippet.
- Skills badge count unchanged (still one `cove` skill).

---

## 10. Risks & Open Questions

- **Latency:** open-book deep verification adds search round-trips. Mitigated by
  parallel dispatch + `needs_verification` gating + shallow staying closed-book.
- **Search-provider keys:** the reference needs a Tavily key to run live; the fake
  provider keeps tests hermetic.
- **JSON robustness across providers:** mitigated by schema validation + a single
  retry on parse failure (reference); instruction+example (skill).

---

## 11. References

- CoVe — arXiv:2309.11495v2, `~/Downloads/arXiv-2309.11495v2/`
- CRITIC — arXiv:2305.11738v4, `~/Downloads/arXiv-2305.11738v4/`
