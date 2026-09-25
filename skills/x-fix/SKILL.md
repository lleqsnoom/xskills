---
name: x-fix
description: Resolve issues from fix plans — read, edit, verify, mark complete
version: 1.0.0
author: Community
tags: [code-quality, debugging, refactoring]
user-invocable: true
---

# X-Fix — Resolve Issues Iteratively

**Prerequisites:** A fix plan in the run folder under `.x-skills/runs/<stamp>-R<nn>-<slug>/`, from x-debug (`E<nn>-fix-plan.md`), x-review (`E<nn>-review-plan.md`), or manual creation.

## Workflow

1. Read the most recent `E<nn>-fix-plan.md` or `E<nn>-review-plan.md` in the run folder (`.x-skills/runs/<stamp>-R<nn>-<slug>/`). x-debug writes the first kind; x-review writes the second.
2. Find next unchecked `[ ]` issue (CRITICAL → MAJOR → MINOR).
3. For each issue:
   - **Reset**: `git checkout -- <file>` for clean baseline
   - Read ±20 lines around reported location
   - Apply fix using `edit` only (never `multiedit`)
   - Run syntax check (`node -c <file>`) and tests
   - **Verify**: Run the run folder's `E<nn>-verify.js` if available — issue NOT resolved until exit 0
   - Mark `[ ]` → `[x]` in plan file
4. Print one-line summary per fix. Repeat until all done.

## Rules

- **One issue at a time** — never batch fixes
- **Prefer `edit` over `multiedit`** — easier recovery from failures
- **Start from clean checkout** — `git checkout -- <file>` before each fix
- **Test after every fix** — revert if tests fail
- **NEVER silence errors** — do NOT add try/catch wrappers that swallow errors, do NOT disable error reporting. Fix the root cause so the error cannot occur.
- **Minimal changes** — only modify what's needed to resolve the specific issue
- **`[Bloat]` issues follow x-unbloat** (`~/.agents/skills/x-unbloat/SKILL.md` for a global install, `.agents/skills/x-unbloat/SKILL.md` for a local one): check every call site before inlining or deleting, and keep what its *Keep it if* column or *Never Cut* list protects
- **If ambiguous**, make smallest reasonable fix and note uncertainty
