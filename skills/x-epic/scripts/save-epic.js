#!/usr/bin/env node

/**
 * Create .x-skills/epics/<timestamp>-<topic>.md with a resolved header skeleton.
 * Auto-finds the matching design spec by topic slug and fills in the path.
 * Usage: node save-epic.js --topic <slug> [--branch <name>] 
 * Output (stdout): path to the created epic file.
 */

const path = require("node:path");
const shared = require("./shared");

function main() {
  const args = shared.parseArgs(process.argv.slice(2), {
    "--topic": "topic", "-t": "topic",
    "--branch": "branch",
  });

  shared.log("x-epic", "parsing arguments");

  if (!args.topic) {
    process.stderr.write("Usage: node save-epic.js --topic <slug> [--branch <name>]\n");
    process.exit(1);
  }

  const slug = shared.sanitizeSlug(args.topic);
  const branch = args.branch || shared.getBranch();
  const date = shared.getTimestamp();

  // Auto-resolve the design spec path from disk (single call)
  const specFullPath = shared.findFileByTopic(".x-skills/design", slug);
  const specPath = specFullPath ? path.relative(process.cwd(), specFullPath) : null;

  const dir = path.resolve(".x-skills/epics");
  const filename = `${date}-${slug}.md`;
  const fullPath = path.join(dir, filename);

  try {
    shared.ensureDir(dir);

    let header = `# Epic — ${args.topic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`;

    if (specPath) {
      header += `goal:         <outcome in one sentence>\nmilestone:    <milestone from roadmap or skip if none>\nspec:         ${specPath}\n\n`;
      shared.log("x-epic", `resolved spec path: ${specPath}`);
    } else {
      header += `goal:         <outcome in one sentence>\nmilestone:    <skip if work fits in one milestone>\nspec:         .x-skills/design/<timestamp>-<topic>.md\n\n`;
      shared.log("x-epic", "no design spec found for topic — placeholder left");
    }

    header += `## Definition of Done (Epic Level)\n\n- [ ] All user stories delivered and acceptance criteria verified\n- [ ] Integration across stories works end-to-end\n- [ ] No regressions in existing behavior\n- [ ] Documentation updated where contracts changed\n`;

    shared.log("x-epic", `writing epic file: ${fullPath}`);
    shared.writeFile(fullPath, header);

    shared.log("x-epic", `epic ready: ${fullPath}`);
    console.log(fullPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
