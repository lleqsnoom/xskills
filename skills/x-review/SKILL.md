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
   - Single file: `node <path-to>/analyze-complexity.js src/lib/media-library/proxy.ts`
   - Directory: `node <path-to>/analyze-complexity.js src/lib/`
   - Full project (no scope specified): `node <path-to>/analyze-complexity.js --all`

2. **Run duplication check** — same scope logic as above:
   - Single file / directory → pass the path directly
   - Full project → `node <path-to>/check-duplication.js --all`

3. **Create fix plan file**: `node <path-to>/save-plan.js --output .x-skills/review/`

The complexity script auto-installs tree-sitter if missing (global install). Output is JSON — parse it for function metrics and duplication counts.

For engineering principles definitions and violation patterns, see `references/principles.md`.

## Related Skills

- **x-refactor** — Focused on automated refactoring suggestions (extract method, rename, polymorphism) without a fix plan workflow. Use when you want analysis only, not an iterative fix process.
- **x-fix** — Consumes the fix plan output by this skill and resolves issues one-by-one with targeted edits + test verification.

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
