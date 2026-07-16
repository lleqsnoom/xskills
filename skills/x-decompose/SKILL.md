---
name: x-decompose
description: Decompose approved epic into atomic tasks — one self-contained file per user story, each ≤8 hours with inlined context, DOD, and test plan; no cross-references
version: 2.0.0
author: Community
tags: [decompose, tasks, definition-of-done, DOD, test-plan, atomic, estimation, self-contained]
user-invocable: true
---

# X-Decompose — Atomic Task Decomposition with DOD

One file per user story. One task per file. Each file is fully self-contained — a developer must understand the entire task by reading that one file alone.

If unresolved epic notes affect task ordering or scope, return to `x-epic`.

## Artifact Location

Invoke the script from any directory — it self-resolves via `__dirname`. Output: `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/` directory (relative to CWD):

```bash
node <path-to-save-tasks.js> --epic <slug>
```

The script creates the staging directory. You then write one task file per user story inside it.

## Workflow

1. **Create staging directory** — Run the script (see Artifact Location above).

Output: `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/` (relative to CWD).

2. **Read the epic** — Derive the epic file path from the topic slug: `.x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md`. Open it and extract every user story with its acceptance criteria.

3. **Write one task file per user story** — For each user story, create a separate `.md` file inside the staging directory. Each file is a complete, standalone task document (see Task Format). Inline all context — no references to other task files, no task IDs, no epic path links.

4. **Gate** — Confirm task list with user before handing off to implementation.

## Task File Naming

```
US<n>-<short-descriptive-slug>.md
```

Examples: `US1-calculate-base-price.md`, `US2-apply-volume-discounts.md`

## Task Format

Each file is a full markdown document:

```markdown
# Task: <descriptive name>

**Effort:** <estimated hours, e.g. "3h">
**Files:** src/<module>/<file>.js (new), tests/<module>.test.<ext> (mod)

## User Story

As a **<role>**, I want **<capability>** so that **<value>**.

**Acceptance criteria:**
- <criterion 1>
- <criterion 2>

## Goal

<What this task accomplishes, 1-2 sentences>

## Context

<Everything a developer needs to complete this task: config fields, formulas,
data shapes, business rules, module APIs, constraints. Written as descriptive
prose. Inline all relevant details from the epic and spec here — never point
to another file.>

## Definition of Done

- [ ] <automated check passes>: `<command>`

## Test Plan

### Happy Path
- Given <condition> → expect <result>

### Error Paths
- Given <condition> → expect <error response>

## Preconditions

<Concrete codebase state required before starting this task. Describe the
state, not task dependencies. E.g., "The pricing module exports calculateBase()
that accepts (qty, unitPrice) and returns a number.">
```

**Rules:**

- **One user story = one task = one file.** Never split a user story across multiple task files.
- **Self-contained.** No file path references, no task IDs (T1, T2...), no "see other task," no "handled by US3." A developer reads one file and knows exactly what to build.
- **No exact code.** No step-by-step implementation instructions. Describe *what* to verify, not *how* to write it.
- **Effort gate enforced.** Every task must be ≤8 hours of human work. If a user story exceeds 8h, return to `x-epic` to split it into smaller user stories.
- **DOD mandatory.** Every task needs at least one automated check (test/lint/typecheck). When none is possible, state explicit manual steps + expected result.
- **Test plan required.** Happy path + all error paths listed. No exceptions.
- **Context section mandatory.** Inline all config, formulas, data shapes, business rules, and module API details. This section is what makes the file self-contained.
- **Each task leaves the repo green.** If a task can't leave it green on its own, the user story is too large — return to `x-epic`.

## Size Gates (enforced before approval)

Apply these checks to every proposed task. A task that fails any gate must be addressed:

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

## Hand off

The task directory `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/` must exist on disk with one `.md` file per user story before handing off to implementation. Confirm task list with the user.

## Verification Checklist

Before declaring decomposition complete, confirm:

1. Task directory exists at `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/`
2. One file per user story — no more, no less
3. Every file is self-contained (no references to other files or task IDs)
4. Every file has a Context section with all details a developer needs
5. Every file has an effort estimate ≤8h
6. Every file has DOD with at least one verifiable check
7. Every file has a test plan covering happy path and error paths
