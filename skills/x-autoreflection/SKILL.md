---
name: x-autoreflection
description: Reflect on a session and improve the skills it used — read the transcript of this or an earlier session, mechanically extract friction signals (failed commands, repeated calls, user corrections, loaded-but-unused skills, questions asked in prose), check each against the real skill files, and turn the survivors into evidence-backed proposals with a target file and a check, then route them to a fix, a spec, or tasks.
version: 1.0.0
author: Community
tags: [reflection, retrospective, self-improvement, transcript, session, process-improvement, skills]
user-invocable: true
---

# X-Autoreflection — Turn a Session's Friction into Skill Improvements

A session is a test run of the skills it used. This skill reads that transcript, finds where the
skills made the agent stumble, and proposes concrete edits to those skills — each one citing the
message it came from and naming the file to change.

The friction is found by a **script, not a feeling**: `scan-session.mjs` extracts signals from the
transcript, so two agents reading the same session start from the same evidence. Judgement about
what to change is yours.

## When to use

- "Reflect on this session", "what went wrong above", "retro", "retrospective".
- "Improve the skills based on what just happened".
- A skill felt wrong while you used it and you want the fix written down rather than remembered.
- Before a release, run it over the last few sessions and look for the same gap recurring.

For one artifact, use `x-roast`. For source code, use `x-review`. This skill reviews **the session**,
which is the only thing that shows a skill's instructions failing in practice.

## Scenario

```bash
# step 1 — find and export the session (this one, or an earlier one)
node <skill>/scripts/read-session.mjs --list
node <skill>/scripts/read-session.mjs --session last --out /tmp/session.json
node <skill>/scripts/read-session.mjs --file <raw.json> --out /tmp/session.json

# step 2 — extract the friction signals
node <skill>/scripts/scan-session.mjs --input /tmp/session.json --out /tmp/signals.json

# steps 3-4 — mint the artifact, then verify and propose into it
node <skill>/scripts/save-reflection.mjs --slug <slug> --session "<title>"

# step 5 — gate: every high signal has a verdict, every proposal a target and a check
node <skill>/scripts/check-reflection.mjs --file "<run folder>/E<nn>-reflection.md" --scan /tmp/signals.json
```

| Gate | Passes when | Checked by |
|------|-------------|-----------|
| `session_loaded` | a transcript was read and has at least one user message and one tool call | `read-session.mjs` reports non-zero counts |
| `signals_recorded` | `scan-session.mjs` ran and its JSON is in the reflection | `check-reflection.mjs` (empty `Signals` section) |
| `signals_verified` | every high signal was checked against the real file and kept, re-graded, or dropped | *contract* — the checker sees a verdict, not the reading |
| `no_open_questions` | every question was asked as a panel and answered | *contract* — `check-questions.mjs` checks the questions, not the session |
| `proposals_shaped` | each proposal has a `Signal`, `Target`, `Change`, and `Check` line | `check-reflection.mjs` (`proposal-shape`) |
| `high_signals_answered` | every `high` signal has a keep / re-grade / drop verdict, and a kept one is cited by a proposal | `check-reflection.mjs` (`unanswered-high`, `kept-without-proposal`) |
| `scan_is_evidence` | the scan reports messages and tool calls, so it is a session and not a stub | `check-reflection.mjs` (`scan-not-evidence`) |
| `reflection_checked` | `check-reflection.mjs` exits 0 | the exit code |
| `route_chosen` | the user picked which proposals to pursue | *contract* — recorded in `Routes` |

The starred rows are contracts, not commands: nothing can verify that you read a file or rendered a
panel. Keep them honest yourself, and do not let the machine-checked rows imply the others.


Read the transcript before asking anything, ask every question as a panel
(`references/questions.md`) and let `scripts/check-questions.mjs` check the questions first. Turn a
signal into a proposal with the map in `references/gap-taxonomy.md` — never from memory.

## Procedure

### 1. Pick the session

```bash
node <skill>/scripts/read-session.mjs --list          # host, id, title, modified — most recent first
```

`--list` asks every CLI that keeps sessions on this machine, through the adapters in `scripts/hosts/`:
Crush (its own `session list|show --json`), Codex (`sessions/**/rollout-*.jsonl`) and OpenCode
(`opencode db` and `opencode export`). Narrow it with `--host crush,codex`. A store that is missing is
reported as `absent` rather than left out, so an empty list says which CLIs were looked at.

`--session <id>` finds the id in whichever host owns it; `--session last` is Crush's own word for the
session you are in, and no other CLI defines it. Neither command is guaranteed by a CLI's README — it
is whatever the installed binary supports — so if one disappears after an upgrade, the import fails
with a usage error rather than a bad scan. Fall back to exporting the JSON yourself and passing
`--file <path>`; any host's dump works as long as it has `meta` and `messages`, and `--file` accepts an
already-normalized export too. To add a CLI the list does not know yet, add one adapter to
`scripts/hosts/`: `id`, `label`, `detect`, `list`, `read`, and nothing else.

Default to the current session (`--session last`), which is usually the one that just frustrated
you. When more than one session is a plausible candidate, ask with a `single` panel listing the
titles; never guess between them.

Export it somewhere outside the repo, because a transcript is megabytes:

```bash
node <skill>/scripts/read-session.mjs --session last --out /tmp/session.json
```

The transcript is clipped on purpose — tool results and reasoning to 600 characters — so keep the
export in `/tmp` and only the reflection in the run folder. Prose is **not** clipped: a session is
roughly 1% prose by volume, and an elided sentence both cites badly and feeds the question detector a
fragment shorter than the line it came from.

Completion: one session is chosen, and its export reports a non-zero message count.

### 2. Scan for friction

```bash
node <skill>/scripts/scan-session.mjs --input /tmp/session.json --out /tmp/signals.json
```

It prints JSON: `stats`, the skills that were `loaded` and `used`, the run folders and artifacts the
session touched, and `signals` — each with a `kind`, a `severity`, the `suspects` (skills the signal
points at), and `evidence` (message index plus a quoted excerpt).

Writing the scan beside the reflection (`--out "<run folder>/signals.json"`) lets the checker find
it on its own, so the artifact carries the evidence it was judged against.

A session with no tool calls yields no signals, and the failure markers the scanner knows are Crush's
words for a failed call (`Exit code N`, an edit that did not match, a leading `Error:`). Another
host's transcript still scans, but its own wording may leave a real failure unnamed. Say so plainly
rather than inventing findings.

Completion: the scan JSON is written and its `stats` are read.

### 3. Verify every signal against the real file

A signal is a lead, not a finding. For each `high` (and each plausible `medium`):

1. Open the file the signal points at — `skills/<name>/SKILL.md`, the script it told you to run, or
   the doc that promised the behaviour.
2. Decide: **keep** (the file really is wrong or unhelpful), **re-grade** (real friction, but not
   that skill's fault), or **drop** (the transcript misled the scanner — e.g. `grep` exiting 1
   because it found nothing, which is the answer, not a failure).
3. For a kept signal, quote the offending line with a `file:line`.

Dropping a signal is a result, not a failure. Record what you dropped and why, so the next
reflection does not re-litigate it.

A gap you found by reading rather than from a signal gets the id **`manual`** — write
`- **manual (medium, kept)** — …` and cite `**Signal:** manual` in its proposal. Not every defect
leaves a failed command; a wrong-but-successful output leaves nothing for the scanner to see.

Signals you are answering together — the low repeats, or a crowd of `expected-exit` misses — take
the id **`group`**: `- **group (low, dropped)** — S4, S11 …`. A grouped verdict never satisfies a
`high` signal: those each need their own line, so a gate can never be quietened by bundling.

Completion: every high signal has a keep / re-grade / drop verdict with a reason.

### 4. Turn signals into proposals

Use `references/gap-taxonomy.md` to pick the improvement for each signal kind, then shape it:

```markdown
### P1 — <signal kind>: <the one-line change>
**Signal:** S3
**Target:** `skills/x-example/SKILL.md:64`
**Change:** <what to write, concretely enough that someone else could make the edit>
**Check:** `node skills/x-example/scripts/check.mjs` exits 0
```

Rules:

- **One proposal per gap, not per signal.** Three failures of the same documented command are one
  proposal citing three messages.
- **Every proposal names a target and a check.** A proposal you cannot check is a wish.
- **Prefer the smallest durable fix.** A missing flag belongs in the script; a wrong instruction
  belongs in the prose; a pattern that keeps recurring belongs in a test or the linter.
- **Ship the check with the fix.** If the gap was "a documented command that cannot run", the check
  is usually a new test or a `x-skill-lint` rule, not a re-read.

Completion: every high signal has a verdict, and every kept finding has a proposal with its four
lines filled.

### 5. Write the reflection, then gate it

```bash
node <skill>/scripts/save-reflection.mjs --slug <slug> --session "<session title>"
node <skill>/scripts/check-reflection.mjs --file "<run folder>/E<nn>-reflection.md" --scan /tmp/signals.json
```

Pass `--slug <slug>` of the run you are reflecting on so the reflection lands in that run folder
beside the artifacts it critiques; the scan lists every run folder it saw. Add `--run <nn>` when
that slug has more than one run. The checker exits **0** when the reflection is filled in, **1**
when a proposal is missing a line, a high signal has no verdict, or the scan is too thin to be
evidence, and **2** on a usage error. Fix each violation and re-run.

Completion: `check-reflection.mjs` exits 0.

### 6. Route the proposals

Ask which proposals to act on with a `multi` panel, then record the choice. Route by size:

| Proposals | Route |
|-----------|-------|
| One small edit, clear target | Edit it, then `x-skill-lint` |
| Several independent edits with checks | `x-fix` driven by this reflection |
| A gap that needs a design decision | `x-plan` (the reflection is the evidence pack) |
| Repeated across many sessions | `x-plan` → `x-epic` → `x-decompose` |
| Cannot be reproduced or explained yet | `x-investigate` with the signal evidence |

Say which sessions you read. A proposal drawn from one session is a hypothesis; the same signal in
three sessions is a defect.

Completion: the user picked, and each chosen proposal has a route and a next action.

## Reflection format

````markdown
# Reflection — <session title>

**Session:** <id> · <created> → <modified>
**Written:** YYYY-MM-DD HH:mm
**Messages:** <n> · **Tool calls:** <n> · **Tool failures:** <n> · **Panels asked:** <n>
**Skills loaded:** x-plan, x-roast · **Skills never used:** x-roast

## Signals

```json
<the scan JSON from scan-session.mjs>
```

## Gaps

- **S3 (high, kept)** — `x-example` documents `--topic`, the script rejects it. `x-example/SKILL.md:64`
- **S7 (medium, dropped)** — `grep` exited 1 because the match was absent; correct behaviour.
- **manual (low, kept)** — something you saw while reading, which no exit code recorded.

## Proposals

### P1 — doc-command-drift: teach the SKILL.md the flag the script already has
**Signal:** S3
**Target:** `skills/x-example/SKILL.md:64`
**Change:** replace `--topic` with `--slug`, and show the `--run` flag in the same block.
**Check:** `node skills/x-skill-lint/scripts/lint.mjs` exits 0, plus a `save-spec` CLI test.

## Routes

- P1 → direct edit, then `x-skill-lint`
````

## Constraints

1. **Evidence or silence.** A proposal must quote a message index, a `file:line`, or a command. No
   "the skill could be clearer".
2. **The script finds, you judge.** Do not report a raw signal as a finding; verify it first.
3. **Never propose a change to a skill you did not open.** Read the file before naming a line.
4. **Blame the instruction, not the agent.** "The SKILL.md did not say" is a gap; "I forgot" is not.
5. **Small, checkable fixes win.** A proposal whose check cannot be run is not finished.
6. **Two panels at most** — one to choose the session and the proposals, one `confirm` before
   writing. Do not interview the user.
7. **Ask as a panel.** Never ask in prose and never bury a question in a paragraph.

## Anti-patterns

- Reporting the scanner's output as the analysis
- A proposal with no target file ("the docs should be better")
- Treating every non-zero exit as a defect — `diff` and `grep` exit 1 to mean "different" and "absent"
- Reflecting on a session you never read, from memory or from the summary
- Proposing a new skill when a sentence in an existing one is the fix
- Editing the skill mid-reflection: write the proposal, route it, then change the file

## Files

- `scripts/read-session.mjs` — lists and exports a session transcript as normalized JSON.
- `scripts/scan-session.mjs` — extracts friction signals, suspect skills, and run folders.
- `scripts/save-reflection.mjs` — writes `<run folder>/E<nn>-reflection.md`.
- `scripts/check-reflection.mjs` — fails while a proposal is unshaped or a high signal has no verdict.
- `scripts/check-questions.mjs` — enforces the panel rules on your questions file.
- `references/gap-taxonomy.md` — signal kind → the improvement that answers it.
- `references/questions.md` — how to ask as a panel, and when to stop asking.
