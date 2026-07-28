---
name: x-anal
description: Interactive analysis skill — understand the user's problem, produce a thesis with evidence, and propose a solution; route to fix or task creation when ready.
version: 1.0.0
author: Community
tags: [analysis, troubleshooting, diagnosis, problem-solving, investigation]
user-invocable: true
---

# X-Anal — Interactive Problem Analysis & Solution Proposal

Guide the user through understanding their problem, formulating a thesis with evidence, proposing solutions, and routing to the right action (fix or task creation). This is an interactive conversation skill — it asks questions, clarifies ambiguities, and only proceeds when confident.

## Workflow (5 Phases)

### Phase 1: Confirm Understanding of Intent

When the user describes a problem (text + logs / error output / screenshots), restate what you believe they want solved in your own words. Show them this restatement and ask for confirmation before proceeding.

```
You say something like: "So you're saying that when X happens, Y occurs instead of Z. You want the behavior to be Z. Is that right?"
```

If the user corrects you, update your understanding and re-confirm. Do not proceed until intent is confirmed.

### Phase 2: Clarify Ambiguities

For every aspect of the problem you are uncertain about, ask the user a focused question with suggested answers or examples. Group related questions but never ask more than 3 at once.

Suggested clarification dimensions (ask only what's genuinely unclear):

| Dimension | Example Question |
|-----------|-----------------|
| Expected behavior | "What exactly should happen instead?" |
| Reproduction | "Does it always happen, or only in certain conditions?" |
| Environment | "Which version / browser / OS is this on?" |
| Scope | "Is this affecting just one user, one workflow, or everywhere?" |
| Recent changes | "Did anything change recently — code, config, data?" |
| Impact | "How critical is this — blocking you now, or just annoying?" |

When asking for missing information, suggest concrete types:

- **Logs / error output** → ask user to paste console errors, server logs, stack traces
- **Database schema** → ask user to share relevant table structures or queries
- **Screenshots / screen recordings** → ask for visual evidence of the issue
- **Reproduction steps** → ask for minimal steps to trigger the problem
- **Configuration** → ask for environment variables, config files, .env values

### Phase 3: Analysis & Thesis

Once you have enough information (or the user confirms they want to proceed with what's available), produce an analysis in `.x-skills/anal/analysis-<session-id>.md`:

```markdown
# Analysis — <session-id>

**Date:** YYYY-MM-DD HH:mm
**User Intent:** <confirmed restatement from Phase 1>
**Environment:** <platform, version, OS, etc.>

## Thesis
<One-sentence statement of what you believe is causing the problem>

## Evidence
- <Observation 1: cite specific log line, code snippet, or symptom with proof>
- <Observation 2: ...>
- <Reasoning that connects evidence to thesis>

## Confidence Level
<high | medium | low> — <brief reason for confidence assessment>

## Solution Proposition
### Option A: <name> (recommended)
**What:** <specific change or fix described clearly>
**Where:** <file(s) and location>
**Risk:** <low / medium / high — what could break>
**Effort:** <small / medium / large — time estimate>

### Option B: <alternative, if applicable>
**What:** ...
**Where:** ...
**Risk:** ...
**Effort:** ...

## Decision
<What the user chose to do — fix now, create tasks, gather more info, or defer>
```

### Phase 4: Confidence Gate

Before presenting the analysis:

- **High confidence** → present full thesis + solution proposition (Phase 3), ask user to approve and route.
- **Medium confidence** → present thesis with caveats, explicitly state what additional information would increase confidence, and ask user if they want to provide more or proceed anyway.
- **Low confidence** → stop analysis, explain what's missing, request specific additional evidence from the user (logs, schema, screenshots, etc.), and do not propose a solution until confidence improves.

Never present a fix for something you're guessing about — always flag uncertainty clearly.

### Phase 5: Route to Action

Based on the analysis scope and user decision:

| Scope | Route To | Output |
|-------|----------|--------|
| Single, small fix (<1 file, <30 min) | `x-fix` or direct implementation | Apply the fix directly; reference this analysis |
| Multi-file fix or moderate complexity | Create tasks and use `x-implement` | Split into tasks, follow TDD workflow |
| Large / architectural issue | Use `x-plan` → `x-epic` → `x-decompose` | Write spec first, then epic and tasks |
| Needs more investigation | Use `x-investigate` + `x-reproduce` pipeline | Hand off with full analysis as context |
| Not actionable right now | Note for later | Save analysis; don't force a decision |

When routing to another skill, pass `.x-skills/anal/analysis-<session-id>.md` as the input context so the downstream skill has full background.

## Constraints (MANIFESTO)

1. **Confirm before proceeding** — never start analyzing until user confirms you understand their intent correctly.
2. **Ask before assuming** — if anything is unclear, ask with suggestions; don't fill in gaps yourself.
3. **Evidence-based thesis only** — every claim must reference concrete evidence (log lines, code, symptoms). No speculation presented as fact.
4. **Flag uncertainty explicitly** — never hide low confidence. Use the three-level scale and explain why.
5. **One path at a time** — present options but guide toward a decision; don't leave user hanging with open choices.
6. **Right-sized routing** — small fix → fix directly; moderate → tasks + implement; large → plan first. Don't over-engineer simple problems.

## Anti-Patterns to Avoid

- Jumping straight to a solution without confirming what the problem actually is
- Assuming intent from vague descriptions ("it doesn't work" → don't guess, ask)
- Presenting analysis without citing specific evidence for each claim
- Skipping the confidence gate — never present low-confidence thesis as fact
- Over-engineering: proposing a full spec+epic+task decomposition for a one-line fix
- Under-investigating: accepting "it's probably X" without checking other possibilities
- Asking 10 questions when 2 would suffice — be efficient but thorough enough
