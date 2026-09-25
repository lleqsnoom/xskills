---
name: x-roast
description: Roast any non-code artifact — articles, analyses, specs, epics, tasks, research, or another skill — where the reviewer fact-checks the claims, attacks the reasoning, proposes better angles, and scores it on a weighted, anchored rubric computed by a script. Use for "roast this", "poke holes in", "review this spec/skill/analysis", or any request for a checked number and reason; the report names its reviewer (self or independent). For source code use x-review instead.
version: 1.5.0
author: Community
tags: [review, critique, roast, research, article, analysis, epic, task, evaluation, scoring, fact-check]
user-invocable: true
---

# X-Roast — Adversarial Review of Articles, Analyses, Specs, Epics, Tasks, Research, and Skills

Roast a document the way a hostile-but-fair expert reviewer would: verify the facts, attack the
reasoning, find the missing angle, then hand back concrete fixes. The score is a **weighted,
anchored rubric computed by a script**: the same dimension scores always give the same total, and a
check re-computes it. The dimension scores themselves are the reviewer's judgement. Anchors make them
consistent, not objective, so the report says who the reviewer was.

Use this for prose and planning artifacts. For **source code**, use `x-review` instead.

## When to use

- "Roast this", "poke holes in this", "review this spec", "second opinion on this".
- An article, analysis, spec, epic, task, research report, or **another skill** (`SKILL.md`).
- You need a critical second opinion before publishing or committing to a plan.
- You want a *number* and a *reason* — not "looks good".

Not for source code — use `x-review` there.

## Anti-gaming rules (read first)

1. **No score without evidence.** Every dimension score cites something the gate can check: a claim
   whose `Backs` names that dimension, a quote found in the artifact, or a `file:line` that exists.
2. **Never invent a source.** If you cannot fetch it, you do not cite it. Fabricated citations are a
   critical failure of the roast itself.
3. **Verify before you penalize.** Check a load-bearing claim online before scoring it low. A claim
   you could not check still caps `accuracy` at 4: it is not a penalty for being wrong, but a score
   of 5 says every claim was checked, and one was not.
4. **Score the artifact, not the author.** Blunt about work, never about a person.
5. **Provisional if partial.** If `completeness < 1` from the scorer, label the total provisional.
   A dimension that does not apply (say, `evidence` for a skill that makes no factual claim) is
   marked `--na evidence="why"` instead. `accuracy`, `logic`, `clarity` and `completeness` always
   apply: score them low, never mark them n/a.
6. **Say who is judging.** LLM evaluators favour their own generations, and the bias grows with how
   well a model recognises its own writing (Panickssery et al., <https://arxiv.org/abs/2404.13076>).
   The paper's evaluators were fresh calls with no memory of writing the text, so a fresh agent of
   your model carries the bias too: `independent` means **another model family, or a human**.
   Anything else is `Reviewer: self`. The report names the model either way (`--model`), and the
   author when known (`--author`); the gate refuses `independent` from the author's own family.
   For an independent roast, run this skill in another family's CLI and let it write the report:

   ```bash
   codex exec -m <model> "Use the x-roast skill on <path>; save with --reviewer independent --model <model> --author <author>"
   opencode run -m <provider/model> "..."     # or crush run -m <provider/model> "..."
   ```

## Procedure

### 1. Intake
Identify the artifact (path or pasted text) and its **profile**, which selects the rubric profile:

`article` · `analysis` · `research` · `epic` · `task` · `spec` · `skill` · `generic`

Use `spec` for a specification or requirements document (it adds `testability`), and `skill` when
the artifact is a `SKILL.md` (it adds `triggers`, `procedure`, `verification`). `generic` is for
anything that fits none of them.

Read it in full. If it is pasted text, save it to a file under the working directory first (the
run folder does not exist until step 7): the gate quotes from the artifact on disk. Write down its
**central claim in one sentence** — if you cannot, that is itself a finding (`clarity` and `logic`
suffer).

Completion: the profile is chosen and the central claim is one sentence.

### 2. Extract load-bearing claims
List the 3–8 claims the artifact depends on as rows of the report's `## Claims` table, each
**quoted word for word** from the artifact and marked `local` (checkable in-repo) or `external`
(needs the web). Skip anything decorative — only claims that, if false, collapse the work.

Name in each row's `Backs` the dimensions of the profile the claim bears on (`accuracy,
evidence`). A finding's claim id counts as evidence only for those dimensions, so `see C1` under
`clarity` does not pass unless C1 was declared to bear on clarity.

Completion: 3–8 rows in `## Claims`, each a quote with its kind and its `Backs`.

### 3. Verify online
For each `external` claim, actually fetch a source with your host's web tools (web search to find
it, web fetch to read it). Put the URL in the row's `Source`, and set its `Result` to `confirmed`,
`contradicted` or `unverified`. A `local` claim's source is the `file:line` or command that checked
it. Actively hunt for:

- **counter-evidence** — the strongest opposing case, not a strawman;
- **better sources** — primary over secondary, newer over older;
- **recency traps** — conclusions resting on superseded work.

If the web is unavailable, mark the claim `unverified` rather than guessing, and put the reason in
its `Source` ("web unavailable", "paywalled"). A `contradicted` claim caps `accuracy` at 2, and at 1
when the conclusion rests on it; an `unverified` one caps it at 4 (`references/rubric.md`, "The
accuracy caps"). The gate enforces the 2 and the 4. If a claim is contradicted, also drop whatever
the artifact rests on it: the `accuracy` finding names the claim and says whether the conclusion
rests on it, and anything built on it scores as unsupported.

Completion: every row has a result, every checked `external` row a URL, every `unverified` row a
reason, and every `contradicted` row is named in the `accuracy` finding with whether the conclusion
rests on it.

### 4. Score with the rubric
Open `references/rubric.md` and score each dimension of the profile with a whole number 1–5. Then
run the scorer — it is the source of truth for the total, the band, and the completeness ratio. The
scripts are in the `scripts/` folder beside this `SKILL.md`: use the skill's base directory your
host gives you, wherever the skill is installed (`~/.agents/skills/x-roast`, a project's
`.agents/skills/x-roast`, or another CLI's skills folder):

```bash
X=<this skill's folder>/scripts
node $X/score.mjs --profile task \
  --score testability=4 --score estimation=2 --score clarity=5 --score accuracy=3 \
  --score logic=4 --score evidence=3 --score originality=3 --score completeness=3 \
  --score actionability=4 --score balance=2
```

Add `--na dimension="reason"` for a dimension that does not apply, and `--report` to print only the
block the report's `## Score` section carries. A file works too (a bare `{ "dimension": 4 }` object,
or `{ "profile": "...", "scores": { }, "na": { } }`):

```bash
node $X/score.mjs --input scores.json --report
```

**Calibrate first, blind.** Every profile has two cases, a weak one and a strong one. List yours,
pick one whose answer this session has not seen, read its artifact, and score it before you score
your own. Never open `evals/calibration-answers.json`: it is the answer key, and
`--calibrate` reads it for you. A calibration done after reading it measures nothing. Two ways it
leaks by accident: a search over the repo (keep it out: `grep --exclude=calibration-answers.json`),
and an earlier roast's `**Calibration:**` line, which holds another reviewer's scores for that case.
Calibrate before you open an earlier report.

```bash
node $X/score.mjs --cases --profile skill
node $X/score.mjs --calibrate <case> --scores "accuracy=<n>,logic=<n>,…"   # every dimension of the profile
```

Score every dimension of the profile: a dimension left out counts as drift. It prints the report's `**Calibration:**` line, and exits 1 listing every dimension
more than 1 from the reference or not scored. Re-read those anchors before you score the real artifact: that is drift, and it
would be in your real scores too. The references are two models' agreement, not a human's (see
Files), so treat a drift as a reason to look again, not a verdict. If you cannot score blind (this session has seen
every answer of your profile, or the artifact *is* the case), write `**Calibration:** skipped —
<reason>`.

**For the `skill` profile, run what the skill ships.** If it has tests or scripts, run them.
`verification` asks whether completion is provable with a command, and a command that fails is
evidence, not an opinion.

The scorer prints `total`, `band`, `completeness` and a `breakdown`, plus five lists of problems
(`missing`, `unknown`, `outOfRange`, `invalid`, `naErrors`); `score.mjs --help` says what to do
about each. Never fill a gap yourself: fix the scores and re-run.

Completion: the calibration line is in hand (or the skip and its reason), the roasted skill's own
tests have run for the `skill` profile, and the scorer runs clean (`missing` empty or the total
labelled provisional, `unknown`, `outOfRange`, `invalid` and `naErrors` all empty).

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
(e.g. "raise `evidence` 2→4 if §2 cites the primary dataset"). A delta starts at the current score
or above, and goes up.

Completion: every proposal names a location and a delta on a scored dimension.

### 7. Report
Create the report file and write into it:

```bash
node $X/save-report.mjs --slug my-article --profile article \
  --artifact path/of/the/artifact.md --reviewer self --model <your model id> [--author <id>]
```

It prints `{ "path": ..., "created": true, "previous": ... }`. `REPORT` below means that path. When
the slug already has more than one run folder it stops and asks you to choose: `--run <nn>` joins
run R<nn>, and `--new-run` starts another.
`--artifact` is what makes a re-roast a re-roast: when an earlier critique of the same artifact (or
of the folder it is in) exists in any run folder, the new report opens with `## Since last roast`,
carrying the earlier total and every earlier proposal. Mark each `closed`, `open` or `regressed`,
with a few words why. Every dimension that rose must be named on a `closed` line, and a rise of 2
or more must show the fix there too (a `file:line` or a `command`). One that fell by 2 or more is
named on an `open` or `regressed` line. A score moves for a recorded reason, not because the
reviewer warmed to the work or went cold on it — and a reviewer re-roasting its own fixes is the
case that most needs it.

Fill in the rest: the total, the calibration line, the central claim, the claims, the `--report`
block, one finding per scored dimension, the alternatives and the proposals.

Completion is the gate: the report is done only when the checker exits 0.

```bash
node $X/check-report.mjs --file REPORT
```

Each violation names its rule, and `check-report.mjs --rules` lists them all. Two things no script
can check stay the reviewer's honesty: that a URL says what its row claims, and that a row's
`Backs` is true.

## Report format

````markdown
# Roast — {artifact}

**Date:** {written by save-report.mjs}
**Artifact:** {path}
**Reviewer:** self | independent — {model id, or human}
**Author:** {model id or human}   (only when known)
**Profile:** article | analysis | research | epic | task | spec | skill | generic
**Total:** 56.3 / 100 — weak
**Completeness:** 100%
**Calibration:** {the line score.mjs --calibrate printed, or: skipped — reason}

## Since last roast          (only on a re-roast)
**Previous:** {earlier report} — 48 / 100
- closed — {earlier proposal}: {why}
- open — ...

## Central claim
{one sentence}

## Claims
| # | Claim | Kind | Backs | Source | Result |
|---|-------|------|-------|--------|--------|
| C1 | "{quoted from the artifact}" | external | accuracy, evidence | {url} | confirmed |
| C2 | "{quoted}" | local | accuracy, logic | `file:line` or a command | contradicted |

## Score
```json
{the block from score.mjs --report}
```

## Findings
- **accuracy (4/5)**: {a claim backing accuracy, a quote, or a file:line}. {why this number, not 5}
- **logic (2/5)**: "{quote}". {the inference that fails}
...

## Creative alternatives
1. `reframe`: ...
2. `addition`: ...
3. `restructure`: ...

## Improvement proposals
1. {change} at {where} → raises `evidence` 2→4
````

## Next steps — which skill to use

| Result | Next skill |
|--------|-----------|
| Artifact needs rewriting/fixing | `x-fix` (drive it with the improvement proposals) or edit directly |
| It is a spec that failed review | `x-plan` (re-derive contract, invariants, tests) |
| It is a plan or task that failed review | `x-plan` (the layers) / `x-decompose` (the tasks) |
| It is a skill that failed review | edit the `SKILL.md`, then `x-skill-lint` (frontmatter, refs, README) |
| You need deeper root-cause work on a claim | `x-investigate` |
| You need to reproduce a failing claim | `x-reproduce` |

## Files

- `scripts/score.mjs` — weighted, anchored scorer with `--na`, `--report`, `--cases` and `--calibrate` (pure, importable, CLI at bottom).
- `scripts/save-report.mjs` — writes a numbered critique into the run folder, and carries the last roast of the same artifact into it.
- `scripts/check-report.mjs` — the gate: `--rules` lists what it checks, `--calibrate <case>` compares a roast with a reference.
- `references/rubric.md` — the anchored 1–5 definitions and profile map.
- `references/example-roast.md` — a worked roast of a calibration case, and a report that passes the gate.
- `evals/calibration.json` — frozen artifacts (`evals/calibration/`: a weak and a strong case for each of the eight profiles) to measure whether a roast agrees with their reference scores, which live apart in `evals/calibration-answers.json` so a case can be scored blind. The references are the skill author's. A second model family (DeepSeek) scored all 16 blind, and 147 of its 148 scores are within 1 of them (`score.mjs --agreement` prints the count without showing any score). The one disagreement is kept in `disputes` with its reason. That is agreement between two models, not a human standard.
- `evals/triggers.json` — trigger and near-miss queries for description tuning.
