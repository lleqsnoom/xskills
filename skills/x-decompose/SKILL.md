---
name: x-decompose
description: Decompose approved epic into layer-based tasks — each task is an independent, testable increment that builds on the previous; outputs .x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/ for handoff to x-implement
version: 2.0.0
author: Community
tags: [decompose, tasks, layers, definition-of-done, DOD, test-plan, atomic, estimation, self-contained, incremental]
user-invocable: true
---

# X-Decompose — Layer-Based Task Decomposition

One task file per sub-step, organized by layer. Each task is a self-contained, testable increment that builds on the previous one. Follow pipeline order from `.agents/rules/xskills.md`.

## Decomposition Rule

Tasks are not components. A task is one step within a layer, and each layer is a complete, runnable increment.

```
Layer 0 (Skeleton)     → Task 0.1: project setup + basic flow with mock
                         → Task 0.2: add test that verifies end-to-end flow
Layer 1 (Real Logic)   → Task 1.1: implement real processing function
                         → Task 1.2: wire real function into flow, verify regression
Layer 2 (Resilience)   → Task 2.1: add error handling + logging
Layer 3 (Polish)       → Task 3.1: add monitoring + documentation
```

**Key rule:** After any task completes, the system must be in a working state. You should never have "Task 1 done but nothing runs yet."

## Workflow

1. **Create staging directory** — run the script: `node <path-to-save-tasks.js> --epic <slug>`
2. **Read the epic** — path: `.x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md`. Extract every layer with its scope and DOD.
3. **Decompose each layer into tasks** — See Task Format below. Each layer becomes 1-3 task files.
4. **Gate** — confirm task list with user before handing off to implementation.

## Task Format

```markdown
# Task: <descriptive name — what this task accomplishes>
**Layer:** <N> — <layer name from epic>
**Effort:** <hours, e.g. "2h">
**Files:** src/<module>/<file>.js (new), tests/<module>.test.<ext> (mod)
## Goal
<1-2 sentences on what this task makes work that didn't work before>
## Context
<All config, formulas, data shapes, business rules, APIs. Inline everything — never point to another file.>
## Definition of Done
- [ ] <automated check>: `<command>`
## Test Plan
### Happy Path
- Given <condition> → expect <result>
### Error Paths
- Given <condition> → expect <error response>
## Preconditions
<Concrete codebase state required before starting. Describe the state, not task dependencies within the layer.>
```

### Task Design Rules

1. **Each task = one verifiable change** — After this task, something works that didn't before (or something that was broken now works). Not "created file X" but "file X works and is tested."
2. **Tasks within a layer are small steps** — A layer might be 1 task (simple change) or 3 tasks (complex change broken into steps). But the layer as a whole is the increment.
3. **First task of L0 = working prototype** — This is the most important task. It creates a project skeleton where data flows end-to-end with mocks, and a test proves it works. If this task isn't concrete enough, the epic needs more clarity.
4. **Regression is a DOD item for L1+** — Every task in L1+ must verify that previous layer tests still pass. This is non-negotiable.
5. **No cross-references between task files** — Each file is self-contained. If Task 1.2 needs context from Task 1.1, inline it. The implementer reads one file and has everything they need.
6. **Effort ≤ 4 hours per task** — If a task exceeds 4 hours, split it. Long tasks hide complexity and make it harder to verify progress.

### How Many Tasks Per Layer?

| Layer complexity | Tasks | Example |
|-----------------|-------|---------|
| Simple (1 concept) | 1 task | "Add input validation" = one function + one test |
| Medium (2-3 concepts) | 2 tasks | "Real processing" = implement function + wire into flow |
| Complex (many concepts) | 3 tasks | "Error handling" = error types + retry logic + logging |
| Very complex | Split across layers | If a layer needs 4+ tasks, some belong in the next layer |

**Rule:** if a layer needs more than 3 tasks, move the extra tasks to the next layer.

### Layer-to-Task Examples

#### Web Page Project
```
Layer 0 — Skeleton (2 tasks):
  Task 0.1: Project setup + basic HTML shell with placeholder content
  Task 0.2: Add test that page renders without errors

Layer 1 — Real Components (2 tasks):
  Task 1.1: Implement header component with real nav links
  Task 1.2: Implement main content area with real data

Layer 2 — Interactivity (2 tasks):
  Task 2.1: Add form handling with client-side validation
  Task 2.2: Add test for form submit flow

Layer 3 — Polish (1 task):
  Task 3.1: Styling, responsive design, accessibility audit
```

#### Data Pipeline (SQS + Lambda)
```
Layer 0 — Skeleton (2 tasks):
  Task 0.1: Create project + basic sender that pushes to mock queue
  Task 0.2: Add Lambda stub that returns fixed response + integration test

Layer 1 — Real Processing (2 tasks):
  Task 1.1: Implement image resize logic in Lambda
  Task 1.2: Wire real processor, verify end-to-end with test image

Layer 2 — Resilience (2 tasks):
  Task 2.1: Add error handling + dead letter queue for failed messages
  Task 2.2: Add retry logic with exponential backoff

Layer 3 — Observability (1 task):
  Task 3.1: Add CloudWatch metrics + structured logging
```

## Handoff Flow

Confirm `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/` exists with task files organized by layer before handing off to implementation. x-implement reads these files and executes tasks in order: L0 first, then L1, etc.
