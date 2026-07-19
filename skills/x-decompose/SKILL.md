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

Invoke the script from any directory — it self-resolves via `__dirname`:

```bash
node <path-to-save-tasks.js> --epic <slug>
```

Output: `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/` (relative to CWD). Write one task file per user story inside.

## Workflow

1. **Create staging directory** — run the script above.
2. **Read the epic** — path: `.x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md`. Extract every user story with acceptance criteria.
3. **Write one task file per user story** — each file is a complete, standalone document (see Task Format). Inline all context.
4. **Gate** — confirm task list with user before handing off to implementation.

## Task File Naming

```
US<n>-<short-descriptive-slug>.md
```

Examples: `US1-calculate-base-price.md`, `US2-apply-volume-discounts.md`

## Task Format

Each file is a full markdown document with these sections in order:

```markdown
# Task: <descriptive name>

**Effort:** <hours, e.g. "3h">
**Files:** src/<module>/<file>.js (new), tests/<module>.test.<ext> (mod)

## User Story
As a **<role>**, I want **<capability>** so that **<value>**.
Acceptance criteria: <list items>

## Goal
<1-2 sentences on what this accomplishes>

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
<Concrete codebase state required before starting. Describe the state, not task dependencies.>
```

For full rules, size gates, and anti-patterns see `references/task-rules.md`.

## Hand off

Confirm `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/` exists with one `.md` per user story before handing off to implementation.
