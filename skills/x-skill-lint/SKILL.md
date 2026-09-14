---
name: x-skill-lint
description: Validate the repo's own skills — frontmatter parses and `name` matches the folder, every referenced `scripts/*` and `references/*` exists, no stray template tokens, and the README skills table lists every skill. Use when adding or editing a skill, or before shipping the repo.
version: 1.0.0
author: Community
tags: [lint, validation, skills, frontmatter, repo-hygiene, discovery]
user-invocable: true
---

# X-Skill-Lint — Validate the Repo's Own Skills

Catch the whole class of "documented command that cannot run" defects before they ship: a skill
that names a script file that does not exist, a frontmatter `name` that disagrees with its folder,
a stray template token, or a skill missing from the README table. Run it after editing any
`skills/*/SKILL.md` and before a release.

## When to use

- You added or edited a skill in this repo.
- A skill's documented command raised "file not found".
- Before shipping: prove the corpus is self-consistent.

## Run it

```bash
node <skill>/scripts/lint.mjs            # lint the repo this script lives in
node <skill>/scripts/lint.mjs --root .   # lint a different repo root
```

Output is JSON: `{ root, skills, violations: [...] }`. Exit **0** when clean, **1** when any
violation is found, **2** on a usage error. Each violation names the `skill` and a `rule`.

## Rules checked

| Rule | Meaning |
|------|---------|
| `missing-skill-md` | A directory under `skills/` has no `SKILL.md`. |
| `frontmatter` | `SKILL.md` has no parseable `---` frontmatter block. |
| `name-mismatch` | Frontmatter `name` does not equal the folder name. |
| `description` | Frontmatter has no `description`. |
| `stray-token` | The body contains a stray authoring token — a leftover closing tag from a template. |
| `missing-ref` | A same-skill `scripts/…` or `references/…` path does not exist on disk. |
| `readme` | The skill is missing from the README skills table. |

References that name *another* skill (a line mentioning a different `x-…`) are skipped, so
cross-skill hops are not reported as local breakage.

## Completion

`node <skill>/scripts/lint.mjs` exits 0. If it exits 1, fix each listed violation and re-run —
do not ship with an open violation.
