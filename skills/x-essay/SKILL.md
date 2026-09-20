---
name: x-essay
description: Write an article end-to-end on a fixed loop — x-analyze thesis, x-roast critique, x-humanize rewrite — repeating until it scores strong and reads clean. Use when asked to write or draft an article, blog post, or essay that must defend a claim.
version: 1.0.0
author: Community
tags: [writing, article, essay, blog, editorial, loop, pipeline, drafting, prose]
user-invocable: true
---

# X-Essay — Author an Article Through a Fixed Critique Loop

Turn a claim into a finished article by running the three existing xskills in a
**fixed order and a bounded loop**, instead of doing it by hand:

```
CLAIM → x-analyze (thesis + evidence) → DRAFT
   ↻  x-roast → REVISE (fix findings) → x-humanize → verify → final-check
      stop when roast total ≥ min-score AND humanize exit = 0 AND coverage ≥ coverage-gate
      else loop; after `cap` iterations, escalate instead of looping forever
```

This skill is an **orchestrator**: it re-implements none of the three phases. It
holds the draft, decides continue-vs-stop, and enforces the one ordering rule that
matters. For papers/research use `x-roast --profile research` (a later `--type`).

**Every gate and decision is a number.** Three numeric gates drive the loop —
`min-score` (x-roast `total`), humanize `exit` (0/1), and `coverage`
(facts preserved / facts total). `state.json` records each gate as
`{ actual, expected, pass }`, so any stop can be re-derived from the stats alone:
`node state.mjs verify --dir <dir>` exits 0 iff the stop is justified.

## When to use

- "Write an article / blog post / essay about …", "draft a piece arguing …".
- You have a claim to defend and want the review built in, not bolted on.
- **Not** for publishing: the finished `.mdx` goes to the site via
  `blog-post-authoring` (frontmatter, slug, og image, build). This skill hands it off.

## Before the loop

A brief that names a topic but no claim is not a claim, and the loop cannot judge
its own output against one it never heard. If the request does not say what the
article should convince the reader of, ask once — one `open` panel: *what must the
reader believe when they finish it?* — and proceed with the answer as the claim.
A brief that already carries the claim is its own confirmation; ask nothing.

## Non-negotiable rules (read first)

1. **Fixed order.** `x-analyze → x-roast → x-humanize`. Never humanize before the
   roast has passed — humanizing a sentence a roast just corrected can quietly
   restore the wrong claim.
2. **Humanize is last, then re-checked.** After a passing humanize, run a
   facts-only final check: the corrected markers, numbers, names and URLs from the
   roast must still be present in the rewritten text. If one regressed, revert that
   sentence and loop.
3. **Bounded loop.** Stop at the gate; if `cap` is hit without passing, **stop and
   report the open findings** — never loop indefinitely.
4. **The numbers decide.** `x-roast`'s `total`, `x-humanize`'s exit code, and the
   final-check coverage ratio are the source of truth, not a feeling. `state.mjs`
   records all three as numeric gate verdicts.

## Procedure

### 1. Start — `scripts/state.mjs`
```bash
node <skill>/scripts/state.mjs start --slug my-article --min-score 75 --coverage-gate 1 --cap 3
```
Creates `<run folder>/E<nn>-article/state.json` and prints the first action plus
a numeric summary. Defaults: score gate **75** ("strong" band), coverage gate
**1.0** (all facts/markers survive), cap **3**. Completion: `state.json` exists
with `phase:"draft"` and `gates` recorded.

### 2. Analyse — run `x-analyze`
Pose the claim; use `x-analyze` to produce `<run folder>/E<nn>-analysis.md`
(thesis, evidence, confidence, options). Completion: you have a one-sentence
central claim and the load-bearing evidence for it.

### 3. Draft
Write the draft to `<run folder>/E<nn>-article/draft-v<n>.md`. Meet the article
checklist in `references/best-practices-article.md` before moving on: one `h1`,
claim first, evidence per section, counterargument handled, references listed.
Completion: a complete draft file, not an outline.

### 4. Roast — run `x-roast`, then record
Run `x-roast` on the draft (profile `article`). Save its score JSON, then:
```bash
node <skill>/scripts/state.mjs record --dir <dir> --roast <score.json>
```
It prints `{ next, stop, phase, iteration, reason }`:
- `next:"humanize"` — gate passed, go simplify.
- `next:"revise"` — fix the roast's improvement proposals, then re-roast.
- `next:"escalate"` (`stop:true`) — cap hit, report findings and stop.

### 5. Revise (when told) — or Humanize
- `revise`: apply the roast's ordered improvement proposals to `draft-v<n>.md`
  (new file), then go to step 4. The new roast's `scoreDelta` vs the previous one
  is recorded — a dropping score is visible, not guessed.
- `humanize`: run `x-humanize` (`analyze.mjs` → rewrite from the brief →
  `verify.mjs`). Record the exit plus the before/after grade:
  ```bash
  node <skill>/scripts/state.mjs record --dir <dir> --humanize-exit 0 --grade-before 12.4 --grade-after 8.1
  ```
  Non-zero → it routes you back to `revise`. Exit 0 → phase `final-check`.

### 6. Final check, then deliver
Count the load-bearing items from the roast and the corrected markers, and how many
survived the humanize rewrite. The verdict is the **ratio**, not a vote:
```bash
node <skill>/scripts/state.mjs record --dir <dir> --final-check 12/12   # kept/total
```
`coverage ≥ coverage-gate` → `phase:"done"`. Below it → `revise` (revert the
regressed sentences). Completion: `state.json` reads `phase:"done"`, then verify:
```bash
node <skill>/scripts/state.mjs verify --dir <dir>   # exit 0 iff the stop is justified
```

### 7. Deliver
Present the article, the numeric summary
(`iterations`, `firstRoastTotal → bestRoastTotal`, `scoreGain`, `lastCoverage`), and
the report paths (the `E<nn>-analysis.md`, `E<nn>-critique.md`, and `E<nn>-humanize.md` artifacts in the run folder).
Hand the text to `blog-post-authoring` when the user wants it published, and
`x-commit` to commit.

## Output format

```markdown
# Essay — <title>

**Claim:** <one sentence>
**Loop:** 2 iterations · roast 62.5 → 81.0 (+18.5) · humanize exit 0 · coverage 12/12 (1.0) · verify ✅

## Article
<the finished text>

## Trail
- <run folder>/E<nn>-analysis.md · E<nn>-critique.md · E<nn>-humanize.md
- <run folder>/E<nn>-article/state.json · verify exit 0
```

## Next steps — which skill to use

| After | Next |
|-------|------|
| Article is done and should be published | `blog-post-authoring` |
| You want it committed | `x-commit` |
| Escalated (cap hit, still weak) | file the open findings as tasks, or `x-plan` a restructure |
| A single claim needs deeper proof | `x-investigate` |

## Files

- `scripts/state.mjs` — pure, numeric loop state machine + CLI (`start` / `record`
  / `status` / `verify`). Zero-dep, standalone: it never imports the other skills.
  Every transition is a recorded `{ actual, expected, pass }` number comparison.
- `references/loop.md` — the state diagram, the three numeric gates, and why
  humanize is last.
- `references/best-practices-article.md` — the pre-roast article checklist and the
  hand-off contract to `blog-post-authoring`.
