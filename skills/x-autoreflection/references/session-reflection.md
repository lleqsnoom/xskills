# Reflecting on one session

The window run in `SKILL.md` answers "what is failing across my sessions". This is the other mode: one
session, read closely, because a single session is a test run of the skills it used. Use it when the
friction is still fresh, or when a window report flagged one session worth reading properly.

Read the transcript before asking anything, ask every question as a panel (`references/questions.md`)
and let `scripts/check-questions.mjs` check the questions first. Turn a signal into a proposal with the
map in `references/gap-taxonomy.md` — never from memory.

## 1. Pick the session

```bash
node <skill>/scripts/read-session.mjs --list          # host, id, title, modified — most recent first
```

`--list` asks every CLI that keeps sessions on this machine, through the adapters in `scripts/hosts/`:
OpenCode, Claude Code, Codex, Gemini CLI, Cursor, Cline, Roo Code, Kilo Code, Goose, Crush, Qwen Code and
GitHub Copilot CLI. Narrow it with `--host crush,codex`. A store that is missing is reported as `absent`
rather than left out, so an empty list says which CLIs were looked at, and a store whose layout the
adapter does not recognise says so in its warnings instead of reporting nothing to review.

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

## 2. Scan for friction and quality anchors

```bash
node <skill>/scripts/scan-session.mjs --input /tmp/session.json --out /tmp/signals.json
```

It prints JSON: `stats`, the session's `model`, its opening `request`, the skills that were `loaded`
and `used` (a name seen only in a tool's output or an injected skill body is `mentioned`, not used),
the run folders and artifacts the session touched, and `signals` — each with a `kind`, a `severity`,
the `suspects`, and `evidence` (message index plus a quoted excerpt). For a quality anchor the suspect
is the **owner**: the skill invoked, loaded, or whose script ran just before the moment — not every
skill the session touched.

The anchors, and what each usually means, are in `references/gap-taxonomy.md`. An `interrupt` is only
context: it says the user stopped a turn, not why. The next user turn usually says why.

**Optional: let a model read the user's turns.** Plain words find few real complaints ("NOOO we ONLY
want…", "IDK how to open it"); a small model reading each turn next to the reply before it finds most
of them. `classify-turns.mjs --prompt` builds the prompt, any model answers it, `--labels` reads the
answers back, and `scan-session.mjs --turns` adds them as `user-pushback`. Treat those as unvalidated
leads — they never outrank the anchors above.

Writing the scan beside the reflection (`--out "<run folder>/signals.json"`) lets the checker find
it on its own, so the artifact carries the evidence it was judged against.

A session with no tool calls yields no signals, and the failure markers the scanner knows are Crush's
words for a failed call (`Exit code N`, an edit that did not match, a leading `Error:`). Another
host's transcript still scans, but its own wording may leave a real failure unnamed. Say so plainly
rather than inventing findings.

Completion: the scan JSON is written and its `stats` are read.

## 3. Verify every signal against the real file

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

**A quality anchor is judged at the anchor, never across the whole session.** Follow
`references/quality-judge.md`: read the anchor's message and the reply the user reacted to, open what
the session produced, and answer one narrow question — which line of the request or of the owner's
`SKILL.md` did that reply not meet? Quote both. When no line says it, the finding is that the skill
never said it. For each kept anchor write one `## Quality` line: the user's words, then the skill line.

Signals you are answering together — the low repeats, or a crowd of `expected-exit` misses — take
the id **`group`**: `- **group (low, dropped)** — S4, S11 …`. A grouped verdict never satisfies a
`high` signal: those each need their own line, so a gate can never be quietened by bundling.

Completion: every high signal has a keep / re-grade / drop verdict with a reason.

## 4. Turn signals into proposals

Use `references/gap-taxonomy.md` to pick the improvement for each signal kind, then shape it:

```markdown
### P1 — <signal kind>: <the one-line change>
**Signal:** S3
**Target:** `skills/x-example/SKILL.md:64`
**Change:** <what to write, concretely enough that someone else could make the edit>
**Check:** `node skills/x-example/scripts/check.mjs` exits 0
**Watch:** (quality gaps only) the skill, the model, the rate that should drop, and the window
```

Rules:

- **One proposal per gap, not per signal.** Three failures of the same documented command are one
  proposal citing three messages.
- **Every proposal names a target and a check.** A proposal you cannot check is a wish.
- **Prefer the smallest durable fix.** A missing flag belongs in the script; a wrong instruction
  belongs in the prose; a pattern that keeps recurring belongs in a test or the linter.
- **Ship the check with the fix.** If the gap was "a documented command that cannot run", the check
  is usually a new test or a `x-skill-lint` rule, not a re-read.
- **A quality gap also names what it should move.** Its `Check` proves the edit landed; its `Watch`
  says which anchor rate should fall afterwards, for which skill and model, so the next digests can show
  whether the fix helped. A fix that moves nothing is a fix to revisit.

Completion: every high signal has a verdict, and every kept finding has a proposal with its four
lines filled.

## 5. Write the reflection, then gate it

```bash
node <skill>/scripts/save-reflection.mjs --slug <slug> --session "<session title>"
node <skill>/scripts/check-reflection.mjs --file "<run folder>/E<nn>-reflection.md" --scan /tmp/signals.json --transcript /tmp/session.json
```

Pass `--slug <slug>` of the run you are reflecting on so the reflection lands in that run folder
beside the artifacts it critiques; the scan lists every run folder it saw. Add `--run <nn>` when
that slug has more than one run. The checker exits **0** when the reflection is filled in, **1**
when a proposal is missing a line, a high signal has no verdict, or the scan is too thin to be
evidence, and **2** on a usage error. Fix each violation and re-run.

Completion: `check-reflection.mjs` exits 0.

## 6. Route the proposals

Ask which proposals to act on with a `multi` panel, then record the choice. Route by size:

| Proposals | Route |
|-----------|-------|
| One small edit, clear target | Edit it, then `x-skill-lint` |
| Several independent edits with checks | the heal stage on a period run, or `x-fix` driven by this reflection |
| A gap that needs a design decision | `x-plan` (the reflection is the evidence pack) |
| Repeated across many sessions | run `x-autoreflection <period>` — recurrence is what the window report measures |
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
- **S9 (high, kept)** — user-redo owned by `x-research`: the user asked for the research again.

## Quality

- **S9** — user: "Do another full round … read internet sources" — skill: `skills/x-research/references/research-first.md:9` "Fetch official docs and prior art"

## Proposals

### P1 — doc-command-drift: teach the SKILL.md the flag the script already has
**Signal:** S3
**Target:** `skills/x-example/SKILL.md:64`
**Change:** replace `--topic` with `--slug`, and show the `--run` flag in the same block.
**Check:** `node skills/x-skill-lint/scripts/lint.mjs` exits 0, plus a `save-spec` CLI test.

### P2 — depth-floor: a research loop adds evidence, not prose
**Signal:** S9
**Target:** `skills/x-research/SKILL.md:76`
**Change:** a criterion counts as met only with a cited source; each loop reads something new.
**Check:** `node --test test/x-research.test.cjs` exits 0
**Watch:** x-research user-redo per session on deepseek-v4-flash, next 14 days

## Routes

- P1 → direct edit, then `x-skill-lint`
- P2 → `x-fix`
````

## Constraints that only this mode needs

1. **The script finds, you judge.** Do not report a raw signal as a finding; verify it first.
2. **Never propose a change to a skill you did not open.** Read the file before naming a line.
3. **Blame the instruction, not the agent.** "The SKILL.md did not say" is a gap; "I forgot" is not.
   For a model that ignores a rule the skill does state, the gap is where the rule sits, or which model
   it fails on — name the model.
4. **The user is the sensor.** A session where the user asked again, gave up, or refused a step fell
   short, however clean its tool calls were. Quote the user; never argue a quality anchor away with
   "every command exited 0".
5. **Editing the skill mid-reflection is out of order.** Write the proposal, route it, then change the file.
