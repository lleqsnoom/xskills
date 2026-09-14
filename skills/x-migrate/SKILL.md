---
name: x-migrate
description: Framework/dependency migration assistant — generates migration plans with breaking changes, upgrade paths, and automated fix candidates from source analysis
version: 1.0.0
author: Community
tags: [migration, upgrade, dependency-management, framework-migration, version-upgrade]
user-invocable: true
---

# X-Migrate — Migration Planning Assistant

Assists with version upgrades and framework migrations by analyzing project structure and generating comprehensive migration plans with breaking change detection and automated fix candidates.

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory:

```bash
# Analyze current project for migration opportunities
node <path-to>/scripts/analyze.js --target express@5 [--source express@4]

# Generate full migration plan document
node <path-to>/scripts/analyze.js --target react@19 --output migration-plan.md
```

**Auto-discovery**: Scripts resolve config and sibling scripts relative to `__dirname`, so they work whether installed globally (`~/.agents/skills/x-migrate/scripts/`) or locally (`.agents/skills/<project>/x-migrate/scripts/`).

## Migration Categories

1. **Dependency upgrades** — parse manifest, check latest versions, flag breaking changes
2. **Framework migrations** — Express 4→5, React class→hooks, etc.
3. **TypeScript upgrades** — tsconfig target and compiler option updates

## Definition of Done

A migration run is done when `analyze.js` produces all three of:

- **Structured plan on stdout** — JSON `{ packagesAnalyzed, plan[] }`; every plan step carries `package`, `fromVersion`, `toVersion`, `change`, `severity`, `fix`, and `automated`.
- **Human-readable plan on stderr** — grouped by package, each step showing its severity and fix; when `--output <file>` is passed, the same markdown is also written to that file.
- **Exit 0** — including the legitimate case of an empty plan (no known breaking changes apply).

Failure modes — each prints a message to stderr and exits 1:

- Neither `--target <package@version>` nor `--all` supplied → usage error.
- No readable `package.json` in the current directory → "No package.json found".

Partial-data contract: an unknown package name, an unparseable `package.json`, or a version string that matches no breaking-change entry never aborts the run — the plan reports the gap (e.g. a single `manual review required` step, or a version marked `unknown`) instead of inventing changes. This lets the caller tell "nothing to do" apart from "could not determine".
