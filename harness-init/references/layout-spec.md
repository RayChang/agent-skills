# Project Harness Layout Spec (專案 Harness 統一目錄規範)

> 繁中導讀：本檔是專案層 harness 的目錄規範正典。harness-init skill 依此落地骨架；
> 任何專案的 harness 結構問題以本檔為準。機器層（HOW：調度、驗證、判斷）住在使用者的
> 全域設定（global CLAUDE.md 及其配套檔案），永不複製進專案；專案層只管 WHAT
> （本專案是什麼、規則、知識、任務）。

## Layering

| Layer | Owns | Location |
|---|---|---|
| Machine harness | HOW to work: dispatch, verification, judgment, templates | the user's global Claude config (global CLAUDE.md + companion files) — shared by all projects, referenced but never copied |
| Project harness | WHAT this project is: facts, rules, knowledge, task state | inside the repo (this spec) |

## Canonical tree

```
<project-root>/
├── AGENTS.md                # Project facts canon (tool-agnostic): stack, commands,
│                            #   conventions, gotchas. The single always-loaded content file.
├── CLAUDE.md                # Thin Claude router: @AGENTS.md + MCP routing + pipeline
│                            #   trigger + KB pointer. Routing only, no content.
├── .claude/
│   ├── settings.json        # Project-level plugins, hooks, permissions
│   ├── commands/            # Project slash commands (e.g. /task)
│   ├── agents/              # Domain agents (thin routers — point at kb/, never copy rules);
│   │                        #   MCP-wrapped agents built on demand → mcp-agent skill
│   ├── skills/              # Project skills (installed from an upstream, not hand-copied)
│   └── rules/               # Always-loaded small rules — each file ≤50 lines
├── docs/constitution/
│   ├── constitution.md      # Architectural law (HUMAN-owned; machines flag, never edit)
│   └── constitution-enforcement.md  # How each article is checked + wiring status
│                            #   (machine-updatable; changing a mechanism ≠ amendment)
├── kb/                      # Knowledge base — SCAFFOLDED BY the kb-wiki skill, not by
│   └── (schema.md, wiki/…)  #   harness-init (see Ownership rule below)
└── tasks/
    ├── workflow.md          # This project's gated pipeline
    ├── roadmap.md           # Canonical execution tracker
    ├── roadmap.index.md     # Small session-start view of the roadmap
    ├── lessons.md           # Canonical lessons log
    ├── lessons.index.md     # Small lookup index of lessons
    └── T<id>-<slug>/        # Per-task artifacts
        ├── spec.md
        └── plan.md
```

## Four hard rules (what keeps the structure from rotting)

1. **Always-loaded budget: ≤8 KB total** for CLAUDE.md + AGENTS.md + `.claude/rules/*`.
   Over budget → move content down into `kb/` or `docs/`, keep the file as a router.
   Check: `wc -c CLAUDE.md AGENTS.md .claude/rules/* | tail -1`.
2. **Dual-index convention**: any file that grows (roadmap, lessons) is a pair —
   `X.md` (canon) + `X.index.md` (small). Sessions read the index, then `rg` the canon
   by ID/topic and read only the matching range. NEVER broad-read the canon.
3. **Single source of truth + ownership delegation**: domain rules live ONLY in `kb/`
   or the constitution; agents, commands, CLAUDE.md may point at them, never copy them.
   Corollary for scaffolding: **a directory whose lifecycle is owned by a dedicated
   skill is delegated, not re-scaffolded** — currently `kb/` → kb-wiki skill.
4. **The constitution is human-owned**: models may propose amendments, never apply them.
   Wiring a checker updates `constitution-enforcement.md` only — that is not an amendment.

## Scaffolding ownership

| Path | Scaffolded by |
|---|---|
| `kb/` | kb-wiki skill (`npx skills add RayChang/agent-skills@kb-wiki`, then its init flow) |
| `.claude/agents/<server>-worker.md` | mcp-agent skill (`npx skills add RayChang/agent-skills@mcp-agent`), on demand — never pre-scaffolded |
| Everything else above | harness-init |

## After scaffolding (manual, deliberate steps)

- Fill `AGENTS.md` placeholders with verified facts (commands actually run, not guessed).
- If your global CLAUDE.md keeps a per-project facts table, add this project's row —
  harness-init prints it. Apply deliberately: verify each fact by actually running a
  command, back up the global file first, and announce the edit.
- Author the real constitution articles (the template ships two common examples as
  PROPOSALS — delete or amend them; do not treat them as defaults that apply).
- Wire CI/lint checkers over time and record each in `constitution-enforcement.md`.
