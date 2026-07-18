# @lleqsnoom/x-skills

Cross-CLI agentic skills for AI coding tools (45+ compatible). Zero dependencies — Node built-ins only (`fs`, `path`, `os`, `child_process`).

## Install

```bash
npm install -g @lleqsnoom/x-skills   # global
npx @lleqsnoom/x-skills               # without installing
```

Two CLIs available after install:

| Command | Purpose |
|---------|---------|
| `xskills` | Skill installer — `xskills list`, `xskills install <name>`, `xskills install <name> --global` |
| `xskills-mcp-server` | MCP server (JSON-RPC 2.0 over stdio) — exposes all skill scripts as callable tools |

## Available Skills & MCP Functions

14 skills, each with a SKILL.md + optional scripts/references/assets:

| Skill | Purpose | MCP Function |
|-------|---------|--------------|
| `x-design` | Spec-driven design (declarations: contract, invariant, test) | `x-design-save-spec`, `x-design-shared` |
| `x-epic` | Convert approved spec → INVEST-gated user stories with DOD | `x-epic-save-epic`, `x-epic-shared` |
| `x-decompose` | Decompose epic into atomic tasks (≤8h each) | `x-decompose-save-tasks`, `x-decompose-shared` |
| `x-implement` | TDD implementation — red/green/refactor/commit per task | `x-implement-save-plan`, `x-implement-shared` |
| `x-commit` | Conventional commit messages (suggest, validate, atomic commit) | `x-commit-suggest-type`, `x-commit-validate-commit`, `x-commit-commit` |
| `x-review` | Code review against SOLID/KISS/DRY + AST-based complexity analysis | `x-review-analyze-complexity`, `x-review-check-duplication`, `x-review-save-plan` |
| `x-fix` | Resolve code review issues from a fix plan file | *(CLI only)* |
| `x-api-draft` | Draft API design from requirements | `x-api-draft-save-design` |
| `x-api-swagger` | Convert API draft → OpenAPI YAML spec | `x-api-swagger-save-spec` |
| `x-debug` | Structured debugging (hypothesis → evidence → root cause) | `x-debug-analyze` |
| `x-refactor` | Automated refactoring suggestions with before/after comparisons | `x-refactor-analyzer` |
| `x-migrate` | Framework/dependency migration plans with breaking changes | `x-migrate-analyze` |
| `x-rollback` | Git revert with multi-step confirmation | `x-rollback-revert` |
| `x-test-gen` | Generate test stubs from implementation (happy/error/edge cases) | `x-test-gen-generate` |
| `x-dispatch` | Parallel subagent task dispatcher via git worktrees | `x-dispatch-dispatch` |

## Pipeline Flow

```
Vague goal or requirement
        │
        ▼
┌───────────────┐     spec approved      ┌──────────────┐   epic approved    ┌──────────────────┐  tasks approved   ┌────────────────┐
│   x-design    │ ──────────────────────▶│     x-epic    │ ──────────────────▶│   x-decompose    │ ──────────────────▶│   x-implement   │
│               │                        │              │                    │                  │                 │                │
│ • Spec format │                        │ • User stories│                    │ • Atomic tasks   │                 │ • TDD cycle     │
│ • Declarations│                        │ • INVEST gate │                    │ • ≤8h each       │                 │ • Commit via    │
│ • Gate on     │                        │ • Epic DOD    │                    │ • Test plans     │                 │   x-commit      │
│   approval    │                        │               │                    │                  │                 │                │
└───────────────┘                        └──────────────┘                    └──────────────────┘                 └────────────────┘
```

Each step outputs a `.x-skills/` artifact that the next step reads. **Never skip phases** — each gates on approval before proceeding.

## MCP Server Usage

Start the server: `node bin/install.js install x-design && node lib/mcp-server.js`

The server exposes all skill scripts as JSON-RPC tools over stdio (MCP 1.0 protocol). Each tool runs its associated script and returns stdout (JSON) or stderr on failure. Compatible with any MCP client (Claude Code, Crush, etc.).

## CI/CD — Auto-Publish on Merge to Main

GitHub Actions workflow at `.github/workflows/publish.yml`:
- Triggers on `push` to `main` (or PR closed → merge)
- Node 24 + npm ≥ 11.5.1 for OIDC trusted publishing
- Inline conventional-commit version bumping (`feat:` → minor, `fix:` → patch, `BREAKING CHANGE` → major)
- Auto-generates CHANGELOG.md entries
- `npm publish --provenance` via OIDC (no NPM_TOKEN secret needed — ephemeral per-publish auth minted by npm CLI from GitHub's OIDC token)
- Creates and pushes Git tag `vX.Y.Z`
- Completes within 5 minutes

Setup required once: configure trusted publisher on [npmjs.com → @lleqsnoom/x-skills → Settings → Trusted Publisher](https://www.npmjs.com/package/@lleqsnoom/x-skills/settings) with repo `lleqsnoom/xskills`, workflow `.github/workflows/publish.yml`.

## Directory Structure

```
xskills/
├── package.json              # @lleqsnoom/x-skills, zero runtime deps
├── bin/install.js            # CLI entry point (CommonJS)
├── lib/install.js            # Core: install, globalInstall, listSkills, copyDir
├── lib/mcp-server.js         # stdio MCP server (JSON-RPC 2.0 over stdin/stdout)
├── lib/mcp-tools.js          # Skill tool discovery from SKILL.md frontmatter
├── CHANGELOG.md              # Auto-regenerated on each release
└── skills/                   # 14 skill packages, published as part of the npm tarball
    ├── x-design/             # Each has: SKILL.md + scripts/ + (optional) references/ assets/
    ├── x-epic/
    ├── ...
```

All `skills/*/` directories are included in the published tarball per `files` field in package.json.
