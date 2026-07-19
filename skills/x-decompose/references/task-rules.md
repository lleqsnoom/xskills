# Task Decomposition Rules Reference

## Core Rules

- **One user story = one task = one file.** Never split a user story across multiple task files.
- **Self-contained.** No file path references, no task IDs (T1, T2...), no "see other task," no "handled by US3." A developer reads one file and knows exactly to build.
- **No exact code.** No step-by-step implementation instructions. Describe *what* to verify, not *how* to write it.
- **Effort gate enforced.** Every task must be ≤8 hours of human work. If a user story exceeds 8h, return to `x-epic` to split it into smaller user stories.
- **DOD mandatory.** Every task needs at least one automated check (test/lint/typecheck). When none is possible, state explicit manual steps + expected result.
- **Test plan required.** Happy path + all error paths listed. No exceptions.
- **Context section mandatory.** Inline all config, formulas, data shapes, business rules, and module API details. This section is what makes the file self-contained.
- **Each task leaves the repo green.** If a task can't leave it green on its own, the user story is too large — return to `x-epic`.

## Size Gates (enforced before approval)

| Gate | Rule | Action if failed |
|------|------|-----------------|
| **Effort** | Task >8h estimated | Return to `x-epic` — split the user story into smaller stories |
| **Components** | Task touches 3+ unrelated new components (not a cohesive unit) | Return to `x-epic` — split by component boundary |
| **Self-contained** | Task references another file, task ID, or "see X" | Inline the missing context into this file |
| **Synthetic data only** | Test plan relies solely on mock/synthetic data with no real-data acceptance criterion | Add a production-data verification step |

## What NOT to put in a task file

- References to other task files or task IDs (T1, US3, etc.)
- Epic or spec file path links — inline the relevant content instead
- "Depends on T2" or "handled by T1" — use Preconditions with concrete state descriptions
- Background or architecture rationale (epic's job — inline only task-relevant facts)
- Step-by-step implementation instructions
- CI commands or build pipeline details
