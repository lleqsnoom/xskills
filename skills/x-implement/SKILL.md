---
name: x-implement
description: Implement or fix with TDD — parallelize independent tasks with x-parallel, apply x-ui for frontend work, red-green-refactor per task, verify with x-review + x-fix, gate on plan completion
version: 1.1.0
author: Community
tags: [tdd, implementation, test-driven, red-green-refactor, production-code, parallel, ui]
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

## Comments

Code must document itself. Comments are a last resort, reserved for what the code cannot express. Follow x-comments rules on every line you write.

- **No trivial comments.** Never restate what the code says (`i++`, `return user`). If the line reads fine alone, it needs no comment.
- **Only the *why*, never the *what*.** A comment earns its place only when the code cannot express the reason: a non-obvious workaround, a CPU-architecture or third-party provider quirk, the source of a magic value, an invariant, or what breaks if changed.
- **Prefer a better name or a smaller function over a comment.** If a block needs a paragraph to explain what it does, extract it into a descriptively named function and delete the paragraph.
- **Strip noise in REFACTOR.** Every refactor pass must remove comments that restate code, not just improve structure.

## Functional Style

Prefer a functional approach for readability. Side effects make code hard to reason about and test; isolate them at the edges.

- **Prefer pure functions.** Compute and return values instead of mutating inputs or external state. Given the same inputs, the same result — no hidden state.
- **Avoid side effects in the middle of logic.** Keep I/O, state mutation, and randomness at the boundaries; keep the core logic pure.
- **Prefer immutable data.** Return new values (`map`, `filter`, `reduce`) instead of mutating arrays or objects in place.
- **Prefer expressions over statements.** Chain transformations and use named intermediate values over loops that accumulate into mutable variables.
- **Pass data explicitly.** Return values rather than writing to shared/global state or relying on closures that hide dependencies.
- **Side effects are only acceptable where unavoidable** (I/O, DB, network) — and must be clearly named and isolated.
- **One responsibility per function; keep orchestrators thin.** Each phase (fetch, validate, probe, decrypt) is a named helper that returns data; the orchestrator only composes them. If a function both does a job and reports on it — a `push` closure appending to a shared `results` array inside every branch — the reporting is entangled with each responsibility; collect the report in exactly one place.
- **One responsibility per class and file too.** A class plays one role — persistence, validation, orchestration — not several. If a class's methods group by role rather than by shared state, split it; keep one file per concern (see Directory Organization).

## Parallelize Independent Tasks

Implement tasks in dependency order. When two or more tasks can run independently, dispatch them to background agents with x-parallel instead of doing them one by one.

1. Read every task file under `.x-skills/tasks/<epic>/`.
2. A task is **independent** when no other pending task modifies the same files and no other task requires its output (check each file's `Preconditions` and `Files:`).
3. Independent tasks run concurrently:
   ```bash
   node <path-to-x-parallel>/scripts/parallel.mjs --tasks .x-skills/tasks/<epic> --parallel 4
   ```
   x-parallel gives each task an isolated worktree and a full background agent, retries failures, and merges committed results back into your branch.
4. Tasks that depend on one another stay in the inline TDD loop below, in dependency order.
5. After an x-parallel batch merges, run the full test suite, then VERIFY (step 4) on the merged changes before updating the plan.

## Frontend Work Uses X-UI

When a task's scope includes UI (HTML/CSS, templates, components, or styles in any framework), apply the x-ui skill to everything you produce:

1. Read `skills/x-ui/SKILL.md` before writing any UI code.
2. Follow x-ui's method: state the screen's primary task, then build to its strict rules (element count limits, component selection, row actions, status display, pagination rules).
3. Run x-ui's Pre-Flight Checklist before VERIFY. A screen that fails any checklist item is not done.

## Workflow

For each task file in `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/`:

1. **RED** — Write the minimal failing test for the task's acceptance criterion. It must fail for the *right reason*.
2. **GREEN** — Write the minimum implementation to pass that test. Nothing more.
3. **REFACTOR** — Evaluate against SOLID/clean code, the comment rules, and the functional style above. Strip comments that restate code; extract explained blocks into named functions; push side effects to the edges and prefer pure, immutable functions. State what you assessed and what (if anything) improved — or why no changes were needed.
   - **One-sentence test:** every function you wrote must be describable in one sentence; if not, split it.
   - **Reporting test:** if deleting a phase's `push`/output call leaves the phase unusable, the phase was never a unit. Delegate each phase to a named helper that returns data and let the orchestrator collect the report in one place.
4. **VERIFY — x-review + x-fix + test.** Run on every finished task before committing:
   - **Test** — run the task's tests and the full regression suite. All must pass.
   - **x-review** — run the review skill on the changed files. It produces a fix plan under `.x-skills/review/`.
   - **x-fix** — resolve every issue in the fix plan. Re-run tests after each fix.
   - Repeat x-review + x-fix until the plan has no unresolved issues and all tests are green.
5. **SYNC DOCS** — Update spec (`.x-skills/plan/*.md`) if it exists; otherwise update living docs (README, comments) directly.
6. **COMMIT** — Run `node <path-to-commit.mjs> "<message>"` from the x-commit skill for every single commit. This is mandatory and non-negotiable. Never run `git commit` manually. If x-commit exits with an error, stop and ask the user for a corrected message — do not bypass it.
7. **UPDATE PLAN** — Change `- [ ]` to `- [x]` for this task. Do not start the next task without this edit.

All tasks `- [x]` and green → `ship`.

## Gate

Before committing: evaluate the implementation against SOLID principles, design patterns, clean code, and the functional style above (pure functions, immutability, side effects at the edges). State what you assessed and what (if anything) you improved — or why no changes were needed.

## Anti-Patterns
See `references/tdd-rules.md` for full list of anti-patterns. Comment noise (restating code, obvious comments, paragraphs that should be a function) is an anti-pattern too — see the Comments section. Scattered side effects and in-place mutation are anti-patterns as well — see the Functional Style section.