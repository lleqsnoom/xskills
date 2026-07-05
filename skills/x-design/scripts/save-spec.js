#!/usr/bin/env node

/**
 * Create docs/staging/specs/ directory and return the full spec file path.
 * Auto-detects branch name from git. Generates timestamp.
 *
 * Usage:
 *   node save-spec.js --topic <slug> [--branch <name>] [--date <YYYY-MM-DDTHHMM>]
 *
 * Output (stdout): absolute path to the spec file, ready to write into with `write`.
 */

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--topic" || argv[i] === "-t") && i + 1 < argv.length) args.topic = argv[++i];
    else if (argv[i] === "--branch" && i + 1 < argv.length) args.branch = argv[++i];
    else if (argv[i] === "--date" && i + 1 < argv.length) args.date = argv[++i];
  }
  return args;
}


function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.topic) {
    console.error("Usage: node save-spec.js --topic <slug> [--branch <name>] [--date <YYYY-MM-DDTHHMM>]");
    process.exit(1);
  }

  const branch = args.branch || "unknown";
  const date = args.date || getTimestamp();
  const dir = path.resolve("docs/staging/specs");
  const filename = `${date}-${args.topic}.md`;
  const fullPath = path.join(dir, filename);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, `# Design — ${args.topic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`);

  console.log(fullPath);
}

main();
