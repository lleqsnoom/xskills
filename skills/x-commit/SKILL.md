---
name: x-commit
description: Write single-line conventional commit messages — one authoritative type map, imperative mood, no description body
version: 1.0.0
author: Community
tags: [conventional-commits, git, commit-messages, commit-changes]
user-invocable: true
---

# Crush Commit — Conventional Commits (Message Only)

Make a conventional commit with info on what current Changes does. One sentence. Authoritative tone. Do not add co-authors or info that it was made with AI.

## Workflow

1. Run `scripts/suggest-type.mjs` to analyze staged changes and suggest a type + scope.
2. Pick the best suggestion, or override if context demands it.
3. Draft a single-line message in imperative mood: `type[(scope)]: description`.
4. Run `scripts/validate-commit.js` to verify the message conforms to Conventional Commits.
5. Commit with the validated message.

## Rules

- **One line only** — no description body, no blank lines inside the message.
- **Imperative mood** — "add", not "added" or "adds".
- **No trailing period**.
- **No AI attribution** — never mention tools, models, or assistants.
- **No co-authors or sign-offs**.
- Scope is optional; use it when the change touches a clearly bounded area (e.g. `feat(auth): ...`).
- Breaking changes get a `!` before the colon or a `BREAKING CHANGE:` footer on the full commit.
