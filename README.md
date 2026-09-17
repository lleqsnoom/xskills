# xskills

<p align="center">
  <img src="x-skills.svg" alt="xskills logo" width="300">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lleqsnoom/x-skills"><img src="https://img.shields.io/npm/dm/@lleqsnoom/x-skills" alt="npm monthly downloads"></a>
  <a href="https://github.com/lleqsnoom/xskills/stargazers"><img src="https://img.shields.io/github/stars/lleqsnoom/xskills?style=social" alt="GitHub stars"></a>
  <a href="https://www.npmjs.com/package/@lleqsnoom/x-skills"><img src="https://img.shields.io/npm/v/@lleqsnoom/x-skills" alt="npm version"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-blue" alt="Node.js >= 18"></a>
</p>

**Stop writing separate instructions for every AI coding tool.** xskills gives you reusable workflows. They work across **45+ AI coding CLIs** — Claude Code, Gemini CLI, Cursor, Aider, and more. One format, install once, use everywhere.

It is built for small local models under 40B. Every skill is tested to fit a 4K context window — the largest `SKILL.md` is about 10 KB, roughly 2.5k tokens. [Read the manifesto →](MANIFESTO.md)

## Why xskills?

You already use AI coding tools. Maybe Claude Code for complex refactors, Gemini CLI for quick questions, or Cursor for inline edits. But each tool wants its own instructions and setup.

**xskills fixes that.** It is a set of reusable "skills" built on the [Agent Skills open standard](https://agentskills.io). A skill is a folder of knowledge and workflows. Any compatible CLI can use it.

- **One format for every CLI** — no adapters, no rewriting per tool
- **27 production-ready skills** — commits, debugging, code review, API design, task decomposition, and more
- **Zero dependencies** — Node.js built-ins only
- **Built for local models** — every skill fits in a 4K context window

### The problem it solves

Without xskills, you write instructions for Claude Code. Then you rewrite them for Gemini CLI. Then you adapt them again for Cursor. You keep three copies in sync.

With xskills, you install once. Every compatible CLI finds and uses the same skills.

## Supported CLIs

| CLI | Status |
|--|--------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Native |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Native |
| [Crush](https://github.com/charmbracelet/crush) | Native |
| [OpenCode](https://github.com/sst/opencode) | Native |
| [Roo Code](https://github.com/RooCodeInc/Roo-Code) | Native |
| [Goose](https://github.com/block/goose) (Block) | Native |
| [OpenAI Codex](https://github.com/openai/codex) | Native |
| [Mistral Vibe](https://github.com/mistralai/mistral-vibe) | Native |
| [NanoBot](https://github.com/HKUDS/nanobot) | Native |
| [Aider](https://aider.chat) | Via `.agents/skills/` discovery |
| [Cursor](https://cursor.sh) | Via `.agents/skills/` discovery |
| **45+ total** | [See full list](https://agentskills.io/clients) |

## Install

Make `xskills` available globally, or run it with npx:

```bash
# Option A: Global install (recommended for persistent use)
npm install -g @lleqsnoom/x-skills

# Option B: Use via npx without installing (still works)
npx @lleqsnoom/x-skills help
```

Then install the skills:

```bash
# Install all 27 skills at once
xskills install-all --global          # Global: ~/.agents/skills/
xskills install-all                   # Local: .agents/skills/ in current project

# Or specific skills only
xskills install x-commit x-plan --global

# Shortcut — just type the skill name
xskills <skill-name>
```

## Requirements

- **Node.js 18 or newer** — the skills use only Node built-ins, so there is nothing to install.
- **Git** — needed by `x-rollback` and `x-parallel`.
- **A compatible CLI** — see [Supported CLIs](#supported-clis). A few skills need extra tooling: `x-browser` drives a real Chrome/Chromium through a `chrome-devtools` MCP client.

## Reading the daily report

```bash
npm run report:install          # once: the app's own dependencies
npm run report:build            # once, and after any change under tools/report-app
npm run report:panel            # the Orca plugin's panel: the same app, baked with a snapshot
npm run report                  # http://127.0.0.1:8787/ — movement per skill, per day
npm run report:open             # start it if it is not running, then open it in an Orca tab
npm run report:window           # the same, in a window with no browser controls (chrome --app)
```

The app is styled in Orca's own design language — its theme tokens, its Geist font, its radius and badge
recipes — so the report reads as another pane of the same application. `Run` in its title bar opens (or
focuses) the report in an Orca browser tab; `window` opens it in an application window instead, which is the
only surface with no browser controls, because nothing inside a tab can hide that tab's own chrome.

A digest's proposals and the to-do list are the same tasks, drawn by the same component. `rows` is the shape
in use — one line a task with an importance badge, and the file, the check and the rest behind a disclosure.
`cards` and `lines` are still one click away in the picker above the list (`?shape=a|b|c`).

### The Orca plugin

`tools/orca-plugin/` is an Orca plugin over the same server: four commands (`Open`, `Status`, `Record the
newest day`, `Start the server here`), `Mod+Alt+X` for the first, a notification the first time you look after
a new day has landed, and a **panel** that is this app itself — built to one file with the API payloads baked
in, because a panel cannot fetch. What is baked is every day the rail and the calendar can reach, newest
first, up to a byte budget, so a day a reader can click is a day that opens. Both surfaces share one baker
(`scripts/report-panel.mjs`): the server bakes
while it runs, and the plugin's worker bakes whenever Orca wakes it, so the panel is current with or without
the server up. It owns no server process and talks only to a loopback address; the report
itself is unchanged, and the plugin is a client of it. A panel cannot be a full-area tab and cannot fetch, so
the report also opens as a browser tab and the live wide pane is requested rather than faked — see
[`tools/orca-plugin/PANE-REQUEST.md`](tools/orca-plugin/PANE-REQUEST.md) and
[`tools/orca-plugin/README.md`](tools/orca-plugin/README.md).

## Available Skills

Run `npx xskills list` to see all available skills.

| Skill | Description |
|-------|-------------|
| `x-anal` | Interactive analysis skill — research the project and web first, ask via panels (single / multi / open / confirm) until the user is sure, then produce a thesis with cited evidence and a mechanical check, propose three solutions with trade-offs, and route to fix or task creation; graph-driven with guards and a markdown memory. |
| `x-api-draft` | Draft API design from requirements — clarify scope, analyze endpoints and data models, produce a human-reviewable API design in markdown |
| `x-api-swagger` | Convert an API design draft to OpenAPI YAML — generate a valid spec from markdown drafts with endpoints, schemas, and auth definitions |
| `x-autoreflection` | Reflect on a session and improve the skills it used — read the transcript of this or an earlier session, mechanically extract friction signals (failed commands, repeated calls, user corrections, loaded-but-unused skills, questions asked in prose), check each against the real skill files, and turn the survivors into evidence-backed proposals with a target file and a check, then route them to a fix, a spec, or tasks. |
| `x-browser` | Launch the real Chrome/Chromium with remote debugging and attach the chrome-devtools MCP to the project’s app URL — detects the URL from README/config/env, verifies the dev server, and opens the browser so you can drive it without manual setup. |
| `x-comments` | Comment management — add only precise, meaningful comments and remove noisy or obvious ones; refactor overly commented code into self-explanatory functions instead of describing it |
| `x-commit` | Write single-line conventional commit messages — one authoritative type map, imperative mood, no description body |
| `x-debug` | Evidence-based debugging — reproduce, hypothesize, fix root cause, verify |
| `x-decompose` | Decompose approved epic into layer-based tasks — each task is an independent, testable increment that builds on the previous; outputs `<run folder>/E02-tasks/` for handoff to x-implement |
| `x-epic` | Convert approved spec into a layer-based epic — each layer is a coherent, testable increment from prototype to polished product; outputs `<run folder>/E01-epic.md` for handoff to x-decompose |
| `x-essay` | Write an article end-to-end on a fixed loop — x-anal thesis, x-roast critique, x-humanize rewrite — repeating until it scores strong and reads clean. Use when asked to write or draft an article, blog post, or essay that must defend a claim. |
| `x-fix` | Resolve issues from fix plans — read, edit, verify, mark complete |
| `x-humanize` | Simplify text, an article, a commit or PR to a B2 reading level — measure sentence length and complexity, cut noise, rewrite, then verify no meaning was lost. Use when asked to humanize, simplify, make easy to read, or plain-language a piece of prose. |
| `x-implement` | Implement or fix with TDD — parallelize independent tasks with x-parallel, apply x-ui for frontend work, red-green-refactor per task, verify with x-review + x-fix, gate on plan completion |
| `x-investigate` | Hypothesis-driven root cause analysis — generate ranked hypotheses from evidence, test systematically with platform tools and git history, eliminate candidates until one root cause remains, output fix plan for x-fix |
| `x-migrate` | Framework/dependency migration assistant — generates migration plans with breaking changes, upgrade paths, and automated fix candidates from source analysis |
| `x-parallel` | Run multiple coding tasks in parallel — each task gets an isolated git worktree and its own background agent process with full tools and the parent's project rights, then committed results merge back into your branch |
| `x-plan` | Plan before coding — research the project and the web first, ask via panels (single / multi / open / confirm) until the user is sure, propose three approaches with trade-offs, then write a layered spec (contract, invariant, test) as a graph-driven scenario with guards and a memory file; gate on user approval |
| `x-refactor` | Automated refactoring suggestions (extract method, rename, replace conditional) — analyzes code against SOLID principles and outputs actionable before/after comparisons |
| `x-reproduce` | Generates minimal platform-aware reproducible test cases from triage briefs — exits 1 when bug is present, exits 0 after fix applied |
| `x-research` | Research a topic or tune a metric — research the project and web first, propose three candidate changes, then iterate one atomic change at a time, evaluating it mechanically (a command, or agent-judged criteria coverage) and keeping only measured improvements until the target, a guard, or a hard cap stops the run; graph-driven with guards, a memory file, and a report. Use for "research X", "compile/summarise sources on Y until N criteria are covered", filling knowledge gaps, literature/topic research with coverage criteria, or optimizing a measurable value. |
| `x-review` | Review code against engineering principles — small functions, SOLID, KISS, DRY — with automated AST-based complexity analysis across 30+ languages including Python, C, C++, Java, JavaScript, TypeScript, Go, Rust, Ruby, PHP, Swift, Kotlin, and more |
| `x-roast` | Roast any non-code artifact — articles, analyses, specs, epics, tasks, research, or another skill — where the reviewer fact-checks the claims, attacks the reasoning, proposes better angles, and scores it on a weighted, anchored rubric computed by a script. Use for "roast this", "poke holes in", "review this spec/skill/analysis", or any request for a reproducible number and reason. For source code use x-review instead. |
| `x-rollback` | Automated git revert with multi-step confirmation — identifies target commits, analyzes impact, requires approval, creates properly formatted revert commits via x-commit integration |
| `x-skill-lint` | Validate this repo’s own skills — frontmatter parses and `name` matches the folder, every referenced `scripts/*` and `references/*` exists, no stray template tokens, and the README skills table lists every skill |
| `x-test-gen` | Generate test stubs from implementation — analyzes source code and creates scaffolded tests with happy path, error cases, and edge case placeholders |
| `x-triage` | Structured intake conversation — ask targeted panels (single / multi / open / confirm) to classify a bug’s platform, type, and evidence before touching any tools. Outputs `<run folder>/E<nn>-triage.md`. |
| `x-ui` | Design and audit app UIs to be clean, clear, and effective — framework-agnostic method (Vue/React/HTML) with component-selection, row-action, and pre-flight rules. |

## Workflow

Skills compose into production workflows. Pick the one that fits your task:

**Plan → Implement:**
```
x-plan → x-epic → x-decompose → x-implement → x-commit
                                         ↘ x-review → x-fix (loop)
```

**API Development:**
```
x-api-draft → x-api-swagger
```

**Code Quality:**
```
x-review → x-fix (loop)
```

**Debugging & Migration:**
```
x-debug          (standalone)
x-migrate        (standalone)
x-rollback       (standalone)
```

**Improve the skills themselves** (run it after a session that felt rough):
```
x-autoreflection → x-fix        (small edits)
                 → x-plan       (a gap that needs a decision)
```

### Quick Start

1. **Make `xskills` available** — `npm install -g @lleqsnoom/x-skills`, or run it with `npx`. See [Install](#install) for both options.
2. **Install skills** — `xskills install-all --global` installs everything; `xskills install <skill-name>` installs one.
3. **Use it with your AI coding agent** — your CLI finds the installed skills and offers them when relevant.

### Upgrading

`install-all` and `install` leave a skill that is already installed alone, so a plain upgrade does
nothing. Pass `--force` to refresh it, which replaces the copy rather than merging into it, so files
the newer version dropped do not linger:

```bash
xskills install-all --global --force     # update every installed skill
xskills install x-plan --global --force  # update one
```

**Artifacts are not migrated.** Since v5.21.0 every skill writes into one folder per run,
`.x-skills/runs/<date>-R<nn>-<slug>/`. Artifacts produced by an earlier version stay where they
are, in `.x-skills/plan`, `epics`, `tasks`, `debug`, and so on; nothing reads those paths any more.
If a run was in flight when you upgraded, move its artifacts into the run folder by hand or re-run
the phase — otherwise it looks like the work is missing.

## How It Works

1. Skills live in `.agents/skills/`, following the [Agent Skills spec](https://agentskills.io/specification).
2. Compatible CLIs scan that directory and find the skills automatically.
3. Skills use **progressive disclosure** — a light catalog at startup, full instructions only when needed.

### Deterministic by design

Some skills do not only suggest — they check. `x-roast` scores an artifact against a fixed rubric. `x-humanize` will not finish until its verifier exits 0. `x-essay` loops until the score and the checks both pass. The rules are numbers, not opinions, so two runs agree. That is the difference between a prompt and a workflow.

## Directory Structure After Install

```
my-project/
├── .agents/
│   └── skills/
│       ├── x-commit/
│       │   ├── SKILL.md          # Instructions the agent reads
│       │   ├── scripts/           # Portable scripts
│       │   ├── references/        # Docs & examples
│       │   └── assets/            # Configs & templates
│       └── ...
```

## Create Your Own Skill

1. Create a folder: `my-skill/`
2. Add `SKILL.md` with YAML frontmatter:

```markdown
---
name: my-skill
description: What it does and when the agent should use it.
---

# My Skill

Step-by-step instructions for the agent...
```

3. Optionally add `scripts/`, `references/`, and `assets/` subdirectories.
4. Submit a PR, or install it locally with `npx xskills install ./path/to/my-skill`.

## Development

This repo is a Node package with zero runtime dependencies. Tests use the built-in `node:test` runner, so there is nothing to install before running them:

```bash
npm test                                     # run the full suite
node bin/install.js list                     # list every skill the package ships
node skills/x-skill-lint/scripts/lint.mjs    # check the skills themselves
```

Skills are plain folders. You can also read any `SKILL.md` directly.

### Daily reflection automation

This repo improves itself on a schedule. `automation/daily-reflection/` collects every session of the
last 24 hours across the AI CLIs it finds on your machine — through one adapter each in
`skills/x-autoreflection/scripts/hosts/`, covering OpenCode, Claude Code, Codex, Gemini CLI, Cursor,
Cline, Roo Code, Kilo Code, Goose, Crush, Qwen Code and GitHub Copilot CLI — scans each one for friction
with the `x-autoreflection` scanner, and reflects on the worst few: a digest of proposed skill edits for
review. It proposes; it never edits a skill, commits, or pushes.

```bash
node automation/daily-reflection/collect-sessions.mjs              # write today's evidence pack
node automation/daily-reflection/collect-sessions.mjs --check      # exit 1 = no x-skill, 3 = no host readable
node automation/daily-reflection/collect-sessions.mjs --host crush # read one CLI only
```

The pack lands in `.x-skills/daily/<date>/`, with `DIGEST.md` as the file to read in the morning. An
Orca automation (`x-skills-daily-reflection`) runs it at 05:00 daily; `automation/daily-reflection/runbook.md`
is the procedure it follows. Nothing under `automation/` is published to npm.

## What This Is Not

- **Not a runtime or a model.** xskills ships instructions and small Node scripts. Your AI coding CLI runs them.
- **Not a hosted service.** No account, no network calls — everything runs locally from `~/.agents/skills/` or `.agents/skills/`.
- **Not magic.** A skill is guidance for the model. The quality of the output still depends on the CLI and model you use.
- **Not dependency-free at install time for everyone.** The skills themselves use only Node built-ins, but Node.js 18 or newer is required.

## License

MIT
