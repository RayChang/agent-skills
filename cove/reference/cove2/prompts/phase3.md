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
