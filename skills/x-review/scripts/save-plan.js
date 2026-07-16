#!/usr/bin/env node

/**
 * Create .x-skills/review/ directory and return the full plan file path.
 * Auto-detects branch name from git if not provided. Generates timestamp.
 *
 * Usage:
 *   node save-plan.js --output <dir> [--branch <name>] 
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
  }
  return args;
}

function sanitizeBranch(branch) {
  // Only replace characters that are invalid in filenames (not - or . which are common in branches).
  return branch.replace(/[/\\:*?"<>|\0]/g, "_");
}

function getBranch() {
  try {
    const cp = require("node:child_process");
    return cp.execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GIT_BRANCH || "unknown";
  }
}

// ── Timestamp (JS-generated only — never LLM-determined) ─────────────

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}-${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// ── Self-discovery ────────────────────────────────────────────────────
// __dirname resolves to wherever the script actually lives, whether invoked
// from a global install ( ~/.agents/skills/x-review/scripts/ ) or a local one
// (.agents/skills/<project>/x-review/scripts/). This lets us find sibling
// scripts and resources without the agent needing to know <skill-install-dir>.

const SKILL_DIR = path.resolve(__dirname, ".."); // parent of scripts/

function skillScript(relPath) {
  return path.join(SKILL_DIR, "scripts", relPath);
}

function skillResource(relPath) {
  return path.join(SKILL_DIR, relPath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.output) {
    console.error("Usage: node save-plan.js --output <dir> [--branch <name>] ");
    process.exit(1);
  }

  const branch = args.branch || getBranch();
  const date = getTimestamp();
  const dir = path.resolve(args.output);
  const filename = `${date}_${sanitizeBranch(branch)}.md`;
  const fullPath = path.join(dir, filename);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, `# Code Review — Fix Plan\n\n`);

  console.log(fullPath);
}

main();
