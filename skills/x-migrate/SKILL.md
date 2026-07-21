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

- [ ] SKILL.md exists with YAML frontmatter documenting migration categories
- [ ] `scripts/analyze.js` accepts source/target framework arguments
- [ ] Outputs markdown plan document to working directory or specified path
- [ ] Includes breaking changes, suggested order, automated fix candidates
