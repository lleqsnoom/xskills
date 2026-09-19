---
name: x-autoreflection-heal
description: Heal the skills an x-autoreflection-analysis report flagged — read the report, turn the top findings into exact edits with a check, propose them as a multi-select panel, and on approval apply the changes with a revert-on-failure ledger. Quality fixes (a session that fell short without failing) are proposals that name the rate they should move, never applied by the script, and a detector or check is never edited together with the skill it measures.
version: 1.1.0
author: Community
tags: [reflection, retrospective, self-improvement, fix, skills, healing]
user-invocable: true
---

# X-Autoreflection-Heal — from a Report to Approved Fixes

The analysis report says *what* is wrong; this skill says *exactly* how to fix it, asks the user which
fixes to make, and applies only those. A human always sees the proposed edits and triggers the
healing — the script never edits a skill it was not told to, and never touches a class it cannot
verify and revert.

## When to use

- After `x-autoreflection-analysis`, to act on its findings.
- "Heal the skills from that report", "apply the top fixes", "fix the flagged skills".
- When a single-session reflection produced a proposal you want applied with proof.

## Scenario

```bash
# step 1 — mint a plan from the analysis report
node <skill>/scripts/heal.mjs --mint "<run folder>/E00-analysis.json" --out "<run folder>/E01-heal.json"

# step 2 — open each target, fill find/replace/check, mark the mechanical ones auto

# step 3 — gate: every auto item names a target, a find and a check
node <skill>/scripts/check-heal.mjs --file "<run folder>/E01-heal.json"

# step 4 — the user picks, then apply
node <skill>/scripts/heal.mjs --plan "<run folder>/E01-heal.json" --apply F1,F3
node <skill>/scripts/heal.mjs --plan "<run folder>/E01-heal.json" --apply F1 --dry-run
```

## Procedure

### 1. Find the report

Use the newest `-analysis.json` in the run folder, or the path the user names. If no report exists,
stop and say so — healing needs `x-autoreflection-analysis` to have run first.

### 2. Mint the plan

```bash
node <skill>/scripts/heal.mjs --mint "<analysis.json>" --out "<run folder>/E<nn>-heal.json"
```

The plan carries one item per finding, with `id`, `skill`, `class`, `change` and `evidence` filled, and
`target`, `find`, `replace`, `check`, `auto` left for you to fill. Every finding becomes an item; a
finding you drop after reading its file gets deleted from the plan, not left empty.

### 3. Turn each top finding into an exact edit

Work down the findings in rank order (recurrence first). For each, **open the target file** before
naming a line — never edit a skill you have not read. Then fill the item:

```jsonc
{
  "id": "F1",
  "skill": "x-epic",
  "class": "doc-command-drift",
  "target": "skills/x-epic/SKILL.md",
  "find": "`--topic`",
  "replace": "`--slug`",
  "check": "node skills/x-skill-lint/scripts/lint.mjs",
  "auto": true
}
```

- **`find` must occur exactly once** in the target. Zero is stale, more than one is ambiguous — the
  applier refuses both rather than guessing.
- **`check` is a command that exits 0 once the fix is in.** Prefer a real gate (`x-skill-lint`, a test,
  `npm run check:run-folders`) over a re-read.
- **`auto: true` only for the four mechanical classes** — `doc-command-drift`, `missing-gate`,
  `panel-rule`, `contract-drift`. Anything that needs judgement (`script-hardening`,
  `missing-check`, `stopping-point`) stays `auto: false`: propose it, do not auto-apply it.
- **The six quality classes are never `auto`** — `rule-not-applied`, `missing-expectation`,
  `unbacked-report`, `depth-floor`, `ritual-cost`, `silent-success`. Each is a judgement about what a
  user expected. Fill their **`watch`**: the skill, the model, the anchor rate that should fall, and
  the window (`x-research user-redo per session on deepseek-v4-flash, next 14 days`). The next digests
  read it back, so a fix that moved nothing is visible and can be reverted.
- **A `missing-expectation` fix is one line in `skills/<x>/evals/expectations.json`**, in the user's
  words, with the finding in `source` (`{"skill", "expected_behavior": [...], "source": ["F2"]}`, at
  most seven lines). The first accepted finding creates the file; `x-skill-lint` checks its shape. The
  judge reads it next to `SKILL.md`, so an expectation the user once had to state is asked of every run.
- **Deltas, not rewrites.** `find` is one line or a short paragraph, and `replace` changes only what
  the finding needs. "Rewrite this section to be clearer" loses the detail the section was carrying —
  rewriting prompts wholesale is how a skill forgets the one line that mattered.
- **Never edit a measure with what it measures.** A detector or gate (`scan-session.mjs`,
  `reactions.mjs`, `check-reflection.mjs`, `gap-taxonomy.md`, the lint) or a skill's own `check-*`
  script is never edited in the same plan as a skill it measures, and never `auto`. Land the measure
  on its own first, reviewed, then heal against it.
- A `find`/`replace` that changes meaning, or a check you cannot write, is not an `auto` item.

A portfolio item is never an edit: record it in the panel as a proposal, not in the plan.

### 4. Gate the plan

```bash
node <skill>/scripts/check-heal.mjs --file "<run folder>/E<nn>-heal.json"
```

Exit **0** clean, **1** when an `auto` item lacks a target, find or check, or names a class outside the
auto whitelist; when a quality item has no `watch` (`item-watch`); when an item's check runs the file the
item edits (`check-edits-itself`); when a detector or check is `auto` (`auto-measure`) or shares a plan
with a skill it measures (`measure-and-measured`); **2** on a usage error. Fix and re-run.

### 5. Propose, then apply on approval

Render a **`multi`** panel listing the `auto` items — one option per fix, phrased as the change — and
let the user pick. On approval, apply only the picked ids:

```bash
node <skill>/scripts/heal.mjs --plan "<run folder>/E<nn>-heal.json" --apply F1,F3
```

Each item is applied, then its check runs; a failed check reverts the edit, so a skill is never left
broken. The result and the reason land in `heal-ledger.jsonl` beside the plan. Run `--dry-run` first
to print what would change without writing.

### 6. Report the ledger

Say what was applied, reverted, stale, and skipped — one line each. A `reverted` item is a result to
read, not silence: the check disagreed, so the fix was wrong and the report stays as the evidence. List
the quality items as proposals with their `watch`: the script never applies them, so whoever lands one
knows which number to read in the coming days.

## Panels

Define the four shapes inline at first use. The selection panel is `multi` (the user picks several
fixes at once). Ask in a panel, never in prose, and never bury a question in a paragraph.

## Constraints

1. **The human triggers healing.** The script applies only ids the user picked in the panel.
2. **Open the file before naming a line.** A `find` that was never read is a guess; guesses are not edits.
3. **Mechanical classes only, and reversible.** `auto` is four classes; everything else is a proposal.
4. **Proof or revert.** Every applied edit ran its check and passed; a failed check reverted it.
5. **Never silence the failure.** A reverted item stays reverted and named, not wrapped so the check passes.
6. **The measure is not edited with the measured.** Detectors, gates, taxonomies and a skill's own checks
   change only on their own, reviewed, never in a plan that also edits the skills they grade.
7. **Deltas, not rewrites.** Every edit is the smallest `find`/`replace` that answers the finding.

## Anti-patterns

- Applying every finding at once — heal the few most important, defer the rest.
- Marking `script-hardening` or `missing-check` as `auto` to get more through.
- A `check` that is a re-read ("open the file and confirm") rather than a command that exits 0.
- Leaving a dropped finding in the plan as an empty item — delete it.
- Proposing a portfolio `delete` as an edit — it is a decision, ask it in the panel, never auto-apply it.
- Marking a quality class `auto`, or leaving its `watch` empty.
- Loosening a check, a lint rule or a detector in the same plan as the edit it would have caught.
- Replacing a whole SKILL.md section when one line answers the finding.

## Files

- `scripts/heal.mjs` — mint a plan from an analysis report, then apply approved edits with a ledger.
- `scripts/check-heal.mjs` — fail while an auto item is unshaped or names a class outside the whitelist.
