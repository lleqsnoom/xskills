# The window report, and the rules for acting on it

`improve.mjs` writes the report; this file says what is in it, how its parts are derived, and the rules
the heal stage follows. Read it after the run, not before: the numbers in the report are what make the
rules concrete.

## One artifact, two files

`E<nn>-analysis.json` is the truth; `E<nn>-analysis.md` is rendered from that same object, so the two
cannot drift. Never edit the markdown by hand — re-run `analyze.mjs` or `improve.mjs`.

```jsonc
{
  "schema": "x-autoreflection-analysis/1",
  "generatedAt": "2026-09-18 14:00",
  "window": { "hours": 24, "since": "…", "until": "…" },
  "stats": { "sessions": 41, "skillsTouched": 9, "signals": 128, "high": 12, "findings": 5, "portfolio": 2 },
  "skills": [ { "name": "x-plan", "sessions": 5, "loaded": 3, "used": 5, "unused": 0, "high": 2, "medium": 3, "low": 0 } ],
  "findings": [
    {
      "id": "F1", "kind": "tool-failure", "class": "doc-command-drift",
      "skill": "x-epic", "severity": "high", "recurrence": 3, "count": 5,
      "summary": "the documented flag does not match the script",
      "change": "align the documented command or flag with what the script actually accepts",
      "sessions": ["s1", "s2", "s3"],
      "evidence": [ { "session": "s1", "message": 12, "excerpt": "…" } ]
    }
  ],
  "retries": [ { "earlier": "crush:9bb1…", "later": "claude:5fe2…", "hours": 0.4, "overlap": 0.97, "excerpt": "…" } ],
  "select": [ { "session": "crush:9bb1…", "reason": "user-handoff", "owner": "x-plan", "model": "deepseek-v4-pro", "anchors": [] } ],
  "recurring": [ { "owner": "x-analyze", "sessions": ["…", "…"], "reason": "tool-rejected" } ],
  "audit": { "session": "crush:327d…", "model": "deepseek-v4-flash", "owner": null },
  "portfolio": [ { "id": "PF1", "action": "delete", "skills": ["x-triage"], "reason": "loaded but never used in 3 sessions", "evidence": [] } ],
  "notes": ["…"]
}
```

## Reading the markdown

- **Read first** — the sessions ranked by their quality anchors, one per owning skill, plus one quiet
  session to audit. These come before any friction-only session: a user who asked again or gave up is
  the evidence that a skill fell short, even when every command exited 0.
- **Asked again in a later session** — requests the user re-asked, earlier session first, since the
  earlier one is the one that fell short.
- **Skills in use** — per-skill load/use/signal counts. Never compare two skills by raw signal count: a
  skill that ran 174 times and one that ran 6 are not comparable.
- **Findings** — ranked, recurrence first.
- **Portfolio** — structural moves, as suggestions.
- **Notes** — how to read the numbers, including what failed and what was skipped.

## How the parts are derived

- **Findings** group signals by `(kind, primary suspect)`. Recurrence counts *distinct sessions*, so the
  same gap in three sessions is one defect, not three. Ranked recurrence first, then severity, then
  count. Each carries an improvement `class` from `gap-taxonomy.md` and a `change` hint.
- **Quality anchors are findings too.** `user-redo` and `user-handoff` map to `missing-expectation`,
  `tool-rejected` to `ritual-cost`, `skill-script-silent` to `silent-success`. Their suspect is the
  **owner** — the skill in charge at that moment — so the same shortfall in three sessions of one skill
  reads as one defect of that skill. An `interrupt` is only context: it says the user stopped a turn,
  not why. Model-read `user-pushback` is a finding marked unvalidated by its summary.
- **Retries, reading order and audit** come from `anchors.mjs`: a later session that opens with most of
  an earlier one's request (≥50% overlap, within 48 h, automation prompts excluded) makes the earlier
  session a `cross-session-retry`; sessions rank handoff > retry > rejected step > redo > silent script
  > friction, one per owning skill; and one interactive session with no anchor is drawn as the audit.
  Headless runs (a sub-agent session, `claude -p`, the daily automation) are left out of all three.
- **Portfolio** is mechanical where it can be: `delete` from `skill-unused` in ≥2 sessions, `create`
  from a recurring failure that names no skill. `merge` and `split` are judgement calls — no scan signal
  can tell that a skill mixes two jobs, only that it was used a lot — so record them by hand after
  reading the skills.
- **A regression is a model change until proven otherwise.** Skills are prompts, and prompts are coupled
  to the model they were tuned on. When a skill's shortfall rate moves against its own history, first
  check whether the model mix under that skill moved with it (`summary.json` carries `model` per
  session): say "regressed under deepseek-v4-pro only" or "regressed under the same model" in the
  finding, so the fix is not aimed at a skill when the model changed under it.

## The heal rulebook

`improve.mjs` mints `E<nn+1>-heal.json` with one item per finding. The item's number is the proposal's
identity everywhere after this: the panel, `--apply`, the ledger.

```jsonc
{
  "id": "F1",
  "skill": "x-epic",
  "class": "doc-command-drift",
  "issue": "tool-failure in 3 sessions: the documented flag does not match the script",
  "severity": "high",
  "recurrence": 3,
  "count": 5,
  "scores": { "sessions": 5, "loaded": 3, "used": 5, "unused": 0, "high": 2, "medium": 3, "low": 0 },
  "improvement": "tool-failure signals on x-epic: 5 across 3 sessions → none in the next 14 days",
  "target": "skills/x-epic/SKILL.md",
  "find": "`--topic`",
  "replace": "`--slug`",
  "check": "node skills/x-skill-lint/scripts/lint.mjs",
  "auto": true,
  "change": "align the documented command or flag with what the script actually accepts",
  "evidence": []
}
```

- **`find` must occur exactly once** in the target. Zero is stale, more than one is ambiguous — the
  applier refuses both rather than guessing.
- **Open the target before naming a line.** A `find` that was never read is a guess; guesses are not edits.
- **`check` is a command that exits 0 once the fix is in.** Prefer a real gate (`x-skill-lint`, a test,
  `npm run check:run-folders`) over a re-read ("open the file and confirm" is not a check).
- **`auto: true` only for the four mechanical classes** — `doc-command-drift`, `missing-gate`,
  `panel-rule`, `contract-drift`. Anything that needs judgement (`script-hardening`, `missing-check`,
  `stopping-point`) stays `auto: false`: propose it, do not auto-apply it.
- **The six quality classes are never `auto`** — `rule-not-applied`, `missing-expectation`,
  `unbacked-report`, `depth-floor`, `ritual-cost`, `silent-success`. Each is a judgement about what a
  user expected, and each names its `watch`: the skill, the model, the anchor rate that should fall, and
  the window (`x-research user-redo per session on deepseek-v4-flash, next 14 days`). The next digests
  read it back, so a fix that moved nothing is visible and can be reverted.
- **A `missing-expectation` fix is one line in `skills/<x>/evals/expectations.json`**, in the user's
  words, with the finding in `source` (`{"skill", "expected_behavior": [...], "source": ["F2"]}`, at most
  seven lines). The first accepted finding creates the file; `x-skill-lint` checks its shape. The judge
  reads it next to `SKILL.md`, so an expectation the user once had to state is asked of every run.
- **Deltas, not rewrites.** `find` is one line or a short paragraph, and `replace` changes only what the
  finding needs. "Rewrite this section to be clearer" loses the detail the section was carrying —
  rewriting prompts wholesale is how a skill forgets the one line that mattered.
- **Never edit a measure with what it measures.** A detector or gate (`scan-session.mjs`,
  `reactions.mjs`, `anchors.mjs`, `check-reflection.mjs`, `analyze.mjs`, `heal.mjs`, `gap-taxonomy.md`,
  `quality-judge.md`, the lint) or a skill's own `check-*` script is never edited in the same plan as a
  skill it measures, and never `auto`. Land the measure on its own first, reviewed, then heal against it.
  `check-heal.mjs` enforces this with `measuresOf`.
- **A portfolio item is never an edit.** Record it in the panel as a proposal, not in the plan.
- **A dropped finding is deleted from the plan**, not left as an empty item.

`check-heal.mjs` exits **0** clean, **1** when an item lacks a target, an issue, a rate, or — for an
`auto` item — a find or a check; when an item names a class outside the auto whitelist; when a quality
item has no `watch`; when an item's check runs the file the item edits; when a detector or check is
`auto` or shares a plan with a skill it measures; **2** on a usage error.
