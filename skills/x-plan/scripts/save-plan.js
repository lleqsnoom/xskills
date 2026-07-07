#!/usr/bin/env node

/**
 * Create .x-skills/plans/ directory and return the full plan file path.
 * Auto-detects branch name from git if not provided. Generates timestamp.
 * Logs each step to stderr for verification.
 *
 * Usage:
 *   node save-plan.js --topic <slug> [--branch <name>] [--date <YYYY-MM-DDTHHMM>]
 *
 * Output (stdout): absolute path to the plan file, ready to write into with `write`.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Logging ───────────────────────────────────────────────────────────

function log(stage) {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [x-plan] ${stage}\n`);
}

// ── Argument parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--topic" || argv[i] === "-t") && i + 1 < argv.length) args.topic = argv[++i];
    else if (argv[i] === "--branch" && i + 1 < argv.length) args.branch = argv[++i];
    else if (argv[i] === "--date" && i + 1 < argv.length) args.date = argv[++i];
  }
  return args;
}

// ── Helpers ───────────────────────────────────────────────────────────

function getBranch() {
  try {
    const cp = require("node:child_process");
    const result = cp.execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] });
    return result.toString().trim();
  } catch {
    return process.env.GIT_BRANCH || "unknown";
  }
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  log("parsing arguments");

  if (!args.topic) {
    console.error("Usage: node save-plan.js --topic <slug> [--branch <name>] [--date <YYYY-MM-DDTHHMM>]");
    process.exit(1);
  }

  const branch = args.branch || getBranch();
  log(`resolved branch: ${branch}`);

  const date = args.date || getTimestamp();
  log(`using date stamp: ${date}`);

  const dir = path.resolve(".x-skills/plans");
  const filename = `${date}-${args.topic}.md`;
  const fullPath = path.join(dir, filename);

  log(`creating directory: ${dir}`);
  fs.mkdirSync(dir, { recursive: true });

  const header = `# Plan — ${args.topic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`;
  log(`writing plan file: ${fullPath} (${header.length} bytes)`);
  fs.writeFileSync(fullPath, header);

  // Verify the write succeeded
  const stats = fs.statSync(fullPath);
  if (stats.size === 0) {
    console.error("ERROR: plan file was written but is empty.");
    process.exit(1);
  }

  log(`plan ready: ${fullPath}`);
  console.log(fullPath);
}

main();
