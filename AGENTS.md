# AGENTS.md — xskills

## Project Overview

`xskills` is an npm package that installs [Agent Skills](https://agentskills.io) into projects or globally. Skills are folders containing a `SKILL.md` (YAML frontmatter + Markdown) plus optional `scripts/`, `references/`, and `assets/` subdirectories. They follow the Agent Skills open standard and work with 45+ AI coding CLIs.

The package has **zero dependencies** — it uses only Node.js built-ins (`fs/promises`, `path`, `os`, `child_process`).

---

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Runs all tests (install, version-bump, etc.) |
| `npm run release -- --dry-run` | Dry-run semantic-release locally to preview bump type |
| `node bin/install.js list` | Lists available skills with descriptions |
| `node bin/install.js install <name>` | Installs a skill into the current project's `.agents/skills/` |
| `node bin/install.js install <name> --global` | Installs globally to `~/.agents/skills/` |
| `node bin/install.js <name>` | Shortcut: installs the named skill |
| `node bin/install.js help` | Shows usage info |

---

## Directory Structure

```
xskills/
├── package.json              # Node >= 18, name: "xskills", MIT
├── bin/install.js            # CLI entry point (CommonJS)
├── lib/install.js            # Core logic — install, globalInstall, listSkills
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
    ├── x-fix/                # Resolve code review issues from fix plan files
    │   └── SKILL.md
    ├── x-design/             # Spec-driven design — clarify goals, write specs as declarations
    │   ├── SKILL.md
    │   └── scripts/
    ├── x-epic/               # Epic definition — outcome-focused user stories with INVEST and DOD
    │   ├── SKILL.md
    │   └── scripts/
    └── x-decompose/          # Atomic task decomposition — tasks ≤8h with DOD, test plans, effort estimates
        ├── SKILL.md
        └── scripts/
```

---

## Development Workflow

The planning workflow follows a three-phase handoff chain:

| Phase | Skill | Input | Output | Gate |
|-------|-------|-------|--------|------|
| 1. Design | `x-design` | Vague goal or requirement | `.x-skills/design/DD-MM-YYYY-hh:mm-<topic>.md` (spec) | User approves spec |
| 2. Epic | `x-epic` | Approved spec | `.x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md` (user stories + DOD) | User approves epic |
| 3. Decompose | `x-decompose` | Approved epic | `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/` (directory with atomic tasks, one file per user story) | User approves tasks |

After task approval → `x-implement` executes tasks sequentially or in parallel groups.

### Code Review & Debugging Workflows (Optional)

Independent of the planning pipeline, code quality improvements use two separate flows:

**Static Analysis Flow:**

| Phase | Skill | Input | Output | Gate |
|-------|-------|-------|--------|------|
| 1. Analyze | `x-review` | Source code or project path | `.x-skills/review/DD-MM-YYYY-hh:mm.md` (review plan with complexity/duplication metrics) | User reviews issues |
| 2. Refactor | `x-refactor` | Review findings | JSON/markdown refactoring suggestions (extract method, rename, polymorphism) | User applies changes manually |

**Debugging Flow:**

| Phase | Skill | Input | Output | Gate |
|-------|-------|-------|--------|------|
| 1. Debug | `x-debug` | Error message or stack trace | `.x-skills/debug/` session + `.x-skills/review/` fix plan with hypotheses | User tests hypotheses |
| 2. Fix | `x-fix` | Fix plan from x-debug or manual creation | Updated source files with all issues resolved | All `[ ]` → `[x]` in plan |

The review directory serves both workflows: `x-review` creates static analysis plans, while `x-debug` exports runtime error hypotheses as fix plans for `x-fix`.

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

### Skill Scripts

- Scripts inside skills use **ES modules** (`import` syntax) even though the project itself is CommonJS.
- Scripts are standalone — they don't import from `lib/install.js` or each other.
- Use `node:child_process` for shell commands (e.g., `git diff`).
- Output JSON to stdout for structured data; errors go to stderr with `process.exit(1)`.

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
