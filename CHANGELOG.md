## [5.26.0] - 2026-09-16

* Merge pull request #58 from lleqsnoom/feat/multi-cli-session-hosts (f060b1f)
* feat(automation): add Goose, Claude, Gemini, Cursor and Copilot hosts (98aa00d)
* feat(automation): add daily reflection over every detected AI CLI (caf0b3c)

## [5.25.0] - 2026-09-16

* Merge pull request #57 from lleqsnoom/feat/x-autoreflection (48293b6)
* fix(skills): name the legal moves when a scenario transition is refused (7924c3f)
* fix(x-commit): read changed paths from git instead of the diff header (04053a7)
* fix(x-review): stop the analyser crashing or silently reporting zero (11b476e)
* feat(skills): add x-autoreflection to turn a session into skill fixes (a78531a)

## [5.24.1] - 2026-09-16

* Merge pull request #56 from lleqsnoom/fix/ci-stale-version-base (8d822b8)
* fix(ci): base the release version on the newest tag as well as npm (b15b20a)

## [5.24.0] - 2026-09-16

* Merge pull request #55 from lleqsnoom/feat/run-flags-everywhere (2b3030e)
* test: cover the run flags for the text families (7da9b1f)
* feat(skills): give every family the run selection flags (c1d3a86)

## [5.23.0] - 2026-09-16

* Merge pull request #53 from lleqsnoom/feat/install-force (9b1254f)
* Merge pull request #54 from lleqsnoom/docs/fix-leftovers (cfe29c5)
* docs: remove the last references to the old artifact paths (a9f5c1b)
* feat(cli): let install replace a skill that is already there (c88043f)

## [5.22.0] - 2026-09-16

* Merge pull request #52 from lleqsnoom/chore/isolate-test-runs (77712ef)
* feat(skills): let a topic start a second run on demand (51079ca)
* docs: explain the upgrade path and the unmigrated artifacts (9581acb)
* test: stop the suite writing artifacts into the repository (543245d)
* Merge pull request #50 from lleqsnoom/docs/run-folder-convention (95bf555)
* docs: describe the one-folder-per-run artifact layout (ebab4d5)

## [5.21.1] - 2026-09-16

* Merge pull request #51 from lleqsnoom/fix/ci-push-release-commit (9a7794e)
* fix(ci): keep release tags on main and stop releasing docs-only pushes (15285cc)

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
