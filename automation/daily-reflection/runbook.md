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
   node automation/daily-reflection/collect-sessions.mjs --classify
   ```

   It prints one JSON line and writes `.x-skills/daily/<YYYY-MM-DD>/summary.json`,
   `summary.md` and `sessions/<uuid>.signals.json`. It exits **2** when it cannot collect; when that
   happens write the failure into `DIGEST.md` (step 4) and stop.

   `--classify` has a model read every person's turn next to the reply before it
   (`skills/x-autoreflection/scripts/classify-turns.mjs`), through `crush run` with the Crush default
   model, from `~/.x-skills/turn-classifier` — a directory the Crush adapter never lists, so these runs
   are not scanned the next morning. What it finds becomes `user-pushback` (medium, unvalidated): it is
   shown, but it does not choose sessions until the labels validate it. If the model cannot be reached,
   `summary.json` → `classifier.failed` says so and the rest of the pack is unchanged; say it in the
   digest and carry on.
3. Read `summary.json`. It is the only source of numbers in this run: `hosts[]` (which CLI stores were
   read, and how many sessions each held), `counts`, `skills` (per-skill loaded / used / signals),
   `sessions[]` (host, model, opening request, stats, loaded skills, run folders, artifacts),
   `signals[]` (severity, suspects, evidence), `select` (the sessions to read, in order), `retries`
   (requests asked again in a later session), `audit` (today's quiet session), `verdictLines` and
   `labels` (the verdicts already read back from earlier digests). Sessions come from every CLI that
   keeps them on this machine, so check `hosts[]` before concluding a window was quiet: a host reported
   `absent` was never read, and a `0` beside a host that is `ok` is a real "nothing there".
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

Reflect on the sessions in `summary.json` → `select`, in that order. The collector ranked them so you do
not have to:

1. **Quality anchors first** — the user handed the work to someone else (`user-handoff`), asked the same
   thing again in a later session (`cross-session-retry`), refused a skill's step (`tool-rejected`),
   asked for the work again (`user-redo`), or a skill's script exited 0 and printed nothing
   (`skill-script-silent`). A session with any of these fell short of what the user expected even when
   nothing failed, and it outranks any amount of friction.
2. **One session per owning skill.** The owner's other anchored sessions are in `recurring`: name them
   in the digest's `Recurring` section, do not reflect on them separately.
3. **Friction after that**, in the old order: the worst severity, then the most recent.

Then read the `audit` session, if there is one: an interactive session with no anchor, drawn by the
date. It is the only way to learn what the anchors miss. Read it like the others; if nothing in it fell
short, say so in one line of the digest.

At most **4 sessions** plus the audit per run. Never reflect on a session `select` did not list. A day
whose `select` is empty and whose audit found nothing is a normal day: write the digest in step 4 saying
so and stop. Do not invent findings to fill it.

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
- **For a quality anchor, start at the anchor.** Read the messages around it, quote the user's words,
  and ask one narrow question: which line of the request or of the owner's `SKILL.md` did the reply
  before it not meet? The rules are in `skills/x-autoreflection/references/quality-judge.md`. An
  anchor whose answer is "the skill said it, the model did not do it" is `rule-not-applied`; one where
  the skill never said it is `missing-expectation`.
- **Shape every proposal** with `Signal`, `Target`, `Change` and `Check`, using
  `skills/x-autoreflection/references/gap-taxonomy.md` for the change. The `Check` must be a command
  that can run, not a re-read.
- **A `missing-expectation` proposal lands in the skill's `evals/expectations.json`**: one line, in
  the user's words, with the session's finding as its `source`. That file is where the bottom-up
  taxonomy grows — a proposal without it leaves nothing a judge can check next time.
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

## Verdicts

<the `verdictLines` from summary.json, pasted as they are>

## Reviewed

- [ ] P1 — accept / defer / drop
````

Rules for the digest:

- Every proposal comes from a gated reflection file; name which session it came from.
- Say how many sessions you read. One session is a hypothesis; the same signal in three is a defect.
- If there is nothing to propose, the digest is three lines: the window, the count, and "no x-skill
  friction in n sessions" — plus the `## Verdicts` section when `verdictLines` has lines. Never pad it.
- **Paste `## Verdicts` exactly as `verdictLines` gives it.** The reviewer ticks a line and keeps one of
  the three words; the next collection reads the ticked lines into `.x-skills/daily/labels.jsonl`, which
  is how every detector's precision is measured. Do not tick lines yourself, and do not reword them.
- Name each `cross-session-retry` in `Recurring` with both sessions: the earlier one fell short, the
  later one is the evidence.
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
