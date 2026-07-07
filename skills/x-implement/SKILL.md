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

## Workflow

For each task in `.x-skills/plans/YYYY-MM-DD-<topic>.md`:

1. **RED** — Write the minimal failing test for the task's acceptance criterion. It must fail for the *right reason*.
2. **GREEN** — Write the minimum implementation to pass that test. Nothing more.
3. **REFACTOR** — Evaluate against SOLID/clean code. State what you assessed and what (if anything) improved — or why no changes were needed.
4. **SYNC DOCS** — Update spec (`.x-skills/design/*.md`) if it exists; otherwise update living docs (README, comments) directly.
5. **COMMIT** — Use `x-commit` for the message.
6. **UPDATE PLAN** — Change `- [ ]` to `- [x]` for this task. Do not start the next task without this edit.

All tasks `- [x]` and green → `ship`.

## Gate

`<gate>` Before committing: evaluate the implementation against SOLID principles, design patterns, and clean code. State what you assessed and what (if anything) you improved — or why no changes were needed. `</gate>`

## Don't

- Test passes without the impl (tests nothing).
- Mock the unit under test (tests the mock).
- Assert many behaviors in one test (split).
- Skip "watch it fail" — if the test doesn't fail, you don't know what it tests.
- Edit the test to match buggy code (tests the bug).
- Add abstractions not required by the current test (GREEN phase — not refactor).
- Edit files outside the failing test's scope.
- Create ad-hoc summary, notes, or analysis files not defined in the plan or required by a loaded skill.
