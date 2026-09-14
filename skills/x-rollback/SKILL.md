---
name: x-rollback
description: Automated git revert with multi-step confirmation — identifies target commits, analyzes impact, requires approval, creates properly formatted revert commits via x-commit integration
version: 1.0.0
author: Community
tags: [git-revert, rollback, safety, confirmation, version-control]
user-invocable: true
---

# X-Rollback — Automated Git Revert with Safety Checks

Automates safe git reverts with multi-step confirmation to prevent accidental rollbacks. Integrates with x-commit for proper revert commit formatting.

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory:

```bash
# Revert a specific commit by SHA
node <path-to>/scripts/revert.js --commit abc123def456

# Revert last N commits
node <path-to>/scripts/revert.js --last 1

# Dry-run mode (show what would happen without reverting)
node <path-to>/scripts/revert.js --commit abc123def456 --dry-run
```

**Auto-discovery**: Scripts resolve config and sibling scripts relative to `__dirname`, so they work whether installed globally (`~/.agents/skills/x-rollback/scripts/`) or locally (`.agents/skills/<project>/x-rollback/scripts/`).

## Safety Checks

1. **Clean working tree required** — exits early with error if uncommitted changes exist
2. **SHA verification** — confirms target commit exists in current branch history
3. **Impact analysis** — shows affected files before confirmation
4. **Explicit approval** — requires user to confirm revert action

## Definition of Done

A rollback run is done when `revert.js` delivers:

- **Refuses a dirty tree** — any uncommitted change makes it exit 1 with a "working tree is not clean" message on stderr, before touching anything.
- **Resolves exactly one target** — `--commit <sha>` or `--last N` selects a single commit; a missing or ambiguous target exits 1 with a usage error.
- **Shows impact before acting** — `--dry-run` prints a JSON plan to stdout (`dryRun: true` plus `sha`, `message`, `files`, `stats`) and creates **no** revert commit; HEAD is unchanged.
- **Requires explicit confirmation** — in an interactive terminal it waits for the literal `REVERT`; any other answer cancels with exit 0.
- **Commits the revert** — on confirmation it creates a `revert: "…"` commit (via x-commit when available, falling back to `git commit`) and prints `{ success: true, revertSha, message }` to stdout.

Failure modes — each prints a message to stderr and exits 1:

- No `--commit` / `--last` target → usage error.
- Commit SHA not in current history → "not found".
- Revert fails mid-way → aborts with `git revert --abort` and reports the error.
