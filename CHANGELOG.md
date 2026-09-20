## [5.33.0] - 2026-09-20

* Merge pull request #70 from lleqsnoom/feat/merge-autoreflection-skills (350c9db)
* feat: fold analysis and heal into x-autoreflection (172c5c6)
* fix: include the Crush sub-agent sessions the CLI hides (fed58c0)

## [5.32.0] - 2026-09-20

* Merge pull request #69 from lleqsnoom/feat/project-preview (f26d2e9)
* chore(deps): declare the grammars the suite needs and refresh the lockfile (ea1619a)
* Merge pull request #68 from lleqsnoom/feat/project-preview (54105bf)
* ci: run the search tool's tests in CI with the embedder they call (581a4ed)
* Merge pull request #67 from lleqsnoom/feat/project-preview (5755499)
* Merge remote-tracking branch 'origin/main' into feat/project-preview (e4af7bb)
* refactor: rename the x-anal skill to x-analyze (49008a1)
* chore: hand the project board over to its own Otter PM repository (131bf41)
* feat(x-search): add a per-repository search index served over MCP (7cd6f66)

## [5.31.0] - 2026-09-19

* Merge pull request #66 from lleqsnoom/lleqsnoom/feat-auto-improve (2ca43a0)
* Merge remote-tracking branch 'origin/main' into lleqsnoom/feat-auto-improve (fb4ed94)
* feat: detect below-expectation sessions via quality anchors, implicit signals, and skill evals (710de5d)
* Merge pull request #65 from lleqsnoom/lleqsnoom/feat-spp-engine (32896fb)
* refactor(report): remove the Orca plugin and pick a free dev port (4700029)

## [5.30.2] - 2026-09-18

* Merge pull request #62 from lleqsnoom/fix/orca-plugin-declared-panel (3639702)
* fix(orca-plugin): commit the panel entry so Orca can load the plugin (48e8d27)

## [5.30.1] - 2026-09-18

* Merge pull request #64 from lleqsnoom/feat/autoreflection-heal (d369e11)
* fix(autoreflection-analysis): dedupe portfolio and widen session lookback (0214d14)
* fix(x-anal): point the record guard at the start step (5b93ec3)

## [5.30.0] - 2026-09-18

* Merge pull request #63 from lleqsnoom/feat/autoreflection-heal (259d0c2)
* fix(report): install the app without the parent's allow-scripts (6054547)
* feat(autoreflection): add skill-health analysis and a heal skill (2c029bd)

## [5.29.0] - 2026-09-18

* Merge pull request #61 from lleqsnoom/feat/orca-panel-and-console (577d727)
* feat(orca-plugin): bake the report panel and add a console command (38f5d7d)

## [5.28.0] - 2026-09-18

* Merge pull request #60 from lleqsnoom/refactor/live-only-report (dea6c84)
* feat(orca-plugin): mark the report panel with the activity icon (21ef54f)
* refactor(report): serve the report live only and drop the baked panel (df0c3c9)

## [5.27.0] - 2026-09-18

* Merge pull request #59 from lleqsnoom/feat/gauge-report (eacfdc1)
* refactor(report): replace the ten views with one card and Tailwind (27dfab0)
* test(x-review): pin the analyzer JSON shapes the SKILL.md documents (782e9fe)
* feat(report): score every skill and open ten views on whether it improved (bb5069c)
* feat(dev): run the report server and the app's dev server together (c8f9f1a)
* docs(x-review): name the engine and say the counts are repo-wide (b4797a0)
* fix(x-anal): keep a run folder portable when a command runs elsewhere (de75196)
* fix(x-plan): keep a run folder portable when a command runs elsewhere (0d77614)
* feat(x-skill-lint): reject repo-only refs and stray run folders (442273b)
* fix(report): open any day the rail lists, and say why when one cannot (e604c48)
* refactor(orca-plugin): keep the worker's path lookup and event check to one job each (fd9ebef)
* feat(orca-plugin): let the worker bake the panel, so it needs no server (cc91a92)
* refactor(report): give the staleness rule one home both callers share (48b4128)
* feat(report): re-bake the panel whenever the packs change (39152b3)
* chore(orca-plugin): stop tracking the panel the baker generates (84debbe)
* fix(report): keep links clickable in the Orca panel, where the host cancels anchors (3cbfeb8)
* docs(orca-plugin): describe the panel as the report's own UI, baked (e7547c7)
* feat(report): run the report inside the Orca panel from a baked snapshot (3e8402e)
* fix(orca-plugin): stop the panel typing into a terminal it cannot identify (3dd033f)
* feat(orca-plugin): give the plugin a panel tab that opens the report (160cf5f)
* feat(report-app): name the report tab after the plugin that opens it (c222a55)
* fix(orca-plugin): recognise the day payload the report actually sends (c4bd0b6)
* docs: point the report section at the Orca plugin (9b562b8)
* docs(orca-plugin): record what Orca must add for the report to live in a pane (bc113d2)
* feat(orca-plugin): wake on Orca events and stay quiet when the report is down (da634d2)
* feat(orca-plugin): say once when a new day lands, and remember the day either way (6b9b5e5)
* refactor(orca-plugin): keep the host stub to assembling recorders and answering calls (e88f575)
* feat(orca-plugin): put the report on Mod+Alt+X and check the manifest in the test run (476f147)
* feat(orca-plugin): describe the report, record the newest day, and start the server from a terminal (26d2060)
* feat(orca-plugin): read the report's address from the plugin's own settings (95f6756)
* feat(orca-plugin): refuse to contact anything that is not the local report (3480650)
* feat(orca-plugin): open the report in an Orca tab from a command (71653fd)

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
