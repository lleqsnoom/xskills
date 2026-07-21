# Auto-Trigger Schema Specification

**Version:** 1.0.0  
**Status:** Draft  
**Last Updated:** 2026-07-18

This document defines the declarative schema for auto-trigger conditions in SKILL.md YAML frontmatter. When a skill declares an `auto-trigger` section, the xskills framework evaluates these conditions before suggesting activation based on detected code patterns, file paths, and git events.

---

## Schema Overview

The `auto-trigger` field lives in the YAML frontmatter of any skill's `SKILL.md`. It is optional — skills without it require explicit user invocation (backward compatible).

```yaml
---
name: x-review
description: Review code against engineering principles...
auto-trigger:
  on-file-pattern: "*.ts,*.tsx,*.js,*.jsx"
  not-when:
    - path-matches: "node_modules/**"
    - file-size-above: 1048576
---
```

---

## Trigger Types

### `on-file-pattern` (required for most auto-triggers)

Glob pattern matching file extensions. Comma-separated list of patterns is supported.

**Syntax:**
- Single extension: `"*.ts"`
- Multiple extensions: `"*.ts,*.tsx,*.js,*.jsx"`
- Full glob: `"src/**/*.{ts,tsx}"`

**Examples:**
```yaml
auto-trigger:
  on-file-pattern: "*.py"                    # Python files only
  on-file-pattern: "*.go,*.rs"               # Go and Rust
  on-file-pattern: "src/**/*.vue"            # Vue components in src/
```

### `on-path-pattern` (optional)

Path prefix or glob for directory context. Activates only when the target file is inside matching directories.

**Examples:**
```yaml
auto-trigger:
  on-path-pattern: "**/test/**"              # Only in test directories
  on-path-pattern: "docs/"                   # Only in docs/ folder
  on-path-pattern: "src/services/*"          # Direct children of services/
```

### `on-commit-msg` (optional)

Regex pattern for git commit message matching. Activates when a commit message matches the pattern.

**Examples:**
```yaml
auto-trigger:
  on-commit-msg: "^fix\\(.*\\):"            # Fix commits
  on-commit-msg: "BREAKING CHANGE:"         # Breaking changes
  on-commit-msg: "(?i)security|vuln"        # Security-related (case-insensitive)
```

### `on-function-name` (optional)

Regex pattern matched against function/class names being edited. Requires editor integration that provides the symbol name under cursor.

**Examples:**
```yaml
auto-trigger:
  on-function-name: "test_|spec_"            # Test functions
  on-function-name: "(?i)TODO|FIXME"         # Functions with TODO/FIXME in name
```

---

## Exclusion Types (`not-when`)

Exclusions are evaluated AFTER trigger conditions. If any `not-when` condition matches, the skill is NOT activated even if triggers matched.

### `path-matches` (glob pattern)

Exclude when the file path matches a glob pattern.

**Examples:**
```yaml
not-when:
  - path-matches: "node_modules/**"
  - path-matches: "vendor/**"
  - path-matches: "*.min.js"                 # Minified files
```

### `file-size-above` (bytes, integer)

Skip for files larger than N bytes. Useful to avoid triggering on large generated files or binaries mistakenly included as source.

**Examples:**
```yaml
not-when:
  - file-size-above: 1048576                 # Skip files > 1MB
  - file-size-above: 524288                  # Skip files > 512KB
```

### `has-skill` (skill name string)

Skip activation when another skill is already active in the session. Prevents redundant triggers from multiple overlapping skills.

**Examples:**
```yaml
not-when:
  - has-skill: "x-review"                    # Don't auto-trigger x-fix if x-review is active
  - has-skill: "x-commit"                    # Skip during commit workflow
```

---

## Evaluation Order

1. **Trigger evaluation**: Check `on-file-pattern`, `on-path-pattern`, `on-commit-msg`, `on-function-name`. ALL specified triggers must match for the skill to be considered.
2. **Exclusion evaluation**: If any `not-when` condition matches, suppress activation immediately.
3. **Conflict resolution**: If multiple skills match, prefer the one with the most specific trigger (longest pattern, fewest exclusions).

---

## JSON Schema Validation

The following JSON schema validates auto-trigger configurations:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Auto-Trigger Configuration",
  "type": "object",
  "properties": {
    "auto-trigger": {
      "type": "object",
      "required": ["on-file-pattern"],
      "properties": {
        "on-file-pattern": {
          "type": "string",
          "description": "Comma-separated glob pattern(s) for file extensions"
        },
        "on-path-pattern": {
          "type": "string",
          "description": "Path prefix or glob for directory context"
        },
        "on-commit-msg": {
          "type": "string",
          "format": "regex",
          "description": "Regex pattern for git commit message matching"
        },
        "on-function-name": {
          "type": "string",
          "format": "regex",
          "description": "Regex pattern matched against function/class names"
        },
        "not-when": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "path-matches": { "type": "string" }
                },
                "required": ["path-matches"],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "file-size-above": { "type": "integer", "minimum": 1 }
                },
                "required": ["file-size-above"],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "has-skill": { "type": "string" }
                },
                "required": ["has-skill"],
                "additionalProperties": false
              }
            ]
          }
        }
      },
      "additionalProperties": false,
      "minProperties": 1
    }
  },
  "additionalProperties": false
}
```

---

## Validation Rules

| Rule | Description |
|------|-------------|
| `on-file-pattern` required | At least one trigger type must be specified |
| Only one trigger per category | Cannot declare multiple `on-file-pattern` fields (use comma-separated values) |
| Regex validation | `on-commit-msg` and `on-function-name` values must compile as valid regex |
| Integer constraints | `file-size-above` must be a positive integer (> 0) |
| No nested objects in `not-when` items | Each exclusion item has exactly one key (path-matches, file-size-above, or has-skill) |

---

## Backward Compatibility

Skills without an `auto-trigger` section continue to work as before — they require explicit user invocation via `user-invocable: true`. The schema is additive; existing SKILL.md files are valid under this spec (the `auto-trigger` field is optional).

Example backward-compatible skill:
```yaml
---
name: x-commit
description: Write single-line conventional commit messages...
version: 1.0.0
author: Community
tags: [commit, git]
user-invocable: true
# No auto-trigger section — requires explicit invocation
---
```

---

## Usage in xskills Framework

The framework evaluates auto-triggers during skill loading. When a user opens or edits files, the framework:

1. Scans for source files matching `on-file-pattern` globs
2. Checks `not-when` exclusions against discovered file paths
3. Suggests matching skills to the AI coding agent via its skill discovery mechanism
4. Resolves conflicts when multiple skills match (most specific wins)

---

## Examples

### x-review with TypeScript files, excluding node_modules:
```yaml
auto-trigger:
  on-file-pattern: "*.ts,*.tsx"
  not-when:
    - path-matches: "node_modules/**"
    - file-size-above: 1048576
```

### x-commit triggering only on fix commits:
```yaml
auto-trigger:
  on-commit-msg: "^fix\\(.*\\):|^hotfix:"
```

### x-plan triggering in docs/ directory:
```yaml
auto-trigger:
  on-file-pattern: "*.md"
  on-path-pattern: "docs/**,specs/**"
  not-when:
    - path-matches: "README.md"
```
