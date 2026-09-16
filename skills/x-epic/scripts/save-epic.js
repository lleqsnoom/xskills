#!/usr/bin/env node

/**
 * Create .x-skills/runs/<stamp>-R<nn>-<topic>/E01-epic.md with a resolved header skeleton.
 * Auto-finds the matching design spec by topic slug and fills in the path.
 * Usage: node save-epic.js --topic <slug> [--branch <name>] 
 * Output (stdout): path to the created epic file.
 */

const fs = require("node:fs");
const path = require("node:path");
const shared = require("./shared");

function main() {
  const args = shared.parseArgs(process.argv.slice(2), {
    "--topic": "topic", "-t": "topic",
    "--branch": "branch",
    "--run": "run",
    "--issue": "issue",
  });

  shared.log("x-epic", "parsing arguments");

  if (!args.topic) {
    process.stderr.write("Usage: node save-epic.js --topic <slug> [--branch <name>] [--issue <n>]\n");
    process.exit(1);
  }

  const slug = shared.sanitizeSlug(args.topic);
  const branch = args.branch || shared.getBranch();
  const date = shared.formatStamp();
  const issue = args.issue === undefined ? "" : args.issue;

  const runDir = shared.resolveRunDir(slug, { run: args.run === undefined ? null : Number(args.run) });
  const planFullPath = shared.resolveArtifact(runDir, "plan", "md");
  const specPath = fs.existsSync(planFullPath) ? path.relative(process.cwd(), planFullPath) : null;

  const fullPath = shared.resolveArtifact(runDir, "epic", "md");

  try {
    shared.ensureDir(runDir);

    let header = `# Epic — ${args.topic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`;

    if (specPath) {
      header += `goal:         <outcome in one sentence>\nspec:         ${specPath}\nissue:        ${issue}\n\n`;
      shared.log("x-epic", `resolved spec path: ${specPath}`);
    } else {
      header += `goal:         <outcome in one sentence>\nspec:         <run folder>/E00-plan.md\nissue:        ${issue}\n\n`;
      shared.log("x-epic", "no plan spec found for topic — placeholder left");
    }

    header += `## Layer 0 — Skeleton / Prototype\n\n**Objective:** Working end-to-end flow with mocks/stubs\n\n**Scope in:**\n- <basic structure that runs>\n- <minimal flow: input → processing → output (even if mocked)>\n\n**Scope out:**\n- <real business logic>\n- <error handling, validation>\n\n**Prerequisite:** Clean project state (Node available, dependencies installed)\n\n**Definition of Done:**\n- [ ] <automated check>: \`<command>\`\n- [ ] System starts without errors\n\n## Layer 1 — Real Implementation\n\n**Objective:** Replace mocks with actual business logic\n**From spec:** L1 — <name from spec>\n\n**Scope in:**\n- <real algorithms, actual data processing>\n\n**Scope out:**\n- <error handling, monitoring>\n\n**Prerequisite:** Layer 0 complete and all tests passing\n\n**Definition of Done:**\n- [ ] All L0 tests still pass (regression)\n- [ ] <new testable behavior>\n\n## Definition of Done (Epic Level)\n\n- [ ] All layers delivered and acceptance criteria verified
- [ ] System works end-to-end with real logic (not mocks)
- [ ] No regressions across layers (L0 tests pass through L(N))
- [ ] Documentation updated where contracts changed
`;

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
