---
name: x-fix
description: Resolve issues from fix plans — read, edit, verify, mark complete
version: 1.0.0
author: Community
tags: [code-quality, debugging, refactoring]
user-invocable: true
---

# X-Fix — Resolve Issues Iteratively

**Prerequisites:** Fix plan in `.x-skills/review/` from x-debug (after reproduction + hypothesis testing) or manual creation.

## Workflow

1. Read the most recent file under `.x-skills/review/`.
2. Find next unchecked `[ ]` issue (CRITICAL → MAJOR → MINOR).
3. For each issue:
   - **Reset**: `git checkout -- <file>` for clean baseline
   - Read ±20 lines around reported location
   - Apply fix using `edit` only (never `multiedit`)
   - Run syntax check (`node -c <file>`) and tests
   - **Verify**: Run `.x-skills/debug/verify-*.js` if available — issue NOT resolved until exit 0
   - Mark `[ ]` → `[x]` in plan file
4. Print one-line summary per fix. Repeat until all done.

## Rules

- **One issue at a time** — never batch fixes
- **Prefer `edit` over `multiedit`** — easier recovery from failures
- **Start from clean checkout** — `git checkout -- <file>` before each fix
- **Test after every fix** — revert if tests fail
- **NEVER silence errors** — do NOT add try/catch wrappers that swallow errors, do NOT disable error reporting. Fix the root cause so the error cannot occur.
- **Minimal changes** — only modify what's needed to resolve the specific issue
- **If ambiguous**, make smallest reasonable fix and note uncertainty
