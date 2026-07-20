---
name: x-debug
description: Structured debugging workflow — hypothesis formation, evidence collection, elimination testing, and root cause declaration with session logging
version: 1.0.0
author: Community
tags: [debugging, hypothesis, root-cause, error-analysis, stack-trace, elimination]
user-invocable: true
---

# X-Debug — Structured Debugging Workflow

Replaces "shotgun debugging" with evidence-based root cause analysis using a systematic hypothesis → test → verdict methodology.

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory:

```bash
# Analyze error/stack trace and generate hypotheses
node <path-to>/analyze.js --error "TypeError: Cannot read property 'foo' of undefined" [--file src/main.js]

# Run with full context (auto-detects project)
node <path-to>/analyze.js --context .
```

**Auto-discovery**: Scripts resolve config and sibling scripts relative to `__dirname`, so they work whether installed globally (`~/.agents/skills/x-debug/scripts/`) or locally (`.agents/skills/<project>/x-debug/scripts/`).

**Output**: The script creates two files:
1. **Debug session** in `.x-skills/debug/` — detailed hypothesis testing workflow
2. **Fix plan** in `.x-skills/review/` — actionable issues ready for `x-fix` consumption

## Related Skills

- **x-fix** — After identifying the root cause through debugging, use `x-fix` to systematically resolve the identified issues with targeted edits and test verification.
- **x-review** — For static code quality issues (complexity, SOLID violations) that don't manifest as runtime errors. Use when the problem is structural rather than behavioral.

## Debugging Workflow

1. **Hypothesis formation** — gather facts, list possible causes ranked by likelihood
2. **Test design** — create minimal reproduction case and elimination tests
3. **Evidence collection** — log results with pass/fail verdicts
4. **Root cause declaration** — document final verdict with evidence chain

## Definition of Done

- [ ] SKILL.md exists with YAML frontmatter and debugging workflow documented
- [ ] `scripts/analyze.js` generates structured debug session files in `.x-skills/debug/`
- [ ] Hypothesis testing produces pass/fail verdicts with evidence logging
- [ ] Final report includes root cause and recommended fix
