#!/usr/bin/env node

/**
 * Create .x-skills/tasks/<timestamp>-<epic>/ staging directory.
 * Auto-finds the matching epic by topic slug for logging.
 * Usage: node save-tasks.js --epic <slug> 
 * Output (stdout): path to the created tasks directory.
 */

const path = require("node:path");
const shared = require("./shared");

function main() {
  const args = shared.parseArgs(process.argv.slice(2), {
    "--epic": "epic", "-e": "epic",
  });

  shared.log("x-decompose", "parsing arguments");

  if (!args.epic) {
    process.stderr.write("Usage: node save-tasks.js --epic <slug>\n");
    process.exit(1);
  }

  const slug = shared.sanitizeSlug(args.epic);
  const date = shared.getTimestamp();

  // Auto-resolve the epic file path from disk (for logging)
  const epicFullPath = shared.findFileByTopic(".x-skills/epics", slug);
  const epicPath = epicFullPath ? path.relative(process.cwd(), epicFullPath) : null;

  if (epicPath) {
    shared.log("x-decompose", `resolved epic path: ${epicPath}`);
  } else {
    shared.log("x-decompose", "no epic file found for slug");
  }

  const taskDir = path.resolve(".x-skills/tasks", `${date}-${slug}`);

  try {
    shared.ensureDir(taskDir);
    shared.log("x-decompose", `tasks directory ready: ${taskDir}`);
    console.log(taskDir);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
