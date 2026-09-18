---
name: x-autoreflection-analysis
description: Analyze past sessions across every CLI and write a detailed skill-health report — traverse the last 24h (or a window the user picks), aggregate friction signals per skill into ranked findings with an improvement class, and surface portfolio moves (create, merge, split, delete) as one JSON + markdown artifact that x-autoreflection-heal consumes.
version: 1.0.0
author: Community
tags: [reflection, retrospective, self-improvement, transcript, analysis, skills, batch]
user-invocable: true
---

# X-Autoreflection-Analysis — a Window of Sessions, One Skill-Health Report

A single session is a hypothesis; the same friction in three sessions is a defect. This skill reads
**every session of a window across every CLI** and turns them into one report: which skills are used,
where they stumble, how often the same gap recurs, and what structural moves the evidence suggests.

It produces the **one artifact the heal skill reads** — a JSON report (the source of truth) and a
markdown rendering of the same object, written together so they cannot drift.

## When to use

- "Analyze the last day of sessions", "what has been failing across my skills".
- "Give me a skill-health report for this week".
- Before acting on `x-autoreflection-heal`, or before a release, to see the shape of the window.
- When a single-session reflection (`x-autoreflection`) is not enough, because the question is
  *across* sessions, not *within* one.

## Scenario

```bash
# one command traverses, scans and writes the report
node <skill>/scripts/analyze.mjs --hours 24
node <skill>/scripts/analyze.mjs --hours 168 --host crush,codex

# gate: the report is shaped and carries evidence
node <skill>/scripts/check-analysis.mjs --file "<run folder>/E<nn>-analysis.json"
```

The traversal shells out to the sibling skill's reader and scanner (`skills/x-autoreflection/scripts/`
`read-session.mjs` and `scan-session.mjs`), which own the host adapters. Both skills ship in one
package and install side by side; `analyze.mjs` fails with a clear message if `x-autoreflection` is
missing. Pass `--scans <dir>` to skip traversal and aggregate `*-signals.json` files already on disk.

## Procedure

### 1. Confirm the window

Ask one panel before running — the window is the only input that changes what the report says.

| Panel | Shape | Options |
|-------|-------|---------|
| Window | `single` | last hour · last 24 hours · last 7 days · last 30 days |

A free-answer field lets the user type a custom hour count. Host scope is a flag, not a question:
default to every detected host, and mention `--host crush,codex` if they want to narrow it.

### 2. Run the analysis

```bash
node <skill>/scripts/analyze.mjs --hours <n>
```

It prints one JSON line naming the `E<nn>-analysis.json` and `E<nn>-analysis.md` it wrote, plus the
session, finding and portfolio counts. A window with no x-skill sessions still writes a report that
says so — a quiet day is a result, not a failure.

### 3. Read the report

Open the markdown. It has four parts: **Skills in use** (per-skill load/use/signal counts), **Findings**
(ranked, recurrence first), **Portfolio** (structural moves), and **Notes** (how to read the numbers).

### 4. Gate it

```bash
node <skill>/scripts/check-analysis.mjs --file "<run folder>/E<nn>-analysis.json"
```

Exit **0** clean, **1** when a finding lacks evidence or a portfolio item is unshaped, **2** on a usage
error. Fix each violation and re-run. Completion: `check-analysis.mjs` exits 0.

## The artifact

One object, two files. The JSON is the truth the heal skill consumes; the markdown is rendered from it.

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
  "portfolio": [
    { "id": "PF1", "action": "delete", "skills": ["x-triage"], "reason": "loaded but never used in 3 sessions", "evidence": [] }
  ],
  "notes": ["…"]
}
```

A finding is a **lead, not a verdict**: severity and the suspect skill are inherited from the scanner.
The heal skill opens each target before naming a line. A portfolio item is a **suggestion**: the four
actions — `create`, `merge`, `split`, `delete` — are decided by a human, never applied automatically.

### How findings and portfolio are derived

- **Findings** group signals by `(kind, primary suspect)`. Recurrence counts *distinct sessions*, so
  the same gap in three sessions is one defect, not three. Ranked recurrence first, then severity,
  then count. Each carries an improvement `class` from `gap-taxonomy.md`'s map and a `change` hint.
- **Portfolio** is mechanical where it can be: `delete` from `skill-unused` in ≥2 sessions, `split`
  when one skill's findings span ≥3 kinds, `create` from a recurring failure that names no skill.
  `merge` is a judgement call — the evidence is two skills fighting over one file or trigger — so the
  heal skill records it by hand from the same report.

## Panels

Define the four shapes inline at first use: `single` (one of several), `multi` (several at once),
`open` (free text), `confirm` (yes/no). Ask in a panel, never in prose, and never bury a question in a
paragraph.

## Constraints

1. **The script traverses, you judge the window.** Do not re-derive the report by hand; do not accept
   a window without confirming it.
2. **Evidence or silence.** Every finding cites a session and a message; the report claims nothing the
   scan did not see.
3. **Recurrence, not volume.** A finding's strength is how many sessions share it, never how many
   signals a single session produced.
4. **One artifact, two files.** Never edit the markdown by hand; `analyze.mjs` renders both from one object.
5. **Portfolio is proposed, not decided.** The report suggests `create`/`merge`/`split`/`delete`; only
   the user approves them.

## Anti-patterns

- Re-running `analyze.mjs` into the same run folder and leaving a stack of stray reports — use the run
  folder, or `--scans` to aggregate what is already there.
- Treating a `high` signal as a proven defect — it is a lead the heal skill must open a file to confirm.
- Comparing skills by raw signal count — a skill that ran 174 times and one that ran 6 are not comparable.
- Asking the window in prose, or guessing it when the user implied a different span.

## Files

- `scripts/analyze.mjs` — traverse + scan + aggregate, and write `E<nn>-analysis.{json,md}`.
- `scripts/check-analysis.mjs` — fail while a finding lacks evidence or a portfolio item is unshaped.
