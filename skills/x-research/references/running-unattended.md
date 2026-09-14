# Running x-research unattended

x-research is a loop **contract**, not a runner. It ships no scheduler, no daemon,
and no shell script. Each invocation performs one experiment and returns; something
outside the skill must re-invoke it. That cadence is **host-owned**, and the host's
permission and approval gates always win — if the host pauses for approval, the loop
waits rather than working around it.

The re-entry rule is the same everywhere: read `state.json`, run **one** iteration,
record it, then stop. Re-enter only while the phase is not a stop phase, and finish
when `node <skill>/scripts/state.mjs verify --dir <dir>` exits 0 (or the state reads
`escalate`).

## OpenClaw

Create a host-scheduled task (a cron-style entry the host runs on an interval) that
re-delivers the x-research prompt for the run's directory. Each fire re-enters the
loop, does one experiment, and returns. Do not pile up overlapping fires: skip a
tick while a phase is a stop phase or while the previous fire is still running.
OpenClaw's own approval prompts apply per step.

## OpenCode

There is no built-in scheduler to lean on here. Drive it from an **external shell
loop** outside the skill: relaunch the agent with the skill prompt on an interval and
use the exit code of `state.mjs verify` to decide whether to continue (`1` = keep
going, `0` = done). Stop the loop when the state reports `escalate`. The loop lives
in your shell, not in the skill.

## Crush

Same shape as OpenCode: an external shell loop relaunches Crush with the skill
prompt, one iteration per launch, checking `state.mjs verify` (`0` = stop) and the
`escalate` phase. Keep the loop outside the repository's skill files.

## Rules for any host

- One iteration per invocation; `state.json` is the single source of truth.
- Never re-enter a stopped run (`done` or `escalate`) — `verify`/`status` tell you.
- Treat every permission and approval gate as authoritative. This skill never
  instructs the agent to bypass a confirmation, never "never stops", and never
  "never asks".
