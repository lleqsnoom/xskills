# X-Roast Rubric

Anchored, reproducible scoring for critiques of **articles, analyses, epics, tasks, and research**.
Every dimension is scored **1–5**. Each level has a concrete anchor so two agents reading the
same artifact arrive at the same number. If you cannot point at evidence for a score, you may
not award it.

## Why anchors, not vibes

A score is only useful if it is *reproducible*. The anchors below turn "this feels weak" into
"logical validity = 2, because the conclusion in §3 does not follow from the evidence in §2".
The `scripts/score.mjs` tool then turns the numbers into a weighted total, a completeness ratio,
and a band. The same inputs always produce the same output.

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
| `accuracy` | 3 | Every checkable claim verified true; no errors found. | Mostly correct; one or two minor factual slips. | A load-bearing claim is false or unverifiable. |
| `logic` | 3 | Conclusions follow necessarily; assumptions stated. | Reasoning is mostly sound; one weak inference. | Non-sequitur, circular argument, or hidden assumption drives the conclusion. |
| `evidence` | 2 | Load-bearing claims cite primary, authoritative sources. | Some claims cited; others rest on assertion. | Claims are asserted with no source, or sources are secondary/low quality. |
| `originality` | 2 | Reframes the problem and adds insight not available elsewhere. | Competent synthesis of existing ideas. | Restates common knowledge with no added value. |
| `clarity` | 2 | Clear structure, defined terms, no ambiguity. | Understandable but uneven; some undefined terms. | Disorganized or ambiguous enough to mislead. |
| `completeness` | 2 | Covers the question fully; no major gaps. | Covers the core; notable omissions at the edges. | Ignores a major part of the question. |
| `actionability` | 1 | Reader knows exactly what to do next, and why. | A next step is implied but not specified. | No decision or action is enabled. |
| `balance` | 1 | Counterarguments and uncertainty handled explicitly. | Counterarguments mentioned briefly. | One-sided; uncertainty hidden or overstated. |

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

## Profiles (which dimensions apply)

| Profile | Dimensions |
|---------|-----------|
| `generic` | core 8 |
| `article` | core 8 |
| `analysis` | core 8 |
| `research` | core 8 + `method`, `recency` |
| `epic` | core 8 + `decomposition`, `acceptance` |
| `task` | core 8 + `testability`, `estimation` |

## Computing the total

`scripts/score.mjs` computes:

```
dimension_normalized = (score - 1) / (5 - 1) * 100
total                = Σ(normalized × weight) / Σ(weight of supplied dimensions)
completeness         = weight supplied / weight required by the profile
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

1. **Cite evidence per score.** Every number maps to a quote, a `file:line`, or a source URL.
2. **Verify before penalizing.** Online-check load-bearing claims before scoring `accuracy` or
   `evidence` low. If the web is unavailable, say so and keep the score, but mark it unverified.
3. **Do not invent sources.** A fabricated citation is a critical defect in the roast itself.
4. **Score the artifact, not the author.** Be blunt about the work; never about the person.
5. **Propose a delta.** Every improvement should name the dimension(s) it raises and by how much.
