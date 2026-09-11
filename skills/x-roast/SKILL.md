---
name: x-roast
description: Critically review any non-code artifact — articles, analyses, epics, tasks, research — with online fact-checking, a creative re-think, concrete improvement proposals, and a weighted rubric score that is reproducible and testable.
version: 1.0.0
author: Community
tags: [review, critique, roast, research, article, analysis, epic, task, evaluation, scoring, fact-check]
user-invocable: true
---

# X-Roast — Adversarial Review of Articles, Analyses, Epics, Tasks, and Research

Roast a document the way a hostile-but-fair expert reviewer would: verify the facts, attack the
reasoning, find the missing angle, then hand back concrete fixes. The score is not a feeling — it
is a **weighted, anchored rubric computed by a script**, so any agent running the same inputs gets
the same number.

Use this for prose and planning artifacts. For **source code**, use `x-review` instead.

## When to use

- "Review this article / analysis / spec / epic / task / research."
- You need a critical second opinion before publishing or committing to a plan.
- You want a *number* and a *reason* — not "looks good".

## Anti-gaming rules (read first)

1. **No score without evidence.** Every dimension score cites a quote, a `file:line`, or a source URL.
2. **Never invent a source.** If you cannot fetch it, you do not cite it. Fabricated citations are a
   critical failure of the roast itself.
3. **Verify before you penalize.** Check a load-bearing claim online before scoring it low.
4. **Score the artifact, not the author.** Blunt about work, never about a person.
5. **Provisional if partial.** If `completeness < 1` from the scorer, label the total provisional.

## Procedure

### 1. Intake
Identify the artifact (path or pasted text) and its **type**, which selects the rubric profile:

`article` · `analysis` · `research` · `epic` · `task` · `generic`

Read it in full. Write down its **central claim in one sentence** — if you cannot, that is itself
a finding (`clarity` and `logic` suffer).

### 2. Extract load-bearing claims
List the 3–8 claims the artifact depends on. For each, mark: `local` (checkable in-repo) or
`external` (needs the web). Skip anything decorative — only claims that, if false, collapse the work.

### 3. Verify online
For each `external` claim, actually fetch a source (`fetch` for raw pages/APIs, `agentic_fetch` to
search and extract). Record the URL and what it **confirmed or contradicted**. Actively hunt for:

- **counter-evidence** — the strongest opposing case, not a strawman;
- **better sources** — primary over secondary, newer over older;
- **recency traps** — conclusions resting on superseded work.

If the web is unavailable, state it and mark affected scores as *unverified* rather than guessing.

### 4. Score with the rubric
Open `references/rubric.md` and score each dimension of the profile. Then run the scorer — it is the
source of truth for the total, the band, and the completeness ratio:

```bash
node <skill>/scripts/score.mjs --profile task \
  --score testability=4 --score estimation=2 --score clarity=5 --score accuracy=3 \
  --score logic=4 --score evidence=3 --score originality=3 --score completeness=3 \
  --score actionability=4 --score balance=2
```

Or feed a file (either a bare `{ "dimension": 4, ... }` object or `{ "profile": "...", "scores": { ... } }`):

```bash
node <skill>/scripts/score.mjs --input scores.json
```

The scorer prints JSON: `total`, `band`, `completeness`, a per-dimension `breakdown`, and the
`missing` / `unknown` / `outOfRange` dimensions. Report the missing list as-is — do not fill gaps.

### 5. Creative re-think
Go beyond nitpicks. Propose at least **three** genuinely different angles:
- an alternative framing or thesis that would be stronger;
- a missing stakeholder, dataset, or perspective;
- a restructuring that changes what the reader concludes.

Mark each as `reframe`, `addition`, or `restructure`.

### 6. Improvement proposals
Turn findings into an ordered, concrete plan. Each proposal names:
**what changes**, **where** (section / file:line), and **expected score delta**
(e.g. "raise `evidence` 2→4 if §2 cites the primary dataset").

### 7. Report
Create the report file and write into it:

```bash
node <skill>/scripts/save-report.mjs --slug "my-article" --type article
```

The script prints `{ "path": ".x-skills/critique/<timestamp>-my-article.md", "created": true }`.
Open it with `edit`/`write` and fill in: central claim, score JSON, findings (one bullet per
dimension), creative alternatives, improvement proposals, and sources consulted.

## Report format

```markdown
# Roast — <artifact>

**Type:** article | analysis | research | epic | task
**Total:** 56.3 / 100 — weak
**Completeness:** 100%

## Central claim
<one sentence>

## Score
<JSON from score.mjs>

## Findings
- **accuracy (4/5)** — <evidence> → <why this number, not 5>
- **logic (2/5)** — <quote> → <the inference that fails>
...

## Creative alternatives
1. `reframe` — ...
2. `addition` — ...
3. `restructure` — ...

## Improvement proposals
1. <change> at <where> → raises `evidence` 2→4

## Sources consulted
- <url> — confirmed/contradicted <claim>
```

## Next steps — which skill to use

| Result | Next skill |
|--------|-----------|
| Artifact needs rewriting/fixing | `x-fix` (drive it with the improvement proposals) or edit directly |
| It is a spec that failed review | `x-plan` (re-derive contract, invariants, tests) |
| It is an epic/task that failed review | `x-epic` / `x-decompose` |
| You need deeper root-cause work on a claim | `x-investigate` |
| You need to reproduce a failing claim | `x-reproduce` |

## Files

- `scripts/score.mjs` — weighted, anchored scorer (pure, importable, CLI at bottom).
- `scripts/save-report.mjs` — creates a timestamped report under `.x-skills/critique/`.
- `references/rubric.md` — the anchored 1–5 definitions and profile map.
