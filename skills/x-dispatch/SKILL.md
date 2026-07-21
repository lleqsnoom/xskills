---
name: x-dispatch
description: Parallel subagent task dispatcher — runs independent tasks concurrently via git worktrees, with dependency management and result aggregation
version: 1.0.0
author: Community  
tags: [dispatch, parallel, subagent, worktree, concurrency, execution]
user-invocable: true
---

# X-Dispatch — Parallel Subagent Task Execution

Dispatches independent tasks to parallel agents via git worktrees. Uses parallel git worktrees for independent task execution with dependency management. Handles dependencies via topological sort into waves; each wave runs concurrently up to the parallel limit.

## Usage

```bash
node <path-to>/scripts/dispatch.js --tasks .x-skills/tasks/<epic-dir> [--parallel 4]
```

## How It Works

### Task Discovery
Reads all `US*.md` files from the task directory. Extracts: task ID and name, effort estimate, dependencies from Preconditions section, files that will be created/modified.

### Dependency Detection
**Explicit dependencies** (from Preconditions): "The Go adapter (US03) must complete first" → US10 depends on US03 completing.
**Implicit dependencies** (file conflicts): Two tasks modifying same file → sequential execution required.

### Wave Scheduling
Tasks grouped into waves — all tasks in wave N depend only on waves 1..N-1. Example: Wave 1 [US01, US02] (no deps) → Wave 2 [US03, US04] (depend on research) → Wave 3 [US05-US16] (mixed deps) → Wave 4 [US17-docs] (depends on all).

### Worker Execution
Each worker: creates git worktree (`../xskills-<task-id>/`), copies task file content, spawns agent with task instructions, monitors for completion or timeout (default 2h per task), cleans up worktree on completion.

### Result Aggregation
After all waves complete: cherry-pick commit ranges from each worktree back to main branch, resolve merge conflicts if any (prefer main branch changes), update task files with completion status (`- [x]`).

Full algorithm details: see `references/dispatch-algorithm.md`.

## Concurrency Rules

| Rule | Limit |
|------|-------|
| Max parallel workers | 4 (configurable via `--parallel`) |
| Task timeout | 2 hours default (`--timeout 120`) |
| Worktree cleanup on failure | Yes, unless `--keep-worktrees` |
| Retry attempts per task | 1 (configurable) |

## Error Handling

- **Agent timeout**: Kill process, mark task failed, continue with other workers
- **Worktree conflict** (file exists): Skip task, report in summary
- **Merge conflict on aggregation**: Keep main branch version, flag for manual review
- **Task has unresolvable dependencies**: Skip entire wave, require user intervention

## Don't

- Don't dispatch tasks with interdependencies into same wave
- Don't exceed parallel limit — causes resource contention
- Don't skip dependency analysis assuming "tasks are independent"