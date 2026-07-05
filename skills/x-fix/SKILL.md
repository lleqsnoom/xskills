---
name: x-fix
description: Resolve code review issues one-by-one from a fix plan under `.x-skills/review/` — read, edit, mark complete, repeat until done
version: 1.0.0
author: Community
tags: [code-review, automated-fix, code-quality, refactoring]
user-invocable: true
---

# X-Fix — Resolve Review Issues Iteratively

**What To Do:** When invoked, immediately execute this workflow. Do not ask the user what to do.

1. Find the most recent file under `/.x-skills/review/`.
2. Read it and find the next unchecked `[ ]` issue (CRITICAL → MAJOR → MINOR).
3. For each: read relevant file context, apply targeted fix, run tests, mark `[ ]` → `[x]`.
4. Print one-line summary per fix, repeat until all done or no unchecked items remain.

## Workflow

1. Read the most recent file under `/.x-skills/review/` (or accept a custom path as argument).
2. Find the next unchecked `[ ]` issue in priority order: CRITICAL → MAJOR → MINOR.
3. For each issue:
   - Read the relevant file and surrounding context (±20 lines around the reported line).
   - Apply the fix using `edit` or `multiedit`. Keep changes minimal — address only what's described.
   - Run tests to verify nothing breaks.
   - Mark the issue complete by changing `[ ]` → `[x]` in the plan file, immediately after applying the fix.
4. After each resolution, print a one-line summary: `Fixed [PRINCIPLE]: [one-sentence description]`.
5. Repeat until all issues are checked off or no more unchecked items remain.
6. Update the **Summary** section at the bottom of the plan file with final counts and status.

## Rules

- **One issue at a time.** Never batch multiple fixes into a single edit pass. Each fix gets its own targeted change + test run.
- **Minimal changes.** Only modify what the issue describes — don't refactor unrelated code or rewrite for style preference.
- **Test after every fix.** Run the project's tests (check `package.json` scripts). If a test fails, revert and adjust before moving on.
- **Preserve intent.** Don't change behavior beyond what's needed to resolve the specific issue.
- **If an issue is ambiguous**, make the smallest reasonable fix and note uncertainty in the one-line summary.
