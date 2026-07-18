---
name: x-review
description: Review code against engineering principles — small functions, SOLID, KISS, DRY — with automated AST-based complexity analysis across 10+ languages
version: 2.0.0
author: Community
tags: [code-review, solid, kiss, dry, single-responsibility, cyclomatic-complexity, code-quality]
user-invocable: true
auto-trigger:
  on-file-pattern: "*.ts,*.tsx,*.js,*.jsx,*.py,*.go,*.java,*.rb,*.rs"
  not-when:
    - path-matches: "node_modules/**"
    - file-size-above: 5242880  # Skip files > 5MB
---

# X-Review — Code Review Against Engineering Principles

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory by passing the full path:

```bash
# Run from anywhere (use whichever script path is available):
node <path-to>/analyze-complexity.js --all       # complexity + length per function
node <path-to>/check-duplication.js --all        # duplicated blocks (>5 lines)
node <path-to>/save-plan.js --output .x-skills/review/   # create plan file
```

**Auto-discovery**: Scripts resolve config and sibling scripts relative to `__dirname`, so they work whether installed globally (`~/.agents/skills/x-review/scripts/`) or locally (`.agents/skills/<project>/x-review/scripts/`).

**What To Do:** When invoked, determine the user's scope (single file, directory, or full project) and execute these commands. Do not ask the user what to do.

1. **Run complexity analysis** — pass specific files/dirs when given, otherwise `--all`:
   - Single file: `node <path-to>/analyze-complexity.js synetic-studio-webapp/src/lib/media-library/media-library-proxy.ts`
   - Directory: `node <path-to>/analyze-complexity.js synetic-studio-webapp/src/lib/`
   - Full project (no scope specified): `node <path-to>/analyze-complexity.js --all`

2. **Run duplication check** — same scope logic as above:
   - Single file / directory → pass the path directly
   - Full project → `node <path-to>/check-duplication.js --all`

3. **Create fix plan file**: `node <path-to>/save-plan.js --output .x-skills/review/`

The complexity script auto-installs tree-sitter if missing (global install). Output is JSON — parse it for function metrics and duplication counts.

## Principles Checklist

1. **SRP / Small Functions** (highest priority) — Flag functions that are >20 lines, have >3 params, nest deeper than 2 levels, or whose name describes multiple actions (e.g., `processAndSendEmail`).
2. **SOLID** — Flag classes with >10 methods, inheritance chains >3 levels deep, or concrete class imports where an interface would work better.
3. **KISS** — Flag unnecessary abstractions (interfaces for one implementation), magic numbers without constants, or conditional logic that should be a lookup table.
4. **DRY** — Flag duplicated behavior (>5 identical lines), copy-pasted error handling, repeated config patterns. DRY targets duplicated *behavior*, not data.

## Organization Principles

Code must be split across directories by concern, never dumped into a single flat directory. When writing the fix plan or reviewing proposed changes:

- **Identify concerns**: What responsibilities exist? (data models, business logic, I/O, API routes, utilities)
- **Map to directories**: Each responsibility gets its own folder (`models/`, `services/`, `controllers/`, `utils/`, etc.)
- **Flag flat structures** as CRITICAL or MAJOR issues — a class file that contains model logic, service logic, and HTTP handling in one place violates SRP at the directory level.
- **Suggest reorganization**: When reviewing existing code, explicitly call out which files/directories should be created or split to separate concerns.

## Severity

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Violates SRP or introduces bug risk | Must fix before merge |
| MAJOR | Clear SOLID/KISS/DRY violation | Should fix |
| MINOR | Style or minor optimization | Nice to have |

## Output Format

Produce a review and save it under `.x-skills/review/`. Use `save-plan.js` to create the directory and generate a timestamped plan file:

```bash
node <path-to>/save-plan.js --output .x-skills/review/
```

The script prints the full path. Write your review content into that file using this format:

```markdown
# Code Review — Fix Plan

**Date:** DD-MM-YYYY-hh:mm
**Files analyzed:** N
**Functions with complexity > 5:** N
**Functions longer than 20 lines:** N
**Duplicated blocks found:** N

---

## [PRINCIPLE] — Brief description

- [ ] **Severity:** CRITICAL / MAJOR / MINOR
  - **File:** `path/to/file.js:42`
  - **Issue:** What's wrong (one sentence)
  - **Suggestion:** How to fix it (concrete, actionable)

---

## Summary

**Total issues:** N (**critical:** N, **major:** N, **minor:** N)
**Status:** 0/N resolved | Run `x-fix` to start resolving.
```

Toggle checkboxes `[ ]` → `[x]` as each issue is resolved by x-fix.
