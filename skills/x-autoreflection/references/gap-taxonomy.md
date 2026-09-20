# Gap taxonomy — which improvement answers which signal

`scan-session.mjs` reports two families of signal. **Friction** is a step that failed, repeated or
was corrected. **Quality anchors** are what a clean-but-weak session leaves instead: the user asking
for the work again, giving up on the agent, refusing a skill's step, or a skill script that "succeeded"
without saying anything. This file says what kind of defect each signal tends to be and where the fix
usually goes. It is a starting point, not an oracle: open the file before you name it.

## Friction signals

| Kind | What the scanner saw | Usually means | Fix usually goes |
|------|----------------------|---------------|------------------|
| `tool-failure` | a command exited non-zero, an edit's text did not match, or a tool reported an error | the skill documented a command that cannot run, or a step that assumes a shape the file does not have | the `SKILL.md` command block, or the script's flag/argument parser |
| `expected-exit` | `diff`, `grep`, `test` and friends exited 1 | nothing — that is the answer | nowhere; the list exists so these are not mistaken for failures |
| `repeat-call` | the same tool with byte-identical input, twice or more | the first attempt failed and the second was a retry, or the agent lost the result and re-read it | if the input was a script invocation: the script's error message; if a file read: the `SKILL.md` step order |
| `user-correction` | the user started a message with "no", "wrong", "actually" | the skill let the agent proceed on a wrong assumption | the missing question or the missing default in the `SKILL.md` |
| `user-reprompt` | the user answered with a bare "continue" or "go on" | the skill defines a stopping point the agent does not recognise as finished, or the agent stalled mid-task | the `Completion:` lines of the step the agent stopped at |
| `prose-question` | the agent ended a turn with a question in plain text | the skill never said to render a panel, or said it too weakly | the asking section of the `SKILL.md`; if the host has panels, point at `references/questions.md` |
| `skill-unused` | a skill was loaded and neither the agent nor the user used it afterwards (a name in a directory listing or an injected skill body does not count) | the description over-triggers: it promises what the session did not need | the frontmatter `description`, then run `x-skill-lint` |

## Quality anchors

Each anchor names the skill that owned the moment — the one invoked, loaded, or whose script ran just
before it — not every skill the session touched.

| Kind | What the scanner saw | Usually means | Fix usually goes |
|------|----------------------|---------------|------------------|
| `user-redo` | after the opening request, the user asked for the same work again ("another full round", "from scratch", "once again") | the first answer fell short of what was asked, without any step failing | the expectation the answer missed, written into the skill in the user's words |
| `user-handoff` | the user gave up on this agent ("make it a prompt for another agent", "I'll do it myself") | the strongest sign of a below-expectation result | read the turns before it; the expectation or the report rule that was missing |
| `cross-session-retry` | a later session, in any CLI, opened with most of this session's request (≥50% overlap, within 48 h) — computed across sessions by `anchors.mjs`, not by the scan | this session's answer did not satisfy; the user tried again elsewhere | the earlier session's owner: what the retry got that the first attempt did not |
| `tool-rejected` | the host's own notice that the user refused a tool call ("The user doesn't want to proceed with this tool use") | a skill step asked for something the situation did not need — a confirmation on a fully specified request, a panel mid-flow | make that step conditional |
| `skill-script-silent` | a skill's own script exited 0 and printed nothing, its output not redirected | `main()` never ran (a symlinked install defeats the ESM main guard) or an old copy is installed | the script: print a result line on success, compare real paths in the main guard |
| `interrupt` | the user stopped a turn (Crush `finish: canceled`, Claude Code "[Request interrupted by user…]") | only that the user stopped the agent — not why | nowhere by itself; read the next user turn, which is usually a redo or a correction |
| `user-pushback` | a small model read a user turn as pushback on the reply before it (`classify-turns.mjs`), including the narrowing forms — "you missed…", "but what about…" | the reply was wrong, incomplete, too long, or not what was asked | as `user-redo`; stays "unvalidated", and out of the reading order, until the review's labels confirm it |
| `user-abandon` | the session ended on the agent's answer and the user never replied — no follow-up, no thanks, no new task | possibly nothing: a finished one-shot looks the same. Possibly the answer fell short and the user moved on | nowhere by itself; it only earns a reading combined with another weak signal (`user-dissatisfied`) |
| `user-handedit` | a file the agent wrote was modified after the session ended, by no session in the window — the user's own hand is the remaining writer | the delivered artifact was not what the user wanted, and editing it was faster than asking again | the artifact's owning skill: what the user changed is the expectation the output missed |
| `user-dissatisfied` | two or more weak implicit signals on one session (`user-abandon`, `user-handedit`, `user-pushback`, `user-reprompt`) — computed in `anchors.mjs`, not by the scan | the session fell short and none of the single signals can say so alone | the last skill in charge; judge the reply before the first weak signal against the request |

## Severity, and what it is not

Severity is mechanical. `high` means a failing call named a skill, or the user reacted to a skill's
reply — it does **not** mean the skill is at fault. A session is full of the agent's own mistakes,
typos, and dead-end probes; those usually belong to no skill at all. Judge each one, then record
`kept`, `re-graded`, or `dropped`.

Re-grade when the friction is real but the owner is elsewhere: a failing `npm test` after an edit is
the edit's fault, not `x-implement`'s. Drop when the transcript misled the scanner, and say why, so
the next reflection does not spend a pass on it again.

## Choosing the improvement class

Look at *why* the step failed or fell short, then pick the smallest durable fix:

| Why it failed | Improvement class | Example |
|---------------|-------------------|---------|
| The prose named a flag, path, or command that does not exist | `doc-command-drift` | `x-epic/SKILL.md:64` says `--topic`, the script takes `--slug` |
| The script rejected a legitimate input | `script-hardening` | the parser dropped `--run` when it followed another flag |
| The agent skipped a required step | `missing-gate` | add the step to the file's `Completion:` line |
| The agent asked in prose | `panel-rule` | point the asking section at `references/questions.md` |
| The same failure recurred across sessions | `missing-check` | add a test, or an `x-skill-lint` rule |
| The user had to repeat an instruction | `stopping-point` | the `SKILL.md` ends without saying what "done" is |
| Two skills conflict on the same file or flag | `contract-drift` | reconcile the copies; if it is a helper, use `npm run sync:run-folders` |
| A rule the skill states was not applied, and nothing failed | `rule-not-applied` | move the rule into the step it governs, or make it a script check; note it when it fails on one model only |
| The answer was valid but not what the user expected | `missing-expectation` | add one expected behaviour, in the user's words, to the skill's `evals/expectations.json` |
| The report claimed more than the session did | `unbacked-report` | the report lists the command or source behind each completion claim, and what was not done |
| The work stopped at the first draft of a research-type task | `depth-floor` | a minimum of cited evidence per criterion or loop; no self-typed coverage |
| A skill step cost the user more than it returned | `ritual-cost` | make the step conditional on the situation that needs it |
| A skill script exited 0 and said nothing | `silent-success` | print a result line; compare real paths in the main guard |

Prefer `missing-check` when a mechanism exists. A doc line can drift again; a test cannot. The six
quality classes (`rule-not-applied` to `silent-success`) are judgement calls: `x-autoreflection`'s heal stage
never applies them automatically.

## What is not a gap

- **The user changed their mind.** That is not friction, it is the process working.
- **The environment was missing something** (no network, no CLI). Report the capability gap once; do
  not propose a skill edit for it.
- **The agent's own experiment failed.** A probe that errors while exploring is how the work gets
  done. Drop it unless the probe was a command the skill told you to run.
- **One slow step.** An efficiency observation needs a measured comparison before it earns a
  proposal; say so in `Gaps` and move on.
- **A headless run.** A session a script started (`claude -p`, the daily automation) is not a person
  falling short; the anchors ignore it.

## What the scan nominates, and what the judge confirms

An anchor says *where* to look, never *what* went wrong. For each kept anchor, ask one narrow question
at that message — "which line of the request or of `skills/<x>/SKILL.md` did the reply before this
turn not meet?" — open the artifact the session produced, and quote both sides. The judging rules are
in `references/quality-judge.md`.

What is still invisible without an anchor — a wrong value the user never noticed, a skill that should
have triggered and did not — is what the daily audit session is for: one quiet session a day, read and
labelled anyway. Record what you find there as a `manual` gap, as before.

## From signal to proposal

```
signal  → open the cited file → keep / re-grade / drop → pick the improvement class → write
```

One proposal per gap, not per signal. If three failures share a cause, write one proposal and cite
all three message indices in its `**Signal:**` line.
