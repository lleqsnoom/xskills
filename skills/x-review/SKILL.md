---
name: x-review
description: Review code against engineering principles — small functions, SOLID, KISS, DRY — with automated complexity analysis
version: 1.0.0
author: Community
tags: [code-review, solid, kiss, dry, single-responsibility, cyclomatic-complexity, code-quality]
user-invocable: true
---

# X-Review — Code Review Against Engineering Principles

Review code changes against four core principles with automated metric analysis.

## Workflow

1. Run `scripts/analyze-complexity.js` on the changed files to get metrics.
2. Run `scripts/check-duplication.js` to detect duplicated code blocks.
3. Review the output and apply the four principles (below).
4. Produce a review comment or feedback grouped by principle, with severity levels.

## The Four Principles (in priority order)

### 1. Small Functions — Single Responsibility (HIGHEST PRIORITY)

A function must do **exactly one thing** and should not be possible to split into smaller logical functions without losing meaning.

**Signals of violation:**
- Function longer than 20 lines (hard threshold for review attention)
- More than 3 parameters (suggests multiple responsibilities)
- Contains nested blocks deeper than 2 levels
- Has multiple distinct "steps" that could each be a separate function
- Function name describes more than one action (e.g., `processAndSendEmail`)

**Check with metrics:** Run `analyze-complexity.js` — functions with cyclomatic complexity > 5 or length > 20 lines need refactoring.

### 2. SOLID Principles

| Principle | What to check |
|-----------|--------------|
| **Single Responsibility** | Each class/module has one reason to change |
| **Open/Closed** | Entities open for extension, closed for modification |
| **Liskov Substitution** | Subtypes must be substitutable for base types |
| **Interface Segregation** | No forced dependencies on unused methods |
| **Dependency Inversion** | Depend on abstractions, not concretions |

**Check with metrics:** Look for classes with many methods (> 10), deep inheritance chains (> 3 levels), and concrete class imports instead of interfaces.

### 3. KISS — Keep It Simple, Stupid

Prefer the simplest solution that works. Complexity must be justified.

**Signals of violation:**
- Unnecessary abstraction layers (interfaces for one implementation)
- Over-engineered patterns where a simple function suffices
- Magic numbers or strings without named constants
- Conditional logic that could be a lookup table or strategy pattern
- Comments explaining "why" — the code should explain itself

### 4. DRY — Don't Repeat Yourself

Eliminate duplication of logic, not just text.

**Check with metrics:** Run `check-duplication.js` to find repeated code blocks (> 5 lines identical). Also watch for:
- Same logic in multiple branches
- Copy-pasted error handling
- Repeated configuration patterns

**Note:** DRY does NOT mean eliminate repeated *data* or *structure*. It targets duplicated *behavior*.

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| **CRITICAL** | Violates SRP or introduces a bug risk | Must fix before merge |
| **MAJOR** | Clear SOLID/KISS/DRY violation | Should fix |
| **MINOR** | Style or minor optimization opportunity | Nice to have |

## Output Format

Structure feedback as:

```
## Code Review

### [PRINCIPLE] — Brief description
**Severity:** CRITICAL / MAJOR / MINOR
**File:** `path/to/file.js:42`
**Issue:** What's wrong
**Suggestion:** How to fix it

### Metrics Summary
- Files analyzed: N
- Functions with complexity > 5: N
- Functions longer than 20 lines: N
- Duplicated blocks found: N
```
