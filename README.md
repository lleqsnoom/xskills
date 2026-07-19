# xskills

<p align="center">
  <img src="x-skills.svg" alt="xskills logo" width="300">
</p>

**Agentic tooling built for local models under 40B. Every skill fits in a 4K context window — lean, fast, and tested against the constraints local developers actually face.** [Read the manifesto →](MANIFESTO.md)

Cross-CLI agentic skills installer. Install once, use with **45+ compatible AI coding tools**.

## What is this?

Skills are the [Agent Skills open standard](https://agentskills.io) — a folder with a `SKILL.md` file (YAML frontmatter + Markdown instructions) plus optional `scripts/`, `references/`, and `assets/` subdirectories. They give AI coding agents specialized knowledge and workflows.

**One format, all CLIs.** No adapters needed.

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
# Install all 15+ skills at once
xskills install-all --global          # Global: ~/.agents/skills/
xskills install-all                   # Local: .agents/skills/ in current project

# Or specific skills only
xskills install x-commit x-design --global

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
| `x-api-draft` | Draft API design from requirements — clarify scope, analyze endpoints and data models |
| `x-api-swagger` | Convert an API design draft to OpenAPI YAML spec with endpoints, schemas, and auth |
| `x-commit` | Write single-line conventional commit messages with automated type suggestion and validation |
| `x-debug` | Structured debugging — hypothesis formation, evidence collection, root cause declaration |
| `x-decompose` | Decompose epic into atomic tasks ≤8h each with DOD, test plan, effort estimate |
| `x-design` | Spec-driven design — clarify goals, propose approaches with trade-offs, gate on approval |
| `x-dispatch` | Parallel subagent task dispatcher via git worktrees with dependency management |
| `x-epic` | Convert approved spec into INVEST-gated user stories and epic-level DOD |
| `x-fix` | Resolve code review issues one-by-one from a fix plan file until complete |
| `x-implement` | Test-driven implementation — red/green/refactor per task, docs sync, commit via x-commit |
| `x-migrate` | Framework/dependency migration assistant — breaking changes, upgrade paths, automated fixes |
| `x-refactor` | Automated refactoring suggestions against SOLID principles with before/after comparisons |
| `x-review` | Review code against engineering principles with AST-based complexity analysis across 10+ languages |
| `x-rollback` | Automated git revert with multi-step confirmation and impact analysis |
| `x-test-gen` | Generate test stubs from implementation — happy path, error cases, edge case placeholders |

## Workflow

Skills compose into production workflows. Pick the one that fits your task:

**Design → Implement:**
```
x-design → x-epic → x-decompose → x-implement → x-commit
                                         ↘ x-review → x-fix (loop)
```

**API Development:**
```
x-api-draft → x-api-swagger
```

**Code Quality:**
```
x-review → x-fix → x-refactor
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
xskills install x-design x-epic x-decompose x-implement
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
