# kb-wiki Per-Developer Activity Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the kb-wiki activity log from one shared `kb/wiki/log.md` to one file per developer (`kb/wiki/log/<dev>.md`), so concurrent developers never conflict and authorship is explicit — while existing single-file KBs keep working.

**Architecture:** Extract the log-writing logic into small **pure functions** (slug, predicate, target-picker, string-insert) that are unit-tested, plus a thin filesystem wrapper. `appendLog` resolves the current developer (`slug(git user.name)`, `KB_DEV` override) and routes the entry to that developer's file, falling back to the legacy single file when no `log/` directory exists. `lint.ts` and `map.ts` stop special-casing the literal `log.md` and instead use a shared `isLogFile()` predicate that also matches `log/*.md`.

**Tech Stack:** TypeScript on Bun 1.3.4 (`bun test` runner, `Bun.file`/`Bun.write`/`Bun.spawnSync`). No new dependencies.

## Global Constraints

- **Dev identifier:** `slug(git config user.name)`; `KB_DEV` env var overrides; fallback `"unknown"`. Read git via `Bun.spawnSync(["git","config","user.name"])` — array form, never through a shell.
- **Slug is filename-safe, NOT the Init shell allowlist (`^[a-z][a-z0-9-]*$`):** trim → lowercase → whitespace runs `→ -` → `/` and `\` `→ -` → collapse `..` `→ -` → strip control chars → strip leading `.`/`-` → collapse repeated `-` → trim trailing `-`. **Preserve unicode letters** (CJK names must not collapse to `unknown`). Empty result → `"unknown"`.
- **Backward compatibility:** if only `kb/wiki/log.md` exists (no `log/` dir), keep appending to it. Switching to per-dev happens only via Migrate.
- **Archive:** Migrate moves `kb/wiki/log.md` → `kb/wiki/log/_archive.md`. The archive inherits the original live-log treatment exactly: excluded from semantic checks, **still injection-scanned**, not consulted by the AI as knowledge. No FROZEN banner, no new invariant.
- **`isLogFile(rel)` matches `log.md` and any `log/` path** (`log/<dev>.md`, `log/_archive.md`).
- **Injection scan is unchanged** — `checkInjectionMarkers` keeps scanning every wiki page including log files.
- **No new shell exposure:** the dev slug only becomes a path component via `resolve()` + `Bun.write`; it never reaches a shell.
- **Code style:** functional, early returns, `camelCase` for TS; comments/commit messages in English.
- **Every commit message** uses Gitmoji + Conventional Commits and ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Branch:** all work lands on `feat/kb-wiki-per-dev-log` (already created; the spec commit is its first commit).
- **Repo script path for verification:** `/Users/raychangmbp2025/Workspace/agent-skills-local/kb-wiki/scripts/...` (the `~/.claude/skills/...` path is a symlink and is only what end-users type).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `kb-wiki/scripts/lib/kb.ts` | Wiki file ops + **new** log helpers | Add pure helpers (`slugifyDev`, `resolveDevSlug`, `isLogFile`, `pickLogTarget`, `insertNewestAtTop`, `logHeader`, `formatLogEntry`, `writeLogEntry`); rewrite `appendLog` |
| `kb-wiki/scripts/lib/kb.test.ts` | **New** unit + integration tests | Create |
| `kb-wiki/scripts/lib/config.ts` | Path config + category discovery | `log` → `logDir`+`legacyLog`; skip `log` in `discoverCategories` |
| `kb-wiki/scripts/lint.ts` | Health checks | Literal `log.md` → `isLogFile()`; keep injection scan |
| `kb-wiki/scripts/map.ts` | Index/MOC rebuild | Literal `log.md` → `isLogFile()`; tighten MOC link filter |
| `kb-wiki/SKILL.md` | Operating manual | Per-dev log everywhere; Init/Invariants/Migrate updates |
| `kb-wiki/assets/schema.md` | New-project template | Architecture + Log Format per-dev |
| `kb-wiki/references/schema.md` | Schema reference | Directory + log format per-dev |

Tasks are ordered so each builds only on already-merged tasks. Tasks 1–3 establish tested foundations; 4–5 wire the scripts; 6–7 are docs; 8 is end-to-end acceptance.

---

## Task 1: Pure developer-slug logic

**Files:**
- Modify: `kb-wiki/scripts/lib/kb.ts` (add `slugifyDev`, `resolveDevSlug`)
- Test: `kb-wiki/scripts/lib/kb.test.ts` (create)

**Interfaces:**
- Produces:
  - `slugifyDev(raw: string): string`
  - `resolveDevSlug(): string`

- [ ] **Step 1: Write the failing tests**

Create `kb-wiki/scripts/lib/kb.test.ts`:

```ts
import { test, expect } from "bun:test"
import { slugifyDev, resolveDevSlug } from "./kb"

test("slugifyDev: spaces and case → kebab", () => {
  expect(slugifyDev("Ray Chang")).toBe("ray-chang")
  expect(slugifyDev("  Multiple   Spaces  ")).toBe("multiple-spaces")
})

test("slugifyDev: strips path separators and traversal", () => {
  expect(slugifyDev("a/b")).toBe("a-b")
  expect(slugifyDev("../../etc")).toBe("etc") // no slash, no ".."
  expect(slugifyDev("..")).toBe("")
})

test("slugifyDev: preserves unicode letters", () => {
  expect(slugifyDev("張瑞")).toBe("張瑞")
})

test("resolveDevSlug: KB_DEV overrides and is slugged", () => {
  const prev = process.env.KB_DEV
  process.env.KB_DEV = "Alice Example"
  expect(resolveDevSlug()).toBe("alice-example")
  if (prev === undefined) delete process.env.KB_DEV
  else process.env.KB_DEV = prev
})

test("resolveDevSlug: empty KB_DEV falls through to git name (non-empty, not unknown)", () => {
  const prev = process.env.KB_DEV
  delete process.env.KB_DEV
  const got = resolveDevSlug()
  expect(got.length).toBeGreaterThan(0)
  expect(got).not.toBe("unknown") // git user.name is configured in this repo
  if (prev !== undefined) process.env.KB_DEV = prev
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test kb-wiki/scripts/lib/kb.test.ts`
Expected: FAIL — `slugifyDev`/`resolveDevSlug` not exported from `./kb`.

- [ ] **Step 3: Implement the helpers**

In `kb-wiki/scripts/lib/kb.ts`, add after the existing imports (`resolve` is already imported from `"path"`):

```ts
// ─── Developer identity ───────────────────────────────────

/**
 * Filename-safe slug for a developer identifier. NOT the Init shell allowlist:
 * this value only becomes a path component (Bun.write), never a shell argument,
 * so unicode letters are preserved while path-dangerous characters are removed.
 */
export function slugifyDev(raw: string): string {
  let s = raw.trim().toLowerCase()
  s = s.replace(/\s+/g, "-")            // whitespace runs → hyphen
  s = s.replace(/[\/\\]/g, "-")         // path separators → hyphen
  s = s.replace(/\.{2,}/g, "-")         // collapse ".." (traversal) → hyphen
  s = s.replace(/[\x00-\x1f\x7f]/g, "") // strip control chars
  s = s.replace(/^[.\-]+/, "")          // no leading dot/hyphen
  s = s.replace(/-{2,}/g, "-").replace(/-+$/, "")
  return s
}

/**
 * Resolve the current developer slug for log routing.
 * Order: KB_DEV env override → git config user.name → "unknown".
 */
export function resolveDevSlug(): string {
  const env = process.env.KB_DEV?.trim()
  if (env) {
    const s = slugifyDev(env)
    if (s) return s
  }
  try {
    const p = Bun.spawnSync(["git", "config", "user.name"]) // array form — no shell
    if (p.exitCode === 0) {
      const s = slugifyDev(p.stdout.toString().trim())
      if (s) return s
    }
  } catch {
    /* git missing / not a repo → fall through */
  }
  return "unknown"
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test kb-wiki/scripts/lib/kb.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add kb-wiki/scripts/lib/kb.ts kb-wiki/scripts/lib/kb.test.ts
git commit -m "✨ feat(kb-wiki): add developer-slug resolution (git name + KB_DEV override)"
```

---

## Task 2: Pure log-routing helpers

**Files:**
- Modify: `kb-wiki/scripts/lib/kb.ts` (add `isLogFile`, `pickLogTarget`, `insertNewestAtTop`, `logHeader`, `formatLogEntry`)
- Test: `kb-wiki/scripts/lib/kb.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from prior tasks (pure).
- Produces:
  - `isLogFile(relativePath: string): boolean`
  - `pickLogTarget(opts: { logDir: string; legacyLog: string; dev: string; logDirExists: boolean; legacyLogExists: boolean; devFileExists: boolean }): { path: string; isNew: boolean }`
  - `insertNewestAtTop(existing: string, entry: string): string`
  - `logHeader(dev: string): string`
  - `formatLogEntry(action: string, description: string, details: string[]): string`

- [ ] **Step 1: Write the failing tests**

Append to `kb-wiki/scripts/lib/kb.test.ts`:

```ts
import { resolve } from "path"
import {
  isLogFile, pickLogTarget, insertNewestAtTop, logHeader, formatLogEntry,
} from "./kb"

test("isLogFile: matches log.md and log/ files, not lookalikes", () => {
  expect(isLogFile("log.md")).toBe(true)
  expect(isLogFile("log/ray-chang.md")).toBe(true)
  expect(isLogFile("log/_archive.md")).toBe(true)
  expect(isLogFile("logging.md")).toBe(false)
  expect(isLogFile("concepts/log-shipping.md")).toBe(false)
})

test("pickLogTarget: new layout writes per-dev file", () => {
  const base = { logDir: "/k/log", legacyLog: "/k/log.md", dev: "ray-chang", legacyLogExists: false }
  expect(pickLogTarget({ ...base, logDirExists: true, devFileExists: false }))
    .toEqual({ path: resolve("/k/log", "ray-chang.md"), isNew: true })
  expect(pickLogTarget({ ...base, logDirExists: true, devFileExists: true }))
    .toEqual({ path: resolve("/k/log", "ray-chang.md"), isNew: false })
})

test("pickLogTarget: legacy single-file project keeps log.md", () => {
  expect(pickLogTarget({
    logDir: "/k/log", legacyLog: "/k/log.md", dev: "ray-chang",
    logDirExists: false, legacyLogExists: true, devFileExists: false,
  })).toEqual({ path: "/k/log.md", isNew: false })
})

test("pickLogTarget: neither exists → adopt new layout", () => {
  expect(pickLogTarget({
    logDir: "/k/log", legacyLog: "/k/log.md", dev: "ray-chang",
    logDirExists: false, legacyLogExists: false, devFileExists: false,
  })).toEqual({ path: resolve("/k/log", "ray-chang.md"), isNew: true })
})

test("insertNewestAtTop: newest entry goes right below the first --- separator", () => {
  const header = logHeader("ray-chang")
  const first = formatLogEntry("ingest", "first", ["a"])
  const second = formatLogEntry("query", "second", ["b"])
  const out = insertNewestAtTop(insertNewestAtTop(header, first), second)
  expect(out.indexOf("second")).toBeLessThan(out.indexOf("first")) // newest first
  expect(out.indexOf("---")).toBeLessThan(out.indexOf("second"))   // below header
})

test("formatLogEntry: renders dated action heading + bullets", () => {
  const e = formatLogEntry("map", "Rebuilt index", ["Pages indexed: 3"])
  expect(e).toMatch(/## \[\d{4}-\d{2}-\d{2}\] map \| Rebuilt index/)
  expect(e).toContain("- Pages indexed: 3")
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test kb-wiki/scripts/lib/kb.test.ts`
Expected: FAIL — new helpers not exported.

- [ ] **Step 3: Implement the helpers**

In `kb-wiki/scripts/lib/kb.ts`, add a new section (keep the existing `todayDate` where it is):

```ts
// ─── Log routing (pure) ───────────────────────────────────

/** True for the legacy single log file or any per-developer log file. */
export function isLogFile(relativePath: string): boolean {
  return relativePath === "log.md" || relativePath.startsWith("log/")
}

/** Header written when a developer's log file is first created. */
export function logHeader(dev: string): string {
  return [
    `# Wiki — Log (${dev})`,
    "",
    "> Append-only. Newest entries at top. One log file per developer.",
    "",
    "---",
    "",
  ].join("\n")
}

/** Format a single dated log entry block. */
export function formatLogEntry(
  action: string,
  description: string,
  details: string[],
): string {
  const date = new Date().toISOString().split("T")[0]
  return [
    "",
    `## [${date}] ${action} | ${description}`,
    ...details.map((d) => `- ${d}`),
    "",
  ].join("\n")
}

/** Insert an entry right below the first `---` separator (newest at top). */
export function insertNewestAtTop(existing: string, entry: string): string {
  const firstSep = existing.indexOf("---\n")
  const insertPoint = firstSep !== -1 ? firstSep + 4 : existing.length
  return existing.slice(0, insertPoint) + entry + existing.slice(insertPoint)
}

/**
 * Decide which log file an entry goes to, given on-disk existence flags.
 * - new layout (log/ dir present) → log/<dev>.md
 * - legacy project (only log.md)  → log.md  (compat until Migrate)
 * - neither                       → adopt new layout (log/<dev>.md)
 */
export function pickLogTarget(opts: {
  logDir: string
  legacyLog: string
  dev: string
  logDirExists: boolean
  legacyLogExists: boolean
  devFileExists: boolean
}): { path: string; isNew: boolean } {
  const { logDir, legacyLog, dev, logDirExists, legacyLogExists, devFileExists } = opts
  if (logDirExists) {
    return { path: resolve(logDir, `${dev}.md`), isNew: !devFileExists }
  }
  if (legacyLogExists) {
    return { path: legacyLog, isNew: false }
  }
  return { path: resolve(logDir, `${dev}.md`), isNew: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test kb-wiki/scripts/lib/kb.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add kb-wiki/scripts/lib/kb.ts kb-wiki/scripts/lib/kb.test.ts
git commit -m "✨ feat(kb-wiki): add pure log-routing helpers (isLogFile, pickLogTarget, insert)"
```

---

## Task 3: Config paths + `appendLog` rewrite (filesystem wrapper)

**Files:**
- Modify: `kb-wiki/scripts/lib/config.ts:7-19` (replace `log` with `logDir`+`legacyLog`) and `:37` (skip `log`)
- Modify: `kb-wiki/scripts/lib/kb.ts` (add `writeLogEntry`; rewrite `appendLog`)
- Test: `kb-wiki/scripts/lib/kb.test.ts` (extend with temp-dir integration tests)

**Interfaces:**
- Consumes: `pickLogTarget`, `insertNewestAtTop`, `logHeader`, `formatLogEntry`, `resolveDevSlug` (Tasks 1–2); `config.kb.logDir`, `config.kb.legacyLog`.
- Produces:
  - `writeLogEntry(opts: { logDir: string; legacyLog: string; dev: string; entry: string }): Promise<string>` (returns the path written)
  - `appendLog(action: string, description: string, details: string[]): Promise<void>` (unchanged signature)

- [ ] **Step 1: Write the failing integration tests**

Append to `kb-wiki/scripts/lib/kb.test.ts`:

```ts
import { afterEach } from "bun:test"
import { mkdir, rm } from "fs/promises"
import { writeLogEntry } from "./kb"

const TMP = resolve(import.meta.dir, "__kbtest_tmp__")
afterEach(async () => { await rm(TMP, { recursive: true, force: true }) })

test("writeLogEntry: new layout creates log/<dev>.md with header", async () => {
  await mkdir(resolve(TMP, "log"), { recursive: true })
  const path = await writeLogEntry({
    logDir: resolve(TMP, "log"),
    legacyLog: resolve(TMP, "log.md"),
    dev: "ray-chang",
    entry: formatLogEntry("ingest", "x", ["y"]),
  })
  expect(path).toBe(resolve(TMP, "log", "ray-chang.md"))
  const text = await Bun.file(path).text()
  expect(text).toContain("# Wiki — Log (ray-chang)")
  expect(text).toContain("## [")
})

test("writeLogEntry: legacy log.md keeps appending to the single file", async () => {
  await mkdir(TMP, { recursive: true })
  await Bun.write(resolve(TMP, "log.md"), logHeader("legacy"))
  const path = await writeLogEntry({
    logDir: resolve(TMP, "log"),
    legacyLog: resolve(TMP, "log.md"),
    dev: "ray-chang",
    entry: formatLogEntry("query", "z", ["w"]),
  })
  expect(path).toBe(resolve(TMP, "log.md"))
  const text = await Bun.file(path).text()
  expect(text).toContain("z") // entry landed in the legacy file
})

test("writeLogEntry: two developers get two separate files (no shared file)", async () => {
  await mkdir(resolve(TMP, "log"), { recursive: true })
  const a = await writeLogEntry({ logDir: resolve(TMP, "log"), legacyLog: resolve(TMP, "log.md"),
    dev: "alice", entry: formatLogEntry("map", "a", ["x"]) })
  const b = await writeLogEntry({ logDir: resolve(TMP, "log"), legacyLog: resolve(TMP, "log.md"),
    dev: "bob", entry: formatLogEntry("map", "b", ["y"]) })
  expect(a).toBe(resolve(TMP, "log", "alice.md"))
  expect(b).toBe(resolve(TMP, "log", "bob.md"))
  expect(a).not.toBe(b)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test kb-wiki/scripts/lib/kb.test.ts`
Expected: FAIL — `writeLogEntry` not exported.

- [ ] **Step 3: Update `config.ts`**

In `kb-wiki/scripts/lib/config.ts`, replace the single log path:

```ts
  kb: {
    wiki: resolve(ROOT, "kb/wiki"),
    index: resolve(ROOT, "kb/wiki/index.md"),
    logDir: resolve(ROOT, "kb/wiki/log"),
    legacyLog: resolve(ROOT, "kb/wiki/log.md"),
    rawSources: resolve(ROOT, "kb/raw/sources"),
  },
```

And extend the `discoverCategories` skip condition (currently line ~37):

```ts
    if (entry.startsWith(".") || entry === "summaries" || entry === "queries" || entry === "log") {
      continue
    }
```

- [ ] **Step 4: Add `writeLogEntry` and rewrite `appendLog` in `kb.ts`**

Add `existsSync` to the fs import at the top of `kb-wiki/scripts/lib/kb.ts`:

```ts
import { readdir, stat } from "fs/promises"
import { existsSync } from "fs"
import { resolve, relative } from "path"
import { config } from "./config"
```

Replace the existing `appendLog` (currently the `## [date]`-building function that writes `config.kb.log`) with:

```ts
/**
 * Write a log entry to the correct file, creating it with a header if new.
 * Pure routing is delegated to pickLogTarget; this wires the filesystem.
 * Returns the path written.
 */
export async function writeLogEntry(opts: {
  logDir: string
  legacyLog: string
  dev: string
  entry: string
}): Promise<string> {
  const { logDir, legacyLog, dev, entry } = opts
  const logDirExists = existsSync(logDir)
  const target = pickLogTarget({
    logDir,
    legacyLog,
    dev,
    logDirExists,
    legacyLogExists: existsSync(legacyLog),
    devFileExists: logDirExists && existsSync(resolve(logDir, `${dev}.md`)),
  })
  const existing = target.isNew ? logHeader(dev) : await Bun.file(target.path).text()
  await Bun.write(target.path, insertNewestAtTop(existing, entry))
  return target.path
}

/**
 * Append an activity entry to the current developer's log file.
 * Routes to kb/wiki/log/<dev>.md (new layout) or kb/wiki/log.md (legacy).
 */
export async function appendLog(
  action: string,
  description: string,
  details: string[],
): Promise<void> {
  await writeLogEntry({
    logDir: config.kb.logDir,
    legacyLog: config.kb.legacyLog,
    dev: resolveDevSlug(),
    entry: formatLogEntry(action, description, details),
  })
}
```

> Note: `Bun.write` auto-creates the parent `log/` directory, so adopting the new layout needs no explicit `mkdir`.

- [ ] **Step 5: Run the full test file to verify it passes**

Run: `bun test kb-wiki/scripts/lib/kb.test.ts`
Expected: PASS (all tests, including the 3 new integration tests).

- [ ] **Step 6: Commit**

```bash
git add kb-wiki/scripts/lib/config.ts kb-wiki/scripts/lib/kb.ts kb-wiki/scripts/lib/kb.test.ts
git commit -m "✨ feat(kb-wiki): route appendLog to per-developer log files (compat-preserving)"
```

---

## Task 4: Update `lint.ts` to the `isLogFile` predicate

**Files:**
- Modify: `kb-wiki/scripts/lint.ts` (import + 4 sites; keep injection scan)

**Interfaces:**
- Consumes: `isLogFile` from `./lib/kb` (Task 2).

- [ ] **Step 1: Add the import**

In `kb-wiki/scripts/lint.ts`, add `isLogFile` to the existing `./lib/kb` import:

```ts
import {
  readAllWikiPages,
  listRawSourceFiles,
  readRawTextSources,
  appendLog,
  todayDate,
  isLogFile,
} from "./lib/kb"
```

- [ ] **Step 2: Replace the broken-link skip (currently lines ~46-48)**

```ts
    if (page.relativePath.startsWith("summaries/")) continue
    // log files are append-only history — their links legitimately rot when pages are renamed
    if (isLogFile(page.relativePath)) continue
```

- [ ] **Step 3: Replace the orphan-page skip (currently the `path === "log"` clause)**

In `checkOrphanPages`, change the guard so it skips log files via the predicate:

```ts
    const path = page.relativePath.replace(".md", "")
    if (
      path === "index" ||
      isLogFile(page.relativePath) ||
      path === "overview" ||
      page.relativePath.endsWith("_moc.md") ||
      page.relativePath.match(/^lint-report-/) ||
      page.relativePath.startsWith("summaries/")
    ) continue
```

- [ ] **Step 4: Replace the missing-frontmatter skip (currently the `page.relativePath === "log.md"` clause)**

In `checkMissingFrontmatter`:

```ts
    if (
      page.relativePath === "index.md" ||
      isLogFile(page.relativePath) ||
      page.relativePath.endsWith("_moc.md") ||
      page.relativePath.match(/^lint-report-/) ||
      page.relativePath.startsWith("summaries/")
    ) continue
```

- [ ] **Step 5: Replace the deep-analysis filter (currently `p.relativePath !== "log.md"`)**

In `deepAnalysis`'s `.filter(...)`:

```ts
    .filter(
      (p) =>
        !p.relativePath.startsWith("summaries/") &&
        p.relativePath !== "index.md" &&
        !isLogFile(p.relativePath),
    )
```

> Do NOT change `checkInjectionMarkers` — it must keep scanning every page including log files (Global Constraints).

- [ ] **Step 6: Verify lint parses and local imports resolve**

Run:
```bash
bun build --target=bun --packages external kb-wiki/scripts/lint.ts > /dev/null && echo "parse OK"
```
Expected: `parse OK`. `--packages external` is REQUIRED — the scripts import `@anthropic-ai/sdk` (via `lib/ai.ts`), which is only auto-installed at runtime, so a plain `bun build` fails on valid code with "Could not resolve". This validates parse + local-import resolution and catches a botched edit's syntax errors; it does NOT typecheck TS types. Full functional verification is in Task 8.

- [ ] **Step 7: Commit**

```bash
git add kb-wiki/scripts/lint.ts
git commit -m "♻️ refactor(kb-wiki): lint skips log files via isLogFile (keeps injection scan)"
```

---

## Task 5: Update `map.ts` to the `isLogFile` predicate

**Files:**
- Modify: `kb-wiki/scripts/map.ts` (import + 3 filter sites + MOC link filter)

**Interfaces:**
- Consumes: `isLogFile` from `./lib/kb` (Task 2). Relies on `discoverCategories` already skipping `log` (Task 3).

- [ ] **Step 1: Add the import**

In `kb-wiki/scripts/map.ts`, add `isLogFile`:

```ts
import { readAllWikiPages, appendLog, todayDate, isLogFile } from "./lib/kb"
```

- [ ] **Step 2: Replace the `buildIndex` exclusion (currently the `page.relativePath === "log.md"` clause)**

```ts
    if (
      page.relativePath.startsWith("summaries/") ||
      page.relativePath === "index.md" ||
      isLogFile(page.relativePath) ||
      page.relativePath.endsWith("_moc.md") ||
      page.relativePath.startsWith("lint-report-")
    ) continue
```

- [ ] **Step 3: Tighten the `buildMoc` outbound-link filter (currently `!l.startsWith("log")`)**

```ts
    const connections = page.outboundLinks.filter(
      (l) => !l.startsWith("index") && l !== "log" && !l.startsWith("log/"),
    )
```

- [ ] **Step 4: Replace the `discoverMissingLinks` filter (currently `p.relativePath !== "log.md"`)**

```ts
    .filter(
      (p) =>
        !p.relativePath.startsWith("summaries/") &&
        p.relativePath !== "index.md" &&
        !isLogFile(p.relativePath) &&
        !p.relativePath.startsWith("lint-report-"),
    )
```

- [ ] **Step 5: Replace the `contentPages` stats filter (currently `p.relativePath !== "log.md"`)**

```ts
  const contentPages = pages.filter(
    (p) =>
      !p.relativePath.startsWith("summaries/") &&
      p.relativePath !== "index.md" &&
      !isLogFile(p.relativePath) &&
      !p.relativePath.endsWith("_moc.md") &&
      !p.relativePath.startsWith("lint-report-"),
  )
```

- [ ] **Step 6: Verify map parses and local imports resolve**

Run:
```bash
bun build --target=bun --packages external kb-wiki/scripts/map.ts > /dev/null && echo "parse OK"
```
Expected: `parse OK`. `--packages external` is REQUIRED (same reason as Task 4 Step 6: `@anthropic-ai/sdk` is runtime-auto-installed, so a plain `bun build` fails on valid code). Validates parse + local-import resolution, not TS types. Full functional verification is in Task 8.

- [ ] **Step 7: Commit**

```bash
git add kb-wiki/scripts/map.ts
git commit -m "♻️ refactor(kb-wiki): map excludes log files via isLogFile; tighten MOC filter"
```

---

## Task 6: Update `SKILL.md`

**Files:**
- Modify: `kb-wiki/SKILL.md`

**Interfaces:** documentation only — describe the behavior implemented in Tasks 1–5.

- [ ] **Step 1: Replace every "Append to `kb/wiki/log.md`"**

Change each operation's log line (Ingest ~line 135, Query ~159, Lint ~195, Verify ~236, Map ~294, Capture ~313, Migrate ~332) from `kb/wiki/log.md` to `kb/wiki/log/<dev>.md`. Example (Ingest):

```markdown
11. Append to `kb/wiki/log/<dev>.md` (the current developer's log file — see "Activity log — one file per developer"):
```

- [ ] **Step 2: Add the "Activity log — one file per developer" subsection**

Insert just before the `## Operations` heading:

```markdown
## Activity log — one file per developer

Each operation appends its entry to the **current developer's** log file,
`kb/wiki/log/<dev>.md`, not a shared file. Two developers therefore never edit the
same file (no merge conflicts) and authorship is the filename.

- `<dev>` = `slug(git config user.name)` (lowercased, spaces → `-`). Set the `KB_DEV`
  environment variable to override (e.g. in CI, or to standardize on `git user.email`
  local-part / a platform handle — document the team's choice in `kb/schema.md`). If
  neither yields a value, the slug is `unknown`.
- Create the file with a header if it does not exist; newest entries stay at the top of
  **each** developer's file.
- Log files are an **activity/audit trail, not knowledge content** — they are not part of
  the retrieval backbone (`index.md` + `summaries/`) and are not cited in answers.
- **Backward compatible:** a project that still has a single `kb/wiki/log.md` and no
  `kb/wiki/log/` directory keeps appending to that single file until it runs Migrate.
```

- [ ] **Step 3: Update Init step 5**

Replace "Create `kb/wiki/log.md`" with directory + first per-dev file:

```markdown
5. Create the `kb/wiki/log/` directory and the initializing developer's log file
   `kb/wiki/log/<dev>.md` (`<dev>` per "Activity log — one file per developer"):
   ```markdown
   # {Project} Wiki — Log ({dev})

   > Append-only. Newest entries at top. One log file per developer.

   ---
   ```
```

- [ ] **Step 4: Update the Invariants line**

Change "Always update `index.md` and `log.md` after any wiki change" to:

```markdown
- **Always update `index.md` and the current developer's log file** (`kb/wiki/log/<dev>.md`) after any wiki change
```

- [ ] **Step 5: Update the Lint and Map manual-fallback wording**

- Lint broken-links bullet: "skip links inside `log.md`" → "skip links inside any log file (`log.md` or `log/*.md`) — append-only history; links legitimately rot when pages are renamed".
- Map step 1: "(excluding `log.md`, `_moc.md` files, and `summaries/`)" → "(excluding log files (`log.md` / `log/*.md`), `_moc.md` files, and `summaries/`)".

- [ ] **Step 6: Add the Migrate freeze step**

In the Migrate operation, add a step (renumber following steps) before the summaries backfill:

```markdown
4. **Freeze the legacy log**: if a single `kb/wiki/log.md` exists, move it to
   `kb/wiki/log/_archive.md` (create `kb/wiki/log/` first). Do **not** redistribute its
   entries into per-developer files. After this, all operations write per-developer.
   The archive keeps the same treatment as the live log: excluded from link/orphan/
   frontmatter checks, still injection-scanned, never cited as knowledge.
```

Also update Migrate step 1's "recent `log.md` entries" to "recent log entries (`log.md` or, post-freeze, `log/_archive.md`)".

- [ ] **Step 7: Commit**

```bash
git add kb-wiki/SKILL.md
git commit -m "📝 docs(kb-wiki): document per-developer log layout across all operations"
```

---

## Task 7: Update schema templates

**Files:**
- Modify: `kb-wiki/assets/schema.md` (Architecture diagram + Log Format)
- Modify: `kb-wiki/references/schema.md` (Directory Structure + log format)

**Interfaces:** documentation only.

- [ ] **Step 1: `assets/schema.md` — Architecture diagram**

Change the `log.md` line in the architecture tree to:

```
│   ├── log/        # One append-only log file per developer (log/<dev>.md)
```

- [ ] **Step 2: `assets/schema.md` — Log Format section**

Replace the "Log Format (wiki/log.md)" block with:

```markdown
## Log Format (wiki/log/<dev>.md)

Each developer appends to their own file `wiki/log/<dev>.md` (`<dev>` =
`slug(git config user.name)`; `KB_DEV` env overrides). Newest entries at top:

```markdown
## [YYYY-MM-DD] action | Description
- Details of what changed
- Pages created/updated: [[page1]], [[page2]]
```

Actions: `ingest`, `query`, `lint`, `map`, `verify`, `capture`, `update`, `restructure`, `migrate`.
Migrate freezes a pre-existing single `wiki/log.md` to `wiki/log/_archive.md`.
```

- [ ] **Step 3: `references/schema.md` — Directory Structure**

Change the `log.md` line in the directory tree to:

```
│   ├── log/        # One append-only log file per developer (log/<dev>.md)
```

- [ ] **Step 4: `references/schema.md` — log format section**

Retitle "## log.md Format" to "## log/ Format (one file per developer)" and update its body to describe `wiki/log/<dev>.md`, the `slug(git user.name)` / `KB_DEV` naming rule, that newest entries stay at the top of each file, and the `_archive.md` frozen archive. Update the grep tooling note to glob:

```markdown
The consistent `## [YYYY-MM-DD] action |` prefix keeps logs parseable with plain unix
tools — e.g. `grep "^## \[" kb/wiki/log/*.md | head -5` lists recent activity across all
developers.
```

- [ ] **Step 5: Commit**

```bash
git add kb-wiki/assets/schema.md kb-wiki/references/schema.md
git commit -m "📝 docs(kb-wiki): update schema templates for per-developer log layout"
```

---

## Task 8: End-to-end acceptance

**Files:** none modified — this task verifies the three acceptance criteria from the spec against the real scripts.

**Interfaces:** exercises `lint.ts` and `map.ts` (both call `appendLog`).

- [ ] **Step 1: Build the new-layout fixture**

```bash
REPO=/Users/raychangmbp2025/Workspace/agent-skills-local
FIX=/tmp/kbwiki-accept; rm -rf "$FIX"
mkdir -p "$FIX/kb/wiki/log" "$FIX/kb/wiki/concepts" "$FIX/kb/raw/sources"
printf '# Demo Wiki — Index\n\n> test\n\n---\n\n**Total: 1 pages**\n' > "$FIX/kb/wiki/index.md"
printf -- '---\ntitle: Alpha\ncategory: concepts\ntags: [a]\nstatus: seedling\n---\n\n# Alpha\n\nFirst concept page with enough body text to be a real summary line.\n\n## See Also\n- [[concepts/alpha]]\n' > "$FIX/kb/wiki/concepts/alpha.md"
echo "fixture ready"
```

- [ ] **Step 2: Acceptance #1 — lint reports 0 errors on the `log/` layout**

```bash
( cd "$FIX" && bun "$REPO/kb-wiki/scripts/lint.ts" ); echo "lint exit=$?"
```
Expected: report prints `0 errors` and `lint exit=0`. (Exit is non-zero only when errors > 0.) Lint's own entry should appear at `"$FIX/kb/wiki/log/<dev>.md"`.

- [ ] **Step 3: Acceptance #2 — two developers write two separate files, no shared file**

```bash
( cd "$FIX" && KB_DEV="Alice Example" bun "$REPO/kb-wiki/scripts/map.ts" >/dev/null )
( cd "$FIX" && KB_DEV="Bob Roy"       bun "$REPO/kb-wiki/scripts/map.ts" >/dev/null )
ls "$FIX/kb/wiki/log/"
```
Expected: the directory lists `alice-example.md` and `bob-roy.md` (two separate files). Because each developer writes a distinct file, concurrent edits cannot produce a git merge conflict. Confirm `log` did NOT become a category:
```bash
grep -c "## Log" "$FIX/kb/wiki/index.md"; echo "(expect 0)"
test ! -e "$FIX/kb/wiki/log/_moc.md" && echo "no log MOC: OK"
```

- [ ] **Step 4: Acceptance #3 — legacy single-`log.md` project still works**

```bash
LEG=/tmp/kbwiki-legacy; rm -rf "$LEG"
mkdir -p "$LEG/kb/wiki/concepts" "$LEG/kb/raw/sources"
printf '# Legacy Wiki — Index\n\n> test\n\n---\n\n**Total: 1 pages**\n' > "$LEG/kb/wiki/index.md"
printf '# Legacy Wiki — Log\n\n> Append-only chronological record. Newest entries at top.\n\n---\n' > "$LEG/kb/wiki/log.md"
printf -- '---\ntitle: Beta\ncategory: concepts\ntags: [b]\nstatus: seedling\n---\n\n# Beta\n\nA legacy concept page with sufficient body text for the index summary.\n\n## See Also\n- [[concepts/beta]]\n' > "$LEG/kb/wiki/concepts/beta.md"
( cd "$LEG" && bun "$REPO/kb-wiki/scripts/map.ts" >/dev/null )
test -f "$LEG/kb/wiki/log.md" && ! test -d "$LEG/kb/wiki/log" && echo "legacy still single-file: OK"
grep -q "map" "$LEG/kb/wiki/log.md" && echo "entry appended to legacy log.md: OK"
```
Expected: both `OK` lines print — the entry went to the existing `log.md` and no `log/` directory was created.

- [ ] **Step 5: Run the unit test suite once more (regression gate)**

```bash
bun test "$REPO/kb-wiki/scripts/lib/kb.test.ts"
```
Expected: all tests PASS.

- [ ] **Step 6: Clean up fixtures and commit acceptance notes (if any)**

```bash
rm -rf /tmp/kbwiki-accept /tmp/kbwiki-legacy
```
No source changes in this task. If any defect was found and fixed, the fix belongs in the relevant earlier task's file and gets its own commit.

---

## Self-Review

**Spec coverage** (spec §5 file-by-file → tasks):
- §5.1 config.ts (logDir/legacyLog + skip `log`) → Task 3.
- §5.2 kb.ts (`resolveDevSlug`, `isLogFile`, `appendLog` rewrite) → Tasks 1, 2, 3.
- §5.3 lint.ts (predicate, keep injection scan) → Task 4.
- §5.4 map.ts (predicate + MOC tighten) → Task 5.
- §5.5 SKILL.md → Task 6.
- §5.6 assets/schema.md → Task 7.
- §5.7 references/schema.md → Task 7.
- §4 dev-id resolution + slug rule → Task 1.
- §6 backward compat + Migrate freeze → Task 3 (compat path) + Task 6 (Migrate doc).
- §7 archive treatment → Task 4 (predicate covers `log/_archive.md`) + Task 6 (Migrate doc).
- §9 tests + acceptance → Tasks 1–3 (unit) + Task 8 (acceptance #1/#2/#3).
- §10 out-of-scope items are intentionally absent. No gaps found.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". `<dev>` is intentional spec notation, not a placeholder.

**Type consistency:** `slugifyDev`, `resolveDevSlug`, `isLogFile`, `pickLogTarget`, `insertNewestAtTop`, `logHeader`, `formatLogEntry`, `writeLogEntry`, `appendLog` use identical names/signatures across the Interfaces blocks, code steps, and tests. `config.kb.logDir`/`config.kb.legacyLog` replace `config.kb.log` consistently and the old name has no remaining consumers after Task 3.
