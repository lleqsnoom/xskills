# AGENTS.md — xskills

## Project Overview

`xskills` is an npm package that installs [Agent Skills](https://agentskills.io) into projects or globally. Skills are folders containing a `SKILL.md` (YAML frontmatter + Markdown) plus optional `scripts/`, `references/`, and `assets/` subdirectories. They follow the Agent Skills open standard and work with 45+ AI coding CLIs.

The package has **zero dependencies** — it uses only Node.js built-ins (`fs/promises`, `path`, `os`, `child_process`).

One local app lives under `tools/` and is not part of the published package: the **report app** over the daily
reflection packs (`tools/report-app`, `npm run report`). A second app used to live here, the project board over a
repository's `.x-skills` tree; it is now its own product, **Otter PM**, in its own repository
(<https://github.com/lleqsnoom/otter-pm>). Nothing in this package imports it, and its scripts are gone from here.

---

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Runs all tests (install, version-bump, etc.); its `pretest` installs what the x-search suite needs — the tool's dependencies and a local embedder — so a fresh clone passes without setup |
| `npm run test:setup` | The `pretest` alone: installs missing dependencies and starts/pulls with Ollama, or exits 1 naming the one thing it cannot install (Ollama itself) |
| `npm run check:run-folders` | Fails if the run-folder helpers have drifted between skills |
| `npm run sync:run-folders` | Rewrites the run-folder helpers in every skill from the one canonical block |
| `npm run release -- --dry-run` | Dry-run semantic-release locally to preview bump type |
| `node bin/install.js list` | Lists available skills with descriptions |
| `node bin/install.js install <name>` | Installs a skill into the current project's `.agents/skills/` |
| `node bin/install.js install <name> --global` | Installs globally to `~/.agents/skills/` |
| `node bin/install.js install-all --global --force` | Refreshes every installed skill, replacing existing copies |
| `node bin/install.js <name>` | Shortcut: installs the named skill |
| `node bin/install.js help` | Shows usage info |
| `npm run report:dev` | Works on the report app: the server under `node --watch` plus Vite with hot reload; both step to the next free port — `-- --port 8080` starts the search there |
| `npm run report` | Serves the daily metrics on <http://127.0.0.1:8787> — `-- --port 8080 --days 14` |
| `npm run report:open` | Starts the report if it is not answering, then opens it in an Orca browser tab — `-- --window` for a window with no browser controls |
| `npm --prefix tools/x-search test` | The repository's x-search tests, from the tool's own directory: its `pretest` provisions the same way, so it never passes over an empty directory |
| `node tools/x-search/src/cli.mjs index --all` | Builds every store; `--root <path>` for one, `--prune` to forget repositories that moved |
| `node tools/x-search/src/cli.mjs watch` | Keeps every known repository warm (2 s debounce) |
| `node tools/x-search/src/cli.mjs mcp` | The stdio MCP server: `search`, `projects`, `stats` |
| `node tools/x-search/src/cli.mjs install --cli crush,claude,codex,opencode` | Wires the CLI configs, with backups; `--remove` takes the entry back out |

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
├── tools/report-app/         # The report app: Solid + Tailwind, controls in src/ui/, styled in Orca's design language
│                             # (dist/, dist-panel/ and node_modules/ are gitignored)
├── tools/x-search/           # The semantic search tool: index, watcher and the stdio MCP server
│                             # its own package (@lleqsnoom/x-search), own release workflow
│                             # (node_modules/ is gitignored)
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
    ├── x-essay/              # Author an article on a fixed loop: x-analyze → x-roast → x-humanize, bounded by score gate + cap
    │   ├── SKILL.md
    │   ├── scripts/
    │   └── references/
    ├── x-fix/                # Resolve code review issues from fix plan files
    │   └── SKILL.md
    ├── x-analyze/               # Interactive analysis — understand problem, produce thesis with evidence, propose solution
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
    ├── x-unbloat/            # YAGNI ladder — cut speculative abstractions, wrappers, dead code; measured by a diff script
    │   ├── SKILL.md
    │   ├── scripts/
    │   └── evals/
```

---

## Skill Access Patterns

Skills are plain markdown files, not MCP servers. Using the wrong access method causes `mcp '<skill>' not available` errors. **No skill is itself an MCP server** — a skill is read as a file with the `view`/`read` tool.

This repository does ship **one** MCP server, `x-search` (`tools/x-search`), which any CLI can be wired to with `x-search install`. It is a tool the skills call, not a way to read a skill: `mcp '<skill>' not available` is still the error for every `x-*` name.

### How to read a skill's instructions (SKILL.md)

| Skill Type | Location on Disk | Correct Tool | Example |
|------------|-----------------|--------------|---------|
| **User-installed** (`x-*`) | `$HOME/.agents/skills/<name>/SKILL.md` | `view` tool with file path | `view $HOME/.agents/skills/x-implement/SKILL.md` |
| **Source repo** (published package) | `<project>/skills/<name>/SKILL.md` | `view` tool with file path | `view skills/x-plan/SKILL.md` |
| **Builtin** (`jq`, `omarchy`) | Internal to Crush runtime | `crush://skills/<name>/SKILL.md` | `view crush://skills/jq/SKILL.md` |

**Never use `Read Mcp Resource` with a skill name as the server.** There is no MCP server named `x-implement`, `x-commit`, etc. `x-search` is the only MCP server this project owns; `x-browser` attaches to a `chrome-devtools` MCP that belongs to the environment, not to xskills.

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
- **x-analyze** — Interactive analysis: confirms user intent, clarifies ambiguities with suggestions, produces thesis with evidence and solution proposition, routes to fix or task creation
- **x-investigate** — Hypothesis-driven root cause analysis using git bisect/blame, Chrome DevTools, debuggers, or engine profilers depending on platform
- **x-autoreflection** — Session retrospective: exports the transcript of this or an earlier session, scans it mechanically for friction (failed commands, repeats, user corrections, prose questions, unused skills), verifies each signal against the real skill files, and writes evidence-backed improvement proposals to `<run folder>/E<nn>-reflection.md`

## Daily Reflection Automation

An Orca automation named **x-skills-daily-reflection** runs every day at **05:00 Europe/Warsaw** in this
repository and leaves a digest for review. It never edits a skill — it proposes, and the review decides.

| Piece | Path | Role |
|-------|------|------|
| Collector | `automation/daily-reflection/collect-sessions.mjs` | Finds every session of the last 24h across all detected CLIs, scans each for x-skill friction and quality anchors, ranks the sessions to read, writes the evidence pack |
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
| `claude` | `<claude root>/projects/<encoded-cwd>/<session-uuid>.jsonl` (`CLAUDE_CONFIG_DIR` moves the root) | read from a live store |
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
reports the reason when the Node runtime is too old to have `node:sqlite` in the default build (23.4+ /
22.13+; below those it is behind `--experimental-sqlite`). Never reach for a dependency: the package has
none, and a store this cannot read should fail loudly rather than silently.

### How a day is reviewed

```
.x-skills/daily/<YYYY-MM-DD>/
├── DIGEST.md                     # the morning read: proposals with Signal / Target / Change / Check
├── summary.md                    # usage + signals per session
├── summary.json                  # the same, machine-readable (the only source of numbers)
├── sessions/<uuid>.signals.json  # scan per session, small enough to keep
├── sessions/<uuid>.turns.json    # the model's class for each user turn (with --classify)
└── reflections/<session>/E00-reflection.md   # one gated reflection per chosen session
.x-skills/daily/labels.jsonl      # every verdict the review ticked, one line per session and anchor
```

Transcripts stay in `/tmp/xskills-reflection/<date>/` (megabytes each). Packs older than 14 days are
pruned, and so is the transcript root. `labels.jsonl` is never pruned: it is what a detector is
measured by.

### When nothing failed but the result fell short

Friction signals find a command that failed. A session whose every command passed, but whose answer
was not what the user wanted, has no friction, and the scan used to call it clean. **The user is the
sensor**: what they did next says the reply fell short. The scanner (`reactions.mjs`) reads that as
*quality anchors*, each blamed on the **owner**, the skill in charge at that moment (the last `Skill`
call, an injected skill body, or a skill's script in a command, never a file the agent wrote):

| Anchor | Read from | Weight |
|--------|-----------|--------|
| `user-handoff` | "write it as a prompt for another agent", "I'll do it myself" | high |
| `cross-session-retry` | a later session opens with most of this one's request (≥50% 3-gram containment, ≤48 h) | an anchor on the earlier session, blamed on its last owner |
| `tool-rejected` | the user refused a tool call or a panel | high with an owner, else medium |
| `user-redo` | "do another round", "again, more thoroughly" | high |
| `skill-script-silent` | a skill script exited 0 and printed nothing | high |
| `user-pushback` | the model's class for a turn (`--classify`) | medium, unvalidated: ranks only once validated |
| `interrupt` | the user stopped a turn | low, context only, never a finding |

Retries skip automation prompts (an opening seen in three or more sessions), and yesterday's pack is
read too, so a request re-asked after midnight still links. **Headless runs are not evidence of what a
user expected**: a Claude session with `entrypoint: "sdk-cli"` (`claude -p`, this automation) is
marked `headless` and left out of anchors, retries and the audit.

`summary.json` → `select` is the reading order: handoff, retry, rejected step, redo, silent script,
validated pushback, then friction. At most four, one per owning skill; the rest are listed as
`recurring`. `audit` adds one interactive session with no anchor, chosen by the date, so a quiet
session is read now and then and a detector that misses a whole mode can be caught.

**`--classify`** sends each user turn after the opening request (four words or more) to a model with
the end of the reply before it, in batches of 60, and reads back one of seven classes (`pushback`,
`redo`, `handoff`, `verify-ask`, `clarify`, `neutral`, `positive`). The default is
`crush run -q -D ~/.x-skills/turn-classifier/data` with Crush's default model, run from
`~/.x-skills/turn-classifier`. The Crush adapter never lists that directory, so the classifier's own runs
are never scanned. `--classifier "<command>"` swaps in any command that reads the prompt on stdin and
prints `<n> <class>` lines. The prompt goes in as a file descriptor, because `crush run` reads a socket
stdin as "No prompt provided." A classifier that fails is recorded in `summary.json` → `classifier`, and
the rest of the pack is unchanged.

**Verdicts are the labels.** `summary.md` carries `## Verdicts (copy into DIGEST.md)`, after the reading order,: one line per
session in `select` and one for the audit (`- [ ] \`<session>\` · <anchor> · <owner> · <model> — good / below /
not-a-skill-problem — note:`). The reviewer ticks a line and keeps one word. The next collection reads
every ticked line back into `labels.jsonl`, merged by date, session and anchor. From those labels
`detectorPrecision` measures each anchor kind. A model-read kind ranks sessions only after at least 60
labels at precision 0.8 or better (`validatedKinds`). Until then it is a lead, never a score.

The metrics count a skill as `used` only from the agent's own words, its scripts and its files, not from
a mention (`definition: "v2"` in `history.jsonl`, so a trend across the change is visible).
`shortfall` reports the rate of redos, handoffs, refused steps, pushback and retries per skill and per
model, beside the composite and never inside it, so a fix that names a rate in its `Watch:` line can be checked against the next days. A skill may
carry `evals/expectations.json`, the behaviours accepted findings said the user expects, in the user's
words. It is grown only from accepted `missing-expectation` fixes and never required. `x-skill-lint`
checks its shape, and the judge reads it next to `SKILL.md`.

### Reading a day

The record is two things: `history.jsonl`, one line per day and the numbers a trend is drawn from, and the
packs themselves. `npm run report` serves both to the app in `tools/report-app` — a Solid app with no
database behind it, whose storage is those JSON files.

```bash
npm run report:install              # once: the app's own dependencies
npm run report:dev                  # work on the app: server (restarting on change) + Vite hot reload
npm run report:build                # once, and after any change under tools/report-app
npm run report                      # http://127.0.0.1:8787/
npm run report -- --days 30 --port 8080
npm run report -- --no-refresh      # answer from disk without recording the newest day first
npm run report:open                 # start it if it is not answering, then open it in an Orca tab
npm run report:open -- --window     # the same, in a window with no browser controls
npm run report:open -- --print      # say what would happen, and open nothing
```

The server only reads, with one exception: the selection a reader makes, written to `todos.json` beside the
packs so it survives a restart. Everything is answered `no-store`, because the app is rebuilt in place.

**A page older than the app reloads itself.** Opening the report focuses the tab that already has it
(`scripts/report-open.mjs`), and focusing a tab does not reload it — so a reader can sit on yesterday's bundle
with every fix merged and none of it on screen, which is what "it is still broken" was. The bundle knows its own
name (`/assets/index-<hash>.js`), the server reports the name its `index.html` asks for (`GET /api/version`), and
when the two differ the page reloads once. Checked on the next focus or visibility change, and at most once a
minute, so a page left open costs nothing. A dev server opts out by construction: `main.tsx` is not a bundle
name.

| Route | What it is |
|-------|------------|
| `/` `/skills` | **skills** — a card per skill in use: its gauge, its name, its band, its score and its line, filtered by name or by how it moved |
| `/days` | the calendar, every recorded day clickable |
| `/day/<YYYY-MM-DD>` | one day: its scores, its sessions, and the proposals its `DIGEST.md` asks for |
| `/day/<date>/session/<id>` | one session's counters, and the signals blamed on it |
| `/skill/<name>` | one skill: its line, why it moved, what was proposed for it and the signals blamed on it |
| `/todos` | the selection as cards, editable, written back to `todos.json`, and `copy the brief` to hand the whole loop to an agent |
| `/api/movement` `/api/days` `/api/day/<date>` `/api/skill/<name>` | the same data as JSON |
| `/api/version` | the bundle the app is serving, so a tab opened before the last build reloads itself |
| `/api/refresh` `POST /api/todos` | record the newest day; write the selection |
| `POST /api/open` | open the report where a reader asked for it: `{ surface: "orca" \| "window", path }` |
| `/history.jsonl` | the raw day-by-day record |

The server answers any extension-less path with the app shell, so a deep link survives a reload, and an
unbuilt app gets a page naming `npm run report:build` instead of a 404. A reader who is not the app can live
on `/api/*` alone.

**A day is one screen.** `/day/<date>` shows the header and the digest's proposals, and nothing else: the
scores, the sessions and the signals — everything the pack holds — sit inside one `<details class="evidence">`,
closed, labelled `the evidence — 28 scores · 21 sessions · 328 signals`. A review is a decision, and the
pack's raw record is not the review; before this the day page was 20.9 viewports tall with 1.8% of it being
the decision. The signals inside are capped at the ones worth reading (`worthReading` counts everything that
is not a low-severity repeat — 81 of 328 on a real day) with `show all` beside it, and folding the rest into
a closed disclosure also takes 328 links out of the tab order.

**One card, and every list is made of it.** `components/Card.tsx` is the app's only panel: a head (what the
thing is, what it scored, its state) and a body (the numbers behind it), in a `.cards` grid whose track is
`minmax(min(22rem, 100%), 1fr)` so a card is never wider than the pane it is in. Four views of the same kind of
thing — a skill in use on `/skills`, the scores of one day, the days of one skill, a proposal — used to be four
layouts (a five-column grid of fixed tracks, two more rows, a table, a card), and a reader had to learn each one.
Now `/skills` is a card per skill (its gauge, its name, its band, its score, its line), a day's scores are a card
per skill (the same head, plus the axes it measured and what it counted), and a skill's days are a card per day.
A card that is the whole link is what makes the target the thing the reader sees: on `/skills` the card is an
`<a>`, and only the name keeps the link colour. `held` marks the card a reader is on, and `onHold`/`onRelease`
make the card itself the target for a pointer and for the keyboard — that is how the skill screen's days drive
the gauge and the radar above them.

**Every line is painted at the width it was given.** A `Sparkline` is a canvas, measured by an observer: at
1300px a skill's card draws one 465px wide, in a 500px pane 155px, and in a 360px panel 306px. Its dots are
circles and its stroke 1.8px at every size, because it is drawn at the size a reader sees rather than stretched
to fit — the fixed 190×26 SVG it started with was 190px of a 688px column, and told the reader nothing about the
rest of it. One renderer is left for this, which is why nothing passes a flag to choose one.

**No page is wider than the pane it is in, and no table pans it.** Measured on every screen from 1300px down to
200px: the document is exactly as wide as the pane, and no `.table-wrap` scrolls sideways either. What was pushing
it out, in order of how much: the fixed-track rows (a five-column grid needs 30.5rem before its text has room);
the tables, whose minimum width comes from what cannot shrink (a single-word head like "A session it was loaded
in" is 163px on its own, and a session id is one unbreakable word); a heading that would not give way beside its
146px picker; a month's `minmax(200px, 1fr)` track, a preference rather than a floor; a 236px filter input. The
cards answer the first two by construction — a track is `minmax(min(22rem, 100%), 1fr)` and the prose in them
breaks a long token (`overflow-wrap: anywhere`, because a change text is full of `{files:[{file, functions:[…]}]}`).
The calendar is `minmax(min(200px, 100%), 1fr)` with 7 `minmax(0, 1fr)` columns, heads wrap under 34rem, and the
filter is capped at its pane. A *record* table — a day's sessions, a session's checks — stacks under 27.5rem
instead: the head goes and each cell carries its own `data-label` in a label column. Above 27.5rem the table is a
table, which reads better whenever the columns fit.

**Controls are a UI layer: Tailwind, wired to this app's tokens.** `src/ui/` is four components — `Button`,
`Input`, `Badge`, `ToggleGroup` — and `components/Card.tsx` is the panel they sit in. Tailwind is imported in
`src/tailwind.css` with its theme pointed at the app's own variables (`--color-card: var(--card)`,
`--radius-lg: var(--radius)`, `--text-chrome: var(--t-chrome)`), so a utility class and a hand-written rule read
the same values and cannot drift. Preflight is deliberately **not** imported: `styles.css` is the base this app
was designed against, and a second reset on top of it would change rules nobody asked to change. The app's
stylesheet is imported into a `components` layer *between* Tailwind's theme and its utilities, so a utility on an
element wins over a legacy rule for that element — which is what moving a piece of UI onto Tailwind means.

The filter is the clearest case for the layer. Three hand-written buttons in a wrapping row sit flush against each
other the moment the row is tight, and a reader cannot tell a gap from a border; Kobalte's `ToggleGroup` is one
track with one raised segment, roving focus and `aria-pressed` done for free, and it is the same control Orca uses
for its own view switches. `Button` carries its own height, padding and radius (24px chip, 28px control — Orca's
own small-control height — and 44px in a phone-sized pane, where a thumb cannot hit 28), its disabled and
focus-ring states come from one place, and **the space between controls is always the layout's `gap`, never a
margin one control forgot to leave**: `CardHead` owns `gap-x-2 gap-y-1` and the action takes the slack with
`ml-auto` behind `CardActions`. That is the whole fix for "items touch or overlap": a control carries no margin,
so it cannot collide, and a head that runs out of room wraps the item rather than overlapping it. A list stands
off whatever it follows (`.cards { margin-top: .6rem }`), so a filter and the cards under it are never one
object. `break-anywhere` (`@utility`, `overflow-wrap: anywhere`) is the app's own utility: machine strings —
session ids, paths, control flow — are what would otherwise make a card wider than the pane.

What is *not* in the layer is as deliberate: the charts, the radar, the calendar and the two record tables stay
in `styles.css`, because they are drawings and records rather than controls, and their geometry (a canvas painted
at a measured width, a table that stacks under 27.5rem) is not a set of paddings. `.dim` and `.num` stay too —
they are the app's two text markers (muted prose, a tabular number) and Tailwind has no name for the meaning.

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
`text-xs`, which is what it sets its own controls at). Orca's 11px meta is the one literal outside those four,
and the chart labels and the tab segments are what wear it. Muting is a colour, never a size (`.dim { color:
var(--muted-foreground); font-weight: 400 }`), because the page used to run thirteen sizes with 1,598
elements at 12.5px, which is below the floor at which secondary text is readable. The one solid control is the
row's `+ to-do` (`button.primary`, `--primary`); a preference marks its choice with a tint (`button.on`), not
an accent fill.

**The shell is Orca's too.** `.app` is a grid: a 240px rail on `--sidebar`, and the routed view beside it — no
action bar above the view. `Run` and `window` used to have one (a pane title bar carrying `components/App.tsx`'s
`.topbar-label` and the two buttons), and it was removed: it took a row off every screen and asked the server for
something the address bar already does. `POST /api/open` and `npm run report:open` stay — the shell and the
command line use them — but nothing in the page does.

**Three tabs are the whole navigation.** `Skills`, `Days` and `To-do` — no lists hang off the rail, because the
lists that used to (the recent days, the skills in use) are the screens themselves, and the skills screen is the
one the app opens on (`/` and `/skills` are that screen; every other path has its own). A tab owns the screens
it leads to, so a skill page keeps **Skills** lit and a day and its sessions keep **Days** lit (`Nav`'s `also`),
which is what makes the bar a place rather than a menu.

Both widths draw the same thing, and it is **one control, not three links**: Orca's segmented switch, the one its
Explorer panel puts in its own header (`right-sidebar/FileExplorerViewSwitch.tsx` — `h-7 … rounded-md bg-input/40
p-0.5`, each segment `rounded-sm px-2 text-[11px] font-normal text-muted-foreground transition-[…]`, the chosen
one `bg-background font-medium text-foreground shadow-xs`). So: a track in `--input` at 40%, `--radius-md`, with
2px of air around the segments and between them; segments at `--radius-sm`, 28px high and 11px in sentence case
(Orca's meta size, the one the chart labels already take — not `--t-chrome`, which this was first), muted until
they are current; and the mark is the **raised segment itself**, `--background` with weight 500 and Orca's
`shadow-xs` — there is no underline, no accent bar, and no colour of its own, because a tab is not a status. The
track is one rule for both orientations: the media query only changes the geometry (`repeat(3, minmax(0, 1fr))`
instead of a column). Below 860px the three become **one row of three across the top**, sticky so they stay put
while the report scrolls under them, on a `--border` hairline. The wordmark and the caption hide, and controls
grow to 44px with inputs at 16px so a phone does not zoom on focus. That is not a preference: stacked above the
content at 390px, the rail was 639px of the 844px screen — **76% of the viewport was menu**, with the report
starting below the fold at 675px. The bar is 39px now and the content pane starts at 39px, at 93px of scroll
with a segment 75.5×28 and `Skills` measuring 54.2px of it.

**Opening the report is a command, not a button.** `npm run report:open` asks `scripts/report-open.mjs` to put
the report in front of the reader: an
Orca browser tab, focused rather than duplicated when the origin is already open (`orca tab list --json` →
`tab switch --page`), or `--window` for `chrome --app=<url>`, which is the only surface with no tabs and no
address bar. **Orca's browser tab always draws its own toolbar** (its pane renders back/forward/reload and an
address field unconditionally; only the pane *title* has a chromeless variant), so "in Orca, with no browser
controls" is not a state that exists — the two surfaces are the honest version of that wish. The page used to
offer both as a `Run` and a `window` button; that bar is gone, and the buttons with it. The server still answers
`POST /api/open` for callers that are not the page — a command line caller asks it, carrying the current page
path so the tab that opens *is* the screen the reader was on — and a machine that cannot oblige answers 502 with the reason,
not a silent success. The body's `path` is re-anchored to the server's own origin (`safePath` refuses anything
with a scheme, `:` or `\\`), so a request cannot point the opener at another host.

**The skill screen answers three questions in order**: is it improving, by how much, and what to do about it —
and it opens on the data, not on a sentence about the data. The header is the skill's name and nothing else: the
delta line and the paragraph about the sample floor were prose above the first thing a reader came for, and the
floor's caveat is now said where the number is, in `.day-note` under the gauge. That note carries the day being
described, its `n` and `named`, and, when the day is under the floor, `below the sample floor: a mean of a handful
of calls, not a score` — beside a number printed as a mean with a `*` rather than a dash. The small line beside a
movement row stays range-scaled, where the direction is the message. Under the top panel: the proposals that
target the skill and the signals blamed on it (`apiSkill`), the first as the same task rows the day screen
uses — and the same `+ to-do`, because a proposal is kept from whichever screen the reader is reading it on, and
`apiSkill` marks each one `inTodo` by the same `sameWork` rule — the second compact and capped at the worst five
with the rest one click away.

**A skill's top is three things about one day: the gauge, the radar, and the line.** The day is the newest
measured one until the reader holds another: hovering or focusing a column of the chart, or a day panel below,
sets `heldDay` in `SkillView`, and the gauge, the radar, the day note and the marked panel all describe that day.
`Sparkline` takes that day as a controlled value (`held` / `onHold`), so the chart's guide line and the panel at
the top can never disagree about which day is being read; letting go returns to the newest. `Radar` draws only
the axes that day actually measured — an axis that does not apply to a skill is not part of its shape, and a spoke
scored zero would be a claim the scanner never made. With nothing measured there is no shape, so the radar is not
drawn at all (and below three axes the rings go with it). Each spoke is labelled with the axis's full name and its
rate, so the shape never hides a number, and the whole thing is drawn in the page's ink: colour has nothing left to
carry there, and a monochrome radar beside the gauge reads as one object with it. `Sparkline` draws the score per
day on a fixed 0–100 domain with the 70/85 thresholds marked — the same number the gauge leads with, over time; the
small line beside a movement row stays range-scaled, where the direction is the message. Each day carries its own
`band` from the server, because a screen that banded a score itself would drift from the rule decided once.

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
measuring anything. A chart that annotates reserves 18px under the plot for the date row; a plain sparkline (a
skill's row) reserves nothing and is painted at the width its cell gives it.

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

**Rolling over the plot replaces what the top of the page says, rather than covering it.** Each day owns a
*column* of the plot — half the way to each neighbour, so every x belongs to a day — and hovering or focusing it
hands that day to the screen, which redraws the gauge, the radar and the day note for it, and marks the matching
day panel below. A popup was tried first: a card over the chart with the date, the score and a small radar. It was
a second reading of the same data, it sat over the line it described, and it could be neither as large nor as
precise as the panel it duplicated. What survives from it is the vertical guide line (the day the pointer is on
has to be visible somewhere) and the reason it worked at all: the shape shown for a past day is the *same* radar
the top of the page draws, so a comparison is between two things of the same kind.

The columns are HTML, not SVG: a full-height band is the same at any frame width, where SVG geometry would
stretch, and it makes the data reachable by keyboard (`tabindex`, the aria-label naming the day and the score).
An 18px marker was tried first and is not enough — hovering "the day" means hovering the plot, and a target you
have to hunt for reads as a chart that does nothing. The native `<title>` is left off the markers, so the two do
not race for the same hover.

**Every day is a card, and it can be held.** The day table on a skill's screen is a grid of cards in the same
language as everything else: the date and its link to the day, the band, the score (a mean with a `*` when the
day is under the floor) and what the day counted, the axes it measured as bars, and the session it came from. It
reads as several days side by side instead of six columns of a table, it needs no horizontal scroll at any width,
and — unlike the table — it can be *held*: hovering or focusing a card puts that day at the top of the page,
exactly as a column of the chart does. That is why the card a reader is on is marked (`.card.held`): the top of
the page may be far above, and the mark is what says which day it is describing.

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

**One list of tasks, one card.** A proposal in a digest and an entry on the to-do list are the same record at
two moments, so all three screens draw them through `components/TaskList.tsx`, and the only difference is the
action threaded in (`+ to-do` there, `remove` here). The list used to ship three shapes — a table of rows, a card,
a line behind a disclosure — with a picker above it: three layouts to learn for one list, and the table was what
could not fit a narrow pane. So there is one card, with the change at reading size, the file and the check under
it, and the whole task one click away on the head's twisty (one card open at a time: a list of nine proposals is
read by opening the one you are working on). The card's head carries the id, the importance badge, the skill and
the action; the detail behind the twisty is the same `dl.fields` it always was.

**The importance badge** is `importanceOf` in `src/tasks.ts`: the worst severity among the signals a task
cites, and how many signals back it — `high`, `high ×2`, `medium`. It reads the digest's own words (`S21
(high, kept)`, `S2 and S24 (both high, kept)`, `manual (medium, kept)`) rather than joining back to the
pack, because a signal id is scoped to the session that produced it: the same `S21` in two sessions is two
findings, so an id alone cannot be looked up. The badge carries the word, the colour only agrees with it,
and the title holds the raw signal text.

An axis a row never measured is a dash, not an empty bar: a bar with no value reads as a broken chart. An
axis with no denominator is not a column, and a skill below the sample floor is not a row.

### Running it by hand

```bash
node automation/daily-reflection/collect-sessions.mjs            # collect the pack, print one JSON line
node automation/daily-reflection/collect-sessions.mjs --check    # probe only; exit 1 = no x-skill, 3 = no host readable
node automation/daily-reflection/collect-sessions.mjs --host crush,codex            # narrow the CLIs read
node automation/daily-reflection/collect-sessions.mjs --hours 168 --out /tmp/week   # a wider window
node automation/daily-reflection/collect-sessions.mjs --classify                    # add the model's turn classes
node automation/daily-reflection/collect-sessions.mjs --classify --classifier "my-model --stdin"   # another model
bash automation/daily-reflection/precheck.sh                     # what the scheduler runs first
orca automations list                                            # confirm the schedule
```

Sessions are scoped per project directory and per CLI, so discovery walks every detected host and unions
what it finds by host and uuid — the same uuid under two CLIs is two sessions. Crush's own walk is
per project in `projects.json` (newest first, `--project-lookback-hours`, default 72).

## Otter PM (its own repository)

The project board over a repository's `.x-skills` tree used to live here, at `tools/project-preview`, and it is now
its own product in its own repository: **Otter PM**, <https://github.com/lleqsnoom/otter-pm>. Its package is
`@lleqsnoom/otter-pm`; `npm run dev`, `npm run serve` and `npm test` are commands *there*; and its documentation —
what it recognises, how a lane is decided, how a project is made — moved with it.

Nothing in this package reads the app: the npm tarball never carried `tools/`, no skill calls it, and no build step
here needs it. What stays in this repository is the other half of the relationship — the `.x-skills` trees the app
draws — and Otter PM reads them from the Orca IDE's own project list, so a repository added to the IDE is one the
board shows.

```bash
git clone https://github.com/lleqsnoom/otter-pm
cd otter-pm && npm install && npm run dev   # http://127.0.0.1:4321/
```

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

The skills that ask questions (`x-analyze`, `x-plan`, `x-research`, `x-autoreflection`) ship the canonical rules in `references/questions.md` and enforce them with `scripts/check-questions.mjs`. Skills without that file (`x-triage`, `x-api-draft`, `x-api-swagger`, `x-browser`, `x-implement`, `x-investigate`) define the four shapes inline at first use.

**Known limits.** The Agent Skills specification (agentskills.io/specification) defines no question or interaction primitive, so there is no portable panel: a host may have no structured question tool, in which case the skill prints the four shapes as a numbered prompt. And `check-questions.mjs` validates only the authored questions file — nothing verifies that a session actually rendered a panel. The rule is a contract on the skill, not a runtime guarantee.

**Shared files.** `scripts/check-questions.mjs`, `references/questions.md`, and `references/research-first.md` must stay byte-identical across the skills that carry them; x-skill-lint's `copy-drift` rule fails the build when they diverge.

### Skill Scripts

- Scripts inside skills use **ES modules** (`import` syntax) even though the project itself is CommonJS.
- Scripts are standalone — they don't import from `lib/install.js` or each other.
- Use `node:child_process` for shell commands (e.g., `git diff`).
- Output JSON to stdout for structured data; errors go to stderr with `process.exit(1)`.

### The run-folder helpers are generated

Every skill that writes a `.x-skills/runs/` artifact carries the same run-folder helpers (`resolveRunDir`, `nextE`, …) because skills cannot import from each other. Edit them **once** in `scripts/sync-run-folders.js` and run `npm run sync:run-folders`, which pastes the canonical block between the `// #region run-folder` markers in every file its `TARGETS` lists. `test/run-helpers-drift.test.cjs` fails if a copy diverges, so never edit a region by hand.

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
3. Optionally add `evals/`: `triggers.json` (labeled should/should-not-trigger queries for description tuning) and `expectations.json` (behaviours past reviews confirmed, in the user's words). Both are shape-checked by x-skill-lint; expectations are grown from accepted findings, not written up front.
4. Update the README's Available Skills table.
5. Run `npm test` to verify the skill appears in the list.

## Publishing

The package uses [semantic-release](https://github.com/semantic-release/semantic-release) with OIDC trusted publishing to npmjs.org. No `NPM_TOKEN` secret is required — GitHub Actions uses OIDC tokens for authentication and generates provenance attestations automatically.

Configuration lives in `.releaserc.json`. The CI workflow is at `.github/workflows/publish.yml`.
