---
name: x-test-gen
description: Generate test stubs from implementation — analyzes source code and creates scaffolded tests with happy path, error cases, and edge case placeholders
version: 1.0.0
author: Community
tags: [test-generation, tdd, scaffolding, unit-tests, jest, vitest, mocha]
user-invocable: true
---

# X-Test-Gen — Test Stub Generator

Analyzes source code and generates test stub files with happy path and error case scaffolding. Useful for bootstrapping test coverage on existing code or generating initial test structure before writing assertions.

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory:

```bash
# Generate test stubs for a single file or all source in a directory
node <path-to>/generate.js src/pricing.js [--output tests/unit/ --framework vitest]

# Auto-detect framework from project config if not specified
node <path-to>/generate.js src/ --all
```

**Auto-discovery**: Scripts resolve config and sibling scripts relative to `__dirname`, so they work whether installed globally (`~/.agents/skills/x-test-gen/scripts/`) or locally (`.agents/skills/<project>/x-test-gen/scripts/`).

## Framework Detection

The script detects the test framework from project configuration files:

| Config File | Framework | Test Syntax |
|-------------|-----------|-------------|
| `jest.config.js` / `package.json` with `"test"` key | Jest | `describe`, `it`, `expect`, `vi.mock()` |
| `vitest.config.ts` / `package.json` with `"vitest"` key | Vitest | `describe`, `it`, `expect`, `vi.mock()` |
| `.mocharc.yml` / `mocha` in dependencies | Mocha | `describe`, `it`, `should()`, `expect()` |
| `pytest.ini` / `setup.cfg` with `[tool:pytest]` | Pytest (Python) | `def test_xxx(): assert ...` |

## Definition of Done

- [ ] SKILL.md exists with YAML frontmatter
- [ ] Script detects test framework from existing project files (`jest.config.js`, `vitest.config.ts`, etc.)
- [ ] Generates stub file in correct location matching project conventions (`tests/unit/`)
- [ ] Includes TODO comments for assertions that need manual completion
