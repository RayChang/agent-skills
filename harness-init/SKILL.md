---
name: harness-init
description: Scaffold or incrementally repair a project's harness structure (AGENTS.md/CLAUDE.md routers, gated task pipeline, roadmap/lessons with indexes, constitution, domain-agent template) following the unified layout spec. Use when starting a new project, when asked to 初始化專案 harness / 建立專案骨架 / harness-init, or when auditing an existing project against the layout spec. Additive-only — never overwrites existing files.
---

# harness-init

Scaffold the project-layer harness defined in `references/layout-spec.md`. Read that
spec first if anything below is ambiguous — it is the canon; this file is the procedure.

**Hard rules (apply to every phase):**
- ADDITIVE ONLY. If a target file already exists, skip it and record the skip. There is
  no overwrite mode — updating existing files is a manual, diff-reviewed task, not yours.
- Detect before asking. Ask ONE question at a time, each with a recommended default.
- Never touch anything outside the target project directory. The global facts-table
  row is printed for the user, not applied by you.

## Phase 0 — Preconditions

1. Confirm cwd is a git repo root (`git rev-parse --show-toplevel` equals cwd).
   Not a repo → stop and ask whether to `git init` first.
2. Scan which canonical paths already exist (see the tree in `references/layout-spec.md`).
   Everything existing goes to the SKIPPED list untouched.

## Phase 1 — Detect (fill placeholders without asking)

| Placeholder | Detection |
|---|---|
| `{{PROJECT_NAME}}` | package.json `name`, else directory name |
| `{{PKG_MANAGER}}` | bun.lock/bun.lockb → bun · pnpm-lock.yaml → pnpm · package-lock.json → npm · yarn.lock → yarn |
| `{{TEST_CMD}}` / `{{TYPECHECK_CMD}}` / `{{LINT_CMD}}` | package.json scripts (use the script name, e.g. `bun run test`); absent → `TODO(verify)` |
| `{{GIT_HOST}}` / `{{MR_TOOL}}` | `git remote get-url origin`: github.com → GitHub/`gh` · anything gitlab → GitLab/`glab` · none → ask (recommended default: GitHub / `gh`) |
| `{{BASE_BRANCH}}` | `develop` if the branch exists, else `main`, else ask |
| `{{STACK}}` | key deps in package.json (framework + runtime), one line |

## Phase 2 — Ask (only what detection missed)

Ask one at a time, with a recommended default. Order: first any placeholders detection
left unresolved (Phase 1 table order), then these two that must never be guessed:

| Question | Fills |
|---|---|
| 1. Commit emoji before type (`✨ feat(x): …`, default) or after (`feat(x): ✨ …`)? A commitlint config in the repo overrides the answer — read it first | `{{EMOJI_POSITION}}` = `before` / `after` |
| 2. Worktree convention — inside-repo (default) or sibling dir? | `{{WORKTREE_CONVENTION}}` = `` inside-repo `.worktrees/` `` / `` sibling `<repo>.worktrees/` ``; `{{WORKTREE_PATH}}` = `.worktrees` / `../<repo>.worktrees` |

## Phase 3 — Scaffold

1. For each file under `templates/`: strip the `.tmpl` suffix, replace every
   `{{PLACEHOLDER}}`, write to the same relative path in the project. Existing → skip.
2. Any placeholder you could not resolve stays as a literal `TODO(verify): <what>` line —
   never invent a value.
3. If the worktree convention is inside-repo: ensure `.worktrees/` is in `.gitignore`
   (file absent → create it with just that line; present → append the line if missing;
   both count as scaffolding) and excluded from the test runner's file glob (record as
   a NEXT STEP if the runner config is unclear).
4. `kb/` is NOT yours (ownership rule in the spec). If `kb/` is absent, add a NEXT STEP:
   install + run the kb-wiki skill init (`npx skills add RayChang/agent-skills@kb-wiki`).
   If present, record as skipped.
5. Canonical paths with no matching template (e.g. `.claude/rules/`, `kb/`) are
   intentionally NOT scaffolded — they are created when first needed (or by their
   owning skill). List them under the `Not scaffolded (by design):` line in the report.

## Phase 4 — Report (mandatory format)

```
HARNESS-INIT REPORT — <project>
Created:  <n> files (relative paths, one per line when more than three)
Skipped:  <n> existing (list)
Not scaffolded (by design): <canonical paths with no template — see Phase 3.5>

TODO(verify) markers left: <n> (file:line each)
NEXT STEPS:
- Fill AGENTS.md placeholders with VERIFIED commands (run them, don't guess)
- [if kb/ absent] kb-wiki init (see Phase 3.4)
- Author real constitution articles (template articles are proposals, not defaults)
- Commit the scaffold on a branch per the project's convention
FACTS TABLE ROW (if your global CLAUDE.md keeps a per-project facts table, paste this
row — verify each fact and back up the file before applying):
| <name> | <stack> | <pkg mgr> | <git host/tool> | <base branch> | <emoji pos> | <worktrees> | tasks/lessons.md | <tests> |
```

The report is your final message. Do not summarize it away; print it verbatim.
