#!/usr/bin/env node

/**
 * Create .x-skills/review/ directory and return the full plan file path.
 * Auto-detects branch name from git if not provided. Generates timestamp.
 *
 * Usage:
 *   node save-plan.js --output <dir> [--branch <name>] [--date <YYYY-MM-DDTHHMM>]
 *
 * Output (stdout): absolute path to the plan file, ready to write into with `write`.
 */

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--output" || argv[i] === "-o") && i + 1 < argv.length) args.output = argv[++i];
    else if (argv[i] === "--branch" && i + 1 < argv.length) args.branch = argv[++i];
    else if (argv[i] === "--date" && i + 1 < argv.length) args.date = argv[++i];
  }
  return args;
}

function sanitizeBranch(branch) {
  // Replace chars problematic in filenames. Slashes first to avoid double-underscore artifacts.
  return branch.replace(/[/\\.*-]/g, "_");
}

function getBranch() {
  try {
    const cp = require("node:child_process");
    return cp.execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GIT_BRANCH || "unknown";
  }
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.output) {
    console.error("Usage: node save-plan.js --output <dir> [--branch <name>] [--date <YYYY-MM-DDTHHMM>]");
    process.exit(1);
  }

  const branch = args.branch || getBranch();
  const date = args.date || getTimestamp();
  const dir = path.resolve(args.output);
  const filename = `${date}_${sanitizeBranch(branch)}.md`;
  const fullPath = path.join(dir, filename);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, `# Code Review — Fix Plan\n\n`);

  console.log(fullPath);
}

main();
