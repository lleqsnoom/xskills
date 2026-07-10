#!/usr/bin/env node

/**
 * Create .x-skills/design/<timestamp>-<topic>.md with a header skeleton.
 * Usage: node save-spec.js --topic <slug> [--branch <name>] [--date <YYYY-MM-DDTHHMM>]
 * Output (stdout): path to the created spec file.
 */

const path = require("node:path");
const shared = require("./shared");

function main() {
  const args = shared.parseArgs(process.argv.slice(2), {
    "--topic": "topic", "-t": "topic",
    "--branch": "branch",
    "--date": "date",
  });

  shared.log("x-design", "parsing arguments");

  if (!args.topic) {
    process.stderr.write("Usage: node save-spec.js --topic <slug> [--branch <name>] [--date YYYY-MM-DDTHHMM]\n");
    process.exit(1);
  }

  const slug = shared.sanitizeSlug(args.topic);
  const branch = args.branch || shared.getBranch();
  shared.log("x-design", `resolved branch: ${branch}`);

  const date = args.date || shared.getTimestamp();
  shared.log("x-design", `using date stamp: ${date}`);

  const dir = path.resolve(".x-skills/design");
  const filename = `${date}-${slug}.md`;
  const fullPath = path.join(dir, filename);

  try {
    const header = `# Design — ${args.topic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`;

    shared.log("x-design", `creating directory: ${dir}`);
    shared.ensureDir(dir);

    shared.log("x-design", `writing spec file: ${fullPath} (${header.length} bytes)`);
    shared.writeFile(fullPath, header);

    shared.log("x-design", `spec ready: ${fullPath}`);
    console.log(fullPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
