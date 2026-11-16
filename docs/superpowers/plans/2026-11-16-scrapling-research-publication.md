# Publish the Scrapling research report

Status: documentation and independent verification complete; publication artifacts prepared.

## Scope and acceptance

Move the research into the repository that owns the reusable tooling. Preserve the dated
primary-source investigation, replace ambiguous current-status statements with historical
scope, add the delivered User Level implementation and recorded validation, and link the
report from both READMEs. Do not change runtime code or delete the original research draft.

- [x] Read the original report and merged implementation/review evidence.
- [x] Create a dedicated docs branch/worktree from origin/main.
- [x] Add docs/research/scrapling-agents.md and bilingual README links.
- [x] Verify local references, shell-example syntax, whitespace and factual consistency.
- [x] Prepare the documentation commit and PR for publication.

## Verification and risk

Low risk: documentation only. Check every local Markdown link, shell-example syntax,
whitespace and the distinction between historical source research, completed smoke tests
and the unexecuted performance evaluation. No runtime test suite is needed for unchanged
code. Rollback removes only the documentation additions and README links.

The original report remains in the Hodmi research worktree until publication is confirmed;
its todo edits and branch cleanup are separate from this documentation change.

## Results

Added the research report with its dated investigation preserved and a current delivery
section linked to the merged implementation. Both READMEs now link to it. Preserved all
81 original external URL targets; checked 22 local references and five shell blocks with
zsh -n. New-file whitespace and git diff --check passed. A fresh read-only verifier
returned PASS after checking references, change scope and implementation facts. Runtime
suites were not rerun because this change contains documentation only.
