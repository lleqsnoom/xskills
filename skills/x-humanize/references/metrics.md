# Metrics reference — x-humanize

All formulas are the published standard forms. They are computed by
`scripts/utils/metrics.mjs` (pure, zero-dependency, Node built-ins only).

## Counts

| Metric | Definition |
|--------|-----------|
| words | alphabetic tokens after masking code/URLs (`tokenizeWords`) |
| sentences | markdown-aware units: headings, list items and blockquotes each count once; prose splits on `. ! ? …` |
| syllables | English heuristic (below) |
| polysyllables | words with 3+ syllables — the "complex word" of Gunning Fog / SMOG |
| characters | letters joined from words (no spaces) |
| hard words | words **not** on the familiar-word list (see below), length ≥ 5 |

### Syllable heuristic

Vowel groups + silent-e rule (`countSyllables`):

```
word <= 3 letters        -> 1
strip trailing es/ed/silent-e, strip leading y
count vowel groups (aeiouy, 1-2 chars)
```

It is an approximation — scores are close to, not identical with,
dictionary-based counters. Best on English.

### Familiar-word list

`references/familiar-words.json` — the **New Dale-Chall (1995)** list of ~2 942
easy American-English words (MIT, via `github.com/words/dale-chall`). Words
absent from the list are surfaced as simplification candidates. For a B2
target, the **Oxford 3000** (A1–B2) is the authority to consult when deciding
whether a word is really above the reader's level.

## Formulas

| Formula | Form | Source |
|---------|------|--------|
| Flesch Reading Ease | `206.835 − 1.015·(words/sentences) − 84.6·(syllables/words)` | Flesch 1948 |
| Flesch-Kincaid Grade | `0.39·(words/sentences) + 11.8·(syllables/words) − 15.59` | Kincaid et al. 1975 |
| Gunning Fog | `0.4·(words/sentences + 100·complex/words)` | Gunning 1952 |
| SMOG | `1.043·√(polysyllables·30/sentences) + 3.1291` | McLaughlin 1969 |
| ARI | `4.71·(chars/words) + 0.5·(words/sentences) − 21.43` | Smith + Senter 1967 |
| Coleman-Liau | `0.0588·L − 0.296·S − 15.8`, L=letters/100w, S=sentences/100w | Coleman + Liau 1975 |

SMOG needs ≥ 3 sentences and is normed on ~30-sentence samples; it returns
`null` below 3 and is low-confidence on short texts.

## Targets

`GRADE_TARGETS` — maximum acceptable Flesch-Kincaid grade for each reader:

| Level | Max FK grade | CEFR meaning |
|-------|-------------|--------------|
| A2 | 4 | basic user |
| B1 | 6.5 | threshold |
| **B2** | **9** | independent user (default) |
| C1 | 12 | operational proficiency |

CEFR estimate from FK grade (`cefrFromGrade`, approximate):
`<5 → A2`, `<7 → B1`, `<10 → B2`, `<13 → C1`, else `C2`.

Plain-language norms: average sentence 15–20 words; prefer active,
affirmative, declarative sentences (US OPM). A text is "easy for B2+" when it
sits at or below FK grade 9 and has few long sentences.

## Noise

`FILLER_PHRASES` / `FILLER_WORDS` flag wordy, meaning-free phrasing
("it is important to note that", "due to the fact that", "basically", "very"…).
The rewrite must **remove** these and must **never introduce** new ones;
`verify.mjs` fails when it does.

## Sources

- roughlogic.com/tools/alternate-readability — SMOG / Coleman-Liau / Gunning Fog / ARI forms
- readable.com — Flesch & Flesch-Kincaid bands; ~grade 8 target for general readers
- coe.int — CEFR global scale (B2 descriptor); takeielts.britishcouncil.org — B2 ≈ IELTS 5.5–6.5
- nationalstrategies / US OPM plain-language — 15–20-word sentence norm
- github.com/words/dale-chall (MIT) — New Dale-Chall familiar-word list
- oxfordlearnersdictionaries.com — Oxford 3000 (A1–B2 vocabulary)
