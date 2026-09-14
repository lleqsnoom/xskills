---
name: x-research
description: Research a topic or tune a metric — define one metric and a target, then iterate one atomic change at a time, evaluating it mechanically (a command, or agent-judged criteria coverage) and keeping only measured improvements until the target, a guard, or a hard cap stops the run. Use for "research X", "compile/summarise sources on Y until N criteria are covered", filling knowledge gaps, literature/topic research with coverage criteria, or optimizing a measurable value.
version: 1.1.0
author: Community
tags: [research, experiment, optimization, metric, loop, iteration, evaluation, tuning, autonomous, literature, coverage]
user-invocable: true
---

# X-Research — Metric-Driven Iteration Loop

Drive a bounded search toward a **number** instead of a feeling. You name one
metric, a direction, and a target; the loop then makes **one atomic change per
iteration**, evaluates it, and keeps it only if the numbers say so:

```
baseline → [ propose ONE change → evaluate → keep or revert → record ]
             stop when the metric meets the target AND the evaluator (and guard) pass
             else loop; at the hard cap, escalate instead of looping forever
```

The metric is scored one of two ways, and **the mechanics are identical for both**:
a **command** printing `{"pass": bool, "score": number}` (preferred when one
exists), or **agent** judgment of **criteria coverage** — N criteria, marked
met/unmet, `score = met/total`, `pass = all met`.

This skill is a **loop contract**, not a runner. It ships no scheduler, no daemon,
and no autonomy doctrine — repetition is owned by the host (see
`references/running-unattended.md`), and the host's permission and approval gates
**always win**. It never tells you to ignore a confirmation, never says "never
stop", and never says "never ask".

## When to use

- "Improve / optimize / tune X until it reaches Y", "run an experiment loop on …".
- **Research a topic toward coverage**: "research X", "compile sources on Y",
  "summarise the literature on Z", "find the gaps in W", "keep going until every
  sub-question is answered". Here the metric is **criteria coverage** (see below)
  and the evaluator is agent-judged.
- You have a **measurable** metric — either a command that scores it, or a set of
  criteria an agent can mark met/unmet.

**Bootstrap, never refuse.** If the request names a goal but no metric, target, or
evaluator, **propose a criteria-coverage metric + target and continue** — do not
stop. Ask **at most once** if something is genuinely ambiguous, then proceed with
the proposal. Only a *pure* open-ended question with **no definable metric** belongs
to `x-anal` / `x-investigate`; this skill *defines* the metric when none exists.

## Non-negotiable rules (read first)

1. **A gate that asks wins.** If the host pauses for permission or approval at any
   step, stop and wait. This skill must never bypass, disable, or argue past a
   safeguard, and must never instruct the agent to proceed without asking.
2. **One atomic change per iteration.** Each experiment changes exactly one thing;
   `--changed <path>` records it and the state machine rejects a multi-path change.
3. **Bounded, always.** A hard `cap` limits the experiments. Hitting the cap without
   meeting the target means **escalate** — report the remaining gap and stop. No
   unbounded loop.
4. **The numbers decide.** The metric, the evaluator's pass flag, the guard, and the
   cap are recorded as `{ actual, expected, pass }`. `verify` re-derives the stop
   from those numbers and exits 0 only when the stop is justified.
5. **Keep or revert by policy.** `pass_only` keeps any candidate the evaluator
   passes; `score_improvement` keeps a candidate only when it passes **and** beats the
   held best by at least `min_delta`. Everything else is reverted; the held state
   only ever moves forward.

## The contract (what the loop must carry)

| Part | Meaning | Where it lives |
|------|---------|----------------|
| **metric** | the single number under study | `--metric` |
| **direction** | `maximize` or `minimize` | `--direction` |
| **target** | the number that ends the run | `--target` |
| **policy** | `score_improvement` \| `pass_only` | `--policy` |
| **evaluator** | a command printing `{"pass": bool, "score": number}`, **or** `agent` | `--evaluator` |
| **criteria** | N sub-questions/requirements (agent mode only) | `--criteria <n\|file>` |
| **guard** (optional) | a command whose exit 0 gates a keep | `--guard` |
| **search space** | allowed / forbidden change globs | `--allow`, `--forbid` |
| **noise** | `noise_runs` samples per evaluation, `min_delta` keep threshold | `--noise-runs`, `--min-delta` |
| **timeout** | per-experiment wall-clock limit | `--timeout` |
| **cap** | hard experiment limit before escalation | `--cap` |
| **history** | every experiment, kept or reverted, with its numbers | `results.tsv` + `state.json` |

## Evaluator kinds

### command (preferred when a command exists)

A command that prints `{"pass": bool, "score": number}` (or a bare number). The
loop runs it with a hard timeout via `scripts/evaluate.mjs`.

### agent (judged — no shell command)

When no command can score the goal — a topic to research, sources to compile, gaps
to close — score **criteria coverage** instead:

1. Define **N criteria** (sub-questions, requirements, sources). Pass them as
   `--criteria <n>` or `--criteria <file>` (one per non-empty line).
2. Each iteration, judge each criterion **met / unmet** and record
   `--coverage <k/n>` (k of n met): `score = k/n`, `pass = (k === n)`.
3. The target defaults to `1` (every criterion); the numeric gate compares the
   coverage ratio to the target, exactly like any other metric.

Record it honestly: the state stores `evaluator: "agent (coverage of N criteria)"`,
so the audit trail never claims a mechanical score no command produced.

## Procedure

### 1. Start — `scripts/state.mjs`
```bash
# command evaluator (preferred when a command exists)
node <skill>/scripts/state.mjs start \
  --slug reduce-bundle-size --goal "ship the smallest JS bundle" \
  --metric bundle_kb --direction minimize --target 120 \
  --policy score_improvement --min-delta 0.5 --noise-runs 3 --cap 12 --timeout 30000 \
  --evaluator "node tools/measure-bundle.mjs --json" \
  --guard "npm test --silent" \
  --allow "src/**,vite.config.*" --forbid "**/*.test.*,package.json"

# agent-judged (no command) — topic research toward coverage
node <skill>/scripts/state.mjs start \
  --slug llm-agents-in-2026 --goal "compile a sourced overview of LLM agent frameworks" \
  --metric criteria_coverage --evaluator agent --criteria criteria.md \
  --cap 12
```
Creates `.x-skills/research/<ts>-<slug>/` with `state.json`, `research.md`,
`research_log.md`, `results.tsv`, and prints the first action. For the agent mode
`--target` defaults to `1` and `--direction` to `maximize`. Completion: `state.json`
exists with `phase:"baseline"`.

### 2. Baseline
Measure the current value and record it. For a command evaluator run it once
(`scripts/evaluate.mjs` enforces the timeout and validates the JSON) and record
`--baseline <score|file>`; for the agent mode record the starting coverage:
```bash
node <skill>/scripts/state.mjs record --dir <dir> --baseline 180          # command
node <skill>/scripts/state.mjs record --dir <dir> --baseline --coverage 1/3   # agent
```
Completion: `phase:"iterate"` (or `done` if the baseline already meets the target).

### 3. Iterate — one atomic change at a time
For each experiment: make **one** change, then evaluate it. For a command
evaluator, `evaluate.mjs` runs the command with the configured timeout and emits
the normalized verdict; for the agent mode you supply the coverage verdict yourself:
```bash
node <skill>/scripts/evaluate.mjs --command "<evaluator>" --timeout 30000 --guard "<guard>" \
  > cand.json
node <skill>/scripts/state.mjs record --dir <dir> --candidate cand.json \
  --changed src/foo.js --change "inline the icon map"

# agent-judged: judge the criteria, then record coverage
node <skill>/scripts/state.mjs record --dir <dir> --candidate --coverage 2/3 \
  --changed research.md --change "add source for the third criterion"
```
`record` prints `{ next, stop, phase, iteration, reason, summary }` and decides:
- `next:"iterate"` — recorded; go make the next atomic change.
- `next:"done"` (`stop:true`) — target met; go to step 4.
- `next:"escalate"` (`stop:true`) — cap hit; report the open gap and stop.
A `--changed` list of more than one path fails the atomicity gate and the change is
reverted. For `noise_runs > 1`, pass `--samples a,b,c` (or several evaluator runs)
and the mean is used; fewer samples than `noise_runs` reverts the candidate.

### 4. Stop and verify
```bash
node <skill>/scripts/state.mjs verify --dir <dir>   # exit 0 iff the stop is justified
node <skill>/scripts/state.mjs status --dir <dir>
```
`verify` recomputes the metric-vs-target, evaluator, and guard gates from the
recorded numbers; exit 0 means the stop is justified, exit 1 means it is not (an
escalation is never "justified success" — it is a reported stop).

### 5. Report
The audit trail is written for you as the loop runs:
- `research.md` — goal, metric, direction, target, policy, evaluator, guard, search
  space, noise settings, timeout, cap, and the full history table.
- `research_log.md` — append-only event log, one line per baseline/experiment.
- `results.tsv` — machine-readable, one row per experiment.
- `final_report.md` — written at stop: outcome, stop reason, best value, gain, the
  evidence commands, the history, and (on escalation) the open findings.

Completion: `verify` exits 0, or the run escalated with a `final_report.md` naming
the gap.

## Repetition is host-owned

This skill ships **no runner**. Each invocation performs one experiment and returns;
the cadence that re-invokes it belongs to the host. `references/running-unattended.md`
has one short section per host (a host scheduler that re-delivers the prompt, or an
external shell loop that relaunches the agent until `verify` exits 0). Whatever the
host, its permission and approval gates still apply on every iteration.

## Output format

```markdown
# X-Research — <slug>

**Metric:** <metric> (<direction> → target <target>) · policy <policy>
**Evaluator:** <command | agent (coverage of N criteria)>
**Loop:** <n> experiments · baseline <a> → best <b> (+<gain>) · phase <done|escalate> · verify <✅|❌>

## Change
<what was held as the best state>

## Trail
- .x-skills/research/<dir>/state.json · research.md · research_log.md · results.tsv · final_report.md
```

## Next steps — which skill to use

| After | Next |
|-------|------|
| Target met, change should ship | `x-commit` (and `x-review` for the held diff) |
| Escalated (cap hit, target unmet) | `x-investigate` (root cause) or `x-plan` (a different approach) |
| The metric itself is unclear or contested | `x-anal` |
| You want the result reviewed before believing it | `x-roast --profile research` |

## Files

- `scripts/state.mjs` — pure, numeric loop state machine + `start` / `record` /
  `status` / `verify` CLI. Zero-dep, standalone: it never imports another skill's
  script, and every transition is a recorded `{ actual, expected, pass }` comparison.
  It carries both evaluator kinds — a command, or agent-judged criteria coverage.
- `scripts/evaluate.mjs` — runs the command evaluator (and optional guard) with a
  hard timeout and prints the normalized `{ pass, score }`. It is the mechanical
  evaluator the loop relies on; the agent mode needs no command and does not use it.
- `references/loop.md` — the state diagram, the gates, the two policies, and the two
  evaluator kinds.
- `references/running-unattended.md` — how each host owns repetition (no bundled runner).
