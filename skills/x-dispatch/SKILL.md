---
name: x-dispatch
description: Parallel subagent task dispatcher — runs independent tasks concurrently via git worktrees, with dependency management and result aggregation
version: 1.0.0
author: Community  
tags: [dispatch, parallel, subagent, worktree, concurrency, execution]
user-invocable: true
---

# X-Dispatch — Parallel Subagent Task Execution

Dispatches independent tasks to parallel agents via git worktrees. Runs up to 4 concurrent workers. Handles dependencies via topological sort.

## Usage

```bash
node <path-to>/dispatch.js --tasks .x-skills/tasks/<epic-dir> [--parallel 4]
```

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    dispatch.js                           │
│  ┌──────────────┐    ┌───────────────┐   ┌───────────┐  │
│  │ Task Parser  │───▶│ Dependency DAG│──▶│ Wave Splitter│  │
│  └──────────────┘    └───────────────┘   └─────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │                    │
         ┌────────────────┼────────────────────┤
         ▼                ▼                    ▼
   ┌──────────┐     ┌──────────┐        ┌──────────┐
   │ worker 1 │     │ worker 2 │   ...  │ worker N │
   │ (worktree)│    │(worktree)│        │(worktree)│
   └────┬─────┘     └────┬─────┘        └────┬─────┘
        │                │                   │
        └────────────────┼───────────────────┘
                         ▼
              ┌──────────────────────┐
              │    aggregator.js     │
              │  (merge commits)     │
              └──────────────────────┘
```

### Task Discovery

Reads all `US*.md` files from the task directory. Extracts:
- Task ID and name
- Effort estimate  
- Dependencies from Preconditions section
- Files that will be created/modified

### Dependency Detection

**Explicit dependencies** (from Preconditions):
```markdown
## Preconditions
The Go adapter (US03) must complete first for format reference.
```
→ US10 depends on US03 completing

**Implicit dependencies** (file conflicts):
- Two tasks modifying same file → sequential execution required

### Wave Scheduling

Tasks are grouped into "waves" — all tasks in wave N have dependencies only on waves 1..N-1.

```javascript
// Example: 17 tasks become 4 waves
Wave 1: [US01-auto-trigger, US02-research]           // No deps
Wave 2: [US03-go, US04-python]                       // Depend on research
Wave 3: [US05-cli, US06-mcp, US07-refactor...]      // Mixed deps  
Wave 4: [US17-docs]                                  // Depends on all
```

### Worker Execution

Each worker:
1. Creates git worktree: `../xskills-<task-id>/`
2. Copies task file content to clipboard/paste buffer context
3. Spawns agent with task instructions
4. Monitors for completion or timeout (default 2h per task)
5. Cleans up worktree on completion

### Result Aggregation

After all waves complete:
1. Cherry-pick commit ranges from each worktree back to main branch
2. Resolve merge conflicts if any (prefer main branch changes)
3. Update task files with completion status (`- [x]`)

## Output Format

```bash
$ node dispatch.js --tasks .x-skills/tasks/18-07-2026-12:00-xskills-improvements/

X-Dispatch v1.0.0 — Parallel Task Execution
=============================================

Parsing tasks from .x-skills/tasks/18-07-2026-12:00-xskills-improvements/
Found 17 tasks across 4 waves

Wave 1 (2 tasks, parallel limit: 4)
├── US01-auto-trigger-schema     [pending]
└── US02-research-stack-adapters [pending]

Creating worktrees...
✓ Worktree created: /xskills-US01/ (branch impl/US01-auto-trigger)
✓ Worktree created: /xskills-US02/ (branch impl/US02-research)

Dispatching agents...
[US01] Spawning agent... 
[US02] Spawning agent...

Waiting for wave completion...
[US01] ✓ Completed in 12m
[US02] ✓ Completed in 18m

Aggregating results...
Cherry-pick US01: abc123..def456 → main (2 commits)
Cherry-pick US02: ghi789..jkl012 → main (3 commits)

Wave 1 complete. Moving to Wave 2...
```

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

## What NOT to do

- Don't dispatch tasks with interdependencies into same wave
- Don't exceed parallel limit — causes resource contention
- Don't skip dependency analysis assuming "tasks are independent"
