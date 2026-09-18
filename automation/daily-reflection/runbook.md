# Runbook — the daily x-skills reflection

Executed by the Orca automation **x-skills-daily-reflection** at 05:00 every day. It turns the last 24
hours of Crush sessions into a reviewable set of improvement proposals for the skills in `skills/`.

The run **never edits a skill**. It collects evidence, reflects on the worst sessions, and writes a
digest. The human picks which proposals to act on during the daily review — that decision is the point
of the automation, so this runbook stops before it.

## Before anything

1. `cd` to the repository root (`git rev-parse --show-toplevel`); everything below is relative to it.
2. Collect the evidence pack:

   ```bash
   node automation/daily-reflection/collect-sessions.mjs
   ```

   It prints one JSON line and writes `.x-skills/daily/<YYYY-MM-DD>/summary.json`,
   `summary.md` and `sessions/<uuid>.signals.json`. It exits **2** when it cannot collect; when that
   happens write the failure into `DIGEST.md` (step 4) and stop.
3. Read `summary.json`. It is the only source of numbers in this run: `hosts[]` (which CLI stores were
   read, and how many sessions each held), `counts`, `skills` (per-skill loaded / used / signals),
   `sessions[]` (host, stats, loaded skills, run folders, artifacts) and `signals[]` (severity,
   suspects, evidence). Sessions come from every CLI that keeps them on this machine, so check `hosts[]`
   before concluding a window was quiet: a host reported `absent` was never read, and a `0` beside a
   host that is `ok` is a real "nothing there".
4. Transcripts are in the `transcripts` directory named in `summary.json` (for example
   `/tmp/xskills-reflection/2026-09-16/`). They are megabytes each; read them there and never copy them
   into the repository.

## Order

| Step | What | Produces |
|------|------|----------|
| 1 | Collect the pack | `.x-skills/daily/<date>/{summary.json,summary.md,sessions/}` |
| 2 | Choose the sessions worth reflecting on | a short list, at most 4 |
| 3 | Reflect on each chosen session | `reflections/<session>/E00-reflection.md`, gated by `check-reflection.mjs` |
| 4 | Write the digest | `.x-skills/daily/<date>/DIGEST.md` |
| 5 | Re-render the pages, so the digest's proposals are on them | `<run folder>/report.html`, `.x-skills/daily/history.html` |

## Step 2 — choose the sessions

Reflect on sessions that carry friction **about a skill**, in this order:

1. A session whose signals name a skill that also appears in another session's signals. The same gap in
   two sessions is a defect, not a hypothesis.
2. Sessions with the most `high` signals.
3. Sessions where the user corrected the agent and a skill was loaded.

At most **4 sessions** per run. Never reflect on a session with no signals and no loaded skill.
A window where `counts.touchedSkills` is 0, or every signal is `low`, is a normal day: write the digest
in step 4 saying so and stop. Do not invent findings to fill it.

## Step 3 — reflect on one session

Follow `skills/x-autoreflection/SKILL.md`, with these rules for a headless run:

- **Read the transcript** at the path in `summary.json` before writing anything. Never reflect from the
  summary or from memory.
- **Mint the artifact** into the day's pack, one folder per session, and call this **once per session**
(`save-reflection.mjs` writes `E00` the first time, `E01`, `E02`… on later calls, so a second call
leaves an empty template behind):

  ```bash
  node skills/x-autoreflection/scripts/save-reflection.mjs \
    --slug <session-slug> --session "<session title>" \
    --output .x-skills/daily/<date>/reflections/<session-id>
  ```

- **Use the scan the pack already has**, do not re-run the scanner:

  ```bash
  node skills/x-autoreflection/scripts/check-reflection.mjs \
    --file .x-skills/daily/<date>/reflections/<session-id>/E00-reflection.md \
    --scan .x-skills/daily/<date>/sessions/<uuid>.signals.json
  ```

- **Verify every high signal** against the real file: open `skills/<name>/SKILL.md`, the script it told
  you to run, or the doc that promised the behaviour, and record **keep / re-grade / drop** with a
  reason. A drop is a result. Quote the offending line as `skills/<name>/SKILL.md:<line>`.
- **Shape every proposal** with `Signal`, `Target`, `Change` and `Check`, using
  `skills/x-autoreflection/references/gap-taxonomy.md` for the change. The `Check` must be a command
  that can run, not a re-read.
- **No panels.** This run is headless: the routing decision belongs to the human review, so fill
  `Routes` with a *proposed* route (direct edit, `x-fix`, `x-plan`) and leave it undecided.
- **Gate:** `check-reflection.mjs` must exit 0 before you move on. Fix each violation and re-run.
- **Every file under `reflections/` must be gated.** A session you read only to confirm a recurrence
  needs no artifact — name it in the digest's `Recurring` section instead. Before writing the digest,
  run the gate over every reflection file and delete any it rejects: an unfilled template is a stray,
  not a reflection, and it makes the pack claim work that was never done.

## Step 4 — write the digest

`DIGEST.md` is what the user opens in the morning. One file, in this shape:

````markdown
# Daily reflection — <date>

**Window:** last 24h · **Sessions scanned:** n · **x-skill sessions:** n · **High signals:** n
**Evidence:** `summary.md` · **Reflections:** `reflections/`

## Usage

| Skill | Sessions | Loaded | Used | Signals h/m/l |
|---|---|---|---|---|
| `x-plan` | 5 | 3 | 5 | 2/3/0 |

Never loaded or mentioned: …

## Proposals

### P1 — <skill>: <the one-line change> (from `<session id>`)
**Signal:** S3 (high, kept)
**Target:** `skills/<name>/SKILL.md:<line>`
**Change:** <concrete edit>
**Check:** <command that exits 0 once the fix is in>
**Proposed route:** direct edit / `x-fix` / `x-plan`

## Recurring

- <signal kind> in <session>, <session> — same gap twice, treat as a defect: <what to change>

## Reviewed

- [ ] P1 — accept / defer / drop
````

Rules for the digest:

- Every proposal comes from a gated reflection file; name which session it came from.
- Say how many sessions you read. One session is a hypothesis; the same signal in three is a defect.
- If there is nothing to propose, the digest is three lines: the window, the count, and "no x-skill
  friction in n sessions". Never pad it.
- Put the digest path in your final message, alone on the last line.

## Step 5 — render the pages

Collection already wrote a page per pack and the index, but it ran before the digest existed, so that page
carries only the items derived from the axes. Re-render once the digest is written:

```bash
node skills/x-autoreflection/scripts/render-report.mjs \
  --days 7 --digest .x-skills/daily/<date>/DIGEST.md --out .x-skills/daily/<date>/report.html
```

The movement page is written too — one row per skill in use, one column per recorded day, and the axis that
moved. It is the default page of `npm run report`, and the first thing to read in the morning.

It writes three things beside the pack:

| File | What it is |
|------|------------|
| `<pack>/report.html` | the window: a compact list, a matrix, a panel per skill, every open item |
| `<pack>/todos.md` | the same items as a checklist, one line each |
| `.x-skills/daily/history.html` | every day on record, one row per skill in use, and what moved |

`.x-skills/daily/history.jsonl` is the record those pages read: one 6 KB line per day, appended by the
renderer and **never pruned**, because packs are. That is what makes a trend possible at all — a pack
disappears after 14 days, its scores do not.

## Rules that span the steps

- **Never edit anything under `skills/`.** Propose, then stop. The review decides. Cleaning up the
  day's own pack (`.x-skills/daily/<date>/`) is allowed and expected.
- **Never commit, push, or open a pull request.**
- **One proposal per gap, not per signal.** Three failures of the same documented command are one
  proposal citing three messages.
- **Blame the instruction, not the agent.** "The SKILL.md did not say" is a gap; "I forgot" is not.
- **Budget:** at most 4 reflections and at most 10 proposals. Both are caps, not targets; a quiet day
  produces the short digest.
- **A gap another CLI caused is still a gap.** The transcripts come from every CLI on this machine, so
  a failing command in a Codex or OpenCode session is as much a finding as one in Crush. Cite the
  session id from `summary.json` either way.
- **Exit 0** on a completed digest, non-zero when collection failed.

## Safety

This run reads sessions and skill files and writes only under `.x-skills/daily/` (gitignored) and the
temp transcript directory. It reaches no other repository, sends nothing, and cannot change a skill.
