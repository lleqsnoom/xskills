---
name: x-plan
description: Plan before coding — clarify vague goals, propose approaches with trade-offs, write spec as declarations (contract, invariant, test) with a layer roadmap; gate on user approval
version: 2.0.0
author: Community
tags: [plan, spec, requirements, architecture, clarification, testable, layers, prototype]
user-invocable: true
---

# X-Plan — Layered Spec-Driven Planning

Do not write any code until the spec is approved by the user. Follow pipeline order from `.agents/rules/xskills.md`.

## Workflow

1. **Classify scope** — Is the goal vague enough that you can't name what to build?
2. **Clarify** (if vague) — Ask one question per turn until concrete. Don't propose solutions until problem is understood.
3. **Propose approaches** (if clear) — Recommend 2–3 approaches with trade-offs; pick one. Then write spec.
4. **Write the spec** — See Spec Format below. Always include a Layer Roadmap starting with L0 (prototype).
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

### Layer Roadmap (Required)

Every spec **must** include a `## Layers` section. This is the heart of the onion approach — you can't think of everything upfront, so you plan in peels.

```markdown
## Layers

### L0 — <name: skeleton / prototype / foundation>
**Goal:** <what the prototype demonstrates — one sentence>
**What works:** <concrete: which flow completes end-to-end>
**What's mocked:** <which parts use stubs/mocks/fixed data and why>
**Definition of Done:**
- [ ] <automated check>: `<command>`
- [ ] System starts without errors

### L1 — <name: real implementation / core logic>
**Goal:** <what improves over L0>
**What changes:** <mocks replaced, logic added>
**Prerequisite:** Layer 0 complete and passing
**Definition of Done:**
- [ ] All L0 tests still pass (regression)
- [ ] <new testable behavior>

### L2 — <name: error handling / resilience>
**Goal:** <what improves over L1>
**What changes:** <new capabilities added>
**Prerequisite:** Layer 1 complete and passing
**Definition of Done:**
- [ ] <testable behavior>
```

#### Layer Design Rules

1. **L0 is always a prototype** — the first layer is always a working skeleton with mocks/stubs. If you can't describe what L0 does in one sentence, clarify before writing the spec.
2. **Each layer is independently testable** — after completing a layer, you should be able to run tests and see something work. If a "layer" only makes sense when combined with 3 others, it's not a layer — split it.
3. **Layers peel back complexity** — L0 has the simplest possible version of everything. Each subsequent layer replaces a mock with real logic, adds error handling, or improves quality. Like oil painting: base coat first, detail later.
4. **Layers have prerequisites** — L(N+1) depends on LN being complete. State this explicitly.
5. **Don't over-plan layers** — define 3-5 layers at the spec level. Details within each layer emerge during decomposition and implementation. It's OK if L4 is just a one-liner like "polish and documentation."

#### How to Define Layers (Decision Guide)

| Situation | Layer breakdown |
|-----------|----------------|
| Web page / UI | L0: basic layout with placeholder content → L1: real components → L2: interactivity → L3: styling/polish |
| API / backend service | L0: routes + mock handlers → L1: real business logic → L2: validation + error handling → L3: auth + middleware |
| Data pipeline (SQS/Lambda) | L0: sender → queue → mock lambda → response → L1: real processing logic → L2: error handling + DLQ → L3: monitoring |
| CLI tool | L0: argument parsing + stub action → L1: real action logic → L2: output formatting → L3: edge cases |
| Library / utility | L0: function signatures + mock returns → L1: real implementation → L2: edge cases + types |

**Rule of thumb:** if you catch yourself writing "L1: header, L2: footer, L3: navigation" — that's component decomposition, not layer decomposition. Each layer should be a complete increment, not a piece. If components are what you need, each component must be independently testable (e.g., each page renders on its own).

## Artifact Location

```bash
node <path-to-save-spec.js> --topic <slug>
```

Output: `.x-skills/plan/DD-MM-YYYY-hh:mm-<topic>.md` (relative to CWD).

## Abandon

If user decides not to proceed after clarification, stop. Record reason in working notes. No spec, no epic.

## Handoff Flow

Artifact must exist on disk with required declarations (contract, invariant, test) and a Layer Roadmap before handing off to `x-epic`.
