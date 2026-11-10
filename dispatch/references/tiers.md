# Tier → model map

Verified 2026-11-10 against Claude Code 2.1.x, Codex CLI 0.166.0 and Copilot CLI
1.0.106. Model line-ups change often: when a model in this table is gone or a newer one
exists, update this file and the `model` lines in `agents/<tool>/`, nothing else.

Source for the tiers: Anthropic, "Which Claude model should you build with?"
(https://claude.dev/blog/which-claude-model-should-you-build-with/).

| Tier | Role | Claude Code | Codex CLI | Copilot CLI |
|---|---|---|---|---|
| `lead` | major refactors, migrations, architecture, deep analysis, leading many workers | `fable` (Fable 5.2) | `gpt-6-astra` | `gpt-6-astra` |
| `default` | everyday complex engineering, debugging, anything unclear | `opus` (Opus 5.5) | `gpt-6.1-sol` | `claude-opus-5.5` |
| `scoped` | well-scoped coding against a spec, verification | `sonnet` (Sonnet 5.5) | `gpt-6.1-terra` | `claude-sonnet-5.5` |
| `chore` | search, log reading, summarizing, classification | `haiku` (Haiku 5.5) | `gpt-6-luna` | `claude-haiku-5.5` |

Workers and their pinned tier:

| Worker | Tier | May edit | Starting effort |
|---|---|---|---|
| `dispatch-scout` | `chore` | no | model default (pinned to `medium` in Codex, where an unset effort inherits the parent's) |
| `dispatch-implementer` | `scoped` | yes | `medium` |
| `dispatch-verifier` | `scoped` | no | `medium` |
| `dispatch-expert` | `lead` | yes | `medium` |

No worker is pinned to `default`: that tier is the main session.

## Caveats

- **Codex mapping is by price ratio, not by benchmark.** Codex credits per 1M input
  tokens run 250 / 50 / 25 / 2.5 (astra / 6.1-sol / 6.1-terra / luna), close to
  Anthropic's 8 / 4 / 2 / 0.1 dollars. OpenAI positions terra as "fast, efficient". If
  `dispatch-implementer` on terra fails verification often, change its model to
  `gpt-6.1-sol` and keep effort at `medium`.
- **Copilot lead tier** is `gpt-6-astra` because Copilot CLI 1.0.106 does not list
  Claude Fable 5.2. Switch to it when `copilot --model` accepts it.
- **Copilot frontmatter keys are kebab-case.** `model-policy: required` and
  `reasoning-effort` work; the camelCase spellings are silently ignored (tested on
  1.0.106). With `model-policy: required` an unavailable model fails the dispatch
  instead of silently falling back to the session model.
- **Copilot Auto ignores pins.** If the session model is `auto`, subagents inherit it
  and the agent file's `model` is ignored. Pick a concrete session model before
  dispatching.
- **Copilot in VS Code** refuses a subagent on a costlier tier than the main model, so
  `dispatch-expert` works only from Copilot CLI.
- **Effort ceiling.** Do not go above `high`: past it, one more effort level can cost as
  much as the next model up.
