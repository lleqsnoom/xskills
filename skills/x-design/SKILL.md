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

## CRITICAL: Pipeline Enforcement

You MUST follow this exact order: `x-design → x-epic → x-decompose → x-implement`. **Never skip a phase.**

- **NEVER write implementation code** during design.
- **NEVER create task files or decompose work** — that is `x-decompose`'s job.
- **NEVER run git commits** or modify source files beyond creating/editing the spec file itself.
- **When asked to implement**, respond: "This requires an approved epic and tasks first."
- The only files you may create are `.x-skills/design/<DD-MM-YYYY-hh:mm>-<topic>.md` and its working notes.

If the user says "skip to implementation", refuse and explain that the epic phase is mandatory.

## Workflow

1. **Classify scope** — Is the goal vague enough that you can't name what to build?
2. **Clarify** (if vague) — Ask one question per turn until concrete. Don't propose solutions until problem is understood.
3. **Propose approaches** (if clear) — Recommend 2–3 approaches with trade-offs; pick one. Then write spec.
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

**Which declaration type?** Use this decision tree when classifying a requirement:

1. Is it about user input or output format? → **contract**
2. Is it a system property that must always hold? → **invariant**
3. Is it an acceptance criterion with given/when/then structure? → **test**
4. Is it a non-functional requirement (performance, security)? → **constraint**
5. Is the decision postponed for later iteration? → **deferred**

If none of these match, the requirement is too vague — clarify with the user first.

### Worked example: POST /auth/login

```markdown
## contract
- Input: email (string, valid format), password (string, min 8 chars)
- Output on success: token (JWT string), user (id, email, created_at)
- Errors: 401 invalid credentials, 429 rate limit exceeded

## invariant
- Password is never stored in plaintext
- Failed login attempts are logged with IP and timestamp
- Token expiry is always ≤ 24 hours

## test
- Given valid credentials → return 200 with token
- Given invalid email format → return 400
- Given rate limit exceeded → return 429 after 5 failed attempts in 60s

## constraint
- Response time < 200ms at p95
- Supports up to 1000 concurrent login requests

## deferred
- OAuth provider integration (decided next iteration)
```

**No question → no section.** Don't fill sections if empty.

### Optional appendices (only if non-empty)

- **Failure modes** — error paths and edge cases
- **Out of scope** — what this change explicitly does not touch
- **Architecture** — structural approach when it is not obvious

Append an `## Working notes` section for scratch, hypotheses. Strip it at ship.

## Artifact Location

Invoke the script from any directory — it self-resolves via `__dirname`. Output: `.x-skills/design/DD-MM-YYYY-hh:mm-<topic>.md` (relative to CWD):

```bash
node <path-to-save-spec.js> --topic <slug>
```

Write your spec content using the declaration format above (see **Spec Format**). Add `milestone: M<n>` to the header when a roadmap applies.

If `.x-skills/roadmap.md` exists, append new milestones to it. Otherwise create one when work spans multiple milestones:

```markdown
- [ ] M1: <one-line goal>
- [ ] M2: <one-line goal>
```

Skip if work fits within a single milestone.

## Abandon

If the user decides not to proceed after clarification, stop. Record reason in working notes. No spec, no epic.

## Handoff Flow

Before declaring complete, confirm: artifact file exists at expected path, spec contains required declarations (contract, invariant, test), and next-phase script can locate it via topic slug matching.
