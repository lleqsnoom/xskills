---
name: x-plan
description: Plan after design approval — milestone tasks with executable acceptance, rolling wave planning, parallel task detection, gate on user confirmation
version: 1.0.0
author: Community
tags: [plan, milestones, tasks, acceptance, rolling-wave, testable]
user-invocable: true
---

# X-Plan — Milestone Planning with Executable Acceptance

`.x-skills/plans/YYYY-MM-DD-<topic>.md`. Reference the spec; don't restate it.

If unresolved spec notes affect implementation or task order, return to `x-design`.

## Script Location

Scripts live inside the **installed skill directory**, not in your project:

- Global install (`~/.agents/skills/x-plan/scripts/save-plan.js`)
- Local install (`.agents/skills/x-plan/scripts/save-plan.js`)

Run from any working directory — the path above is absolute or project-local.

## Workflow

1. **Open staging plan** — Run the script to create the file:

```bash
node <skill-install-dir>/scripts/save-plan.js --topic <slug>
```

Output: `.x-skills/plans/YYYY-MM-DD-<topic>.md`

2. **Rolling wave** — Spec references a milestone (`milestone: MN`)? Check `.x-skills/roadmap.md` — expand only that milestone. Leave the rest as stubs. After ship: confirm which milestone is next, then expand it.

3. **Write tasks** — See Task Format below. Each task leaves the repo green.

4. **Detect parallelism** — Mark independent tasks with `[parallel]`. Only when shared contracts, state, errors, and acceptance are all closed.

5. **Gate** — Confirm plan with user before handing off to implementation.

## Task Format

Every task is `- [ ] T<n>: <name>` — always a checkbox, never a heading. Implementation flips it to `- [x]` on completion.

```markdown
goal:       <one sentence describing what the task achieves>
files:      <paths this task creates or modifies>
acceptance: <test command, script check, or manual verification steps>
spec:       <.x-skills/design/...#anchor>
```

- **No exact code.** No step-by-step implementation instructions.
- **Acceptance must be verifiable** — a test, command, or scripted check. When none is possible, state explicit manual steps + expected result.
- **Each task leaves the repo green.**

### Parallel tasks

```markdown
[parallel] T3, T4, T5 — independent work with closed contracts and no shared state
```

Mark `[parallel]` only when all shared contracts, state, error handling, and acceptance criteria are resolved.

### New project initialization

For new projects, derive an init task: scaffold code, tests, CI. Always include `README.md`, `CHANGELOG.md`, `.gitignore`.

## What NOT to put in the plan

- Background, architecture, rationale (spec's job)
- CI commands (implementation detail)
- Copy-pasted acceptance criteria
- Step-by-step implementation instructions

## Hand off

`<gate>` `.x-skills/plans/YYYY-MM-DD-<topic>.md` must exist on disk before handing off to implementation. Confirm plan with the user. `</gate>`

**Mostly parallel?** → dispatch to subagents. **Otherwise?** → sequential implementation with `x-fix` for review.
