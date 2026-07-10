---
name: x-decompose
description: Decompose approved epic into atomic tasks — each ≤8 hours with Definition of Done (DOD), explicit test plan (happy + error paths), effort estimate, and dependency tracking; enforced size gates prevent oversized tasks
version: 1.0.0
author: Community
tags: [decompose, tasks, definition-of-done, DOD, test-plan, atomic, estimation]
user-invocable: true
---

# X-Decompose — Atomic Task Decomposition with DOD

`.x-skills/tasks/YYYY-MM-DD-<epic>.md`. One file per epic. Reference the epic; don't repeat its content.

If unresolved epic notes affect task ordering or scope, return to `x-epic`.

## Artifact Location

Invoke the script from any directory — it self-resolves via `__dirname`. Output: `.x-skills/tasks/YYYY-MM-DD-<epic>.md` (relative to CWD):

```bash
node <path-to-save-tasks.js> --epic <slug>
```

## Workflow

1. **Open staging task file** — Run the script (see Artifact Location above).

Output: `.x-skills/tasks/YYYY-MM-DD-<epic>.md` (relative to CWD).

2. **Read the epic** — Derive the epic file path from the topic slug: `.x-skills/epics/YYYY-MM-DD-<topic>.md`. Open it and extract every user story, acceptance criterion, and scope boundary into atomic tasks. One task per verifiable unit of work.

3. **Decompose** — See Task Format below. Apply size gates and taste tests before writing.

4. **Detect parallelism** — Mark independent tasks with `[parallel]`. Only when shared contracts, state, errors, and acceptance are all closed.

5. **Gate** — Confirm task list with user before handing off to `x-implement`.

## Task Format

```markdown
- [ ] T1: <task name>

  goal:       <what this single task achieves in one sentence>
  epic:       .x-skills/epics/YYYY-MM-DD-<topic>.md#US<n>-<slug>
  files:      src/<module>/<file>.js (new), tests/<module>.test.<ext> (mod)
  effort:     <estimated hours, e.g. "3h">

  DOD:
    - [ ] Automated check passes (test/lint/typecheck as applicable): `<command>`

  Test plan:
    - Given <happy path condition> → expect <expected result>
    - Given <error condition> → expect <expected error response>

  Dependencies: none (or T<n>)

```

**Rules:**

- Every task is a checkbox: `- [ ] T<n>: <name>`. Never a heading. Implementation flips it to `[x]` on completion.
- `T<n>` numbers restart per epic file (T1, T2, ... within one tasks doc).
- **No exact code.** No step-by-step implementation instructions. Describe *what* to verify, not *how* to write it.
- **Effort gate enforced.** Every task must be ≤8 hours of human work. If a proposed task exceeds 8h, split it before showing to the user.
- **DOD mandatory.** Every task needs at least one automated check (test/lint/typecheck). When none is possible, state explicit manual steps + expected result.
- **Test plan required.** Happy path + all error paths listed per task. No exceptions.
- **Each task leaves the repo green.** If a task can't leave it green on its own, split further.

## Size Gates (enforced before approval)

Apply these checks to every proposed task. A task that fails any gate must be split:

| Gate | Rule | Action if failed |
|------|------|-----------------|
| **Effort** | Task >8h estimated | Split into smaller tasks with shared DODs |
| **Components** | Task touches 3+ unrelated new components (not a cohesive unit) | Slice by component boundary |
| **Abstraction first** | Task needs to build an abstraction that other tasks depend on | Make the abstraction its own task, reference it from dependent tasks |
| **Synthetic data only** | Test plan relies solely on mock/synthetic data with no real-data acceptance criterion | Add a production-data verification step or split off the integration work |

## Parallelism

```markdown
[parallel] T3, T4 — independent work: closed contracts, no shared state, no ordering constraint
```

Mark `[parallel]` only when **all** of these are true for the marked tasks:
- Shared interfaces/contracts are fully specified in prior tasks or the epic
- No shared mutable state (files, databases, config) between them
- Error handling in one doesn't affect the other's acceptance

## What NOT to put in the task file

- Background, architecture rationale (epic's job)
- Copy-pasted user stories verbatim — reference them instead
- Step-by-step implementation instructions
- CI commands or build pipeline details

## Hand off

`.x-skills/tasks/YYYY-MM-DD-<epic>.md` must exist on disk before handing off to implementation. Confirm task list with the user.

## Verification Checklist

Before declaring decomposition complete, confirm:

1. Artifact file exists at `.x-skills/tasks/YYYY-MM-DD-<epic>.md`
2. Every task has an effort estimate ≤8h
3. Every task has DOD with at least one verifiable check
4. Every task has a test plan covering happy path and error paths
5. Parallel markers only applied where contracts and state are truly independent
