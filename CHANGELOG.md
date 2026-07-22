## [5.4.0] - 2026-07-22

* Merge pull request #31 from lleqsnoom/feat/x-reproduce (e957a86)
* fix(mcp): discover skills from package directory instead of system paths (4e4674c)
* fix(mcp): scan both skills directories for resource discovery (fe2520d)
* Merge pull request #30 from lleqsnoom/feat/x-reproduce (254cd8d)
* test(debug): add pipeline validation tests for new skills (d92f0ad)
* fix(x-reproduce): hardcode platform-to-template mapping instead of relying on route.js (2bf91d1)
* docs(skills): remove dangerous MCP resource example that agents copy verbatim (1df8d2d)
* docs(skills): document correct skill access patterns to prevent MCP errors (dd8e84a)
* docs(AGENTS): add Debugging Workflow section with triage-reproduce-investigate-fix handoff table (f02d581)
* feat(debug): wire platform routing table across reproduce and investigate skills (3b69c76)
* refactor(x-dispatch): keep worktrees inside repo boundary and clean up dead code (ce35296)
* feat(skill): add x-investigate — hypothesis-driven root cause analysis with ranked pattern matching (917b30c)
* feat(skill): add mobile reproduction template for x-reproduce skill (550e392)
* feat(skill): add web reproduction template for x-reproduce skill (7294870)
* feat(skill): add backend reproduction template for x-reproduce skill (e2be20d)
* feat(skill): add x-triage structured intake and classification skill with platform routing table (3ae0ddf)
* refactor(mcp): extract argument-building logic and add 20 tests for MCP server (e07ca56)
* fix(skill): update all SKILL.md script paths to include scripts/ subdirectory (5a3af62)
* fix(x-debug): update SKILL.md analyze.js path to include scripts/ subdirectory (ad2f1ff)

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
