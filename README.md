# xskills

Cross-CLI agentic skills installer. Install once, use with **45+ compatible AI coding tools**.

## What is this?

Skills are the [Agent Skills open standard](https://agentskills.io) — a folder with a `SKILL.md` file (YAML frontmatter + Markdown instructions) plus optional `scripts/`, `references/`, and `assets/` subdirectories. They give AI coding agents specialized knowledge and workflows.

**One format, all CLIs.** No adapters needed.

## Supported CLIs

|| CLI | Status |
||-----|--------|
|| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Native |
|| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Native |
|| [Crush](https://github.com/charmbracelet/crush) | Native |
|| [OpenCode](https://github.com/sst/opencode) | Native |
|| [Roo Code](https://github.com/RooCodeInc/Roo-Code) | Native |
|| [Goose](https://github.com/block/goose) (Block) | Native |
|| [OpenAI Codex](https://github.com/openai/codex) | Native |
|| [Mistral Vibe](https://github.com/mistralai/mistral-vibe) | Native |
|| [NanoBot](https://github.com/HKUDS/nanobot) | Native |
|| [Aider](https://aider.chat) | Via `.agents/skills/` discovery |
|| [Cursor](https://cursor.sh) | Via `.agents/skills/` discovery |
|| **45+ total** | [See full list](https://agentskills.io/clients) |

## Install

```bash
# One command — installs into current project
npx xskills install <skill-name>

# Install globally (available in all projects)
npx xskills install <skill-name> --global

# Shortcut — just type the skill name
npx xskills <skill-name>
```

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

1. Install skills you need: `npx xskills install x-design x-epic x-decompose x-implement`
2. Ask your AI coding agent to follow the workflow chain
3. Each skill gates on user approval before moving to the next step

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
