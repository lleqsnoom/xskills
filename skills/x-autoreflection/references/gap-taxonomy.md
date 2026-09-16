# Gap taxonomy — which improvement answers which signal

`scan-session.mjs` reports friction. This file says what kind of defect each signal tends to be and
where the fix usually goes. It is a starting point, not an oracle: open the file before you name it.

## Signals the scanner reports

| Kind | What the scanner saw | Usually means | Fix usually goes |
|------|----------------------|---------------|------------------|
| `tool-failure` | a command exited non-zero, an edit's text did not match, or a tool reported an error | the skill documented a command that cannot run, or a step that assumes a shape the file does not have | the `SKILL.md` command block, or the script's flag/argument parser |
| `expected-exit` | `diff`, `grep`, `test` and friends exited 1 | nothing — that is the answer | nowhere; the list exists so these are not mistaken for failures |
| `repeat-call` | the same tool with byte-identical input, twice or more | the first attempt failed and the second was a retry, or the agent lost the result and re-read it | if the input was a script invocation: the script's error message; if a file read: the `SKILL.md` step order |
| `user-correction` | the user started a message with "no", "wrong", "actually" | the skill let the agent proceed on a wrong assumption | the missing question or the missing default in the `SKILL.md` |
| `user-reprompt` | the user answered with a bare "continue" or "go on" | the skill defines a stopping point the agent does not recognise as finished, or the agent stalled mid-task | the `Completion:` lines of the step the agent stopped at |
| `prose-question` | the agent ended a turn with a question in plain text | the skill never said to render a panel, or said it too weakly | the asking section of the `SKILL.md`; if the host has panels, point at `references/questions.md` |
| `skill-unused` | a skill was loaded and never called | the description over-triggers: it promises what the session did not need | the frontmatter `description`, then run `x-skill-lint` |

## Severity, and what it is not

Severity is mechanical. `high` means a failing call named a skill — it does **not** mean the skill is
at fault. A session is full of the agent's own mistakes, typos, and dead-end probes; those usually
belong to no skill at all. Judge each one, then record `kept`, `re-graded`, or `dropped`.

Re-grade when the friction is real but the owner is elsewhere: a failing `npm test` after an edit is
the edit's fault, not `x-implement`'s. Drop when the transcript misled the scanner, and say why, so
the next reflection does not spend a pass on it again.

## Choosing the improvement class

Look at *why* the step failed, then pick the smallest durable fix:

| Why it failed | Improvement class | Example |
|---------------|-------------------|---------|
| The prose named a flag, path, or command that does not exist | `doc-command-drift` | `x-epic/SKILL.md:64` says `--topic`, the script takes `--slug` |
| The script rejected a legitimate input | `script-hardening` | the parser dropped `--run` when it followed another flag |
| The agent skipped a required step | `missing-gate` | add the step to the file's `Completion:` line |
| The agent asked in prose | `panel-rule` | point the asking section at `references/questions.md` |
| The same failure recurred across sessions | `missing-check` | add a test, or an `x-skill-lint` rule |
| The user had to repeat an instruction | `stopping-point` | the `SKILL.md` ends without saying what "done" is |
| Two skills conflict on the same file or flag | `contract-drift` | reconcile the copies; if it is a helper, use `npm run sync:run-folders` |

Prefer `missing-check` when a mechanism exists. A doc line can drift again; a test cannot.

## What is not a gap

- **The user changed their mind.** That is not friction, it is the process working.
- **The environment was missing something** (no network, no CLI). Report the capability gap once; do
  not propose a skill edit for it.
- **The agent's own experiment failed.** A probe that errors while exploring is how the work gets
  done. Drop it unless the probe was a command the skill told you to run.
- **One slow step.** An efficiency observation needs a measured comparison before it earns a
  proposal; say so in `Gaps` and move on.

## Findings the scanner cannot see

The scan only sees friction that shows up as a failure, a repeat, or a nudge. A command that
succeeds with a wrong answer looks like success to it, and so does a skill that never fired when it
should have. You still read the transcript: when you spot one of those, record it as a `manual`
gap and propose the fix like any other.

| Invisible to the scan | Example |
|-----------------------|---------|
| A successful command returning a wrong value | a scope guesser that prints `diff --git c` |
| A skill that should have triggered and did not | the user asked for a review and no review skill ran |
| A step that succeeded by luck | the file was already in the expected shape |
| Guidance the agent ignored without failing | a rule stated in the `SKILL.md` and never followed |


## From signal to proposal

```
signal  → open the cited file → keep / re-grade / drop → pick the improvement class → write
```

One proposal per gap, not per signal. If three failures share a cause, write one proposal and cite
all three message indices in its `**Signal:**` line.
