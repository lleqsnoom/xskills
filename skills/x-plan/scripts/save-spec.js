#!/usr/bin/env node

/**
 * Create .x-skills/plan/<timestamp>-<topic>.md with a header skeleton.
 * Usage: node save-spec.js --topic <slug> [--branch <name>] 
 * Output (stdout): path to the created spec file.
 */

const path = require("node:path");
const shared = require("./shared");

function main() {
  const args = shared.parseArgs(process.argv.slice(2), {
    "--topic": "topic", "-t": "topic",
    "--branch": "branch",
  });

  shared.log("x-plan", "parsing arguments");

  if (!args.topic) {
    process.stderr.write("Usage: node save-spec.js --topic <slug> [--branch <name>]\n");
    process.exit(1);
  }

  const slug = shared.sanitizeSlug(args.topic);
  const branch = args.branch || shared.getBranch();
  shared.log("x-plan", `resolved branch: ${branch}`);

  const date = shared.getTimestamp();
  shared.log("x-plan", `using date stamp: ${date}`);

  const dir = path.resolve(".x-skills/plan");
  const filename = `${date}-${slug}.md`;
  const fullPath = path.join(dir, filename);

  try {
    const header = `# Plan — ${args.topic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`;

    shared.log("x-plan", `creating directory: ${dir}`);
    shared.ensureDir(dir);

    shared.log("x-plan", `writing spec file: ${fullPath} (${header.length} bytes)`);
    shared.writeFile(fullPath, header);

    shared.log("x-plan", `spec ready: ${fullPath}`);
    console.log(fullPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
