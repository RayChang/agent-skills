---
name: cove
description: Chain-of-Verification (CoVe) — manually triggered self-verification workflow. This skill should be used when the user invokes /cove to verify and refine a previous response through a structured 4-step process (draft → plan verification questions → independent verification → final revision). Ideal for fact-heavy answers, technical explanations, or any response where accuracy is critical.
---

# Chain-of-Verification (CoVe)

Apply CoVe to verify and refine the most recent response (or a user-specified response) through a structured 4-step self-verification workflow.

## Verification Tiers

Not every claim deserves the same rigor. Each claim is classified as **deep** or **shallow** and routed accordingly — this keeps verification cost aligned with risk and gets closer to the paper's Factored variant for high-risk claims.

### Tag a claim as `deep` if **any** signal applies

| Signal | Reason |
|---|---|
| 🔢 Specific numbers, dates, versions, API signatures | Most commonly hallucinated class |
| 🔗 Named references (papers, people, URLs, package names) | Frequently fabricated |
| 🔬 Niche topic or post-training-cutoff content | Model "knows" but uncertainty is high |
| ⚖️ Legal / medical / financial / compliance content | Irreversible errors |
| 🚀 User will act on it without further verification | High error cost |
| 📊 Draft contains ≥5 verifiable claims | Scale benefits from distribution |

### Use `shallow` when

- Fewer than 3 verifiable claims total
- Claim depends on conversation context (a subagent would miss it)
- Subjective opinion or common knowledge
- Rapid iteration / brainstorming scenario

### Routing

- **`tier: deep`** → dispatch an Agent subagent per question. Fresh context = real isolation (the paper's Factored variant). Dispatch multiple deep questions in **parallel** (single message, multiple Agent tool calls).
- **`tier: shallow`** → answer in-context with the "don't reference draft" soft constraint.

Deep and shallow can be mixed within a single draft — route each claim independently so cost is spent only where it matters.

## Workflow

### Step 1: Identify the Draft

Check if the user provided arguments after `/cove`:

- **If arguments are provided** (`/cove <text to verify>`): treat the argument text as the draft to verify.
- **If no arguments**: default to the most recent substantive response in the conversation.

### Step 2: Plan Verification Questions

Analyze the draft and extract key factual claims, technical statements, and logical assertions. For each, generate a targeted verification question **and classify its tier** using the signals in the "Verification Tiers" section above.

Output format:

```
Verification Questions:
1. [Factual claim from draft] → Q: [Verification question] | tier: deep
2. [Technical statement] → Q: [Verification question] | tier: shallow
...
```

Focus on claims that are:
- Specific facts (dates, numbers, names, versions) — usually `deep`
- Causal or logical relationships — usually `shallow`
- Technical API/syntax claims — usually `deep`
- Comparisons or rankings — depends on specificity

Skip subjective opinions and well-established common knowledge.

### Step 3: Independent Verification

Route each question by its `tier`:

**For `tier: deep` questions — dispatch an Agent subagent (real context isolation):**

- Use the Agent tool with `subagent_type: general-purpose`
- Dispatch all deep questions in **parallel** (single message, multiple Agent tool calls) to minimize latency
- Prompt template for each subagent:

  ```
  Answer this verification question based on your own knowledge.
  Do NOT fabricate facts — if uncertain, say "unable to verify" explicitly.

  Question: <the verification question>

  Return in this format:
  - Answer: <concise answer>
  - Confidence: High | Medium | Low
  - Source basis: internal knowledge | reasoning | unable to verify

  Do not reference any prior context — answer only from your own knowledge.
  ```

- The subagent has a fresh context and cannot see the original draft. That isolation is the whole point.

**For `tier: shallow` questions — answer in-context:**

- Answer directly without dispatching
- Apply the soft constraint: do NOT reference the original draft while answering

For each question, record:
- The verified answer
- Confidence level (High / Medium / Low)
- Source basis (internal knowledge, reasoning, or "unable to verify")

Output format:

```
Verification Results:
1. Q: [question] | tier: deep
   A: [subagent answer] | Confidence: [H/M/L] | Source: [basis]
2. Q: [question] | tier: shallow
   A: [in-context answer] | Confidence: [H/M/L] | Source: [basis]
...
```

### Step 4: Final Revision

Compare the draft against verification results:

1. Identify contradictions between draft claims and verified answers
2. Identify claims that could not be verified (Low confidence)
3. Generate a revised response that:
   - Corrects any contradictions found
   - Adds caveats to unverifiable claims
   - Preserves accurate portions unchanged

Output format:

```
## Verification Summary
- Checked: [N] claims
- Confirmed: [X] | Corrected: [Y] | Uncertain: [Z]

## Corrections
- [Original claim] → [Corrected claim] (reason)

## Revised Response
[Full revised response]
```

## Variant Selection

Tier-based routing handles per-claim decisions (see "Verification Tiers"). Variant selection is the **overall** intensity:

| Variant | When to use | How |
|---------|------------|-----|
| **Joint** | Short, trivial (<3 claims, all shallow) | Combine Steps 2-3 into one pass |
| **Two-step** | Medium complexity, mostly shallow claims | Standard 4-step flow, all in-context |
| **Factored** | Has ≥1 deep-tier claim | Standard 4-step flow with subagent dispatch for deep claims |
| **Factored + Revise** | Long-form, high accuracy need, many deep claims | Parallel subagent dispatch + explicit cross-check step |

Default to **Two-step**. Automatically upgrade to **Factored** the moment any claim qualifies for `tier: deep`.

## Cost-Awareness

CoVe trades latency/tokens for accuracy. To manage cost:

- Skip verification of common knowledge and subjective statements
- Batch related claims into single verification questions where possible
- For responses with >10 verifiable claims, prioritize high-risk claims (specific numbers, dates, API syntax, version-specific behavior)
