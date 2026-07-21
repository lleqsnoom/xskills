---
name: x-review
description: Review code against engineering principles — small functions, SOLID, KISS, DRY — with automated AST-based complexity analysis across 30+ languages including Python, C, C++, Java, JavaScript, TypeScript, Go, Rust, Ruby, PHP, Swift, Kotlin, and more
version: 2.0.0
author: Community
tags: [code-review, solid, kiss, dry, single-responsibility, cyclomatic-complexity, code-quality]
user-invocable: true
auto-trigger:
  on-file-pattern: "*.ts,*.tsx,*.js,*.jsx,*.py,*.go,*.java,*.rb,*.rs,*.hx,*.c,*.cpp,*.cs,*.swift,*.kt,*.lua,*.dart,*.scala,*.hs,*.ex,*.erl,*.clj,*.fs,*.zig,*.jl,*.pl,*.r,*.groovy,*.adb"
  not-when:
    - path-matches: "node_modules/**"
    - file-size-above: 5242880  # Skip files > 5MB
---

# X-Review — Code Review Against Engineering Principles

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory by passing the full path:

```bash
# Run from anywhere (use whichever script path is available):
node <path-to>/scripts/analyze-complexity.js --all       # AST-based complexity, length, params per function
node <path-to>/scripts/check-duplication.js --all         # duplicated blocks (>5 lines)
node <path-to>/scripts/save-plan.js --output .x-skills/review/   # create plan file with all analysis results
```

**Auto-discovery**: Scripts resolve config and sibling scripts relative to `__dirname`, so they work whether installed globally (`~/.agents/skills/x-review/scripts/`) or locally (`.agents/skills/<project>/x-review/scripts/`).

**What To Do:** When invoked, determine the user's scope (single file, directory, or full project) and execute these commands. Do not ask the user what to do.

1. **Create plan file with all analyses**: `node <path-to>/scripts/save-plan.js --output .x-skills/review/` — this runs complexity analysis (AST-based via tree-sitter), duplication check, AND refactor pattern detection in one step.
2. The script prints the full path. Open that file with `edit` or `write`, then insert your review content directly into it using the format below.

The complexity script auto-installs tree-sitter if missing (global install). Output is JSON — parse it for function metrics and duplication counts.

For engineering principles definitions and violation patterns, see `references/principles.md`.

**After running the scripts:** The plan file path is printed by `save-plan.js`. Open that file with `view` or `edit`, then write your review content directly into it using the format below. **Do not use MCP resources to read/write plan files — they don't exist.**

## Related Skills

- **x-refactor** — Use after reviewing this plan to get automated refactoring suggestions (extract method, rename variables, replace conditionals). Run `x-refactor` on flagged files for before/after comparisons. Note: `x-refactor` provides analysis only; apply changes manually based on its suggestions.
- **x-debug** — For runtime errors or behavioral issues that require hypothesis-driven investigation rather than static code analysis.

## Severity

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Violates SRP or introduces bug risk | Must fix before merge |
| MAJOR | Clear SOLID/KISS/DRY violation | Should fix |
| MINOR | Style or minor optimization | Nice to have |

## Output Format

Produce a review and save it under `.x-skills/review/`. Use `save-plan.js` to create the directory and generate a timestamped plan file:

```bash
node <path-to>/scripts/save-plan.js --output .x-skills/review/
```

The script prints the full path. Open that file with `edit` or `write`, then insert your review content using this format:

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
**Status:** 0/N resolved | Review issues manually or run `x-refactor <file>` for automated suggestions.
```

Apply fixes manually based on review findings. Track progress by updating checkboxes `[ ]` → `[x]`.

## Next Steps — Which Skill to Use

After saving the plan file, recommend the appropriate next skill based on what was found:

| Review finding | Recommended skill | Why |
|----------------|-------------------|-----|
| Any issues that need fixing (complexity, SOLID violations, duplication) | `x-fix` | Reads your plan and actually edits source files to resolve each issue |
| Structural refactoring suggestions without applying changes | `x-refactor` | Analysis-only — produces before/after comparisons but doesn't edit code |
| Behavioral bugs or runtime errors that need investigation | `x-debug` | Hypothesis-driven debugging — reproduce, isolate root cause, then fix with x-fix |

For most review workflows: **use `x-fix`** to resolve issues from your plan. Use `x-refactor` only when you want suggestions without applying changes.
