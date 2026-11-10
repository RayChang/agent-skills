---
name: dispatch
description: Turn an approved implementation plan into a dispatch table and hand the tasks to model-tiered subagents (scout / implementer / verifier / expert), in Claude Code, Codex CLI or Copilot CLI. Use after a plan or spec has been agreed and the user says "dispatch", "hand out the tasks", "implement with subagents", 派工 / 分發任務 / 依計劃派工, or invokes /dispatch. Also use to decide whether a plan should be split at all.
---

# dispatch

Decide which tasks of an approved plan go to which model tier, show the user a dispatch
table, and only then dispatch. The tier → model map and its caveats live in
`references/tiers.md`; the worker definitions live in `agents/<tool>/`. This file is the
procedure.

**Hard rules:**
- Never dispatch a worker that edits files before the user explicitly approves the
  dispatch table (Step 4). Read-only `dispatch-scout` runs need no approval.
- You, the main session, are the lead. Do not switch your own model, and dispatch only
  inside the tool you are running in (no `codex exec` from Claude Code, and so on).
- The worker that wrote the code never verifies it. `dispatch-verifier` does, in a
  fresh context.
- `dispatch-scout` and `dispatch-verifier` never edit files.
- Never escalate to a costlier model on your own. `dispatch-expert` runs only for tasks
  the user approved for it.

## Step 0 — Install the workers (first use in this tool)

Check that the four worker files exist in this tool's user-level agent directory and
match the copies in this skill's `agents/<tool>/`:

| Tool | Copy from | Copy to |
|---|---|---|
| Claude Code | `agents/claude/*.md` | `~/.claude/agents/` |
| Codex CLI | `agents/codex/*.toml` | `~/.codex/agents/` |
| Copilot CLI | `agents/copilot/*.agent.md` | `~/.copilot/agents/` |

Missing → copy them and tell the user. Present but different → show the difference and
ask before overwriting. If the tool does not see newly copied agents, ask the user to
restart the session and stop here.

Copilot only: if the session model is `auto`, ask the user to pick a concrete model
first (Auto makes subagents ignore their pinned model).

## Step 1 — Read the plan

Take the plan from the conversation or the file the user names. List its tasks. Each
task needs:

- the files it will change, and
- at least one acceptance command that exits non-zero on failure (test, typecheck,
  lint, build, or a script).

Read-only tasks need neither. A directory counts as a file list and means everything
under it. A task without a file list is treated as overlapping with every other task. A task
without an acceptance command cannot go to `dispatch-implementer`; ask the user for
one, or keep the task in the main session.

## Step 2 — Route each task

| The task is… | Route |
|---|---|
| Reading only and cheap to check: file search, log or test-output reading, summarizing | `dispatch-scout` |
| Well-scoped coding against the plan: exact files, clear interfaces, acceptance command | `dispatch-implementer` |
| Anything needing judgment, an unclear spec, or cross-cutting debugging | main session |
| A major refactor, migration, architecture change or deep analysis | main session if you run on the `lead` tier; otherwise propose `dispatch-expert` |

A clear spec does not by itself make a task `scoped`: migrations and performance work
follow the last row. A proposed `dispatch-expert` task is the user's call at Step 4;
if they decline, it stays in the main session. When unsure, keep the task in the main
session.

If the plan as a whole is `lead`-tier work and you run below that tier, say so once in
Step 4 so the user can restart on a bigger model instead.

## Step 3 — Decide whether to split

Do **not** dispatch implementation when either holds; do the work in the main session
and use `dispatch-scout` only for verbose reading:

- the tasks form a single dependency chain, or
- fewer than two tasks are independent of each other.

Otherwise group the dispatched tasks into batches. Tasks in one batch run in parallel and must
have non-overlapping file lists and no dependency on each other. Everything else is
sequential. All workers share the current working tree; do not create a worktree per
worker. Main-session tasks get batch `main`: do them in dependency order between
batches, or during a batch only when their files do not overlap with it.

## Step 4 — Dispatch table (gate)

Show this table, then stop and wait for explicit approval. If no row goes to a worker
that edits files, show it, say so in one line, and continue without waiting:

| # | Task | Route | Tier / model | Effort | Batch | Files | Acceptance |
|---|---|---|---|---|---|---|---|

Under it, state in one line each: whether you are splitting at all and why; any task
proposed for `dispatch-expert` (it costs about twice the `default` tier per token);
any task you could not route and what is missing.

If the project has a `tasks/<task-id>/` directory for this work, also save the table as
`tasks/<task-id>/dispatch.md`. Otherwise keep it in the conversation only.

## Step 5 — Dispatch and verify

Send every worker a brief with exactly these five sections. The brief is the worker's
whole context, so point at files rather than retelling the discussion:

```
Goal: <one or two sentences: what must be true when done>
Read first: <paths to the plan section, specs, and code the task builds on>
Files you may change: <exact list, or "none">
Acceptance: <commands that must pass>
Report: <the worker's report format, unchanged>
```

Per batch: dispatch its workers together, wait for all reports, then dispatch one
`dispatch-verifier` with the same goal, file list and acceptance commands for each task
in the batch that changed files. A task is done only on `VERDICT: PASS`. Scout reports
need no verifier; spot-check one cited `path:line` yourself before relying on them.
For main-session tasks, run their acceptance commands yourself.

When a task fails or the worker reports `STATUS: BLOCKED`, take each step at most once:

1. If the tool lets you set effort per call, re-dispatch the same worker at `high` with
   the verifier's defects added to the brief. If it does not, skip this step.
2. Do the task yourself in the main session, then send it to `dispatch-verifier`.
3. Stop and ask the user whether to send it to `dispatch-expert`.

After the last batch, run the project's full test, typecheck and lint commands yourself.

## Step 6 — Report

One row per task: route taken, verdict, retries used. Then the full-suite result and
anything left undone. Do not commit or push unless the user asks.
