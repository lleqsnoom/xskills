#!/usr/bin/env node

/**
 * Validate a conventional commit message against the spec.
 * Usage: node scripts/validate-commit.js "<message>"
 * Exit 0 = valid, exit 1 = invalid.
 */

const VALID_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const PATTERN = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:\ .+/;

const msg = process.argv.slice(2).join(" ");

if (!msg) {
  console.error("Usage: validate-commit.js '<message>'");
  process.exit(2);
}

const trimmed = msg.trim();

// Must be single line (no newlines)
if (trimmed.includes("\n")) {
  console.error("ERROR: Commit message must be a single line.");
  process.exit(1);
}

// No trailing period
if (trimmed.endsWith(".")) {
  console.error("ERROR: Commit message must not end with a period.");
  process.exit(1);
}

if (!PATTERN.test(trimmed)) {
  console.error(`ERROR: "${firstLine}" is not a valid conventional commit message.`);
  console.error("");
  console.error("Expected format: type[(scope)]: description");
  console.error("");
  console.error("Valid types:", VALID_TYPES.join(", "));
  process.exit(1);
}

console.log(`OK: ${firstLine}`);
process.exit(0);
