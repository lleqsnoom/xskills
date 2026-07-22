---
name: x-refactor
description: Automated refactoring suggestions (extract method, rename, replace conditional) — analyzes code against SOLID principles and outputs actionable before/after comparisons
version: 1.0.0
author: Community
tags: [refactor, solid, extract-method, rename-variable, replace-conditional, polymorphism]
user-invocable: true
---

# X-Refactor — Automated Refactoring Analyzer

Analyzes source code and suggests specific refactorings based on SOLID principles, complexity metrics, and naming conventions. Outputs actionable suggestions with before/after comparisons.

## Related Skills

- **x-review** — Comprehensive code review that analyzes complexity, duplication, and engineering principles. Use `x-review` first to generate metrics, then use this skill for specific refactoring suggestions.
- This skill (`x-refactor`) is analysis-only — it outputs JSON/markdown suggestions but does not apply changes automatically.

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory:

```bash
# Analyze single file or directory for refactoring opportunities
node <path-to>/scripts/analyze.js <file-or-dir> [--thresholds 20,5,3]

# Output structured JSON to stdout
# Exit code 0 = analysis complete (may find issues)
# Exit code 1 = fatal error (file not found, parse failure)
```

**Auto-discovery**: Scripts resolve config and sibling scripts relative to `__dirname`, so they work whether installed globally (`~/.agents/skills/x-refactor/scripts/`) or locally (`.agents/skills/<project>/x-refactor/scripts/`).

## Refactoring Patterns Detected

### 1. Extract Method
Functions >20 lines doing 2+ distinct operations. Signal: compound verb names like `loadAndValidate`, `processAndSendEmail`.

### 2. Rename Variable
Single-letter names (`x`, `i`, `tmp`) or Hungarian notation (`strName`, `nCount`).

### 3. Replace Conditional with Polymorphism
Long if/else chains on type checks — signal: 4+ branches checking same variable.

### 4. Inline Method
Trivial single-line methods called from exactly one location.

## Definition of Done

- [ ] SKILL.md exists with YAML frontmatter and description
- [ ] `scripts/analyzer.js` detects all four refactoring patterns
- [ ] Outputs structured suggestions in JSON format (stdout) and human-readable markdown (stderr for review)
- [ ] Passes `node bin/install.js list` as valid skill
