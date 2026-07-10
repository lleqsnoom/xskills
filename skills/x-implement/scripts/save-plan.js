#!/usr/bin/env node

/**
 * Create .x-skills/tasks/<timestamp>-<epic>.md with a resolved header skeleton.
 * Auto-finds the matching epic by topic slug and fills in the path.
 * Usage: node save-plan.js --epic <slug> [--branch <name>] [--date <YYYY-MM-DDTHHMM>]
 * Output (stdout): path to the created plan file.
 */

const path = require("node:path");
const shared = require("./shared");

function main() {
  const args = shared.parseArgs(process.argv.slice(2), {
    "--epic": "epic", "-e": "epic",
    "--branch": "branch",
    "--date": "date",
  });

  shared.log("x-implement", "parsing arguments");

  if (!args.epic) {
    process.stderr.write("Usage: node save-plan.js --epic <slug> [--branch <name>] [--date YYYY-MM-DDTHHMM]\n");
    process.exit(1);
  }

  const slug = shared.sanitizeSlug(args.epic);
  const branch = args.branch || shared.getBranch();
  const date = args.date || shared.getTimestamp();

  // Auto-resolve the epic file path from disk
  const epicPath = shared.findFileByTopic(".x-skills/epics", slug)
    ? path.relative(process.cwd(), shared.findFileByTopic(".x-skills/epics", slug))
    : null;

  const dir = path.resolve(".x-skills/tasks");
  const filename = `${date}-${slug}.md`;
  const fullPath = path.join(dir, filename);

  try {
    shared.ensureDir(dir);

    let header = `# Tasks — ${args.epic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`;

    if (epicPath) {
      header += `epic:         ${epicPath}\n\n`;
      shared.log("x-implement", `resolved epic path: ${epicPath}`);
    } else {
      header += `epic:         .x-skills/epics/<timestamp>-<topic>.md\n\n`;
      shared.log("x-implement", "no epic file found for slug — placeholder left");
    }

    shared.log("x-implement", `writing tasks file: ${fullPath}`);
    shared.writeFile(fullPath, header);

    shared.log("x-implement", `plan ready: ${fullPath}`);
    console.log(fullPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
