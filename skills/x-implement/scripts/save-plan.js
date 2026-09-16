#!/usr/bin/env node

/**
 * Create .x-skills/runs/<stamp>-R<nn>-<epic>/E<nn>-implement.md with a resolved header skeleton.
 * Auto-finds the matching epic by topic slug and fills in the path.
 * Usage: node save-plan.js --epic <slug> [--branch <name>]
 * Output (stdout): path to the created plan file.
 * NOTE: Timestamps are always JS-generated. No --date flag is accepted.
 */

const fs = require("node:fs");
const path = require("node:path");
const shared = require("./shared");

function main() {
  const args = shared.parseArgs(process.argv.slice(2), {
    "--epic": "epic", "-e": "epic",
    "--branch": "branch",
  });

  shared.log("x-implement", "parsing arguments");

  if (!args.epic) {
    process.stderr.write("Usage: node save-plan.js --epic <slug> [--branch <name>]\n");
    process.exit(1);
  }

  const slug = shared.sanitizeSlug(args.epic);
  const branch = args.branch || shared.getBranch();
  const date = shared.formatStamp();

  const runDir = shared.resolveRunDir(slug);
  const epicFullPath = shared.resolveArtifact(runDir, "epic", "md");
  const epicPath = fs.existsSync(epicFullPath) ? path.relative(process.cwd(), epicFullPath) : null;

  const fullPath = shared.resolveArtifact(runDir, "implement", "md");

  try {
    shared.ensureDir(runDir);

    let header = `# Tasks — ${args.epic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`;

    if (epicPath) {
      header += `epic:         ${epicPath}\n\n`;
      shared.log("x-implement", `resolved epic path: ${epicPath}`);
    } else {
      header += `epic:         <run folder>/E01-epic.md\n\n`;
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
