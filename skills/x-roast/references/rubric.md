# X-Roast Rubric

Anchored, consistent scoring for critiques of **articles, analyses, specs, epics, tasks, research, and skills**.
Every dimension is scored with a **whole number 1–5**. Each level has a concrete anchor so two
agents reading the same artifact are more likely to agree; how often they do is measured against
`evals/calibration.json`, not assumed. If you cannot point at evidence for a score, you may not
award it.

## Why anchors, not vibes

A score is only useful if it is *consistent*. The anchors below turn "this feels weak" into
"`logic` = 2, because the conclusion in §3 does not follow from the evidence in §2".
The `scripts/score.mjs` tool then turns the numbers into a weighted total, a completeness ratio,
and a band. The same scores always produce the same total. The scores are still a judgement, and a
judge favours its own work, so a report names its reviewer (`self` or `independent`).

## Levels

| Score | Meaning |
|-------|---------|
| 5 | Exemplary — nothing material to add. Would survive expert scrutiny. |
| 4 | Strong — one small gap or imprecision; easily fixed. |
| 3 | Adequate — works, but a knowledgeable reader would want more. |
| 2 | Weak — a load-bearing part is missing, wrong, or unsupported. |
| 1 | Absent/broken — the dimension is not addressed, or is actively misleading. |

## Core dimensions (all profiles)

| Dimension | Weight | 5 | 3 | 1 |
|-----------|:------:|----|----|----|
| `accuracy` | 3 | Every checkable claim verified true; no errors found. | Mostly correct; one or two minor factual slips. | A load-bearing claim is false. |
| `logic` | 3 | Conclusions follow necessarily; assumptions stated. | Reasoning is mostly sound; one weak inference. | Non-sequitur, circular argument, or hidden assumption drives the conclusion. |
| `evidence` | 2 | Load-bearing claims cite primary, authoritative sources. | Some claims cited; others rest on assertion. | Claims are asserted with no source, or sources are secondary/low quality. |
| `originality` | 2 | Reframes the problem and adds insight not available elsewhere. | Competent synthesis of existing ideas. | Restates common knowledge with no added value. |
| `clarity` | 2 | Clear structure, defined terms, no ambiguity. | Understandable but uneven; some undefined terms. | Disorganized or ambiguous enough to mislead. |
| `completeness` | 2 | Covers the question fully; no major gaps. | Covers the core; notable omissions at the edges. | Ignores a major part of the question. |
| `actionability` | 1 | Reader knows exactly what to do next, and why. | A next step is implied but not specified. | No decision or action is enabled. |
| `balance` | 1 | Counterarguments and uncertainty handled explicitly. | Counterarguments mentioned briefly. | One-sided; uncertainty hidden or overstated. |

### The accuracy caps

The anchors and the gate say the same thing about a claim that did not check out:

| Worst claim in `## Claims` | `accuracy` |
|----------------------------|:----------:|
| `contradicted`, and the conclusion rests on it | 1 |
| `contradicted`, and the conclusion does not rest on it | at most 2 |
| `unverified` (the reason is in its Source) | at most 4 |

The gate enforces the two caps; whether a contradicted claim is load-bearing is the reviewer's call,
and the finding says which it is.

## Profile extras

### `research` — adds
| Dimension | Weight | Anchor |
|-----------|:------:|--------|
| `method` | 3 | Methods valid, appropriate to the question, and reproducible from the text. A 1 means the method cannot be repeated or does not answer the question. |
| `recency` | 1 | Sources current relative to how fast the field moves. A 1 means conclusions rest on superseded work. |

### `epic` — adds
| Dimension | Weight | Anchor |
|-----------|:------:|--------|
| `decomposition` | 3 | Sliced into increments that are independently valuable, independently testable, and roughly estimable. A 1 means slices depend on each other and deliver nothing until all are done. |
| `acceptance` | 3 | Each slice has explicit, testable acceptance criteria / definition of done. A 1 means "done" is undefined or subjective. |

### `task` — adds
| Dimension | Weight | Anchor |
|-----------|:------:|--------|
| `testability` | 3 | The definition of done can be verified by a third party with a command or check. A 1 means completion is a matter of opinion. |
| `estimation` | 2 | Effort/scope estimate is justified against comparable work. A 1 means the estimate is a guess with no basis. |

### `spec` — adds
| Dimension | Weight | Anchor |
|-----------|:------:|--------|
| `testability` | 3 | Every requirement can be verified by a third party with a command, a test or an observable behaviour. A 1 means whether the spec is met is a matter of opinion. |

### `skill` — adds
| Dimension | Weight | Anchor |
|-----------|:------:|--------|
| `triggers` | 3 | The situations and phrases that should fire the skill are stated up front. A 1 means the skill never says when to use it. |
| `procedure` | 3 | Steps are ordered and each ends on a completion criterion the agent can check. A 1 means the steps are unordered advice with no finish line. |
| `verification` | 3 | Completion is provable with a command, exit code, or artifact, not a judgement. A 1 means "done" is a matter of opinion. |

## Profiles (which dimensions apply)

| Profile | Dimensions |
|---------|-----------|
| `generic` | core 8 |
| `article` | core 8 |
| `analysis` | core 8 |
| `research` | core 8 + `method`, `recency` |
| `epic` | core 8 + `decomposition`, `acceptance` |
| `task` | core 8 + `testability`, `estimation` |
| `spec` | core 8 + `testability` |
| `skill` | core 8 + `triggers`, `procedure`, `verification` |

## Not applicable

A dimension that does not apply to this artifact is marked, not scored: `--na evidence="the skill
makes no factual claim"`. It leaves the profile, so it neither lowers the total nor makes it
provisional. The reason is required and shows in the report. Use it only when the anchor cannot be
met *or* failed by this kind of artifact. A dimension the artifact could meet and does not is scored
low, not marked n/a. `accuracy`, `logic`, `clarity` and `completeness` apply to every text with
claims, and the scorer refuses to mark them n/a.

## Computing the total

`scripts/score.mjs` computes:

```
dimension_normalized = (score - 1) / (5 - 1) * 100
total                = Σ(normalized × weight) / Σ(weight of supplied dimensions)
completeness         = weight supplied / weight required by the profile (minus n/a dimensions)
```

Weights are **normalized over the dimensions you supply**, so a partially-scored artifact still
yields a meaningful total — but `completeness` flags how much of the rubric was actually applied.
A total with `completeness < 1` must be reported as provisional.

## Bands

| Total | Band |
|-------|------|
| 90–100 | exemplary |
| 75–89 | strong |
| 60–74 | adequate |
| 40–59 | weak |
| 0–39 | raw |

## Scoring discipline

1. **Cite evidence per score.** Every number maps to a claim whose `Backs` names that dimension, a
   quote from the artifact, or a `file:line`; the gate checks each one it can.
2. **Verify before penalizing.** Online-check load-bearing claims before scoring `accuracy` or
   `evidence` low. If the web is unavailable, mark the claim unverified with the reason, and score
   `accuracy` at most 4 (see "The accuracy caps").
3. **Do not invent sources.** A fabricated citation is a critical defect in the roast itself.
4. **Score the artifact, not the author.** Be blunt about the work; never about the person.
5. **Propose a delta.** Every improvement should name the dimension(s) it raises and by how much.
