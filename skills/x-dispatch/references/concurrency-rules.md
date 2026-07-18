# Concurrency Rules for X-Dispatch

## Task Execution Model

X-Dispatch uses **git worktrees** to isolate parallel task execution. Each worker gets its own checkout of the repository, allowing true parallel development without branch conflicts.

## Dependency Types

### Explicit Dependencies

Declared in task Preconditions:

```markdown
## Preconditions

The Go adapter (US03) must complete first for format reference.
```

This creates a hard ordering: US10 cannot start until US03 completes.

### Implicit Dependencies (File Conflicts)

If two tasks modify the same file, they run sequentially:

| Task A | Task B | Relationship |
|--------|--------|--------------|
| Modifies `skills/x-review/references/principles.md` | Creates `skills/x-review/references/stack-adapters/` | **Sequential** — directory overlap |

### Transitive Dependencies

US05 → US03 → US02 means US05 depends on both.

## Wave Computation Algorithm

```javascript
function computeWaves(tasks, parallelLimit) {
  const completed = new Set();
  const waves = [];
  
  while (completed.size < tasks.length) {
    // Find runnable tasks (all deps satisfied)
    const runnable = tasks.filter(task => 
      !completed.has(task.id) &&
      task.dependsOn.every(depId => completed.has(depId))
    );
    
    if (runnable.length === 0 && completed.size < tasks.length) {
      throw new Error('Circular dependency detected');
    }
    
    // Take up to parallelLimit tasks
    const wave = runnable.slice(0, parallelLimit);
    waves.push(wave);
    wave.forEach(t => completed.add(t.id));
  }
  
  return waves;
}
```

## Example: Our 17-Task Epic

### Dependency Graph

```
US01 (no deps) ──────────────────────────┐
US02 (no deps) ───┬──────────────────────┼──┐
                  │                      │  │
                  ▼                      ▼  │
US03 ◀── US02 ────┘                      │  │
US04 ◀── US02 ────┘                      │  │
                                      US05  │
                                      US06  │
                                      US07  │
         ┌──────────────────────────────┴──┤
         │                                   │
         ▼                                   ▼
US09 ◀── US03-04                           US08
US10 ◀── US09                               │
US11 ◀── US10                               │
US12 ◀── US11                               ▼
                                       US14 (migrate)
                                          
                 ┌───────────────────────────┴─────┐
                 │                                 │
                 ▼                                 ▼
            US13 (debug)                    US15-16-17
                 │                             
                 └───────────────────────────▶ US17 (docs, final)
```

### Resulting Waves

| Wave | Tasks | Reasoning |
|------|-------|-----------|
| 1 | US01, US02 | No dependencies — can start immediately in parallel |
| 2 | US03, US04, US05, US06, US07, US08 | After research (US02) completes |
| 3 | US09, US10, US11, US12 | Stack adapters done; CLI/MCP/new skills as deps |
| 4 | US13, US14, US15, US16 | Mid-level tasks complete |
| 5 | US17 | Final integration — depends on most things |

## Concurrency Limits

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Max parallel workers | 4 | CPU/memory balance; avoids agent context overflow |
| Task timeout | 2 hours | Prevent hung tasks from blocking pipeline |
| Worktree age | 24 hours | Cleanup stale worktrees |

## Error Recovery

### Worker Failure (timeout/crash)

1. Mark task as `failed`
2. Kill any child processes in that worktree
3. Continue with remaining workers
4. Report failed tasks at end for manual retry

### Dependency Failure

If US03 fails:
- All tasks depending on US03 are marked `blocked`
- User must resolve US03 before blocked tasks can proceed

## File Locking Strategy

Tasks declare files they'll create/modify in their header:

```markdown
**Files:** skills/x-review/references/stack-adapters/go.md (new)
```

Before dispatch:
1. Build file ownership map: which task touches which file
2. Tasks touching same file(s) cannot be in same wave
3. Warn on directory overlaps ("skills/x-review/" touched by multiple tasks)

## Best Practices

1. **Keep tasks truly independent** — avoid unnecessary dependencies
2. **Declare explicit deps clearly** — use "(USXX)" format in Preconditions
3. **Small file scopes** — task shouldn't touch more than 5 files
4. **No cross-task communication** — tasks share nothing except through git commits
