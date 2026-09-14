# Worked roast — this skill's own first pass

A short example of tone and depth. The artifact was `x-roast` itself, scored on the `skill` profile.

**Profile:** skill · **Total:** 53 / 100 — weak · **Completeness:** 100%

## Central claim

The skill makes adversarial review reproducible: facts are verified, reasoning is attacked, and the
verdict is a weighted rubric score from a script rather than a feeling.

## Findings (excerpt)

- **accuracy (2/5)** — the documented profile list stopped at six, but `scripts/score.mjs:114` and
  `references/rubric.md:75` also ship `skill`. A skill roast silently fell back to `generic` and lost
  `triggers`/`procedure`/`verification`. Not a 1 because every other script claim checked out.
- **verification (3/5)** — `save-report.mjs` writes an empty template full of `<!--` comments and
  nothing checks it was filled, so a roast that stopped there still exited 0.

## Creative alternatives (excerpt)

1. `reframe` — make the artifact a ledger of claims (`claims.json`), so "verify before you penalize"
   is structural instead of a rule you trust the agent to follow.
2. `addition` — a contradiction loop: a refuted claim sends the reviewer back to step 2.
3. `restructure` — a thin `SKILL.md` contract plus `references/` and `evals/`.

## Improvement proposals (excerpt)

1. Document the `skill` profile and add skills/specs to the description → raises `triggers` 2→5.
2. Add `scripts/check-report.mjs` as the step 7 completion gate → raises `verification` 3→5.

## How to read a roast

- Every number cites a `file:line` or a URL — if it does not, the score is invalid.
- A low score names the anchor it missed (here: `triggers` = "the skill never says when to use it").
- Proposals are ordered by delta, so the cheap wins come first.