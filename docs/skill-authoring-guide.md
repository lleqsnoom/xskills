# Skill Authoring Guide

This guide covers everything needed to create, test, and publish an Agent Skill for xskills.

---

## What is a Skill?

A skill is a folder containing:

```
my-skill/
├── SKILL.md          # Required: YAML frontmatter + Markdown instructions
├── scripts/          # Optional: executable Node.js/Bash scripts
├── references/       # Optional: docs, type maps, examples
└── assets/           # Optional: configs, templates, reusable files
```

Skills follow the [Agent Skills open standard](https://agentskills.io) and work with 45+ AI coding CLIs.

---

## SKILL.md Conventions

Every skill **must** have a `SKILL.md` file with YAML frontmatter followed by Markdown instructions.

### Frontmatter Structure

```yaml
---
name: my-skill
description: What it does and when to use it (one sentence, used in skill lists).
version: 1.0.0
author: Your Name or Community
tags: [tag1, tag2, tag3]
user-invocable: true
---
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique skill identifier (kebab-case). Must match the folder name. |
| `description` | Yes | One-line summary of what the skill does and when to use it. Extracted by `listSkills()`. |
| `version` | No | Semantic version (e.g., `1.0.0`). Increment on changes. |
| `author` | No | Author name or "Community". Defaults to "Community". |
| `tags` | No | Array of lowercase tags for search/discovery. Use comma-separated in YAML array syntax. |
| `user-invocable` | Yes | Set to `true` if users can invoke this skill directly (vs. framework-internal skills). |

### Frontmatter Constraints

The frontmatter parser is regex-based — keep it simple:
- Only top-level scalar fields are supported
- No nested objects or arrays of objects
- Multi-line values should use YAML block scalars (`|` or `>`)
- Tags must be a flat list: `[tag1, tag2]`

### Auto-Trigger (Optional)

Skills can declare conditions for automatic activation based on file patterns:

```yaml
---
name: x-review
auto-trigger:
  on-file-pattern: "*.ts,*.tsx,*.js,*.jsx"
  not-when:
    - path-matches: "node_modules/**"
    - file-size-above: 1048576  # Skip files > 1MB
---
```

**Supported trigger types:**
- `on-file-pattern`: Glob patterns for file extensions (e.g., `"*.ts,*.py"`)
- `not-when.path-matches`: Exclude when paths match glob patterns
- `not-when.file-size-above`: Skip files larger than N bytes
- `not-when.has-skill`: Skip when another skill is already active

---

## Script Structure

Scripts inside skills are standalone Node.js programs. They self-resolve their working directory via `__dirname`.

### File Naming

```
scripts/
├── analyze.js           # Main script (CommonJS with .js extension)
├── commit.mjs           # ES module scripts use .mjs extension
└── utils/
    └── helpers.cjs      # CommonJS explicit (.cjs) for clarity
```

**Note:** Scripts use `.js` or `.mjs` extensions. The Node shebang `#!/usr/bin/env node` handles execution without needing special flags in Node 18+.

### Self-Resolution Pattern

All scripts resolve paths relative to their own location, not the user's CWD:

```javascript
// Always resolve via __dirname — works whether installed globally or locally
const path = require("path");
const skillDir = path.dirname(__filename); // e.g., ~/.agents/skills/x-review/scripts/
const referencesDir = path.join(skillDir, "../references/");
```

### Input/Output Conventions

- **Input**: Command-line arguments (`process.argv`), environment variables, or stdin
- **Success output**: JSON to stdout for structured data; plain text for human-readable results
- **Errors**: Write to stderr with `console.error()`, exit with code 1

```javascript
// Good: structured output
console.log(JSON.stringify({ functions: [...], total: count }));

// Bad: mixed console.log and error handling without structure
console.log("Found issues"); // What does this mean? How do I parse it?
```

### Script Example

```javascript
#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");

async function main() {
  const target = process.argv[2] || ".";
  const resolved = path.resolve(target);
  
  // ... analysis logic ...
  
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
```

---

## Directory Organization

Follow these principles when adding scripts to a skill:

1. **One concern per script** — a single script does one thing well (analyze, validate, save)
2. **Utility modules in `utils/` subdirectory** for shared helpers used by multiple scripts
3. **Scripts are standalone** — they don't import from other skill scripts or from `lib/install.js`
4. **References go in `references/`** — documentation and data files that scripts read at runtime

---

## Testing Your Skill

### List Verification

After creating a skill, verify it's discoverable:

```bash
# From the xskills project root
node bin/install.js list
```

Your new skill should appear with its description from SKILL.md frontmatter.

### Install Test

```bash
# Install locally into a test project
cd /tmp/test-project
npx xskills install my-skill

# Verify installation
ls .agents/skills/my-skill/
cat .agents/skills/my-skill/SKILL.md
```

### Script Execution Test

```bash
# Run from any directory — scripts self-resolve via __dirname
node /tmp/test-project/.agents/skills/my-skill/scripts/main.js --help
```

---

## Publishing a New Skill

1. **Create the skill folder** in `skills/<name>/` within this repository
2. **Write SKILL.md** with proper frontmatter and instructions
3. **Add scripts/references/assets** as needed
4. **Verify discovery**: Run `node bin/install.js list` — your skill must appear
5. **Test installation**: Install locally and run scripts from the installed location
6. **Update package.json** if adding new dependencies (xskills has zero runtime deps)

### Publishing to npm

The `files` field in `package.json` controls what's included:

```json
{
  "files": ["bin/", "lib/", "skills/"]
}
```

This ensures only the necessary directories are published — no test files, no `.crush/`.

---

## Common Patterns Across xskills

### Shared Script Pattern

Many skills follow this invocation pattern:

```bash
node <skill-dir>/scripts/<action>.js [--flag value] [target-path]
```

Examples from existing skills:

| Skill | Command | Purpose |
|-------|---------|---------|
| `x-review` | `analyze-complexity.js --all` | Full project complexity analysis |
| `x-commit` | `commit.mjs "fix: resolve crash"` | Validate and commit in one step |
| `x-plan` | `save-spec.js --topic auth` | Generate design spec file |
| `x-epic` | `save-epic.js --epic auth-flow` | Convert spec to epic |

### Output Location Convention

Skills that generate artifacts write them into **one folder per run**:

```
.x-skills/runs/2026-09-15-2130-R03-my-topic/
├── state.json                       # scenario state, when the skill keeps one
├── memory.md                        # event log, when the skill keeps one
├── E00-plan.md                      # design spec
├── E01-epic.md                      # epic definition
├── E02-tasks/                       # task breakdown (a directory)
├── E03-review-plan.md               # code review plan
└── E04-reflection.md                # session retrospective
```

- The stamp is `YYYY-MM-DD-hhmm`: leading zeros, no colon, so a plain name sort runs
  oldest to newest on every OS. A colon is reserved on Windows, so it cannot appear in
  a file name at all.
- `E<nn>` numbers artifacts in execution order, so a folder listing is the run's story.
- `R<nn>` identifies the run. Only the first skill of a run mints it; every later skill
  writes into the folder holding the artifact it read.
- Both counters are exactly two digits. A run that would need `R100` or `E100` fails
  loudly rather than widening the name, because `E100` would sort before `E99`.
- The helpers implementing this are duplicated across the skills that need them (skills
  cannot import from each other) and generated from one source. Edit
  `scripts/sync-run-folders.js` and run `npm run sync:run-folders`; never edit a
  `// #region run-folder` block by hand.

---

## Checklist for New Skills

Before submitting a new skill:

- [ ] SKILL.md has valid YAML frontmatter with required fields (`name`, `description`, `version`, `tags`, `user-invocable`)
- [ ] Script(s) self-resolve via `__dirname` and work when installed globally or locally
- [ ] Scripts exit 0 on success, non-zero on failure
- [ ] Errors go to stderr, structured data goes to stdout as JSON
- [ ] Skill appears in `node bin/install.js list` output
- [ ] Installed skill can be executed from any directory
- [ ] No external dependencies beyond Node.js built-ins (unless documented in package.json devDependencies)
