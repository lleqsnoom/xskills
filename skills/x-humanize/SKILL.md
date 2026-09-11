---
name: x-humanize
description: Simplify text, an article, a commit or PR to a B2 reading level — measure sentence length and complexity, cut noise, rewrite, then verify no meaning was lost. Use when asked to humanize, simplify, make easy to read, or plain-language a piece of prose.
version: 1.0.0
author: Community
tags: [writing, readability, simplification, plain-language, cefr, editing, prose]
user-invocable: true
---

# X-Humanize — Rewrite Prose to a B2 Reading Level, Verified

Take any prose — an article, a doc, a commit or PR description — measure it
objectively (sentence length, sentence complexity, vocabulary difficulty),
rewrite it so a **B2+ reader** understands it easily, then **prove** the result
with the same measurement plus meaning-preservation checks.

The number is the source of truth: a rewrite is never trusted until
`verify.mjs` passes. This mirrors `x-roast` (pure scorer + report), for prose
simplification instead of critique.

## When to use

- "Humanize this", "simplify this text", "make it easy to read", "plain-language this".
- A draft reads heavy and you want it at a target CEFR level.
- A commit/PR message is long and dense.

## Non-negotiable rules (read first)

1. **Preserve meaning.** Every fact, number, name, URL, link target, and code
   block stays exactly as it was. Simplify the *language*, never the *content*.
2. **No noise, no filler.** Delete wordy, meaning-free phrasing ("it is
   important to note that", "due to the fact that", "basically", "very").
   Never introduce new filler. If a phrase carries no meaning, remove it.
3. **No non-meaningful statements.** Do not add sentences that say nothing, pad,
   hedge, or restate the obvious. Add no new claims and no new content.
4. **Keep structure.** Headings, lists, and markdown formatting stay; only the
   prose inside changes.
5. **Verify before you finish.** Run `verify.mjs`. If it exits non-zero, fix and
   re-run. Do not report success on a failed check.

## Procedure

### 1. Intake
Identify the input and the target (`A2 | B1 | B2 | C1`; default **B2**). The
source can be a file, stdin, a git commit message, or a GitHub PR.

### 2. Measure — `scripts/analyze.mjs`
```bash
node <skill>/scripts/analyze.mjs draft.md --level B2 --output /tmp/x-humanize.json
node <skill>/scripts/analyze.mjs --stdin --level B1
node <skill>/scripts/analyze.mjs --commit HEAD          # git commit message
node <skill>/scripts/analyze.mjs --pr 42                # GitHub PR (needs gh)
```
Read the JSON: `level.cefr`, `level.fkGrade`, `metrics.avgSentenceLength`,
`metrics.longSentences`, `metrics.filler`, `hardWords`, and `sentences[]` (each
with `words`, `polysyllables`, `markers`, `passive`, `nominalizations`,
`filler`, `hardWords`, `score`). Completion: you can name the worst sentences
and why.

### 3. Get a ranked edit list — `scripts/rewrite-brief.mjs`
```bash
node <skill>/scripts/analyze.mjs draft.md | node <skill>/scripts/rewrite-brief.mjs --stdin --format md
```
This ranks sentences by score and gives a concrete action for each. Completion:
you have an ordered plan of which sentences to split, de-passive, de-nominalize,
or de-noise.

### 4. Rewrite (this is the agent's job, driven by the brief)
Apply the brief. Target: FK grade ≤ the target's max, average sentence 15–20
words, no sentence over 25 words unless unavoidable, plain verbs, active voice,
no noise. Keep every fact, number, URL, and code block. See
`references/simplifications.json` for common plain-word swaps.

### 5. Verify — `scripts/verify.mjs`
```bash
node <skill>/scripts/verify.mjs --original draft.md --revised draft.humanized.md --level B2
```
Checks: `target-met`, `no-noise-added`, `no-noise-phrases`, `urls-preserved`,
`code-preserved`, `numbers-preserved`, `meaning-retained`. **Exit 0 = pass.**
On failure, edit and re-run. Completion: exit 0.

### 6. Report — `scripts/save-report.mjs`
```bash
node <skill>/scripts/save-report.mjs --slug my-article --level B2
```
Fill `.x-skills/humanize/<ts>-<slug>.md` with the before/after JSON, the
verification result, the rewrites, and the noise removed.

### 7. Deliver
By default, present the simplified text and the report. Only overwrite the
source when the user asks for it (`--write` semantics): copy the verified text
over the original, or write a `<name>-humanized` sibling. Never apply an
unverified rewrite.

## Output format

```markdown
# Humanize — <document>

**Target:** B2 · **Before:** C1 (grade 12.4) · **After:** B2 (grade 8.1) ✅

## Verification
- target-met ✅ · no-noise-added ✅ · urls/code/numbers preserved ✅ · meaning-retained ✅

## Rewrites
- `12w → split` "…" → "…"
- `noise` "due to the fact that" → "because"

## Result
<the simplified text>
```

## Next steps — which skill to use

| After | Next |
|-------|------|
| Simplified text needs a critical review | `x-roast` |
| You want it committed | `x-commit` |
| You need a doc restructured, not just simplified | `x-plan` |

## Files

- `scripts/analyze.mjs` — measure + flag (pure; JSON out).
- `scripts/rewrite-brief.mjs` — ranked edit list + plain-word swaps.
- `scripts/verify.mjs` — target + meaning + noise checks; exit 0/1.
- `scripts/save-report.mjs` — timestamped report under `.x-skills/humanize/`.
- `scripts/utils/metrics.mjs` — pure metrics (formulas, syllables, noise).
- `scripts/utils/io.mjs` — input resolution (file / stdin / commit / PR).
- `references/metrics.md` — formula definitions, thresholds, CEFR map.
- `references/simplifications.json` — common hard→plain word swaps.
- `references/familiar-words.json` — New Dale-Chall word list (MIT).
