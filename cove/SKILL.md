---
name: cove
description: Chain-of-Verification (CoVe) — manually triggered self-verification workflow. This skill should be used when the user invokes /cove to verify and refine a previous response through a structured 4-step process (draft → plan verification questions → independent verification → final revision). Ideal for fact-heavy answers, technical explanations, or any response where accuracy is critical.
---

# Chain-of-Verification (CoVe)

Apply CoVe to verify and refine the most recent response (or a user-specified response) through a structured 4-step self-verification workflow.

## Workflow

### Step 1: Identify the Draft

Check if the user provided arguments after `/cove`:

- **If arguments are provided** (`/cove <text to verify>`): treat the argument text as the draft to verify.
- **If no arguments**: default to the most recent substantive response in the conversation.

### Step 2: Plan Verification Questions

Analyze the draft and extract key factual claims, technical statements, and logical assertions. For each, generate a targeted verification question.

Output format:

```
Verification Questions:
1. [Factual claim from draft] → Q: [Verification question]
2. [Technical statement] → Q: [Verification question]
...
```

Focus on claims that are:
- Specific facts (dates, numbers, names, versions)
- Causal or logical relationships
- Technical API/syntax claims
- Comparisons or rankings

Skip subjective opinions and well-established common knowledge.

### Step 3: Independent Verification

Answer each verification question **independently** — do NOT reference the original draft while answering. This isolation prevents self-confirmation bias.

For each question, provide:
- The verified answer
- Confidence level (High / Medium / Low)
- Source basis (internal knowledge, reasoning, or "unable to verify")

Output format:

```
Verification Results:
1. Q: [question]
   A: [independent answer] | Confidence: [H/M/L]
2. ...
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

Choose the appropriate variant based on the response type:

| Variant | When to use | How |
|---------|------------|-----|
| **Joint** | Short, simple responses (<3 claims) | Combine Steps 2-3 into one pass |
| **Two-step** | Medium complexity responses | Standard 4-step flow |
| **Factored** | Responses with many independent claims | Decompose into sub-claims, verify each |
| **Factored + Revise** | Long-form content, high accuracy need | Full decomposition with detailed revision |

Default to **Two-step** unless the response characteristics clearly match another variant.

## Cost-Awareness

CoVe trades latency/tokens for accuracy. To manage cost:

- Skip verification of common knowledge and subjective statements
- Batch related claims into single verification questions where possible
- For responses with >10 verifiable claims, prioritize high-risk claims (specific numbers, dates, API syntax, version-specific behavior)
