# kb-wiki: Per-Developer Activity Log

> Design spec — migrate the kb-wiki activity log from a single shared `kb/wiki/log.md`
> to one file per developer under `kb/wiki/log/<dev>.md`.

- **Date**: 2026-06-22
- **Status**: approved (design); ready for implementation plan
- **Scope**: general methodology change to the `kb-wiki` skill — affects every project that
  uses the skill, not one specific project. Must stay backward-compatible with existing
  single-file KBs.
- **Files touched**: `kb-wiki/scripts/lib/config.ts`, `kb-wiki/scripts/lib/kb.ts`,
  `kb-wiki/scripts/lint.ts`, `kb-wiki/scripts/map.ts`, `kb-wiki/SKILL.md`,
  `kb-wiki/assets/schema.md`, `kb-wiki/references/schema.md`, plus a new minimal test file.

---

## 1. Problem & Goal

Every kb-wiki operation appends its activity entry to a single aggregate file,
`kb/wiki/log.md`. `appendLog()` in `scripts/lib/kb.ts` writes to it; `scripts/map.ts` and
`scripts/lint.ts` special-case it; `SKILL.md` ends each operation (ingest / query / lint /
verify / map / capture / migrate) with "Append to `kb/wiki/log.md`".

Because everyone appends to the tail of the same file, **two developers working
concurrently produce a guaranteed merge conflict**, and an entry carries no indication of
who wrote it.

**Goal**: give each developer their own log file, `kb/wiki/log/<dev>.md`. Each developer
appends only to their own file, so two developers never touch the same file (zero merge
conflict) and authorship is obvious from the filename. Existing single-file KBs keep
working until explicitly migrated.

This is the per-developer variant. A per-entry layout (one file per log entry) would be
even more conflict-proof, but the chosen requirement is per-developer: it directly encodes
"who did this" the same way git commit authorship does.

---

## 2. Decisions (resolved)

| # | Decision | Choice |
|---|---|---|
| D1 | Developer identifier source | `slug(git config user.name)`; `KB_DEV` env var overrides; fallback `unknown` |
| D2 | Override mechanism for deterministic scripts | `KB_DEV` env var + documented convention. Scripts do **not** parse `schema.md` |
| D3 | Backward compat for existing single-`log.md` projects | Keep appending to the single `log.md` until the user runs Migrate (Migrate is the explicit switch) |
| D4 | Migrate freezes the old log by | Moving `kb/wiki/log.md` → `kb/wiki/log/_archive.md` (do not migrate old content into per-dev files) |
| D5 | Archive treatment | Inherit the original live-log treatment exactly: excluded from semantic checks, **still injection-scanned**, not consulted by the AI as knowledge. No new banner, no new invariant |
| D6 | Cross-developer merged chronological view | Out of scope (YAGNI). `grep "^## \[" kb/wiki/log/*.md` already gives an ad-hoc merged view |
| D7 | Slug rule for non-ASCII names | Filename-safe (not shell-safe): preserve unicode letters; only strip path-dangerous chars. CJK names stay distinct rather than collapsing to `unknown` |

---

## 3. Architecture change

```
BEFORE                                AFTER
kb/wiki/                              kb/wiki/
├── index.md                         ├── index.md
├── log.md   ← everyone appends      ├── log/                ← one file per developer
├── overview.md                      │   ├── ray-chang.md    ← Ray only appends here
├── summaries/                       │   ├── alice.md        ← Alice only appends here
└── <categories>/                    │   └── _archive.md     ← frozen pre-migration log (Migrate only)
                                     ├── overview.md
                                     ├── summaries/
                                     └── <categories>/
```

- `<dev>` is the slugged developer identifier (§4).
- "Newest entries at top" is preserved **per file**.
- The log remains an append-only **activity/audit trail**, not part of the retrieval
  backbone (which is `index.md` + `summaries/`). This is unchanged from the original
  design — the per-developer split changes only the *write* target, never how the AI
  *reads* knowledge.

---

## 4. Developer identity resolution

A new exported helper `resolveDevSlug()` lives in `scripts/lib/kb.ts` (shared by
`appendLog`, and indirectly by `lint.ts` / `map.ts` through it).

**Resolution order (deterministic):**

1. `process.env.KB_DEV` (if non-empty) → slugified.
2. else `git config user.name`, read via `Bun.spawnSync(["git", "config", "user.name"])`
   — **array form, never through a shell** — slugified.
3. else `"unknown"`.

**Slug rule (filename-safe, NOT the shell allowlist).** The slug only becomes a path
component via `resolve()` and is written with `Bun.write` — it never reaches a shell — so
the strict Init category allowlist (`^[a-z][a-z0-9-]*$`) does **not** apply. Instead:

- trim; lowercase (ASCII; unicode letters pass through unchanged);
- collapse whitespace runs → single `-`;
- replace path separators `/` and `\` → `-`;
- collapse any run of `..` → `-` (defeats path traversal);
- strip control characters;
- strip leading `.`/`-`; collapse repeated `-`; trim trailing `-`;
- if the result is empty → `"unknown"`.

Preserving unicode word characters is deliberate (D7): a CJK or other non-ASCII name must
stay a distinct filename, not collapse to `unknown` and collide with every other non-ASCII
developer.

**Override convention (documentation, not code):** the team default is `git user.name`. A
project that standardizes on `git user.email` local-part or a platform handle exports
`KB_DEV` (e.g. in CI) or has the LLM compute it. `SKILL.md` and the schema templates
document this; the scripts stay schema-agnostic (D2).

```ts
// scripts/lib/kb.ts (illustrative)
function slugifyDev(raw: string): string {
  let s = raw.trim().toLowerCase()
  s = s.replace(/\s+/g, "-")          // whitespace runs → hyphen
  s = s.replace(/[\/\\]/g, "-")       // path separators → hyphen
  s = s.replace(/\.{2,}/g, "-")       // collapse .. (traversal) → hyphen
  s = s.replace(/[\x00-\x1f\x7f]/g, "") // strip control chars
  s = s.replace(/^[.\-]+/, "")        // no leading dot/hyphen
  s = s.replace(/-{2,}/g, "-").replace(/-+$/, "")
  return s
}

export function resolveDevSlug(): string {
  const env = process.env.KB_DEV?.trim()
  if (env) { const s = slugifyDev(env); if (s) return s }
  try {
    const p = Bun.spawnSync(["git", "config", "user.name"])
    if (p.exitCode === 0) {
      const s = slugifyDev(p.stdout.toString().trim())
      if (s) return s
    }
  } catch { /* not a git repo / git missing → fall through */ }
  return "unknown"
}
```

---

## 5. File-by-file changes

### 5.1 `scripts/lib/config.ts`

- Replace the single `log: resolve(ROOT, "kb/wiki/log.md")` with two entries:
  - `logDir: resolve(ROOT, "kb/wiki/log")`
  - `legacyLog: resolve(ROOT, "kb/wiki/log.md")`
- In `discoverCategories()`, add `"log"` to the skip set so the `log/` directory is never
  treated as a wiki category (it currently skips `.`-prefixed, `summaries`, `queries`).
  Without this, `log/` would surface as an empty category, get an `_moc.md`, and inflate
  the index.

### 5.2 `scripts/lib/kb.ts`

- Add `resolveDevSlug()` (§4) and a shared `isLogFile(relativePath)` predicate:

  ```ts
  export function isLogFile(relativePath: string): boolean {
    return relativePath === "log.md" || relativePath.startsWith("log/")
  }
  ```

  `log/` prefix covers `log/<dev>.md` and `log/_archive.md`.

- Rewrite `appendLog()` to resolve a per-developer target with backward compatibility:

  ```ts
  import { existsSync } from "fs"

  function logHeader(dev: string): string {
    return [
      `# Wiki — Log (${dev})`, "",
      "> Append-only. Newest entries at top. One log file per developer.", "",
      "---", "",
    ].join("\n")
  }

  function resolveLogTarget(): { path: string; isNew: boolean; dev: string } {
    const dev = resolveDevSlug()
    if (existsSync(config.kb.logDir)) {                 // new layout in use
      const path = resolve(config.kb.logDir, `${dev}.md`)
      return { path, isNew: !existsSync(path), dev }
    }
    if (existsSync(config.kb.legacyLog)) {              // old single-file project (compat)
      return { path: config.kb.legacyLog, isNew: false, dev }
    }
    const path = resolve(config.kb.logDir, `${dev}.md`) // neither → adopt new layout
    return { path, isNew: true, dev }
  }

  export async function appendLog(action, description, details): Promise<void> {
    const date = new Date().toISOString().split("T")[0]
    const entry = ["", `## [${date}] ${action} | ${description}`,
      ...details.map((d) => `- ${d}`), ""].join("\n")

    const target = resolveLogTarget()
    const existing = target.isNew ? logHeader(target.dev) : await Bun.file(target.path).text()

    // newest-at-top: insert right below the first `---` separator (unchanged logic)
    const firstSep = existing.indexOf("---\n")
    const insertPoint = firstSep !== -1 ? firstSep + 4 : existing.length
    await Bun.write(target.path, existing.slice(0, insertPoint) + entry + existing.slice(insertPoint))
  }
  ```

  Notes:
  - `Bun.write` creates the parent `log/` directory automatically, so adopting the new
    layout needs no explicit `mkdir`.
  - The newest-at-top insertion logic is unchanged; it now operates on whichever file was
    resolved. The header always contains a `---` so the insertion point exists.

### 5.3 `scripts/lint.ts`

Import `isLogFile` and replace every literal `log.md` special-case with it:

- `checkBrokenLinks`: skip links inside any log file (`isLogFile(page.relativePath)`) —
  append-only history links legitimately rot when pages are renamed.
- `checkOrphanPages`: skip log files (currently keyed on `path === "log"`).
- `checkMissingFrontmatter`: skip log files (they carry no YAML frontmatter).
- `deepAnalysis`: exclude log files from the LLM-analyzed corpus (currently
  `p.relativePath !== "log.md"`).

**No change to `checkInjectionMarkers`** — it scans every wiki page including log files
(D5). The archive and per-dev logs continue to be injection-scanned. This is a pure regex
pass, no LLM, no token cost; it surfaces possible poisoning in historical entries for human
review and never auto-resolves.

Result: in the new `log/` multi-file layout, `bun lint.ts` reports **0 errors** for a
well-formed KB (acceptance criterion §9).

### 5.4 `scripts/map.ts`

Import `isLogFile` and replace literal `log.md` checks:

- `buildIndex`: exclude log files from the category listing (not pages, no count, no MOC).
- content-page / orphan stats filter: exclude log files.
- `discoverMissingLinks` (LLM, `--deep`): exclude log files from the suggestion corpus.
- `buildMoc` outbound-link filters currently use `l.startsWith("log")`, which also
  over-matches a hypothetical page slug like `logging`. Tighten to drop only real log
  targets: `l !== "log" && !l.startsWith("log/")`. (Same fix for the `index` filter is
  optional; keep scope minimal — fix the `log` one because this change introduces `log/`.)

`discoverCategories()` already excludes `log` (§5.1), so `log/` never gets a `_moc.md` or
appears as a category in the index.

### 5.5 `SKILL.md`

- **Each operation** (Ingest / Query / Lint / Verify / Map / Capture / Migrate): change
  "Append to `kb/wiki/log.md`" → "Append to `kb/wiki/log/<dev>.md`".
- Add a short subsection **"Activity log — one file per developer"** explaining: `<dev>` =
  `slug(git config user.name)`; `KB_DEV` overrides; fallback `unknown`; create the file if
  missing; newest-at-top **within each developer's file**; backward compatibility with
  single-file KBs; the team-convention override note (D2). State that log files are an
  activity/audit trail, not knowledge content (this restates existing design intent — see
  §7 — rather than adding a new rule).
- **Init step 5**: create the `kb/wiki/log/` directory and write the initializing
  developer's `log/<dev>.md` with the per-developer header, replacing "create single
  `log.md`". (Writing the first dev file makes the directory non-empty and git-trackable.)
- **Invariants**: "Always update `index.md` and `log.md`" → "Always update `index.md` and
  the current developer's log file (`kb/wiki/log/<dev>.md`)".
- **Lint manual fallback** bullet: "skip links inside `log.md`" → "skip links inside any
  log file (`log.md` or `log/*.md`)".
- **Map manual fallback** step 1: extend the exclusion list from `log.md` to all log files.
- **Migrate**: add a step — freeze the existing single log by **moving** `kb/wiki/log.md`
  → `kb/wiki/log/_archive.md` (do **not** copy old entries into per-developer files), then
  create `kb/wiki/log/`. Subsequent operations write per-developer. Migrate's existing
  one-time read of "recent `log.md` entries" to recover ingest dates now reads the archive.

### 5.6 `assets/schema.md` (new-project template)

- Architecture diagram: `log.md` → `log/   # one file per developer (log/<dev>.md), append-only`.
- "Log Format" section: document the per-developer layout, the `slug(git user.name)`
  naming rule, the `KB_DEV` override, and the `_archive.md` convention.

### 5.7 `references/schema.md`

- Directory Structure: `log.md` → `log/   # one append-only file per developer (log/<dev>.md)`.
- "log.md Format" section: rename/retitle to cover per-developer files; document the naming
  rule, that newest entries stay at the top of each file, and the `_archive.md` frozen
  archive. The `grep "^## \["` tooling note now globs `kb/wiki/log/*.md`.

---

## 6. Backward compatibility & Migrate

**Detection (in `resolveLogTarget`, §5.2):**

| On-disk state | Behavior |
|---|---|
| `kb/wiki/log/` exists | New layout → write `log/<dev>.md` (create if missing) |
| only `kb/wiki/log.md` exists | Legacy project → keep appending to `log.md` (D3) |
| neither | Adopt new layout → create `log/<dev>.md` |

So a fresh `init` always produces the new layout; a pre-existing single-file project keeps
using `log.md` until the user runs Migrate. Nothing changes silently.

**Migrate** is the explicit switch (D4):
1. `git mv kb/wiki/log.md kb/wiki/log/_archive.md` (or `mkdir -p` + move).
2. Old content is **not** redistributed into per-developer files.
3. After migration, `log/` exists, so all subsequent operations write per-developer.

`lint.ts` and `map.ts` handle both layouts transparently via `isLogFile()`, which matches
`log.md`, `log/<dev>.md`, and `log/_archive.md` alike.

---

## 7. Archive treatment (`log/_archive.md`)

The archive **inherits the original live-log treatment exactly** (D5) — it is not given any
new status:

- Excluded from broken-link / orphan / frontmatter / `--deep` LLM analysis (via
  `isLogFile()`), just like the original `log.md` was.
- **Still injection-scanned** by the deterministic regex pass in `lint.ts`, just like the
  original `log.md` was (`checkInjectionMarkers` scans all wiki pages).
- **Not consulted by the AI as knowledge.** This matches the original design intent: the
  log was never part of the retrieval backbone (`index.md` + `summaries/`), is excluded
  from Map and from lint's LLM analysis, and is read by the AI only for the one-time
  provenance/date recovery in Migrate. The per-developer split and the archive do not
  change this.
- **No FROZEN banner and no new invariant** are added — keeping the original setting and
  the change minimal.

---

## 8. Security / trust-model considerations

- **No new shell exposure.** `appendLog` writes with `Bun.write` and reads `git config`
  via `Bun.spawnSync` array form — neither interpolates the developer name into a shell.
  The slug only becomes a path component, and the slug rule strips `/`, `\`, leading dots,
  and collapses `..` to defeat path traversal (§4).
- **Injection scanning is preserved**, including over the archive and per-developer logs
  (§5.3, §7), so the per-developer change does not weaken the existing feedback-loop
  poisoning defense.
- The existing Init category allowlist and all other trust-model rules in `SKILL.md` are
  untouched.

---

## 9. Testing & acceptance

The skill currently has no automated test harness (scripts are run manually). Per the
project's "every feature needs unit tests" rule, add a minimal `bun test` file
(`scripts/lib/kb.test.ts` or similar):

- `resolveDevSlug()`:
  - `KB_DEV` override wins and is slugged;
  - `"Ray Chang"` → `"ray-chang"`;
  - path-traversal input (`"../../etc"`, `"a/b"`) is stripped to a safe single component;
  - unicode name is preserved (does not collapse to `unknown`);
  - empty/whitespace → `"unknown"`.
- `appendLog` target resolution (using a temp fixture KB):
  - new layout (`log/` present) → writes `log/<dev>.md`, newest-at-top;
  - legacy layout (only `log.md`) → still appends to `log.md`;
  - neither → creates `log/<dev>.md`.
- `isLogFile()`: matches `log.md`, `log/x.md`, `log/_archive.md`; rejects `logging.md`.

**Manual acceptance (from the task):**
1. `bun ~/.claude/skills/kb-wiki/scripts/lint.ts` reports **0 errors** on a `log/`
   multi-file layout.
2. Two different `git config user.name` values (or `KB_DEV`) each run a capture → two
   separate files, no git conflict.
3. An existing single-`log.md` project still works (compat path).

---

## 10. Out of scope (YAGNI)

- Cross-developer merged chronological view (D6) — `grep "^## \[" kb/wiki/log/*.md` covers
  the ad-hoc need.
- Redistributing old `log.md` content into per-developer files during Migrate.
- Parsing `schema.md` from the scripts to read a dev-id rule (D2).
- A `FROZEN` banner or a new "logs are not knowledge" invariant (D5) — the behavior already
  holds; documenting it stays a one-line restatement in SKILL.md, not a new rule.

---

## 11. Open questions

None. All forks (D1–D7) are resolved.
