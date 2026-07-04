# AGENTS.md — xskills

## Project Overview

`xskills` is an npm package that installs [Agent Skills](https://agentskills.io) into projects or globally. Skills are folders containing a `SKILL.md` (YAML frontmatter + Markdown) plus optional `scripts/`, `references/`, and `assets/` subdirectories. They follow the Agent Skills open standard and work with 45+ AI coding CLIs.

The package has **zero dependencies** — it uses only Node.js built-ins (`fs/promises`, `path`, `os`, `child_process`).

---

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Runs `node bin/install.js list` (lists available skills) |
| `node bin/install.js list` | Lists all available skills with descriptions |
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
    └── x-review/             # Code review against engineering principles
        ├── SKILL.md
        ├── scripts/
        ├── references/
        └── assets/
```

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

7. **No test framework** — the only "test" is `npm test` which just lists skills. There are no unit tests for the install logic.

---

## Adding a New Skill

1. Create `skills/<name>/SKILL.md` with proper YAML frontmatter.
2. Optionally add `scripts/`, `references/`, `assets/` directories.
3. Update the README's Available Skills table.
4. Run `npm test` to verify the skill appears in the list.

## Publishing

The package is published via npm. The `files` field in `package.json` ensures only `bin/`, `lib/`, and `skills/` are included (no test files, no `.crush/`).
