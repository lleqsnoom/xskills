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
    const header = `# Plan — ${args.topic}

**Date:** ${date}
**Branch:** ${branch}

---

goal:         <outcome in one sentence>
constraint:   <non-functional requirements>

## Layers

### L0 — Skeleton / Prototype
**Goal:** Working end-to-end flow with mocks/stubs
**What works:** <concrete: which flow completes end-to-end>
**What's mocked:** <which parts use stubs and why>
**Definition of Done:**
- [ ] <automated check>: \`<command>\`
- [ ] System starts without errors

### L1 — Real Implementation
**Goal:** Replace mocks with actual logic
**What changes:** <mocks replaced, logic added>
**Prerequisite:** Layer 0 complete and passing
**Definition of Done:**
- [ ] All L0 tests still pass (regression)
- [ ] <new testable behavior>

## Working notes
<scratch space for hypotheses and edge cases>
`;

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
