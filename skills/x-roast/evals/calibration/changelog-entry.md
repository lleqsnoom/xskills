---
name: changelog-entry
description: Add one entry to CHANGELOG.md for the staged change. Use when asked to "add a changelog entry", "update the changelog", or before committing a user-visible change. Not for release notes across versions (use the release tooling) or commit messages.
---

# Changelog entry

Adds exactly one line under `## Unreleased` in `CHANGELOG.md`, in the Keep a Changelog format
(https://keepachangelog.com/en/1.1.0/): the section is one of Added, Changed, Deprecated, Removed,
Fixed, Security.

## When not to use
- The change is not user-visible (tests, CI, refactors): say so and stop.
- There is no `CHANGELOG.md`: ask whether to create one; do not create it unasked.

## Steps
1. Read the staged change: `git diff --cached --stat` and `git diff --cached`.
   Done when you can name the user-visible effect in one sentence, or have stopped (see above).
2. Pick the section from the list above. Done when exactly one section is chosen.
3. Write one line under `## Unreleased` → `### <Section>`, creating the subheading if missing. The
   line says what changed for the user, not which files moved.
   Done when `git diff CHANGELOG.md` shows exactly one added line of text (plus a heading if new).
4. Stage it: `git add CHANGELOG.md`.

## Verify
`git diff --cached --numstat CHANGELOG.md` prints 1 added line (2 or 3 when a heading was added)
and 0 removed. Anything else: undo with `git restore --staged --worktree CHANGELOG.md` and redo
step 3.
