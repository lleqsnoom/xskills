---
name: x-review
description: Review code against engineering principles — small functions, SOLID, KISS, DRY — with automated AST-based complexity analysis across 10+ languages
version: 2.0.0
author: Community
tags: [code-review, solid, kiss, dry, single-responsibility, cyclomatic-complexity, code-quality]
user-invocable: true
---

# X-Review — Code Review Against Engineering Principles

## Script Location

Scripts live inside the **installed skill directory**, not in your project:

- Global install (`~/.agents/skills/x-review/scripts/<script>`)
- Local install (`.agents/skills/x-review/scripts/<script>`)

Run from any working directory — the path above is absolute or project-local.

**What To Do:** When invoked, immediately execute these three commands in order. Do not ask the user what to do.

1. Run complexity analysis: `node <skill-install-dir>/scripts/analyze-complexity.js --all`
2. Run duplication check: `node <skill-install-dir>/scripts/check-duplication.js --all`
3. Create fix plan file: `node <skill-install-dir>/scripts/save-plan.js --output .x-skills/review/`

Parse the JSON output from steps 1 and 2, apply the four principles (below), then write your review into the fix plan file using the format below.

## Run Analysis

Scripts for analysis live in `<skill-install-dir>/scripts/`. From any working directory:

```bash
node <skill-install-dir>/scripts/analyze-complexity.js --all       # complexity + length per function
node <skill-install-dir>/scripts/check-duplication.js --all        # duplicated blocks (>5 lines)
```

The script auto-installs tree-sitter if missing. Output is JSON — parse it for function metrics and duplication counts.

## Principles Checklist

1. **SRP / Small Functions** (highest priority) — Flag functions that are >20 lines, have >3 params, nest deeper than 2 levels, or whose name describes multiple actions (e.g., `processAndSendEmail`).
2. **SOLID** — Flag classes with >10 methods, inheritance chains >3 levels deep, or concrete class imports where an interface would work better.
3. **KISS** — Flag unnecessary abstractions (interfaces for one implementation), magic numbers without constants, or conditional logic that should be a lookup table.
4. **DRY** — Flag duplicated behavior (>5 identical lines), copy-pasted error handling, repeated config patterns. DRY targets duplicated *behavior*, not data.

## Severity

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Violates SRP or introduces bug risk | Must fix before merge |
| MAJOR | Clear SOLID/KISS/DRY violation | Should fix |
| MINOR | Style or minor optimization | Nice to have |

## Output Format

Produce a review and save it under `/.x-skills/review/`. Use the script to create the directory, detect branch from git, generate timestamp, sanitize filename, and write an empty plan file:

```bash
node <skill-install-dir>/scripts/save-plan.js --output .x-skills/review/
```

The script prints the full path (e.g. `.x-skills/review/2026-07-04T1430_main.md`). Write your review content into that file using this format:

```markdown
# Code Review — Fix Plan

**Date:** YYYY-MM-DDTHH:MM
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
