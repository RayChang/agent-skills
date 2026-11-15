# Scrapling PR #22 review fixes

Status: implementation and User Level update complete; independent verification and Fable final re-review PASS. Publication continues in existing PR #22.
Baseline: `2cc635d9deebaf9ca6d7971c0a169d4d4c41b10f`.
Branch/worktree: existing `feature/scrapling-agent` worktree.

## Acceptance

- Preserve externally managed skill directories and their matching discovery symlinks.
- Repair missing owned assets while refusing to overwrite existing modified/unowned assets.
- Recover an interrupted publication even if a subsequent retry uses another source version.
- Record browser installation only after successful verification. Dry runs show concrete actions.
- Publish destination files atomically on their own filesystem.
- Clean up the child process group on SIGINT, SIGTERM, SIGHUP and SIGQUIT, including signals
  during Popen construction; restore handlers on every path.
- Preserve error-envelope subtype and bounded nonsecret diagnostics.
- Accept completed Claude output when a surviving descendant merely holds a capture pipe.
- Remove filesystem Read permission from both native worker and launcher.
- Bind launcher execution to the validated worker definition, or fail clearly for incompatible
  configuration; do not silently execute a different same-named worker.
- Keep schema, independent validation and exit-code documentation consistent.
- Run regression tests, installed-runtime smoke checks and independent Fable re-review.

## Review disposition

| Finding | Action |
| --- | --- |
| 1. Global skills-manager link collision | Fix installer and add regression |
| 2. Broad Read/network capabilities | Remove Read; retain documented MCP trust limitations |
| 3. Missing owned files cannot recover | Repair absent files/links; preserve modified existing assets |
| 4. SIGHUP/SIGQUIT orphan the worker | Extend signal handling and real-signal regressions |
| 5. Missing envelope subtype | Preserve subtype and bounded diagnostics |
| 6. Changed-source double-failure journal | Persist validated current ownership before new intent |
| 7. Descendant pipe holds up completed output | Detect parent completion and drain bounded output |
| 8. Detached descendants escape process groups | State the actual process-group guarantee and SIGKILL limitation; no speculative OS supervisor |
| 9. Premature browser_installed flag | Record completed browser verification only |
| 10. Generic dry-run output | Show pending destinations and runtime/browser actions |
| 11. Failed update becomes unready | Retain fail-closed behavior; document retry/recovery |
| 12. Cross-filesystem replace | Stage each publication in the destination directory |
| 13. Worker discovery mismatch | Main integration: explicit validated definition or actionable rejection |
| 14. Output/schema/docs discrepancies | Tighten whitespace/source validation and document exit codes |

The network MCP tools remain capable of operations beyond GET, and website instructions
remain untrusted. Removing Read reduces exposure; this is not a security sandbox or a
server-side network allowlist. Do not break explicitly requested internal URLs by adding
an unrelated hostname policy. Deliberately detached descendants and SIGKILL require an
outer supervisor; ordinary process-group cleanup does not claim that capability.

## Ownership and verification

Reuse the already approved installer/launcher dispatch ownership for this continuation.
The user explicitly requested fixes after the independent review; no new model escalation.

| Task | Route | Files | Acceptance |
| --- | --- | --- | --- |
| Installer regressions and fixes | dispatch-implementer | scripts/install.py, tests/test_install.py under scrapling-agent | python3 -B -m unittest discover -s scrapling-agent/tests -p 'test_install.py' |
| Launcher regressions and fixes | dispatch-implementer | scripts/run.py, tests/test_run.py under scrapling-agent | python3 -B -m unittest discover -s scrapling-agent/tests -p 'test_run.py' |
| Worker/schema/docs and integration | main | Other scrapling-agent assets and this plan; launcher only after its worker finishes | Full package suite, skill validator, real installed launcher |
| Independent verification | fresh dispatch-verifier, then existing Herdr Fable reviewer | Read only | Acceptance commands and focused review |

Workers share this worktree and have disjoint edit ownership. Add regressions first and
record their failures before fixing behavior. Never install into the real home in unit tests.
Main owns the actual User Level update, live checks and updating the existing PR after PASS.

## Risk and rollback

Medium: installation ownership and subprocess lifecycle. Keep all changes reversible on
the existing feature branch. Preserve user-modified files and external-manager links.
Use the ownership manifest for User Level rollback; do not remove shared directories.
No authentication, global permission settings or parent MCP registrations change.

## Progress

- [x] Capture review findings, source baseline and acceptance criteria.
- [x] Installer regressions and fixes.
- [x] Launcher regressions and fixes.
- [x] Main assets and integration.
- [x] Independent verification and Herdr Fable re-review.
- [x] Real User Level update and live checks; publication artifacts prepared for existing PR #22.

## Evidence

Baseline has 20 passing tests. Independent review and main reproductions confirmed global
manager-link collision, missing-worker recovery failure, SIGHUP/SIGQUIT orphaning and
discarded `error_max_turns` diagnostics. The Fable reviewer is `scrapling-fable-review`
in Herdr pane `w9:p5`.

- Installer worker added failing regressions (four failures and three errors before fixes),
  then passed 15 tests; manager-takeover follow-up added two more passing tests. Main added
  the failed cached-browser repair case, reproduced it failing, and corrected pending flags.
- Launcher worker passed 13 tests covering additional signals, inherited-pipe completion,
  error subtypes and no Read. Main added the explicit-definition regression (failed first),
  then bound the validated definition through --agents as documented by current Claude docs.
- Initial independent verification found three additional defects despite passing tests:
  a stale true browser flag after failed repair, subtype loss with result text, and quoted
  JSON secret values. All three got failing regressions before main's fixes.
- A follow-up verifier identified unsupported MCP args being silently ignored by the explicit
  definition adapter. Main added args/permissionMode rejection regressions (both failed first),
  and now accepts only the generated scalar header and exact stdio MCP shape. Unsupported
  custom configuration fails before launching Claude.
- Main live probe after User Level update: static and JavaScript page extraction both passed,
  Claude exit 0, structured_output present, no permission denials. Init listed 14 tools with
  no Read/Bash/Edit; model was claude-sonnet-5-5. Latest parser hardening will be reinstalled
  and rechecked before completion.
- Official CLI definition reference: https://code.claude.com/docs/en/sub-agents
  (Context7 /websites/code_claude confirms --agents accepts frontmatter fields including
  inline mcpServers, maxTurns, tools and model).

- Fable re-review returned PASS on the main defects and identified four nonblocking edge
  cases. Added regressions first for inherited ignored signals, a noisy descendant retaining
  stderr, and output arriving between empty select and parent poll. These failed before the
  fixes. The launcher now preserves ignored signals, checks parent completion on every
  iteration, stops group writers and performs a final zero-timeout drain.
- Installer follow-up reproduced and fixed external-source discovery under a symlinked
  `.agents` parent; 19 installer tests pass.
- Replaced the ad-hoc YAML scalar parser with JSON-formatted YAML frontmatter and typed JSON
  validation (including duplicate-key rejection), with no new runtime dependency. A temporary
  native Claude plugin probe successfully loaded JSON frontmatter and returned JSON_PROBE_OK.
  Arrays in description/model, booleans in maxTurns, extra MCP args and extra permission
  fields all fail before spawning Claude.

## Final results (2026-11-16)

- Final package suite: 41 passing tests (19 installer, 21 launcher, one package integration).
- Existing suites: kb-wiki 129 pass; cove/reference 42 pass; TypeScript noEmit exit 0.
- Skill validator, tracked/new-file whitespace checks and source syntax checks passed.
- Fresh dispatch-verifier returned PASS for the final typed-configuration implementation.
- Herdr Fable 5.2 final focused re-review returned PASS. It independently reproduced all
  four follow-up edge cases and checked the rendered template with 17 configuration variants.
- Native Claude successfully loaded the JSON-frontmatter worker and delegated in the
  foreground: selected scrapling-worker, called make_request, returned the verified author
  and source, zero permission denials, zero Scrapling tools in parent init. An initial test
  allowed background delegation and returned only progress; the skill now explicitly requires
  waiting for the completed foreground report, and the corrected live test passed.
- The installed shared entry passed static+JavaScript page comparison from this repository
  with status ok and two sources. Copilot invoked that same entry with scoped command and
  directory approval; shell exit 0, sourced report, zero parent Scrapling MCP servers.
- Identical actual setup rerun reported Already installed. Ready state, verified browser, all
  eight owned file hashes, both link targets and six-file source/installed parity passed.
- The existing User Level installation is updated. Parent MCP configuration, authentication
  and global permissions remain unchanged. Source worktree remains separate from runtime.

| Task | Route and review | Final verdict | Repair notes |
| --- | --- | --- | --- |
| Installer | implementer, focused follow-ups, main fallback, fresh verifier | PASS | Added missing assets, manager takeover/aliases/ancestors, journals, browser state and destination publication regressions |
| Launcher | implementer, main integration/fallback, fresh verifier | PASS | Added signal, ignored-signal, pipe, diagnostics and typed-definition regressions |
| Assets/docs and exact worker binding | main, fresh verifier and Herdr Fable | PASS | JSON-formatted YAML removes scalar coercion; reject unsupported fields/types and duplicates |
| User Level and cross-client validation | main | PASS | Real static/dynamic extraction and three client paths; installed/source parity and idempotence |

Main fallback was used after the initial worker-verification defects. Additional defects in
main's explicit-definition adapter were corrected in main; no unapproved expert writer or
model escalation was used. User-authorized Fable remained read-only throughout review.

Accepted limitations remain explicit: no Linux live validation, no quantified efficiency or
accuracy improvement, no server-side network allowlist, and no OS supervisor for deliberately
detached descendants or SIGKILL. The macOS zombie-only killpg PermissionError remains an
unverified narrow race noted by Fable; no failing normal-operation reproduction remains.
