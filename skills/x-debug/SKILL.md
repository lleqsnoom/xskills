---
name: x-debug
description: Evidence-based debugging — reproduce, hypothesize, fix root cause, verify
version: 1.0.0
author: Community
tags: [debugging, root-cause, reproduction, verification]
user-invocable: true
---

# X-Debug — Reproduce → Hypothesize → Fix → Verify

Never silence errors. Always fix the root cause and verify it's resolved.

## Critical: Run analyze.js First (Always)

**Before any analysis, hypothesis testing, or fixing begins**, execute `analyze.js` with the user's bug description as the error text:

```bash
node <path-to>/scripts/analyze.js --error "<user's bug description>" --context .
```

This creates:
- `.x-skills/debug/<session-id>.md` — debug session doc (required for x-fix handoff)
- `.x-skills/review/debug-*.md` — fix plan (required input for x-fix skill)

**Never skip this step.** It is required even for behavioral bugs with no stack trace (e.g., "SSE event not triggered", "wrong value displayed"). analyze.js will create empty hypothesis lists in that case, but the docs MUST exist before any further work.

## Usage

```bash
node <path-to>/scripts/analyze.js --error "TypeError: Cannot read property 'foo' of undefined" [--file src/main.js]
node <path-to>/scripts/analyze.js --context . [--session-id my-session]
node <path-to>/scripts/analyze.js --no-reproduce --error "..."  # skip auto-reproduction
```

**Output**: Debug session in `.x-skills/debug/`, fix plan in `.x-skills/review/`.

## Workflow (4 Steps)

### 0. Initialize — Run analyze.js
Execute `analyze.js` with the bug description. This is mandatory and must complete before Step 1. The generated docs are the handoff contract for x-fix later. If auto-reproduction fails, write one manually — never proceed without it.

### 1. Reproduce Locally
`analyze.js` generates `repro-*.js` for known error patterns. Run it to confirm the error triggers locally. If auto-reproduction fails, write one manually — never proceed without it.

### 2. Hypothesize & Test
The script lists hypotheses ranked by likelihood. For each, run the proposed test and mark `[ ]` → `[x] Confirmed` or `[ ] Rejected` in `.x-skills/debug/`. Eliminate until one cause remains.

### 3. Fix Root Cause (NOT Silence)
Apply a targeted fix that eliminates the error condition:
- **DO** ensure the error can no longer occur
- **DO NOT** add try/catch wrappers that swallow errors silently
- **DO NOT** disable error reporting or set `process.exit(0)` on failure paths
- **DO NOT** use `console.error` as a substitute for fixing

### 4. Verify
Run `.x-skills/debug/verify-*.js` after applying the fix. Issue is NOT resolved until verification exits 0. If it fails, go back to Step 2.

## Related Skills

- **x-fix** — Reads fix plans from `.x-skills/review/` and applies fixes with verification
- **x-review** — Static code quality analysis (complexity, SOLID violations), not runtime errors

## Definition of Done

- [ ] Reproduction script triggers the same error locally
- [ ] Root cause identified through hypothesis elimination
- [ ] Fix applied (not silenced)
- [ ] Verification script passes (exit 0)
