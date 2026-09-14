---
name: x-roast
description: Roast any non-code artifact — articles, analyses, specs, epics, tasks, research, or another skill — where the reviewer fact-checks the claims, attacks the reasoning, proposes better angles, and scores it on a weighted, anchored rubric computed by a script. Use for "roast this", "poke holes in", "review this spec/skill/analysis", or any request for a reproducible number and reason. For source code use x-review instead.
version: 1.0.0
author: Community
tags: [review, critique, roast, research, article, analysis, epic, task, evaluation, scoring, fact-check]
user-invocable: true
---

# X-Roast — Adversarial Review of Articles, Analyses, Specs, Epics, Tasks, Research, and Skills

Roast a document the way a hostile-but-fair expert reviewer would: verify the facts, attack the
reasoning, find the missing angle, then hand back concrete fixes. The score is not a feeling — it
is a **weighted, anchored rubric computed by a script**, so any agent running the same inputs gets
the same number.

Use this for prose and planning artifacts. For **source code**, use `x-review` instead.

## When to use

- "Roast this", "poke holes in this", "review this <artifact>", "second opinion on this".
- An article, analysis, spec, epic, task, research report, or **another skill** (`SKILL.md`).
- You need a critical second opinion before publishing or committing to a plan.
- You want a *number* and a *reason* — not "looks good".

Not for source code — use `x-review` there.

## Anti-gaming rules (read first)

1. **No score without evidence.** Every dimension score cites a quote, a `file:line`, or a source URL.
2. **Never invent a source.** If you cannot fetch it, you do not cite it. Fabricated citations are a
   critical failure of the roast itself.
3. **Verify before you penalize.** Check a load-bearing claim online before scoring it low.
4. **Score the artifact, not the author.** Blunt about work, never about a person.
5. **Provisional if partial.** If `completeness < 1` from the scorer, label the total provisional.

## Procedure

### 1. Intake
Identify the artifact (path or pasted text) and its **profile**, which selects the rubric profile:

`article` · `analysis` · `research` · `epic` · `task` · `skill` · `generic`

Use `skill` when the artifact is a `SKILL.md` (it adds `triggers`, `procedure`, `verification`).

Read it in full. Write down its **central claim in one sentence** — if you cannot, that is itself
a finding (`clarity` and `logic` suffer).

Completion: the profile is chosen and the central claim is one sentence.

### 2. Extract load-bearing claims
List the 3–8 claims the artifact depends on. For each, mark: `local` (checkable in-repo) or
`external` (needs the web). Skip anything decorative — only claims that, if false, collapse the work.

Completion: 3–8 claims listed, each marked `local` or `external`.

### 3. Verify online
For each `external` claim, actually fetch a source (`fetch` for raw pages/APIs, `agentic_fetch` to
search and extract). Record the URL and what it **confirmed or contradicted**. Actively hunt for:

- **counter-evidence** — the strongest opposing case, not a strawman;
- **better sources** — primary over secondary, newer over older;
- **recency traps** — conclusions resting on superseded work.

If the web is unavailable, state it and mark affected scores as *unverified* rather than guessing.

If verification **contradicts** a load-bearing claim, loop back to step 2: strike that claim, drop
anything resting on it, and re-score. Record both passes in the findings.

Completion: every `external` claim has a URL, or an explicit *unverified* marker; every
contradicted claim has been struck and re-scored.

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
`missing` / `unknown` / `outOfRange` dimensions. Handle them as follows — never fill a gap yourself:

| Field | Meaning | What to do |
|-------|---------|-----------|
| `missing` | profile dimensions you did not score | score them, or report the total as provisional |
| `unknown` | keys not in this profile | drop them (typo guard) |
| `outOfRange` | a value outside 1–5, clipped by the scorer | re-read the anchor and re-score honestly |
| `invalid` | a value that is not a number | fix it and re-run |

Completion: the scorer runs clean (`missing` empty or the total labelled provisional, `unknown`,
`outOfRange`, and `invalid` all empty).

### 5. Creative re-think
Go beyond nitpicks. Propose at least **three** genuinely different angles:
- an alternative framing or thesis that would be stronger;
- a missing stakeholder, dataset, or perspective;
- a restructuring that changes what the reader concludes.

Mark each as `reframe`, `addition`, or `restructure`.

Completion: three angles, each tagged, none a restatement of a finding.

### 6. Improvement proposals
Turn findings into an ordered, concrete plan. Each proposal names:
**what changes**, **where** (section / file:line), and **expected score delta**
(e.g. "raise `evidence` 2→4 if §2 cites the primary dataset").

Completion: every proposal names a location and a dimension delta.

### 7. Report
Create the report file and write into it:

```bash
node <skill>/scripts/save-report.mjs --slug "my-article" --type article
```

The script prints `{ "path": ".x-skills/critique/<timestamp>-my-article.md", "created": true }`.
Open it with `edit`/`write` and fill in: central claim, score JSON, findings (one bullet per
dimension), creative alternatives, improvement proposals, and sources consulted.

Completion is the gate — the report is done only when the checker passes:

```bash
node <skill>/scripts/check-report.mjs --file <report.md>   # exit 0 iff filled in
```

## Report format

````markdown
# Roast — <artifact>

**Profile:** article | analysis | research | epic | task | skill
**Total:** 56.3 / 100 — weak
**Completeness:** 100%

## Central claim
<one sentence>

## Score
```json
<JSON from score.mjs>
```

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
- <url> — confirmed/contradicted <claim>   (or "no external claims; all checkable in-repo")
````

## Next steps — which skill to use

| Result | Next skill |
|--------|-----------|
| Artifact needs rewriting/fixing | `x-fix` (drive it with the improvement proposals) or edit directly |
| It is a spec that failed review | `x-plan` (re-derive contract, invariants, tests) |
| It is an epic/task that failed review | `x-epic` / `x-decompose` |
| It is a skill that failed review | edit the `SKILL.md`, then `x-skill-lint` (frontmatter, refs, README) |
| You need deeper root-cause work on a claim | `x-investigate` |
| You need to reproduce a failing claim | `x-reproduce` |

## Files

- `scripts/score.mjs` — weighted, anchored scorer (pure, importable, CLI at bottom).
- `scripts/save-report.mjs` — creates a timestamped report under `.x-skills/critique/`.
- `scripts/check-report.mjs` — fails while the report is still the empty template.
- `references/rubric.md` — the anchored 1–5 definitions and profile map.
- `references/example-roast.md` — a worked roast to match tone and depth against.
- `evals/triggers.json` — trigger and near-miss queries for description tuning.
