#!/usr/bin/env node

/**
 * Validate a conventional commit message and commit it atomically.
 * Usage: node scripts/commit.mjs "<message>"
 *    or: echo "<message>" | node scripts/commit.mjs
 * Exit 0 = committed, exit 1 = validation failed (no commit made).
 */

import { execSync } from "node:child_process";

let msg;

if (process.argv.length > 2) {
  msg = process.argv.slice(2).join(" ");
} else if (!process.stdin.isTTY) {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => {
    msg = Buffer.concat(chunks).toString();
    runCommit(msg);
  });
}

function runCommit(message) {
  if (!message || !message.trim()) {
    console.error("ERROR: No commit message provided.");
    console.error("Usage: node scripts/commit.mjs '<message>'");
    process.exit(2);
  }

  const trimmed = message.trim();

  // Inline validation (mirrors validate-commit.js to keep this script self-contained)
  const VALID_TYPES = [
    "feat", "fix", "docs", "style", "refactor", "perf",
    "test", "build", "ci", "chore", "revert",
  ];
  const PATTERN = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:\ .+/;

  if (/\bassisted-by:\s*\S+/i.test(trimmed)) {
    console.error("ERROR: Commit message must not contain AI attribution (e.g. 'Assisted-by: ...').");
    process.exit(1);
  }

  if (trimmed.includes("\n")) {
    console.error("ERROR: Commit message must be a single line.");
    process.exit(1);
  }

  if (trimmed.endsWith(".")) {
    console.error("ERROR: Commit message must not end with a period.");
    process.exit(1);
  }

  if (!PATTERN.test(trimmed)) {
    console.error(`ERROR: "${trimmed}" is not a valid conventional commit message.`);
    console.error("");
    console.error("Expected format: type[(scope)]: description");
    console.error("Valid types:", VALID_TYPES.join(", "));
    process.exit(1);
  }

  // Validation passed — commit atomically
  try {
    execSync(`git commit -m "${trimmed.replace(/"/g, '\\"')}"`, { stdio: "inherit" });
    console.log(`Committed: ${trimmed}`);
    process.exit(0);
  } catch (err) {
    console.error("ERROR: git commit failed.");
    process.exit(1);
  }
}

// Execute synchronously if we got CLI args
if (process.argv.length > 2) {
  runCommit(msg);
}
