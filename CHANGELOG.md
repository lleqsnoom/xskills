## [5.3.1] - 2026-07-21

* Merge pull request #28 from lleqsnoom/refactor-merge-and-plan-rename (5bf9029)
* fix(test): correct regex patterns and assertion strings in save-spec tests (9017337)
* Merge pull request #27 from lleqsnoom/refactor-merge-and-plan-rename (92d6f6b)
* chore: rename x-design to x-plan across entire codebase - Rename skill directory skills/x-design/ -> skills/x-plan/ and update SKILL.md frontmatter, tags, and title - Update all internal references: spec paths (.x-skills/design → .x-skills/plan), log tags ([x-design] → [x-plan]), script comments, and shared helper docstrings - Update test files (save-spec.test.cjs, save-epic.test.cjs) to reflect new skill name and output paths - Update documentation: README.md, AGENTS.md, QUICKSTART.md, docs/*.md, .agents/rules/xskills.md - Remove x-refactor from Available Skills table and Code Quality workflow as previously planned (16d93a6)
* refactor(review): merge x-refactor patterns into x-review analysis pipeline and remove x-refactor skill - Add analyze-patterns.js with refactor pattern detection (compound verbs, long functions, single-letter vars, Hungarian notation, conditional chains, trivial methods) - Update save-plan.js to run all three analyses (complexity, duplication, patterns) in one command and pre-fill plan header with aggregated stats - Remove x-refactor from README skills table and Code Quality workflow - Fix x-review SKILL.md MCP resource reference that was causing 'not available' errors - Decrement skill count from 15 to 14 (2fc9ec4)

## [2.0.2] - 2026-07-19

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of xskills — cross-CLI agentic skills package

### Added
* Merge pull request #17 from lleqsnoom/fix/publish-version-higher-than-latest (ee3bfd5)
* fix: prevent npm publish failure when higher version exists on registry (93ae751)
* Merge pull request #16 from lleqsnoom/improve-readme-with-badges (27fea3f)
* fix: simplify badge URLs to improve reliability (2518ef7)
* docs: rewrite README with stronger hook and social proof badges (969d463)
