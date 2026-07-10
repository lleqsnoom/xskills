---
name: x-design
description: Design before coding — clarify vague goals, propose approaches with trade-offs, write spec as declarations (contract, invariant, test), gate on user approval
version: 1.0.0
author: Community
tags: [design, spec, requirements, architecture, clarification, testable]
user-invocable: true
---

# X-Design — Spec-Driven Design

Do not write any code until the spec is approved by the user.

## Workflow

1. **Classify scope** — Is the goal vague enough that you can't name what to build, for whom, or what success looks like?

2. **Clarify** (if vague) — Ask one question per turn until the goal is concrete. Don't propose solutions until the problem is understood. Working notes can hold hypotheses and ruled-out directions.

3. **Propose approaches** (if clear) — Recommend 2–3 approaches with trade-offs; pick one. Then write the spec.

4. **Write the spec** — See Spec Format below.

5. **Gate** — Confirm with user before handing off to `x-epic`.

## Spec Format

A spec answers open questions for THIS change only. Reference code by path; never paste it.

Use declarations, not narrative:

```
contract:     <interface or API shape>
invariant:    <what must always hold>
test:         <how we'll know it works>
constraint:   <non-negotiable limitation>
deferred:     <decided later>
```

**No question → no section.** Don't fill sections if empty.

### Optional appendices (only if non-empty)

- **Failure modes** — error paths and edge cases
- **Out of scope** — what this change explicitly does not touch
- **Architecture** — structural approach when it is not obvious

### Working notes

Append an `## Working notes` section for scratch, open questions, hypotheses. Strip it at ship.

## Artifact Location

Invoke the script from any directory — it self-resolves via `__dirname`. Output: `.x-skills/design/YYYY-MM-DD-<topic>.md` (relative to CWD):

```bash
node <path-to-save-spec.js> --topic <slug>
```

Write your spec content using the declaration format above (see **Spec Format**). Add `milestone: M<n>` to the header when a roadmap applies.

## Roadmap

If `.x-skills/roadmap.md` exists, append new milestones to it. Otherwise, create one when the work spans multiple milestones:

```markdown
- [ ] M1: <one-line goal>
- [ ] M2: <one-line goal>
- [ ] M3: <one-line goal>
```

Add `milestone: M<n>` to the spec header when applicable. Skip if work fits within a single milestone.

## Abandon

If the user decides not to proceed after clarification, stop. Record reason in working notes. No spec, no epic.

## Handoff Flow

Spec written → `.x-skills/design/YYYY-MM-DD-<topic>.md`. User approves the spec. Then transition to `x-epic`:
"Spec approved. Shall I proceed with x-epic?"

## Verification Checklist

Before declaring a phase complete, confirm:

1. Artifact file exists at `.x-skills/design/YYYY-MM-DD-<topic>.md`
2. Spec contains required declarations (contract, invariant, test)
3. Next-phase script (`save-epic.js --topic <slug>`) can locate this file via topic slug matching
