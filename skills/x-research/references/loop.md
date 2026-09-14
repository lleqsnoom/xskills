# The x-research loop

The loop is a state machine over numbers. Every transition is a comparison of two
recorded values, so the stop can be re-derived from `state.json` alone.

## States

```
baseline ──record baseline──► iterate
iterate ──candidate kept/reverted──► iterate        (metric gap remains, under cap)
iterate ──candidate──► done                          (metric meets target + evaluator + guard pass)
iterate ──candidate──► escalate                      (cap reached, target unmet)   ── STOP
done / escalate = STOP_PHASES
```

`start` → `baseline`. One `record --baseline` → `iterate`. Each
`record --candidate` advances one experiment.

## Gates (all numbers)

| Gate | Comparison | On fail |
|------|-----------|---------|
| metric vs target | `score >= target` (maximize) or `score <= target` (minimize) | keep looping |
| evaluator pass | `pass === true` | revert the candidate |
| guard pass (optional) | guard exit code `0` | revert the candidate |
| improvement (policy `score_improvement`) | `delta >= min_delta` | revert the candidate |
| noise | `samples >= noise_runs` | revert the candidate |
| atomicity | `changed.length === 1` | revert the candidate |
| search | every path allowed ∧ none forbidden | revert the candidate |
| cap | `iteration >= cap` | escalate |

Each is written into the history entry as `{ actual, expected, pass }`. `verify`
recomputes the metric, evaluator, and guard gates for the held-best entry and exits
0 only when all pass — i.e. only a genuine `done` is justified.

## Keep vs revert

The held state (`state.best`) only moves forward:

- `pass_only` — keep a candidate iff the evaluator passes (the guard, noise,
  atomicity, and search gates still apply).
- `score_improvement` — keep a candidate iff it passes **and** its metric beats the
  held best by at least `min_delta`. A change smaller than `min_delta` counts as
  noise and is reverted.

A reverted experiment is still recorded — full history, kept and reverted alike.

## Why a cap and an escalation

A metric loop can plateau. The cap turns "keep trying" into a bounded budget; when
it runs out without the target, the loop **escalates**: it writes `final_report.md`
with the remaining gap and stops. That is a reported outcome, not a failure to hide.

## Reading the audit trail

- `research.md` — the config and the human-readable history table.
- `research_log.md` — append-only, one line per event.
- `results.tsv` — machine-readable rows: `iteration, kind, score, pass, guard_pass,
  delta, decision, change`.
- `final_report.md` — written at stop only.
