---
name: x-design
description: Design before coding — clarify vague goals, propose approaches with trade-offs, write spec as declarations (contract, invariant, test), gate on user approval
version: 1.0.0
author: Community
tags: [design, spec, requirements, architecture, clarification, testable]
user-invocable: true
---

# X-Design — Spec-Driven Design

`<gate>` No code until user approves the spec. `</gate>`

## Workflow

1. **Classify scope** — Is the goal vague enough that you can't name what to build, for whom, or what success looks like?

2. **Clarify** (if vague) — Ask one question per turn until the goal is concrete. Don't propose solutions until the problem is understood. Working notes can hold hypotheses and ruled-out directions.

3. **Propose approaches** (if clear) — Recommend 2–3 approaches with trade-offs; pick one. Then write the spec.

4. **Write the spec** — See Spec Format below.

5. **Gate** — Confirm with user before handing off to `x-plan`.

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

**No question → no section.** Don't fill "Risks" / "Non-goals" if empty.

### Typical spec sections

- **contract** — public interface, data shape, I/O
- **invariant** — what must hold true in all states
- **failure modes** — error paths, edge cases
- **test** — one verifiable check per acceptance criterion
- **out of scope** — what this change explicitly does not touch
- **architecture** — when the structural approach isn't obvious

### Working notes

Append an `## Working notes` section for scratch, open questions, hypotheses. Strip it at ship.

## Spec Location

Run the script to create the staging directory and file:

```bash
node skills/x-design/scripts/save-spec.js --topic <slug>
```

Output: `docs/staging/specs/YYYY-MM-DD-<topic>.md`

Write your spec content into the file printed by the script using this structure:

```markdown
# Design — <Topic>

**Date:** YYYY-MM-DDTHH:MM
**Branch:** <branch>
**Scope:** <one sentence>

---

contract:     <interface or API shape>
invariant:    <what must always hold>
test:         <how we'll know it works>
constraint:   <non-negotiable limitation>
deferred:     <decided later>

---

## Working notes

- Open question or hypothesis...
```

## Roadmap

**`docs/ROADMAP.md` exists?** Does this work add new milestones? Append them. Otherwise skip.

**Does not exist?** This work spans ≥ 3 milestones → create `docs/ROADMAP.md`:

```markdown
- [ ] M1: <one-line goal>
- [ ] M2: <one-line goal>
- [ ] M3: <one-line goal>
```

If roadmap exists or was created, add `milestone: M1 (see docs/ROADMAP.md)` to the spec header.

## Abandon

If the user decides not to proceed after clarification, stop. No spec, no plan. Record reason in working notes.

## Gates

`<gate>`

1. `docs/staging/specs/YYYY-MM-DD-<topic>.md` must exist on disk before handing off to `x-plan`.
2. Confirm with the user that the spec is complete and correct.

`</gate>`
