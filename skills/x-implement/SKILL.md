---
name: x-implement
description: Implement or fix with TDD — failing test first, red-green-refactor cycle, doc sync after each task, gate on plan completion
version: 1.0.0
author: Community
tags: [tdd, implementation, test-driven, red-green-refactor, production-code]
user-invocable: true
---

# X-Implement — Test-Driven Implementation
**No production code without a failing test first.** Wrote code before the test? Delete it. Rewrite from the test. Exception — ask user first: prototypes, generated code, throwaway scripts.

## Artifact Location

```bash
node <path-to-save-plan.js> --epic <slug>
```
The script creates the staging directory. Read all `.md` files inside it — one file per user story.

## Directory Organization
Assign each responsibility to its own directory (models/, services/, controllers/, utils/, tests/). One file per concern, imports flow top-down, never cycle. See `references/dir-organization.md` for full guidance.

## Workflow

For each task file in `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/`:

1. **RED** — Write the minimal failing test for the task's acceptance criterion. It must fail for the *right reason*.
2. **GREEN** — Write the minimum implementation to pass that test. Nothing more.
3. **REFACTOR** — Evaluate against SOLID/clean code. State what you assessed and what (if anything) improved — or why no changes were needed.
4. **SYNC DOCS** — Update spec (`.x-skills/design/*.md`) if it exists; otherwise update living docs (README, comments) directly.
5. **COMMIT** — Run `node <path-to-commit.mjs> "<message>"` from the x-commit skill for every single commit. This is mandatory and non-negotiable. Never run `git commit` manually. If x-commit exits with an error, stop and ask the user for a corrected message — do not bypass it.
6. **UPDATE PLAN** — Change `- [ ]` to `- [x]` for this task. Do not start the next task without this edit.

All tasks `- [x]` and green → `ship`.

## Gate

Before committing: evaluate the implementation against SOLID principles, design patterns, and clean code. State what you assessed and what (if anything) you improved — or why no changes were needed.

## Anti-Patterns
See `references/tdd-rules.md` for full list of anti-patterns.