---
name: x-epic
description: Convert approved spec into user stories — INVEST-gated, scope-bounded epics with epic-level DOD; outputs .x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md for handoff to x-decompose
version: 1.0.0
author: Community
tags: [epic, user-stories, invest, scope, definition-of-done]
user-invocable: true
---

# X-Epic — Spec-to-User-Stories Conversion

`.x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md`. One file per topic. Reference the spec; don't repeat it. Follow pipeline order from `.agents/rules/xskills.md`.

## Workflow

1. **Open staging file** — Run: `node <path-to-save-epic.js> --topic <slug>`
2. **Read the spec** — Open file referenced by `spec:` in Epic Header. Extract every contract, invariant, and constraint into user stories. One story per coherent unit of value.
3. **Write user stories** — See User Story Format below. Apply INVEST (Independent, Negotiable, Valuable, Estimable, Small, Testable — mark ✓ or ✗ with one-line reason; if any ✗, split or rephrase).
4. **Define scope boundaries** — Explicitly state what is *in* and what is *out*.
5. **Gate** — Confirm epic with user before handing off to `x-decompose`.

## User Story Format

```markdown
### US<n> — <title>

As a **<role>**, I want **<capability>** so that **<value>**.
**Acceptance criteria:**
- [ ] <testable requirement 1>
- [ ] <testable requirement 2>
```

## Epic Header

```markdown
# Epic — <Topic>

**Date:** DD-MM-YYYY-hh:mm
**Branch:** <branch>
**Scope:** <one sentence covering this epic>
---

goal:         <outcome in one sentence>
milestone:    <skip if work fits in one milestone, otherwise M<n>>
spec:         .x-skills/plan/DD-MM-YYYY-hh:mm-<topic>.md
```

## Epic-Level Definition of Done

```markdown
## Definition of Done (Epic Level)

- [ ] All user stories delivered and acceptance criteria verified
- [ ] Integration across stories works end-to-end
- [ ] No regressions in existing behavior
- [ ] Documentation updated where contracts changed
```

## Handoff Flow

Artifact must exist on disk before handing off to `x-decompose`.