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
| `npm run dev` | Works on the report app: the server under `node --watch` plus Vite with hot reload — `-- --port 8080 --panel` |
| `npm run report` | Serves the daily metrics on <http://127.0.0.1:8787> — `-- --port 8080 --days 14` |
| `npm run report:open` | Starts the report if it is not answering, then opens it in an Orca browser tab — `-- --window` for a window with no browser controls |

---

## Directory Structure

```
xskills/
├── package.json              # Node >= 18, name: "xskills", MIT
├── bin/install.js            # CLI entry point (CommonJS)
├── lib/install.js            # Core logic — install, globalInstall, listSkills
├── automation/               # Scheduled maintenance (not published in the npm package)
│   └── daily-reflection/     # 05:00 Orca job: collect last 24h sessions from every CLI, write a digest
├── scripts/                  # Repo tooling: sync-run-folders.js, dev.mjs, report-server.mjs, report-open.mjs (not published)
├── tools/report-app/         # The report app's Solid source, styled in Orca's design language (dist/ and node_modules/ are gitignored)
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

### Reading a day

The record is two things: `history.jsonl`, one line per day and the numbers a trend is drawn from, and the
packs themselves. `npm run report` serves both to the app in `tools/report-app` — a Solid app with no
database behind it, whose storage is those JSON files.

```bash
npm run report:install              # once: the app's own dependencies
npm run dev                         # work on the app: server (restarting on change) + Vite hot reload
npm run report:build                # once, and after any change under tools/report-app
npm run report:panel                # the Orca plugin's panel: the same app, baked with a snapshot
npm run report                      # http://127.0.0.1:8787/
npm run report -- --days 30 --port 8080
npm run report -- --no-refresh      # answer from disk without recording the newest day first
npm run report:open                 # start it if it is not answering, then open it in an Orca tab
npm run report:open -- --window     # the same, in a window with no browser controls
npm run report:open -- --print      # say what would happen, and open nothing
```

The server only reads, with three exceptions, all files beside the packs: the selection a reader makes
(`todos.json`), the floors a reader commits to (`ratchet.json`) and the re-checks a reader records
(`reviews.json`), so all three survive a restart.

| Route | What it is |
|-------|------------|
| `/` | **the main screen**, five views of the record (see below): `movement`, `bench`, `ledger`, `ratchet`, `recurrence` |
| `/days` | the calendar, every recorded day clickable |
| `/day/<YYYY-MM-DD>` | one day: its scores, its sessions, and the proposals its `DIGEST.md` asks for |
| `/day/<date>/session/<id>` | one session's counters, and the signals blamed on it |
| `/skill/<name>` | one skill: its line, why it moved, what was proposed for it and the signals blamed on it |
| `/todos` | the selection, editable, written back to `todos.json` |
| `/api/movement` `/api/days` `/api/day/<date>` `/api/skill/<name>` | the same data as JSON |
| `/api/ledger` `/api/ratchet` `/api/bench` `/api/recurrence` | the work views as JSON |
| `/api/control` `/api/interval` `/api/factors` `/api/flow` `/api/schedule` | the measurement views as JSON |
| `/api/refresh` `POST /api/todos` `POST /api/ratchet` `POST /api/reviews` | record the newest day; write the selection; hold a floor in or lower it; record a re-check |
| `POST /api/open` | open the report where a reader asked for it: `{ surface: "orca" \| "window", path }` |
| `/history.jsonl` | the raw day-by-day record |

The server answers any extension-less path with the app shell, so a deep link survives a reload, and an
unbuilt app gets a page naming `npm run report:build` instead of a 404. A reader who is not the app can live
on `/api/*` alone.

**The main screen is ten views, because one goal cannot be served from one angle.** `?view=` picks one
(`movement`, `bench`, `ledger`, `ratchet`, `recurrence`, `control`, `interval`, `factors`, `flow`, `schedule`),
the picker is a tab strip on the screen itself, and
the choice rides through every link beside `shape`, so a reload or a bookmark lands on the view the reader
chose. What the five have in common is that each ends in a decision rather than a number:

| View | The question | What is loud |
|------|--------------|--------------|
| `movement` | did anything in use get better or worse, and by which axis | a skill whose line went down |
| `bench` | what is the one fix to do now, and is it done yet | the picked card — `doing` is capped at one |
| `ledger` | of the fixes I kept, how many held | a fix whose window came back below where it started |
| `ratchet` | has any skill slipped below the best it has already held | a skill below its floor |
| `recurrence` | which defects keep coming back | a finding proposed again *after* a fix landed |
| `control` | is the newest day different from the days before it, in the record's own noise | the rule that fired, with its false-alarm rate |
| `interval` | what is a score worth, and where does the next session buy the most | the widest interval |
| `factors` | why is the score that number, in points | the axis costing the most, with its counters |
| `flow` | is the fixing process keeping up | the stage work has reached and not left |
| `schedule` | which believed-fixed finding is due for a re-check | a finding the scan already caught coming back |

Three of those need a fact no pack holds: **when a fix landed**. `scripts/report-server.mjs` asks git for the
commits to the file a proposal's `Target:` names (`git log --format=%cI -- <path>`, as argv and after `--`),
memoised per file and injected through a `commits` seam so a test needs no repository. That one fact is what closes the loop the
panel otherwise only records: proposal → kept (`todos.json`) → landed (git) → measured (the day's line).

- **ledger** measures `?window=` (default 2) *measured* days either side of the day a commit touched the file,
  waits for the whole window before it says anything, and calls a move under ±2 points flat — the noise the
  movement table already treats as flat. A commit that predates the day the reader kept the fix is context,
  not a landing, and is shown as such: a fix must not take credit for an earlier commit.
- **ratchet** holds a floor per skill in `ratchet.json`. The floor is the best *sustained* run of measured days
  (3 by default), the whole window's score when the record is too short for a run, or a value the reader
  committed to — `source` says which, and the basis is printed beside it. A day below the sample floor can
  neither hold nor break a floor, and lowering one is refused without a reason: RuboCop's todo lesson is that
  re-baselining silently absorbs whatever went wrong.
- **bench** picks with `severity × (1 + 0.5 × days seen) ÷ check cost`, and the `why` is part of the answer. A
  fix with no check costs three times as much to prove, because it cannot be proven.
- **recurrence** groups findings by *file*, not by improvement class: the class is written by the reflection and
  its wording drifts between runs (one digest files a defect as `doc-command-drift:`, the next as
  `` `x-epic`: ``), so grouping by it would orphan the history and read as progress. A sighting after the last
  commit to the file is the finding "coming back"; a finding with a fix and no sighting for 7 days is *closed by
  evidence*, and says how long the quiet has lasted rather than claiming certainty.

The last five measure the measurement itself, each borrowing a rule a field already settled:

- **control** builds a Levey-Jennings chart per skill the way a lab does: the centre and the spread come from a
  **baseline period** (every measured day but the ones under judgement, at least `minDays`), the last up to
  seven days are judged against it, and the rules are Westgard's multirule set (`1_3s`, `1_2s` as a *warning*,
  `2_2s`, `4_1s`, `10x`, `7T`) with each one's false alarm computed from the normal tail and printed beside it.
  The fleet's expected false alarms come with it: at 28 skills a 2s rule rings about once a day on nothing,
  which is the arithmetic that decides the rule set. A day nobody loaded is a baseline, never a measurement.
- **interval** puts a standard error on a score from the denominators its axes were measured over
  (`σ/√n`; a rate's variance is `r(1−r)/n`), prints the score the evidence alone supports (TrueSkill's μ − 3σ),
  and says how many sessions would halve the interval, which is always four times what the skill has.
- **factors** decomposes the gap from 100 into the points each axis costs (`100·Σw(1−r)/Σw`) with the counters
  behind it, and simulates one axis at a target. The target is the reader's: on this record the fleet's own
  trigger rate is 23% because these CLIs name far more skills than they load, and aiming at it *costs* points.
  It reads the newest day's tallies, not the movement table, because the skills with the widest gaps are the
  ones no session ever loaded.
- **flow** is Little's law over the pipeline: proposals → kept → landed → closed, the arrivals and closures a
  day, the wait the open queue implies, and the constraint as the deepest stage work has reached and not left.
  A closure is dated by the rule that produces it (last fix + the quiet week), which the view says.
- **schedule** is SM-2 over findings: intervals of 1, then 6 days, then ×easiness (floored at 1.3), a lapse
  back to one day, and `reformulate` after two — Wozniak's own conclusion, that an item which keeps failing has
  a flaw in how it is written. A finding the scan already caught coming back is answered for free (`auto`), so
  the list asks a human only for what the scanner cannot see. It is the second file the app writes
  (`reviews.json`, beside `todos.json` and `ratchet.json`).

The arithmetic lives in `scripts/report-views.mjs` and every rule is a pure function of records the packs
already hold plus the `commits`, `applied` and `sigma` seams, so `test/report-app.test.cjs` drives all of it
without a repository. `report-panel.mjs` bakes all nine payloads into the plugin's panel beside the movement
one, so a panel answers every view with no network.

**A day is one screen.** `/day/<date>` shows the header and the digest's proposals, and nothing else: the
scores, the sessions and the signals — everything the pack holds — sit inside one `<details class="evidence">`,
closed, labelled `the evidence — 28 scores · 21 sessions · 328 signals`. A review is a decision, and the
pack's raw record is not the review; before this the day page was 20.9 viewports tall with 1.8% of it being
the decision. The signals inside are capped at the ones worth reading (`worthReading` counts everything that
is not a low-severity repeat — 81 of 328 on a real day) with `show all` beside it, and folding the rest into
a closed disclosure also takes 328 links out of the tab order.

**The app wears Orca's design language.** Every colour in `src/styles.css` is a value from Orca's own theme —
`--background #fff/#0a0a0a`, `--card #fff/#171717`, `--border #e5e5e5/#ffffff12`, `--primary`, `--muted`,
`--sidebar`, `--radius: .625rem` — copied rather than invented, so the report and the IDE that opens it are one
application. The type is Geist, Orca's own app font (`appFontFamily`), vendored as a variable woff2 in
`src/assets/` with its OFL licence, and the code font is Orca's mono stack. Badges use Orca's recipe — the
colour at 10% with a 25% edge (`color-mix(in srgb, currentColor 10%, transparent)`). Two deliberate departures,
both measured in the running app: `--muted-foreground` is `#6d6d6d` rather than Orca's `#737373`, because
Orca's value is 4.35:1 on its own `--muted` surface and this app puts muted text there (a hovered row, an
inline `code` chip); and the light band colours are the palette's darker steps (emerald-700, amber-800,
red-700) so a badge clears 4.5:1 *on its own tint*, not only on white.

**Four type sizes, one job each.** `--t-title: 24px` for the page headline, `--t-section: 16px` for `h2`,
`--t-body: 14px` for prose, and `--t-chrome: 12px` for labels, table heads, buttons and badge text (Orca's
`text-xs`, which is what it sets its own controls at). Muting is a colour, never a size (`.dim { color:
var(--muted-foreground); font-weight: 400 }`), because the page used to run thirteen sizes with 1,598
elements at 12.5px, which is below the floor at which secondary text is readable. The one solid control is the
row's `+ to-do` (`button.primary`, `--primary`); a preference marks its choice with a tint (`button.on`), not
an accent fill.

**The shell is Orca's too.** `.app` is a grid: a 240px sidebar on `--sidebar`, a pane title bar across the top
of the content column (`components/App.tsx`'s `.topbar` — 12px, muted, a `--border` hairline and a blurred
`--background` behind it), and the routed view below it. The bar's left says which screen this is; its right
carries `Run`.

**`Run` opens the report where the reader is.** The button asks the server (`POST /api/open`, which carries the
current page path so the tab that opens *is* the screen the reader was on), and `scripts/report-open.mjs`
decides: an Orca browser tab, focused rather than duplicated when the origin is already open
(`orca tab list --json` → `tab switch --page`), or — for the `window` button — `chrome --app=<url>`, which is
the only surface with no tabs and no address bar. **Orca's browser tab always draws its own toolbar** (its
pane renders back/forward/reload and an address field unconditionally; only the pane *title* has a chromeless
variant), so "in Orca, with no browser controls" is not a state that exists — the two buttons are the honest
version of that wish. `npm run report:open` is the same code path from a shell, and starts the server first if
nothing answers on the port; a machine that cannot oblige answers 502 with the reason, not a silent success.
The body's `path` is re-anchored to the server's own origin (`safePath` refuses anything with a scheme, `:` or
`\\`), so a request cannot point the opener at another host.

**The skill screen answers three questions in order**: is it improving, by how much, and what to do about it.
The headline delta is printed with the sample floor beside it (`apiSkill` returns the per-day `n`), because a
skill measured only on thin days has a change that is a difference of two means over a handful of calls —
`floorNote` in `SkillView.tsx` says so rather than letting `+19.2` read as a score. The small line beside a
movement row stays range-scaled, where the direction is the message. Under the two charts: the proposals that
target the skill and the signals blamed on it (`apiSkill`), the first as the same task rows the day screen
uses, the second compact and capped at the worst five with the rest one click away.

**A skill's top is three things: the gauge, the radar, and the score over time.** `Radar` is the current
state as a shape, and it **draws only the axes the latest day actually measured** — an axis that does not apply
to a skill is not part of its shape, and a spoke scored zero would be a claim the scanner never made. With
nothing measured there is no shape, so the radar is not drawn at all (and below three axes the rings go with
it). Each spoke is labelled with the axis's full name and its rate, so the shape never hides a number, and the
whole thing is drawn in the page's ink: colour has nothing left to carry there, and a monochrome radar beside
the gauge reads as one object with it. `Sparkline` draws the score per day on a fixed 0–100 domain with the
70/85 thresholds marked — the same number the gauge leads with, over time; the small line beside a movement row
stays range-scaled, where the direction is the message.

Everything on this screen is the score or the shape, with no explanation under it: the charts are read, and a
paragraph restating what a reader can see is furniture. (`StackedAxes`, an earlier experiment that stacked the
axes into one 100% column, is gone.)

**The chart is a fixed frame that only stretches sideways.** Its plot is 132px and its y scale is one unit a
pixel at every width, so the same move is the same distance on screen whatever the panel is doing — verified by
the 70 and 85 marks staying 21.6px apart from a 340px panel to a 1200px one. That is `preserveAspectRatio="none"`
plus a fixed height; the x axis does the stretching, and the lines hold their weight with
`vector-effect: non-scaling-stroke`. A point cannot be a `<circle>` in a stretched frame — it would be squashed
into an ellipse — so it is a round-capped stroke of the same colour (`Dot`), drawn in the device's own pixels and
therefore still a dot. Every point gets one: a marker is what makes a chart's data visible, not just its trend.

**The dates and the scores are HTML, over and under the drawing.** SVG text inside a stretched frame would be
stretched with it — 2.25× wide in a wide pane — so the labels are ordinary spans in two absolutely positioned
layers, each placed by a *percentage* of the frame. That is what lets them sit exactly on the geometry without
measuring anything. A chart that annotates reserves 18px under the plot for the date row; a plain sparkline
(the movement rows) reserves nothing and is drawn at its own size.

**The time axis is logarithmic: `x` comes from a day's age, not its index.** One day old sits 17% of the way
along, and by a 90-day history the last week holds a third of the width — the recent days are the ones a reader
acts on. `DAY_BIAS = 3` sets how hard it bends (`log(1 + age/3)`, normalised against the oldest point), because a
raw `log(age)` would give the newest day most of the chart and squash everything else. The date under each point
is what makes a non-uniform scale honest; the x gaps no longer mean equal time, and the axis says so. It applies
to the skill's chart only: the row sparkline has no axis to explain it, and the direction is all it claims.

Labels are skipped rather than overlapped: the newest always keeps its score and its date, and a further label
lands only if it clears 38px (scores) or 56px (dates) from the last one placed. Measured in the browser on a
synthetic year in a 1530px frame: 27 scores and 19 dates, all 365 columns tiling with no gap, and no two labels
touching in either row; the narrow case (a year in 260px) gives 6 and 4. Two days in the record, which is all this
repo has, show both and exercise none of the skipping.

**Rolling over the plot names a day, and shows what that day was.** Each day owns a *column* of the plot — half
the way to each neighbour, so every x belongs to a day — and hovering or focusing it opens `ChartTip`: the date,
the score, the *same* radar the top of the page draws for today, and the rates beside it, so a comparison is
between two things of the same kind. A vertical guide line marks the day the pointer is on, because a popup with
nothing under it is a popup you have to guess at.

The columns are HTML, not SVG: a full-height band is the same at any frame width, where SVG geometry would
stretch, and it makes the data reachable by keyboard (`tabindex`, the aria-label naming the day and the score).
An 18px marker was tried first and is not enough — hovering "the day" means hovering the plot, and a target you
have to hunt for reads as a chart that does nothing. The tip itself is two columns (shape beside numbers) so it
stays shorter than the chart it belongs to, is `names={false}` on the radar with `AxisRates` carrying the labels
(a 15rem popover cannot hold full names at 12px, and a shrunken label is unreadable), and opens away from
whatever it would hang over — sideways at the two ends, and towards the emptier half of the plot in the middle.
The native `<title>` is left off the markers when the tip is on, so the two do not race for the same hover.

**The radar scales and measures nothing; the score chart is painted at the width it is given.** The radar is a
fixed drawing in its own units that the browser fits to the box, and it caps at 420px so a pentagon never becomes
a wall. The chart is the other way round: a canvas cannot hold a thousand units in a 200px box without its line
weights lying, so it is painted at the size it is actually shown and an observer hands it that width.
The row that holds the gauge and the radar is a wrapping flex row, so the radar drops under the gauge when the
panel cannot pay for both, and `.radar-box`/`.chart-box` are `container-type: inline-size` — the question a
responsive chart asks is how wide *its panel* is, not the window, since in Orca a 1200px window holds a 500px
pane. The one thing scaling cannot do is keep a label its own size, so below a 360px box the radar is replaced
by `AxisRates`, the same five numbers as a list: text that cannot be read at the size it was set is not rendered.

A `ResizeObserver` has bitten this file twice, in opposite directions. The SVG version observed its own box and
drew into it, and Chrome drops those notifications once a drawing changes the size of the box it is observed
through — a growth was then never seen, and the chart stayed drawn for the old width. The canvas is safe for the
mirror-image reason: `canvas.width` sets the backing store while `.chart > canvas` pins the box in CSS, so the
measurement cannot feed the resize it is reacting to.

**A theme change repaints the canvas by hand.** Its ink comes from the live stylesheet — `getComputedStyle(canvas)`
for `--primary`, `--border` and `--muted-foreground` — which is not a signal, so the paint effect reads the
`prefers-color-scheme` media signal for that subscription alone. Without it the tokens move and the pixels do not:
measured, 4570 dots left in the light ink on a dark page. Orca sets `nativeTheme.themeSource`, so that media query
follows the IDE's own theme with no API of ours in the path.

**A drawing scales once, not once per mark.** The scale, the columns and the label set are memoised in
`Sparkline`, because each is read from inside the list of marks as well as from the picture itself: `x(index)`
rebuilt the whole scale for a single point, which made a 365-day chart cost n³ and left the page 96 seconds from
interactive (`domContentLoaded`, measured on a synthetic year). Memoised, the same five charts are interactive in
96ms with the geometry unchanged. No test in this repo can see it — only a chart longer than the record can.

**Signals are rows, not a table.** `SignalList` (`components/DayView.tsx`) draws one row a signal: the head
carries the labels — severity, the scanner's kind, and `seen 4×`, spelled out because a bare `×4` tells a
reader nothing — and the summary takes as many lines as the width allows, so nothing is clipped and nothing
spills off the page. The row is a link to the session it came from, which is why there is no session column;
on a session's own page, where the row has nowhere to send the reader, it shows the signal's own excerpts
instead. `limit` caps a long list to its worst few with the rest one click away.

**A kept proposal stops offering itself.** `apiDay` marks every proposal with `inTodo`, and the row's button
starts from that flag (`TodoButton` takes the task's `inTodo`), so "in to-do" is what a reader sees on a reload
— not only after they clicked it in this session. The decision is `sameWork` in `scripts/report-server.mjs`,
and it compares **the work, not the label**: a digest names its proposals `P1…Pn`, so the same label means a
different task on every day, while the same change text is the same task whenever it was proposed. Only when
neither side has text does the label decide, scoped to its day. That rule also makes the entries saved before
this existed count, because they carry the text they were kept with — and it keeps yesterday's `P1`, which is
a different piece of work, from being marked as kept by today's. `TodoItem.day` is therefore a storage
discriminator, not a label: two days may each contribute a `P1`, so dropping one must not drop the other
(`POST /api/todos` whitelists it, and the to-do screen removes by `id` + `day`).

**One list of tasks, three shapes.** A proposal in a digest and an entry on the to-do list are the same
record at two moments, so both screens draw them through `components/TaskList.tsx` — the only difference is
the action threaded in (`+ to-do` there, `remove` here). Which shape reads best is a taste call, so all
three ship and the picker sits above the list:

| Shape | Arrangement | Best for |
|-------|-------------|----------|
| `rows` | a row a task: skill, the change, an importance badge, one line each; open a row for the whole text | a digest with nine proposals in it |
| `cards` | a card a task, the change at reading size and the file and check muted under it | reading one task at a time |
| `lines` | a line a task, the whole text behind a disclosure | scanning a long list |

`rows` is the shape in use. The change is the only prose in a row: the file it touches and the check that
proves it are in the expanded row, not in every line, so nine proposals stay one screen. The row's title
carries the file as well, for a reader who only hovers.

**The importance badge** is `importanceOf` in `src/tasks.ts`: the worst severity among the signals a task
cites, and how many signals back it — `high`, `high ×2`, `medium`. It reads the digest's own words (`S21
(high, kept)`, `S2 and S24 (both high, kept)`, `manual (medium, kept)`) rather than joining back to the
pack, because a signal id is scoped to the session that produced it: the same `S21` in two sessions is two
findings, so an id alone cannot be looked up. The badge carries the word, the colour only agrees with it,
and the title holds the raw signal text.

`?shape=a|b|c` picks one, and the choice rides through every link, so a reload or a bookmark lands on the
shape the reader chose. Each shape clamps the long fields and keeps the full text in the row's `title`, so a
400-character change does not become a 400-character column.

An axis a row never measured is a dash, not an empty bar: a bar with no value reads as a broken chart. An
axis with no denominator is not a column, and a skill below the sample floor is not a row.

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
