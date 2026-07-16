#!/usr/bin/env node

/**
 * Create .x-skills/apis/ directory and return the full YAML spec file path.
 * Auto-detects branch name from git if not provided. Generates timestamp.
 * Logs each step to stderr for verification.
 *
 * Usage:
 *   node save-spec.js --topic <slug> [--branch <name>]
 *
 * Output (stdout): absolute path to the YAML spec file, ready to write into with `write`.
 * NOTE: Timestamps are always JS-generated. No --date flag is accepted.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Logging ───────────────────────────────────────────────────────────

function log(stage) {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [x-api-swagger] ${stage}\n`);
}

// ── Argument parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--topic" || argv[i] === "-t") && i + 1 < argv.length) args.topic = argv[++i];
    else if (argv[i] === "--branch" && i + 1 < argv.length) args.branch = argv[++i];
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

// ── Timestamp (JS-generated only — never LLM-determined) ─────────────

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}-${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// ── Self-discovery ────────────────────────────────────────────────────
// __dirname resolves to wherever the script actually lives, whether invoked
// from a global install ( ~/.agents/skills/x-api-swagger/scripts/ ) or a local one
// (.agents/skills/<project>/x-api-swagger/scripts/). This lets us find sibling
// scripts and resources without the agent needing to know <skill-install-dir>.

const SKILL_DIR = path.resolve(__dirname, ".."); // parent of scripts/

function skillScript(relPath) {
  return path.join(SKILL_DIR, "scripts", relPath);
}

function skillResource(relPath) {
  return path.join(SKILL_DIR, relPath);
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  log("parsing arguments");

  if (!args.topic) {
    console.error("Usage: node save-spec.js --topic <slug> [--branch <name>]\n");
    process.exit(1);
  }

  const branch = args.branch || getBranch();
  log(`resolved branch: ${branch}`);

  const date = getTimestamp();
  log(`using date stamp: ${date}`);

  const dir = path.resolve(".x-skills/apis");
  const filename = `${args.topic}-openapi.yaml`;
  const fullPath = path.join(dir, filename);

  log(`creating directory: ${dir}`);
  fs.mkdirSync(dir, { recursive: true });

  const header = `# OpenAPI — ${args.topic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n**Scope:** \n**Status:** Draft — awaiting user approval\n\n---\n\n`;
  log(`writing YAML spec file: ${fullPath} (${header.length} bytes)`);
  fs.writeFileSync(fullPath, header);

  // Verify the write succeeded
  const stats = fs.statSync(fullPath);
  if (stats.size === 0) {
    console.error("ERROR: YAML spec file was written but is empty.");
    process.exit(1);
  }

  log(`YAML spec ready: ${fullPath}`);
  console.log(fullPath);
}

main();
