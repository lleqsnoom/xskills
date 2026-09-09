---
name: x-parallel
description: Run multiple coding tasks in parallel — each task gets an isolated git worktree and its own background agent process with full tools, then committed results merge back into your branch
version: 1.0.0
author: Community
tags: [parallel, agents, background, worktree, concurrency, dispatch]
user-invocable: true
---

# X-Parallel — Parallel Background Coding Agents

Runs independent coding tasks concurrently. Each task is executed in an isolated git worktree by a full `crush run` agent process (read + edit + bash tools, not the read-only in-session agent tool). Committed results are merged back into your current branch. Use it to parallelize x-decompose output, batch fixes, or multi-file refactors.

## Requirements

- `crush` CLI on PATH (the worker binary). Verify: `command -v crush`.
- Task files are markdown, one per file, self-contained (x-decompose format or any md).
- Run from a git repo on a normal branch with a **clean working tree**.

## Usage

```bash
node <path-to>/scripts/parallel.mjs --tasks <task-dir> [options]
```

| Option | Default | Meaning |
|--------|---------|---------|
| `--tasks <dir>` | (required) | Task directory; all `*.md` recursively are tasks |
| `--parallel N` | 4 | Max concurrent agents |
| `--retries N` | 1 | Extra attempts per task after the first failure (each starts from a clean worktree, with escalating backoff) |
| `--timeout-min N` | 30 | Kill an agent (and its whole process group) after N minutes. Every agent run is time-bounded; never run unbounded. |
| `--agent <bin>` | crush | Worker CLI; called as `<bin> run`, prompt on stdin |
| `--keep-worktrees` | off | Keep worktrees after run for inspection |
| `--dry-run` | off | Print the wave plan, spawn nothing |
| `--prompt "<text>"` | default | Override the worker instruction (default below) |

## How It Works

1. **Discover tasks** — collect every `*.md` under `--tasks`, sorted. Task id = basename.
2. **Dependencies** — a task depends on each sibling task basename it mentions anywhere in its body (Preconditions, "must complete first"). Tasks mentioning no sibling are independent.
3. **Waves** — a task enters a wave when all its dependencies are in earlier waves. Tasks sharing a declared file are not scheduled into the same wave (serialized to avoid conflicts).
4. **Run each wave** — for every task up to `--parallel`, with retries:
   - attempt the task (worktree + agent run). If it fails, retry up to `--retries` more times, each retry starting from a clean worktree and branch, with escalating backoff
   - `git worktree add <repo>/.x-skills/worktrees/<slug> -b xp/<slug>`
   - write the task file to `<worktree>/TASK.md` (ignored via `.git/info/exclude`, never merged)
   - spawn `<agent> run` with `cwd = <worktree>`, prompt as the CLI argument, stdout to `.x-skills/parallel-logs/<slug>.log`
   - success = exit code 0 AND `git status --porcelain` empty in the worktree (uncommitted leftovers are auto-committed as `feat: <slug> (auto)`)
   - a task only counts as failed after all attempts are exhausted
5. **Merge successes** — after each wave, merge every successful branch into your branch: `git merge --no-ff xp/<slug> -m "xp: <slug>"`. On conflict: `git merge --abort`, mark the task conflicted for manual resolution, continue.
6. **Cleanup** — remove merged worktrees and delete their branches. Failed or conflicted tasks keep their `xp/<slug>` branch (worktree removed) so you can inspect and fix by hand.

## Worker Prompt (default)

```
You are one parallel coding agent working in an isolated copy of the
repository. Read TASK.md at the repository root: it contains your complete
task. Implement it fully. Follow the task's own workflow (TDD if it names
tests). Do not modify files outside the task's scope. When finished, run the
project tests. Then commit all changes with one conventional commit message
(type(scope): description). Leave the working tree clean, with no uncommitted
changes. If you cannot complete the task, still leave the tree clean and
state what is missing in your final answer.
```

## Rules

- The working tree must be clean before dispatch; the script refuses to run otherwise.
- Two tasks that write the same file must not run concurrently. If the script cannot detect overlap, a merge conflict results; resolve it manually.
- Do not edit files inside another task's worktree.
- **Always time-bound agent runs.** Every spawned agent is killed (process group) after `--timeout-min`. Do not change this to "wait forever".
- Exit 0 only when every task was merged. Non-zero exit means failures or conflicts; read the summary.

## Output

The script prints a per-wave progress table and a final summary: `success / conflicted / failed`, plus log file paths for inspection.
