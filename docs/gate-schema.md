# Gate Schema Specification

**Version:** 1.0.0  
**Status:** Draft  
**Last Updated:** 2026-07-18

This document defines the declarative gate condition system for xskills workflow phases. Gates are automated checks evaluated before phase completion, allowing teams to enforce quality standards without manual review.

---

## Overview

Phases (x-plan, x-epic, x-decompose, x-implement) declare gates in their configuration. Each gate is an atomic check that must pass for the phase to be considered complete. Gates are defined as JSON objects and evaluated by `lib/gates.js`.

```json
{
  "gates": {
    "x-epic": [
      { "type": "file-exists", "path": ".x-skills/epics/{topic}.md" },
      { "type": "no-empty-body", "pattern": "^\\s*// TODO$" }
    ],
    "x-implement": [
      { "type": "tests-pass", "command": "npm test --if-present" },
      { "type": "commit-message-format", "pattern": "^\\w+\\(.+\\): .+" }
    ]
  }
}
```

---

## Available Gate Types

### `file-exists`

Check whether a file exists at the specified path. Supports glob patterns via `{topic}` placeholders that resolve to task/epic names.

**Parameters:**
| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | string | Yes | Must be `"file-exists"` |
| `path` | string | Yes | File path (supports `{topic}` placeholder) |

**Examples:**
```json
{ "type": "file-exists", "path": ".x-skills/plan/{topic}.md" }
{ "type": "file-exists", "path": "tests/unit/{name}.test.js" }
```

### `no-pattern`

Assert that a pattern does NOT appear in any file matching the optional `files` glob. Useful for ensuring TODOs are resolved or forbidden patterns are removed.

**Parameters:**
| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | string | Yes | Must be `"no-pattern"` |
| `pattern` | string (regex) | Yes | Regex pattern that must NOT match any file content |
| `files` | string (glob) | No | Glob of files to check. Defaults to all source files. |

**Examples:**
```json
{ "type": "no-pattern", "pattern": "^\\s*console\\.log" }
{ "type": "no-pattern", "pattern": "TODO:.*unresolved", "files": "**/*.js" }
```

### `tests-pass`

Run a shell command and check its exit code. Exit 0 = pass, non-zero = fail. Use with caution — this executes arbitrary commands.

**Parameters:**
| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | string | Yes | Must be `"tests-pass"` |
| `command` | string | Yes | Shell command to execute |
| `timeout` | integer | No | Timeout in milliseconds (default: 60000) |

**Examples:**
```json
{ "type": "tests-pass", "command": "npm test --if-present" }
{ "type": "tests-pass", "command": "pytest tests/", "timeout": 120000 }
```

### `commit-message-format`

Validate that recent commit messages match a regex pattern. Checks the last N commits (configurable).

**Parameters:**
| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | string | Yes | Must be `"commit-message-format"` |
| `pattern` | string (regex) | Yes | Regex that all commit messages must match |
| `count` | integer | No | Number of recent commits to check (default: 5) |

**Examples:**
```json
{ "type": "commit-message-format", "pattern": "^\\w+\\(.+\\): .+" }
{ "type": "commit-message-format", "pattern": "^(feat|fix|docs|chore)", "count": 10 }
```

### `schema-valid`

Validate that a JSON/YAML file conforms to a defined schema. Useful for enforcing structure on generated artifacts.

**Parameters:**
| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | string | Yes | Must be `"schema-valid"` |
| `file` | string | Yes | Path to the JSON/YAML file to validate |
| `schemaPath` | string | Yes | Path to the JSON schema definition |

**Examples:**
```json
{ "type": "schema-valid", "file": ".x-skills/tasks/{epic}.md", "schemaPath": "schemas/task-schema.json" }
```

---

## Gate Configuration Location

Gates are declared in phase-specific config files:

| Phase | Config File | Default Gates |
|-------|-------------|---------------|
| `x-plan` | `.x-skills/config/gates/design.json` | 2 gates (file-exists, no-empty-body) |
| `x-epic` | `.x-skills/config/gates/epic.json` | 2 gates (file-exists, schema-valid) |
| `x-decompose` | `.x-skills/config/gates/decompose.json` | 2 gates (tests-pass, commit-message-format) |
| `x-implement` | `.x-skills/config/gates/implement.json` | 3 gates (tests-pass, commit-message-format, no-pattern) |

If a config file does not exist, the phase uses sensible defaults (at least one gate per phase).

---

## JSON Schema for Gate Configurations

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Gate Configuration",
  "type": "object",
  "properties": {
    "gates": {
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": {
          "oneOf": [
            {
              "$ref": "#/definitions/fileExists"
            },
            {
              "$ref": "#/definitions/noPattern"
            },
            {
              "$ref": "#/definitions/testsPass"
            },
            {
              "$ref": "#/definitions/commitMessageFormat"
            },
            {
              "$ref": "#/definitions/schemaValid"
            }
          ]
        }
      }
    }
  },
  "required": ["gates"],
  "additionalProperties": false,
  "definitions": {
    "fileExists": {
      "type": "object",
      "properties": {
        "type": { "const": "file-exists" },
        "path": { "type": "string" }
      },
      "required": ["type", "path"],
      "additionalProperties": false
    },
    "noPattern": {
      "type": "object",
      "properties": {
        "type": { "const": "no-pattern" },
        "pattern": { "type": "string" },
        "files": { "type": "string" }
      },
      "required": ["type", "pattern"],
      "additionalProperties": false
    },
    "testsPass": {
      "type": "object",
      "properties": {
        "type": { "const": "tests-pass" },
        "command": { "type": "string" },
        "timeout": { "type": "integer", "minimum": 1000 }
      },
      "required": ["type", "command"],
      "additionalProperties": false
    },
    "commitMessageFormat": {
      "type": "object",
      "properties": {
        "type": { "const": "commit-message-format" },
        "pattern": { "type": "string" },
        "count": { "type": "integer", "minimum": 1 }
      },
      "required": ["type", "pattern"],
      "additionalProperties": false
    },
    "schemaValid": {
      "type": "object",
      "properties": {
        "type": { "const": "schema-valid" },
        "file": { "type": "string" },
        "schemaPath": { "type": "string" }
      },
      "required": ["type", "file", "schemaPath"],
      "additionalProperties": false
    }
  }
}
```

---

## Evaluation Results

Each gate returns one of three states:

| State | Description | Action |
|-------|-------------|--------|
| `pass` | Gate condition met | Phase can proceed |
| `fail` | Gate condition not met | Phase blocked; must fix and re-evaluate |
| `skip` | Gate not applicable (e.g., no tests to run) | Treated as pass for phase completion |

---

## Example Configurations

### x-plan gates (default):
```json
{
  "gates": {
    "x-plan": [
      { "type": "file-exists", "path": ".x-skills/plan/{topic}.md" },
      { "type": "no-pattern", "pattern": "^\\s*$", "files": ".x-skills/plan/{topic}.md" }
    ]
  }
}
```

### x-epic gates (default):
```json
{
  "gates": {
    "x-epic": [
      { "type": "file-exists", "path": ".x-skills/epics/{topic}.md" },
      { "type": "schema-valid", "file": ".x-skills/epics/{topic}.md", "schemaPath": "schemas/epic-schema.json" }
    ]
  }
}
```

---

## Extending Gates

To add a custom gate type:

1. Implement an evaluator function in `lib/gates.js` matching the pattern `evaluate<GateType>(gate, context)`
2. Register it in the `GATE_EVALUATORS` map
3. Document it in this spec under "Available Gate Types"

---

## Backward Compatibility

Existing phases that do not declare gates use built-in defaults (file-exists check on artifact location). Custom gate configurations are opt-in — adding them does not break existing workflows.
