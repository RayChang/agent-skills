# Agentic CoVe 2.0 — Worked Example (manual dry-run)

- **Date:** 2026-06-07
- **Protocol:** `cove/SKILL.md` (Agentic CoVe 2.0, three-phase open-book)
- **What it shows:** the open-book pipeline catching two factual errors that originate
  in the model's own memory — exactly the failure class a *closed-book* self-check
  cannot catch (the errant source is the model itself).

This is a real run: Phase 2's deep verifiers actually ran web search, each blind to the
draft (constraint **C3**), and returned cited evidence.

---

## Subject

**Question:** "Give me a quick factual brief on the Rust programming language."

**Initial draft (Phase 1 output):**

> Rust is a systems programming language originally created by **Graydon Hoare**; it
> began as his personal project and was later sponsored by **Mozilla**. **Rust 1.0 was
> released in May 2015.** Its headline feature is **memory safety without a garbage
> collector**, achieved through an **ownership** model enforced at compile time by the
> **borrow checker**. As of my knowledge, the **latest stable release is around Rust
> 1.85 (early 2026)**, shipping a new stable version roughly every six weeks. Rust has
> also been voted the **most-loved programming language in the Stack Overflow Developer
> Survey for around eight consecutive years**.

Two of those claims are wrong — both from training-data memory (a version that drifted
past the knowledge cutoff, and an undercounted streak).

---

## Phase 1 — Adaptive Draft & Plan

```json
{
  "needs_verification": true,
  "claims": [
    {"text": "Rust created by Graydon Hoare; sponsored by Mozilla", "tier": "deep",
     "verification_query": "Who created the Rust programming language and which organization sponsored its early development?"},
    {"text": "Rust 1.0 released May 2015", "tier": "deep",
     "verification_query": "What was the exact release date of Rust 1.0?"},
    {"text": "latest stable ~Rust 1.85 (early 2026)", "tier": "deep",
     "verification_query": "What is the latest stable release version of Rust and its release date as of mid-2026?"},
    {"text": "~8 consecutive years most-loved on Stack Overflow survey", "tier": "deep",
     "verification_query": "Has Rust been the most loved or admired language in recent Stack Overflow Developer Surveys, and for how many years?"},
    {"text": "memory safety via ownership + borrow checker (compile time)", "tier": "shallow"}
  ]
}
```

Note (**C2**): every `verification_query` is an *open* question, never a yes/no
"is X correct?" framing.

---

## Phase 2 — Tiered Verification

Four `deep` claims dispatched in parallel as open-book search-subagents, each receiving
**only its query, never the draft** (**C3**). The one `shallow` claim was handled
closed-book and conservatively (**C4**) — no search, no rewrite.

| Claim | Verdict | Evidence (web) |
|---|---|---|
| creator / sponsor | ✅ confirmed (enriched) | Hoare created it in **2006** as a personal project; Mozilla sponsored from **2009** [1] |
| Rust 1.0 date | ✅ confirmed (exact) | **May 15, 2015** — official announcement blog [2] |
| latest stable version | ❌ **corrected** | **Rust 1.96.0**, released **2026-05-28** [3] |
| SO survey streak | ❌ **corrected** | **~10 consecutive years (2016–2025)**; award renamed "most loved" → "most admired" in 2023 [4] |
| ownership / borrow checker | ✅ confirmed (shallow, in-context) | well-established; no external lookup needed |

---

## Phase 3 — Critique & Finalize with Citations

```
## Verification Summary
- Checked: 5 | Confirmed: 3 | Corrected: 2 | Uncertain: 0

## Corrections
- "latest stable ~Rust 1.85 (early 2026)" -> "Rust 1.96.0, released 2026-05-28" (basis: [3])
- "~8 consecutive years most-loved" -> "~10 years (2016-2025); renamed 'most admired' in 2023" (basis: [4])

## Sources
[1] https://en.wikipedia.org/wiki/Rust_(programming_language)
[2] https://blog.rust-lang.org/2015/05/15/Rust-1.0/
[3] https://blog.rust-lang.org/2026/05/28/Rust-1.96.0/
[4] https://survey.stackoverflow.co/2025/technology
```

**Revised response:**

> Rust is a systems programming language originally created by **Graydon Hoare**, who
> began it as a personal project in 2006; **Mozilla sponsored its development from 2009**
> [1]. **Rust 1.0 was released on May 15, 2015** [2]. Its headline feature is **memory
> safety without a garbage collector**, achieved through an **ownership** model enforced
> at compile time by the **borrow checker**. As of mid-2026, the **latest stable release
> is Rust 1.96.0 (released 2026-05-28)**, with a new stable version roughly every six
> weeks [3]. Rust has also topped the Stack Overflow Developer Survey as the most
> loved / most admired language for **about ten consecutive years (2016–2025)** — the
> award was renamed from *most loved* to *most admired* starting with the 2023 survey
> [4].

---

## What this demonstrates

- **Open-book value (the whole point of 2.0).** Both corrected claims came from the
  model's own memory. A closed-book CoVe verifier (the original skill) would have
  re-derived the same wrong answers, since the model is the very source of the error.
  This mirrors CRITIC's finding that self-correction without external feedback can fail
  to help or even degrade output.
- **C3 isolation.** The verifiers never saw the draft, so they could not anchor on or
  "agree with" its wrong numbers — they answered each open question from scratch.
- **C2 open questions.** Open factual queries (not yes/no) avoided the agree-with-the-
  premise bias the CoVe ablation warns about.
- **Honest citations.** Every correction (and every confirmation) is backed by a source;
  nothing was invented to fill a gap.
