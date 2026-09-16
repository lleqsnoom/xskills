# AGENTS.md — xskills

## Project Overview

`xskills` is an npm package that installs [Agent Skills](https://agentskills.io) into projects or globally. Skills are folders containing a `SKILL.md` (YAML frontmatter + Markdown) plus optional `scripts/`, `references/`, and `assets/` subdirectories. They follow the Agent Skills open standard and work with 45+ AI coding CLIs.

The package has **zero dependencies** — it uses only Node.js built-ins (`fs/promises`, `path`, `os`, `child_process`).

---

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Runs all tests (install, version-bump, etc.) |
| `npm run check:run-folders` | Fails if the run-folder helpers have drifted between skills |
| `npm run sync:run-folders` | Rewrites the run-folder helpers in every skill from the one canonical block |
| `npm run release -- --dry-run` | Dry-run semantic-release locally to preview bump type |
| `node bin/install.js list` | Lists available skills with descriptions |
| `node bin/install.js install <name>` | Installs a skill into the current project's `.agents/skills/` |
| `node bin/install.js install <name> --global` | Installs globally to `~/.agents/skills/` |
| `node bin/install.js install-all --global --force` | Refreshes every installed skill, replacing existing copies |
| `node bin/install.js <name>` | Shortcut: installs the named skill |
| `node bin/install.js help` | Shows usage info |

---

## Directory Structure

```
xskills/
├── package.json              # Node >= 18, name: "xskills", MIT
├── bin/install.js            # CLI entry point (CommonJS)
├── lib/install.js            # Core logic — install, globalInstall, listSkills
├── automation/               # Scheduled maintenance (not published in the npm package)
│   └── daily-reflection/     # 05:00 Orca job: collect last 24h sessions from every CLI, write a digest
└── skills/                   # Skill packages (published as part of the npm package)
    ├── x-commit/             # Conventional commit message helper
    │   ├── SKILL.md          # Required: YAML frontmatter + instructions
    │   ├── scripts/          # Optional: executable scripts (ES modules)
    │   ├── references/       # Optional: docs, type maps
    │   └── assets/           # Optional: configs, templates
    ├── x-review/             # Code review against engineering principles
    │   ├── SKILL.md
    │   ├── scripts/
    │   ├── references/
    │   └── assets/
    ├── x-reproduce/          # Creates minimal platform-aware reproducible test cases
    │   ├── SKILL.md
    │   └── scripts/
    ├── x-research/           # Metric-driven iteration loop — command- or agent-judged (criteria coverage) evaluation, one atomic change per iteration, keep/revert by numbers
    │   ├── SKILL.md
    │   ├── scripts/
    │   └── references/
    ├── x-browser/            # Launch Chrome with remote debugging + attach chrome-devtools MCP
    │   ├── SKILL.md
    │   └── scripts/
    ├── x-roast/              # Critique articles/analyses/epics/tasks/research with online fact-checking + reproducible rubric score
    │   ├── SKILL.md
    │   ├── scripts/
    │   └── references/
    ├── x-humanize/           # Simplify prose to a B2 reading level — measure, rewrite, verify meaning kept + no noise
    │   ├── SKILL.md
    │   ├── scripts/
    │   └── references/
    ├── x-essay/              # Author an article on a fixed loop: x-anal → x-roast → x-humanize, bounded by score gate + cap
    │   ├── SKILL.md
    │   ├── scripts/
    │   └── references/
    ├── x-fix/                # Resolve code review issues from fix plan files
    │   └── SKILL.md
    ├── x-anal/               # Interactive analysis — understand problem, produce thesis with evidence, propose solution
    │   └── SKILL.md
    ├── x-investigate/        # Hypothesis-driven root cause analysis — ranked hypotheses, git history, platform tools
    │   ├── SKILL.md
    │   └── scripts/
    ├── x-autoreflection/     # Reflect on a session — scan the transcript for friction, propose skill improvements
    │   ├── SKILL.md
    │   ├── scripts/
    │   └── references/
    ├── x-triage/             # Structured intake — classify bug platform/type/evidence before debugging
    │   ├── SKILL.md
    │   └── scripts/
    ├── x-plan/             # Plan — clarify goals, write specs as declarations (contract, invariant, test)
    │   ├── SKILL.md
    │   └── scripts/
    ├── x-epic/               # Epic definition — outcome-focused user stories with INVEST and DOD
    │   ├── SKILL.md
    │   └── scripts/
    └── x-decompose/          # Atomic task decomposition — tasks ≤8h with DOD, test plans, effort estimates
        ├── SKILL.md
        └── scripts/
    ├── x-skill-lint/         # Validate the repo's own skills — frontmatter, refs, README table
    │   ├── SKILL.md
    │   └── scripts/
```

---

## Skill Access Patterns

Skills are plain markdown files, not MCP servers. Using the wrong access method causes `mcp '<skill>' not available` errors. **xskills ships no MCP server** — a skill is read as a file with the `view`/`read` tool.

### How to read a skill's instructions (SKILL.md)

| Skill Type | Location on Disk | Correct Tool | Example |
|------------|-----------------|--------------|---------|
| **User-installed** (`x-*`) | `$HOME/.agents/skills/<name>/SKILL.md` | `view` tool with file path | `view $HOME/.agents/skills/x-implement/SKILL.md` |
| **Source repo** (published package) | `<project>/skills/<name>/SKILL.md` | `view` tool with file path | `view skills/x-plan/SKILL.md` |
| **Builtin** (`jq`, `omarchy`) | Internal to Crush runtime | `crush://skills/<name>/SKILL.md` | `view crush://skills/jq/SKILL.md` |

**Never use `Read Mcp Resource` with a skill name as the server.** There is no MCP server named `x-implement`, `x-commit`, etc. Some skills drive *external* MCP servers that the client may have configured (for example `x-browser` attaches to a `chrome-devtools` MCP) — those belong to the environment, not to xskills.

### When task directories don't exist yet

Directories like `.x-skills/runs/` are **created by the skills themselves** during workflow execution. If a glob or read fails because these paths don't exist, that means the prior pipeline step hasn't run yet:
- `<run folder>/E00-plan.md` → created when `x-plan` runs (before `x-epic`)
- `<run folder>/E01-epic.md` → created when `x-epic` runs (before `x-decompose`)
- `<run folder>/E02-tasks/` → created when `x-decompose` runs (before `x-implement`)
- `<run folder>/E<nn>-triage.md` → created when `x-triage` runs (before `x-reproduce`)

If you need content at one of these paths, first execute the skill that creates it.

---

## Development Workflow

The planning workflow follows a three-phase handoff chain using **layer-based decomposition** (onion approach). Each layer is a complete, testable increment — like oil painting: base coat first, detail later.

| Phase | Skill | Input | Output | Gate |
|-------|-------|-------|--------|------|
| 1. Plan | `x-plan` | Vague goal or requirement | `<run folder>/E00-plan.md` (spec + layer roadmap) | User approves spec |
| 2. Epic | `x-epic` | Approved spec | `<run folder>/E01-epic.md` (layers with scope + DOD) | User approves epic |
| 3. Decompose | `x-decompose` | Approved epic | `<run folder>/E02-tasks/` (layer-organized tasks, each independently testable) | User approves tasks |

After task approval → `x-implement` executes tasks layer by layer (L0 first, then L1, etc.).

### The Onion Approach (Layer-Based Decomposition)

**Old approach (component-based):** Break into pieces like header, footer, queue, lambda. Nothing works until all pieces are done. Hard to test incrementally.

**New approach (layer-based):** Each layer is a complete, working increment:

```
Layer 0 — Skeleton/Prototype: basic flow with mocks/stubs → something runs and tests pass
Layer 1 — Real Implementation: replace mocks with actual logic → same tests still pass, real data flows
Layer 2 — Resilience: error handling, retries, logging → system survives bad input
Layer 3+ — Polish: monitoring, docs, edge cases → production-ready
```

**Key rules:**
- **L0 is always a working prototype** — after Task 0.1, you can run `node test` and see something work
- **Each task = one verifiable change** — not "created file X" but "file X works and is tested"
- **Regression is mandatory for L1+** — every task verifies previous layer tests still pass
- **Tasks within a layer are small steps** (1-3 per layer); layers are the real increments
- **If you catch yourself decomposing by component** (header, footer, nav), each component must be independently testable to qualify as a layer

### Example: Image Processing Pipeline (SQS + Lambda)

```
L0 — Skeleton (2 tasks):
  Task 0.1: Create project + basic sender → mock queue → stub Lambda → fixed response
  Task 0.2: Add integration test proving end-to-end flow works

L1 — Real Processing (2 tasks):
  Task 1.1: Implement actual image resize logic in Lambda
  Task 1.2: Wire real processor, verify all L0 tests still pass with real data

L2 — Resilience (2 tasks):
  Task 2.1: Add error handling + dead letter queue for failed messages
  Task 2.2: Add retry logic with exponential backoff

L3 — Observability (1 task):
  Task 3.1: Add CloudWatch metrics + structured logging
```

vs. old approach: "Create SQS queue, create Lambda function, implement sender, implement resize" — none of which work until all 4 are done.


## Debugging Workflow

Independent of the planning pipeline, debugging uses a multi-skill scientific method workflow:

| Phase | Skill | Input | Output | Gate |
|-------|-------|-------|--------|------|
| 1. Triage | `x-triage` | Bug report (error message, symptoms) | `<run folder>/E<nn>-triage.md` | User confirms classification |
| 2. Reproduce | `x-reproduce` | Triage brief → Platform field | `<run folder>/E<nn>-repro-<platform>.js` | Reproduction triggers same error locally |
| 3. Investigate | `x-investigate` | Triage brief + repro script | `<run folder>/E<nn>-investigate.md` (fix plan) | Root cause confirmed, hypotheses eliminated |
| 4. Fix | `x-fix` (existing) | Fix plan from investigate | Updated source files + verification passes | Verification script exits 0 |

**Critical rule:** never silence errors — always fix the root cause and verify with reproduction.

### Skill Descriptions

- **x-triage** — Structured intake: asks targeted questions about platform, symptoms, and evidence before any tools run
- **x-reproduce** — Creates minimal platform-aware reproducible test cases (browser console, Node standalone, ADB logcat steps)
- **x-anal** — Interactive analysis: confirms user intent, clarifies ambiguities with suggestions, produces thesis with evidence and solution proposition, routes to fix or task creation
- **x-investigate** — Hypothesis-driven root cause analysis using git bisect/blame, Chrome DevTools, debuggers, or engine profilers depending on platform
- **x-autoreflection** — Session retrospective: exports the transcript of this or an earlier session, scans it mechanically for friction (failed commands, repeats, user corrections, prose questions, unused skills), verifies each signal against the real skill files, and writes evidence-backed improvement proposals to `<run folder>/E<nn>-reflection.md`

## Daily Reflection Automation

An Orca automation named **x-skills-daily-reflection** runs every day at **05:00 Europe/Warsaw** in this
repository and leaves a digest for review. It never edits a skill — it proposes, and the review decides.

| Piece | Path | Role |
|-------|------|------|
| Collector | `automation/daily-reflection/collect-sessions.mjs` | Finds every session of the last 24h across all detected CLIs, scans each for x-skill friction, writes the evidence pack |
| Hosts | `skills/x-autoreflection/scripts/hosts/` | One adapter per CLI (`crush`, `codex`, `opencode`, `goose`): detect, list, read |
| Precheck | `automation/daily-reflection/precheck.sh` | Skips the run when `skills/` is dirty or no session in the window used an x-skill |
| Runbook | `automation/daily-reflection/runbook.md` | The agent's instructions: reflect on at most 4 sessions, then write the digest |

The collector imports `skills/x-autoreflection/scripts/hosts/` and `{read-session,scan-session}.mjs`, so
the pack, the sessions a review can pick from and the scanner that judges them all come from one place.
Nothing under `automation/` ships in the npm package (`package.json` `files` excludes it).

### Session hosts

Reading a session is not tied to one CLI. Each adapter declares `id`, `label`, `store`, `detect(ctx)`,
`list(ctx)` and `read(session, ctx)`; `ctx` carries the window and a `run(command, args, { cwd })` seam,
so an adapter is a mapping from a CLI's own output and a test can drive it by stubbing `run` alone.

| Host | Store | Evidence |
|------|-------|----------|
| `opencode` | `opencode db "<sql>" --format json` for the list, `opencode export <id>` for a transcript | read from a live store |
| `claude` | `<claude root>/projects/<encoded-cwd>/<session-uuid>.jsonl` (`CLAUDE_CONFIG_DIR` moves the root) | spec only |
| `codex` | `<codex home>/sessions/YYYY/MM/DD/rollout-*.jsonl`, named by `<codex home>/session_index.jsonl` | read from a live store |
| `gemini` | `<gemini root>/tmp/<project-id>/chats/session-*.jsonl`, or the older single `session-*.json` | spec only |
| `cursor` | `<cursor home>/projects/<project-slug>/agent-transcripts/**/*.jsonl` | read from a live store |
| `cline`, `roo`, `kilo` | `<editor> User/globalStorage/<extension-id>/tasks/<task-id>/{api_conversation_history,ui_messages}.json` | spec only |
| `goose` | `<goose data dir>/sessions/sessions.db` (SQLite, read with the `node:sqlite` built-in) | read from a live store |
| `crush` | `crush session list\|show --json`, one call per project in `<crush data dir>/projects.json` | read from a live store |
| `qwen` | `<qwen root>/tmp/<project-id>/chats/*.jsonl` (older trees: `projects/<project-id>/chats/`) | spec only |
| `copilot` | `<copilot home>/session-state/<session-id>/events.jsonl` | spec only |

**Verified and spec-built are different claims.** A host marked "read from a live store" was written
against real bytes on the machine it was added on; a "spec only" host was written from published
documentation, each header citing it, and has never seen a real store. That is allowed, but it is
paying a debt: the fixtures in `test/daily-reflection.test.cjs` restate the spec, so a real store that
disagrees will show up as a `warnings` entry ("the store is there but no … matched its layout") rather
than as a session that scans to nothing. When such a warning appears, fix that adapter against the
bytes — do not widen the scan until something matches.

`--host a,b` narrows a run. A CLI that is not installed reports `absent`, so an empty window still says
which stores were read. A CLI whose sessions live only in SQLite needs either a command that prints JSON
(OpenCode has one) or the built-in driver Goose uses; `hosts/sqlite.mjs` opens such a store read-only and
reports the reason when the Node runtime is too old to have `node:sqlite` (22.5+). Never reach for a
dependency: the package has none, and a store this cannot read should fail loudly rather than silently.

### How a day is reviewed

```
.x-skills/daily/<YYYY-MM-DD>/
├── DIGEST.md                     # the morning read: proposals with Signal / Target / Change / Check
├── summary.md                    # usage + signals per session
├── summary.json                  # the same, machine-readable (the only source of numbers)
├── sessions/<uuid>.signals.json  # scan per session, small enough to keep
└── reflections/<session>/E00-reflection.md   # one gated reflection per chosen session
```

Transcripts stay in `/tmp/xskills-reflection/<date>/` (megabytes each). Packs older than 14 days are
pruned, and so is the transcript root.

### Running it by hand

```bash
node automation/daily-reflection/collect-sessions.mjs            # collect the pack, print one JSON line
node automation/daily-reflection/collect-sessions.mjs --check    # probe only; exit 1 = no x-skill, 3 = no host readable
node automation/daily-reflection/collect-sessions.mjs --host crush,codex            # narrow the CLIs read
node automation/daily-reflection/collect-sessions.mjs --hours 168 --out /tmp/week   # a wider window
bash automation/daily-reflection/precheck.sh                     # what the scheduler runs first
orca automations list                                            # confirm the schedule
```

Sessions are scoped per project directory and per CLI, so discovery walks every detected host and unions
what it finds by host and uuid — the same uuid under two CLIs is two sessions. Crush's own walk is
per project in `projects.json` (newest first, `--project-lookback-hours`, default 72).

## Release Workflow

Releases are fully automated via [semantic-release](https://github.com/semantic-release/semantic-release) triggered on every push to `main`.

### How it works

1. Push to `main`
2. GitHub Actions runs semantic-release with OIDC trusted publishing (no NPM_TOKEN needed)
3. semantic-release analyzes conventional commits since last tag:
   - `feat:` → **MINOR** bump (`1.0.0` → `1.1.0`)
   - `fix:`, `perf:` → **PATCH** bump (`1.1.0` → `1.1.1`)
   - `BREAKING CHANGE:` or `!` suffix → **MAJOR** bump (`1.1.0` → `2.0.0`)
4. Updates `package.json` version
5. Generates/updates `CHANGELOG.md`
6. Commits the changes back to the repo
7. Publishes to npmjs.org with provenance attestations
8. Creates a git tag (`v<version>`)

### Commit conventions (Conventional Commits)

| Type | Semver bump |
|------|-------------|
| `feat:` | MINOR |
| `fix:`, `perf:` | PATCH |
| `BREAKING CHANGE:` in footer, or `!` suffix | MAJOR |
| `docs:`, `chore:`, `refactor:`, `style:`, `test:`, `ci:` | No release |

### Local dry-run

```bash
GITHUB_TOKEN=dummy npx semantic-release --dry-run
```

This analyzes commits and prints what would happen without publishing.

---

## Architecture

**Entry point flow**: `bin/install.js` parses CLI args and dispatches to functions exported from `lib/install.js`.

- `install(skillName)` — copies skill from `skills/<name>/` → `<cwd>/.agents/skills/<name>/`
- `globalInstall(skillName)` — copies to `~/.agents/skills/<name>/`
- `listSkills()` — scans `skills/` directory, parses SKILL.md frontmatter for descriptions
- `copyDir(src, dest)` — recursive copy preserving directory structure
- `resolveSkillSource(name)` — resolves skill name to `__dirname/../skills/<name>`
- `extractDescription(content)` — regex-based YAML frontmatter parser (no dependency on YAML lib)

**Key patterns**:
- All file operations use `node:fs/promises` (async/await).
- Helpers `dirExists()` and `fileExists()` wrap `fsp.stat()` in try/catch returning booleans.
- Skills are resolved relative to `__dirname` so they work when the package is published and installed via npm.
- No dependency injection or configuration files — everything is file-system-driven.

---

## Skill Authoring Conventions

### SKILL.md Structure

Every skill **must** have a `SKILL.md` with YAML frontmatter:

```yaml
---
name: my-skill
description: What it does and when to use it.
version: 1.0.0
author: Community
tags: [tag1, tag2]
user-invocable: true
---

# Title

Instructions for the agent...
```

The `description` field is auto-extracted by `listSkills()`. The frontmatter parser uses a simple regex — no YAML library is used. Keep frontmatter simple: only top-level scalar fields, avoid nested objects or multi-line values.

### Asking the user (question panels)

A skill must **never** ask the user a question in prose or bury one in a discussion paragraph. Every question is a **panel** built from the host's structured question tool, in exactly one of four shapes:

| Panel | Shape | Options |
|-------|-------|---------|
| `single` | single select with multiple options, plus a free-answer field | 2-5 required |
| `multi` | multi select with options, plus an open form | 2-5 required |
| `open` | open form only (free text) | none |
| `confirm` | yes/no | none |

The skills that ask questions (`x-anal`, `x-plan`, `x-research`, `x-autoreflection`) ship the canonical rules in `references/questions.md` and enforce them with `scripts/check-questions.mjs`. Skills without that file (`x-triage`, `x-api-draft`, `x-api-swagger`, `x-browser`, `x-implement`, `x-investigate`) define the four shapes inline at first use.

**Known limits.** The Agent Skills specification (agentskills.io/specification) defines no question or interaction primitive, so there is no portable panel: a host may have no structured question tool, in which case the skill prints the four shapes as a numbered prompt. And `check-questions.mjs` validates only the authored questions file — nothing verifies that a session actually rendered a panel. The rule is a contract on the skill, not a runtime guarantee.

**Shared files.** `scripts/check-questions.mjs`, `references/questions.md`, and `references/research-first.md` must stay byte-identical across the skills that carry them; x-skill-lint's `copy-drift` rule fails the build when they diverge.

### Skill Scripts

- Scripts inside skills use **ES modules** (`import` syntax) even though the project itself is CommonJS.
- Scripts are standalone — they don't import from `lib/install.js` or each other.
- Use `node:child_process` for shell commands (e.g., `git diff`).
- Output JSON to stdout for structured data; errors go to stderr with `process.exit(1)`.

### The run-folder helpers are generated

Every skill that writes a `.x-skills/runs/` artifact carries the same run-folder helpers (`resolveRunDir`, `nextE`, …) because skills cannot import from each other. Edit them **once** in `scripts/sync-run-folders.js` and run `npm run sync:run-folders`, which pastes the canonical block between the `// #region run-folder` markers in all 13 files. `test/run-helpers-drift.test.cjs` fails if a copy diverges, so never edit a region by hand.

#### x-commit Scripts

| Script | Purpose |
|--------|---------|
| `scripts/suggest-type.mjs` | Analyzes staged changes and suggests a conventional commit type + scope. |
| `scripts/validate-commit.js` | Validates a commit message against the spec (CLI arg or stdin). Exit 0 = valid, exit 1 = invalid. |
| `scripts/commit.mjs` | Atomically validates AND commits — never bypass this script. Exit 0 = committed, exit 1 = rejected. |

**Critical**: Always use `commit.mjs` for committing. It combines validation + commit in one atomic step. Never run `git commit` directly — doing so bypasses the validator and allows invalid messages through.

### Skill Discovery

`listSkills()` iterates `skills/`, checks each subdirectory for a `SKILL.md`, and extracts its description. Skills without `SKILL.md` are silently skipped.

---

## Gotchas

1. **Skill scripts use ES modules** — they have `.js` extension but use `import`/`export`. The Node shebang `#!/usr/bin/env node` handles this without `--experimental-vm-modules` or `.mjs` extension in modern Node (18+).

2. **Frontmatter parsing is regex-based** — `extractDescription()` matches `^description:\s*(.+?)\s*$` with multiline flag. Don't add complex frontmatter fields; the parser won't handle them.

3. **Skills resolve via `__dirname/../skills/`** — not `process.cwd()`. This means skills always come from the installed package's `skills/` directory, not the consuming project's.

4. **No idempotent overwrite** — `install()` checks if the target already exists and skips if so. To "reinstall" a skill, the user must manually delete the installed copy first.

5. **`copyDir()` doesn't preserve permissions** — it uses `fsp.copyFile()` which copies content but may not preserve execute bits on scripts. Run `chmod +x` manually after installing if a script needs to be executable.

6. **The CLI treats unknown commands as skill names** — running `node bin/install.js my-skill` attempts to install it. This is intentional (per README shortcut) but means typos silently install nothing or error with "not found".

7. **`npm test` uses `node:test`** — all tests live in `test/*.test.cjs`. There are unit tests for install logic, version bump mapping, and more.

---

## Adding a New Skill

1. Create `skills/<name>/SKILL.md` with proper YAML frontmatter.
2. Optionally add `scripts/`, `references/`, `assets/` directories.
3. Update the README's Available Skills table.
4. Run `npm test` to verify the skill appears in the list.

## Publishing

The package uses [semantic-release](https://github.com/semantic-release/semantic-release) with OIDC trusted publishing to npmjs.org. No `NPM_TOKEN` secret is required — GitHub Actions uses OIDC tokens for authentication and generates provenance attestations automatically.

Configuration lives in `.releaserc.json`. The CI workflow is at `.github/workflows/publish.yml`.
