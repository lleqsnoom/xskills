---
name: x-epic
description: Convert approved spec into a layer-based epic — each layer is a coherent, testable increment from prototype to polished product; outputs .x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md for handoff to x-decompose
version: 2.0.0
author: Community
tags: [epic, layers, definition-of-done, scope, prototype, incremental]
user-invocable: true
---

# X-Epic — Layer-Based Epic Definition

`.x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md`. One file per topic. Reference the spec; don't repeat it. Follow pipeline order from `.agents/rules/xskills.md`.

## Workflow

1. **Open staging file** — Run: `node <path-to-save-epic.js> --topic <slug>`
2. **Read the spec** — Open file referenced by `spec:` in Epic Header. Extract every layer from the Layer Roadmap.
3. **Flesh out layers** — See Layer Format below. Each layer becomes a coherent increment with scope, prerequisites, and DOD.
4. **Define epic-level boundaries** — Explicitly state what is *in* and what is *out*.
5. **Gate** — Confirm epic with user before handing off to `x-decompose`.

## Layer Format

Each layer from the spec becomes a detailed section in the epic. Layers are the replacement for user stories — they represent **increments of working software**, not components or features.

```markdown
### Layer <N> — <name>

**Objective:** <one sentence: what this layer achieves>
**From spec:** L<N> — <spec layer name>

**Scope in:**
- <what this layer delivers>
- <specific capabilities added or improved>

**Scope out:**
- <what is explicitly deferred to later layers>
- <known limitations of this layer>

**Prerequisite:** Layer <N-1> complete and all tests passing
  (skip for L0 — prerequisite is a clean project state)

**Definition of Done:**
- [ ] <regression check: L(N-1) tests still pass> (skip for L0)
- [ ] <new testable behavior 1>
- [ ] <new testable behavior 2>
```

### Layer Design Rules

1. **Each layer = one working increment** — After completing a layer, the system is in a better but fully functional state. Not "header done, waiting for footer."
2. **Each layer replaces the previous layer's stubs.** L0 uses mocks/stubs. L1 replaces them with real logic. L2 adds error handling. L3 polishes.
3. **Prerequisites are explicit** — State what must be done before this layer starts. This creates a clear execution order for x-decompose and x-implement.
4. **Scope out is as important as scope in** — Knowing what a layer does NOT do prevents scope creep and keeps each layer small enough to complete in 1-3 tasks.

### Layer Order (prototype to polish)

```
┌─────────────────────┐  L3: Polish — monitoring, docs, edge cases
├─────────────────────┤  L2: Resilience — error handling, retries
├─────────────────────┤  L1: Real logic — replace mocks with actual implementation  
├─────────────────────┤  L0: Skeleton — working prototype with mocks/stubs
```

Implementation order is fixed: L0 skeleton, then L1 real logic, then L2 resilience, then L3 polish. Build in this order regardless of how the spec presents the layers.

## Epic Header

```markdown
# Epic — <Topic>

**Date:** DD-MM-YYYY-hh:mm
**Branch:** <branch>
**Scope:** <one sentence covering this epic>
---

goal:         <outcome in one sentence>
spec:         .x-skills/plan/DD-MM-YYYY-hh:mm-<topic>.md
```

## Epic-Level Definition of Done

```markdown
## Definition of Done (Epic Level)

- [ ] All layers delivered and acceptance criteria verified
- [ ] System works end-to-end with real logic (not mocks)
- [ ] No regressions across layers (L0 tests pass through L(N))
- [ ] Documentation updated where contracts changed
```

## Handoff Flow

Artifact must exist on disk before handing off to `x-decompose`. The epic's layers section is the source of truth for decomposition.
