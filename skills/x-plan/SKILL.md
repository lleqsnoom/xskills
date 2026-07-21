---
name: x-plan
description: Plan before coding — clarify vague goals, propose approaches with trade-offs, write spec as declarations (contract, invariant, test), gate on user approval
version: 1.0.0
author: Community
tags: [plan, spec, requirements, architecture, clarification, testable]
user-invocable: true
---

# X-Plan — Spec-Driven Planning

Do not write any code until the spec is approved by the user. Follow pipeline order from `.agents/rules/xskills.md`.

## Workflow

1. **Classify scope** — Is the goal vague enough that you can't name what to build?
2. **Clarify** (if vague) — Ask one question per turn until concrete. Don't propose solutions until problem is understood.
3. **Propose approaches** (if clear) — Recommend 2–3 approaches with trade-offs; pick one. Then write spec.
4. **Write the spec** — See Spec Format below.
5. **Gate** — Confirm with user before handing off to `x-epic`.

## Spec Format

Use declarations, not narrative. Section names are optional — include only what applies:

```
contract:     <interface or API shape>
invariant:    <what must always hold>
test:         <acceptance criterion with given/when/then>
constraint:   <non-functional requirement>
deferred:     <decided later>
```

Decision tree for classification: input/output → contract, system property → invariant, acceptance criterion → test, performance/security → constraint, postponed → deferred. If none match → clarify first. **No question → no section.**

Append `## Working notes` for scratch/hypotheses; strip at ship. Optional appendices (only if non-empty): Failure modes, Out of scope, Architecture.

For worked example: see `references/examples/design-spec.md`.

## Artifact Location

```bash
node <path-to-save-spec.js> --topic <slug>
```

Output: `.x-skills/plan/DD-MM-YYYY-hh:mm-<topic>.md` (relative to CWD). Add `milestone: M<n>` when a roadmap applies. If `.x-skills/roadmap.md` exists, append new milestones; otherwise create one for multi-milestone work.

## Abandon

If user decides not to proceed after clarification, stop. Record reason in working notes. No spec, no epic.

## Handoff Flow

Artifact must exist on disk with required declarations (contract, invariant, test) before handing off to `x-epic`.
