# X-Essay Loop — state machine, gates, and ordering

The loop is owned by `scripts/state.mjs`, which persists one `state.json` per
article and answers a single question each turn: **what next, and do we stop?**

## States

| `phase` | Meaning | Agent action |
|---------|---------|--------------|
| `draft` | Starting point | Write `draft-v<n>.md`, then run `x-roast` and record it |
| `revise` | Roast (or humanize) demands changes | Apply the findings to a new draft file, then re-roast and record |
| `humanize` | Roast gate passed | Run `x-humanize`, then record its verify exit code |
| `final-check` | Humanize passed | Confirm roast corrections survived, then record pass/fail |
| `done` | Delivered | Present the article + trail |
| `escalate` | Cap hit without passing | **Stop.** Report the open findings; do not loop |

`next` in the CLI output is just `phase`. `stop:true` only in `done` / `escalate`.

## Three numeric gates

Every transition is a comparison of two numbers, and the verdict is stored in
`state.json` as `{ actual, expected, pass }` — so no step needs a judgement call.

| Gate | Actual (recorded) | Expected | Where |
|------|-------------------|----------|-------|
| Score | `x-roast` `total` | `min-score` (75) | `record --roast` |
| Verify | `x-humanize` `verify.mjs` exit | `0` | `record --humanize-exit` |
| Coverage | facts/markers survived ÷ total | `coverage-gate` (1.0) | `record --final-check k/t` |

`cap` bounds the backward edges. `record` also stores `scoreDelta` (this roast −
last), so a plateau or regression is a number in the history, not an impression.

## Transitions

```
start ─▶ draft
draft/revise ──record --roast──▶  total ≥ min-score      ─▶ humanize
                                  total < min-score      ─▶ revise        (iteration+1)
                                  iteration ≥ cap        ─▶ escalate
humanize ──record --humanize-exit 0──▶ final-check
         ──exit ≠ 0──────────────────▶ revise / escalate
final-check ──coverage ≥ coverage-gate──▶ done
            ──coverage < coverage-gate──▶ revise / escalate
```

`cap` is checked on every backward edge: the loop never exceeds it.

## Verifying the stop

`node state.mjs verify --dir <dir>` re-derives the decision from the recorded
numbers and **exits 0 iff `phase:"done"` and all three gates pass**; it exits 1 on
an `escalate`. It also prints the arc as stats:

```json
{
  "ok": true,
  "checks": [
    { "name": "roast >= gate", "actual": 81, "expected": 75, "pass": true },
    { "name": "humanize exit == 0", "actual": 0, "expected": 0, "pass": true },
    { "name": "coverage >= gate", "actual": 1, "expected": 1, "pass": true }
  ],
  "stats": { "iterations": 2, "firstRoastTotal": 62.5, "bestRoastTotal": 81, "scoreGain": 18.5 }
}
```

## Defaults

- **Score gate (`--min-score`): 75** — the `strong` band in `x-roast`'s rubric.
- **Coverage gate (`--coverage-gate`): 1.0** — every load-bearing fact and
  corrected marker must survive the humanize rewrite. Lower it only to tolerate a
  *documented* loss.
- **Cap (`--cap`): 3** — most articles pass in one or two revisions; a third
  catches the stubborn ones. Past the cap, surface what is still wrong instead of
  running another blind pass.

All three are per-article: `state.json` records them, so a paper can run a
different gate than a blog post.

## Why humanize is last (the ordering hazard)

`x-roast` fixes facts and logic; `x-humanize` rewrites *language*. Simplifying a
sentence a roast just corrected can **quietly restore the wrong claim** — the
rewrite reads cleanly and passes the readability check while undoing the fix.
(`blog-post-authoring` documents the same trap.) So the order is fixed:

1. roast until the content is right,
2. then humanize,
3. then a **facts-only final check** — the corrected markers, numbers, names and
   URLs must all still be present. One miss → `final-check fail` → revert those
   sentences and loop.

## Reading the output

```json
{ "next": "revise", "phase": "revise", "iteration": 2, "stop": false, "reason": null,
  "summary": { "bestRoastTotal": 68, "scoreGain": 6, "lastCoverage": null } }
```

`reason` is non-null only when stopped, and it always carries the numbers, e.g.
`"roast 61 < gate 75; cap 2 reached"`.
