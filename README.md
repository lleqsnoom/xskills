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

**Stop writing different instructions for every AI coding tool.** xskills gives you reusable, specialized workflows that work across **45+ AI coding CLIs** — Claude Code, Gemini CLI, Cursor, Aider, and more. One format, install once, use everywhere.

Agentic tooling built for local models under 40B. Every skill fits in a 4K context window — lean, fast, and tested against the constraints real developers face daily. [Read the manifesto →](MANIFESTO.md)

## Why xskills?

You're using AI coding tools — maybe Claude Code for complex refactors, Gemini CLI for quick questions, Cursor for inline edits. But each tool needs different instructions, different prompt formats, different setup.

**xskills solves that.** It's a collection of reusable "skills" following the [Agent Skills open standard](https://agentskills.io) — folders with specialized knowledge and workflows that any compatible CLI can use.

- **One format across all CLIs** — no adapters, no rewriting for each tool
- **14 production-ready skills** — commit conventions, debugging, code review, API design, task decomposition, and more
- **Zero dependencies** — pure Node.js built-ins, nothing else
- **Built for local models** — every skill fits in a 4K context window

### The problem it solves

Without xskills: Write custom instructions for Claude Code. Rewrite them for Gemini CLI. Adapt again for Cursor. Maintain three copies.

With xskills: Install once. Every compatible CLI discovers and uses the same skills automatically.

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

**First, make `xskills` available globally or via npx:**

```bash
# Option A: Global install (recommended for persistent use)
npm install -g @lleqsnoom/x-skills

# Option B: Use via npx without installing (still works)
npx @lleqsnoom/x-skills help
```

**Then, install skills:**

```bash
# Install all 14+ skills at once
xskills install-all --global          # Global: ~/.agents/skills/
xskills install-all                   # Local: .agents/skills/ in current project

# Or specific skills only
xskills install x-commit x-plan --global

# Shortcut — just type the skill name
xskills <skill-name>
```

## MCP Server

For CLIs that support MCP (Model Context Protocol), run the bundled stdio server. **First install skills, then start the server:**

```bash
# 1. Install all skills locally or globally
npx @lleqsnoom/x-skills install-all --global

# 2. Start the MCP server
npx @lleqsnoom/x-skills mcp-server
```

The server discovers installed skills from `.agents/skills/` (local) or `~/.agents/skills/` (global) and exposes them as MCP tools.

### Configure in Client

Add to your client config (e.g., `.claude.json`, `cursor.json`, etc.):

```json
{
  "mcpServers": {
    "xskills": {
      "command": "npx",
      "args": ["@lleqsnoom/x-skills", "mcp-server"]
    }
  }
}
```

### Configure Globally (Optional)

To use the MCP server across all projects without per-project config:

```bash
# Install globally so npx can resolve it anywhere
npm install -g @lleqsnoom/x-skills
npx xskills mcp-server
```

Or pin a specific version and install skills separately:
```bash
npm install -g @lleqsnoom/x-skills@latest
xskills install-all --global  # Install skills globally once
xskills mcp-server            # Start MCP server whenever needed
```

### Available MCP Tools

The server exposes all installed skills as tools. Each skill provides its own set of functions (e.g., `x_commit_suggest_type`, `x_review_analyze_complexity`). Run the server and your client will auto-discover them.

## Available Skills

Run `npx xskills list` to see all available skills.

| Skill | Description |
|-------|-------------|
| `x-anal` | Interactive analysis skill — understand the user’s problem, produce a thesis with evidence, and propose a solution; route to fix or task creation when ready. |
| `x-api-draft` | Draft API design from requirements — clarify scope, analyze endpoints and data models, produce a human-reviewable API design in markdown |
| `x-api-swagger` | Convert an API design draft to OpenAPI YAML — generate a valid spec from markdown drafts with endpoints, schemas, and auth definitions |
| `x-browser` | Launch the real Chrome/Chromium with remote debugging and attach the chrome-devtools MCP to the project’s app URL — detects the URL from README/config/env, verifies the dev server, and opens the browser so you can drive it without manual setup. |
| `x-comments` | Comment management — add only precise, meaningful comments and remove noisy or obvious ones; refactor overly commented code into self-explanatory functions instead of describing it |
| `x-commit` | Write single-line conventional commit messages — one authoritative type map, imperative mood, no description body |
| `x-debug` | Evidence-based debugging — reproduce, hypothesize, fix root cause, verify |
| `x-decompose` | Decompose approved epic into layer-based tasks — each task is an independent, testable increment that builds on the previous; outputs .x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/ for handoff to x-implement |
| `x-epic` | Convert approved spec into a layer-based epic — each layer is a coherent, testable increment from prototype to polished product; outputs .x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md for handoff to x-decompose |
| `x-essay` | Write an article end-to-end on a fixed loop — x-anal thesis, x-roast critique, x-humanize rewrite — repeating until it scores strong and reads clean. Use when asked to write or draft an article, blog post, or essay that must defend a claim. |
| `x-fix` | Resolve issues from fix plans — read, edit, verify, mark complete |
| `x-humanize` | Simplify text, an article, a commit or PR to a B2 reading level — measure sentence length and complexity, cut noise, rewrite, then verify no meaning was lost. Use when asked to humanize, simplify, make easy to read, or plain-language a piece of prose. |
| `x-implement` | Implement or fix with TDD — parallelize independent tasks with x-parallel, apply x-ui for frontend work, red-green-refactor per task, verify with x-review + x-fix, gate on plan completion |
| `x-investigate` | Hypothesis-driven root cause analysis — generate ranked hypotheses from evidence, test systematically with platform tools and git history, eliminate candidates until one root cause remains, output fix plan for x-fix |
| `x-migrate` | Framework/dependency migration assistant — generates migration plans with breaking changes, upgrade paths, and automated fix candidates from source analysis |
| `x-parallel` | Run multiple coding tasks in parallel — each task gets an isolated git worktree and its own background agent process with full tools, then committed results merge back into your branch |
| `x-plan` | Plan before coding — clarify vague goals, propose approaches with trade-offs, write spec as declarations (contract, invariant, test) with a layer roadmap; gate on user approval |
| `x-refactor` | Automated refactoring suggestions (extract method, rename, replace conditional) — analyzes code against SOLID principles and outputs actionable before/after comparisons |
| `x-reproduce` | Generates minimal platform-aware reproducible test cases from triage briefs — exits 1 when bug is present, exits 0 after fix applied |
| `x-review` | Review code against engineering principles — small functions, SOLID, KISS, DRY — with automated AST-based complexity analysis across 30+ languages including Python, C, C++, Java, JavaScript, TypeScript, Go, Rust, Ruby, PHP, Swift, Kotlin, and more |
| `x-roast` | Critically review any non-code artifact — articles, analyses, epics, tasks, research — with online fact-checking, a creative re-think, concrete improvement proposals, and a weighted rubric score that is reproducible and testable. |
| `x-rollback` | Automated git revert with multi-step confirmation — identifies target commits, analyzes impact, requires approval, creates properly formatted revert commits via x-commit integration |
| `x-skill-lint` | Validate this repo’s own skills — frontmatter parses and `name` matches the folder, every referenced `scripts/*` and `references/*` exists, no stray template tokens, and the README skills table lists every skill |
| `x-test-gen` | Generate test stubs from implementation — analyzes source code and creates scaffolded tests with happy path, error cases, and edge case placeholders |
| `x-triage` | Structured intake conversation — ask targeted questions to classify a bug’s platform, type, and evidence before touching any tools. Outputs .x-skills/debug/triage-brief.md. |
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

### Quick Start

**Step 1: Make `xskills` available:**

```bash
# Global install (recommended) — use from anywhere without npx
npm install -g @lleqsnoom/x-skills

# Or use via npx (still works, no global install needed)
npx @lleqsnoom/x-skills help
```

**Step 2: Install skills:**

```bash
# All skills globally (recommended for most users)
xskills install-all --global

# Specific skills locally in current project
xskills install x-plan x-epic x-decompose x-implement
```

**Step 3: Use with your AI coding agent**

Your CLI will auto-discover installed skills and offer them when relevant. Each skill gates on user approval before executing.

For MCP clients (editors, agents), add to config:
```json
{
  "mcpServers": {
    "xskills": {
      "command": "npx",
      "args": ["@lleqsnoom/x-skills", "mcp-server"]
    }
  }
}
```

## How It Works

1. Skills live in `.agents/skills/` following the [Agent Skills spec](https://agentskills.io/specification).
2. Compatible CLIs scan this directory and discover skills automatically.
3. Skills use **progressive disclosure** — lightweight catalog at startup, full instructions only when needed.

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

3. Optionally add `scripts/`, `references/`, `assets/` subdirectories.
4. Submit a PR or install locally via `npx xskills install ./path/to/my-skill`.

## License

MIT
