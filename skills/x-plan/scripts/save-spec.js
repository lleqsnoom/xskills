#!/usr/bin/env node

/**
 * Create .x-skills/runs/<stamp>-R<nn>-<topic>/E00-plan.md with a header skeleton.
 * Usage: node save-spec.js --topic <slug> [--branch <name>] 
 * Output (stdout): path to the created spec file.
 */

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

  const date = shared.formatStamp();
  shared.log("x-plan", `using date stamp: ${date}`);

  const runDir = shared.resolveRunDir(slug);
  const fullPath = shared.resolveArtifact(runDir, "plan", "md");
  shared.log("x-plan", `resolved run folder: ${runDir}`);

  try {
    const header = `# Plan — ${args.topic}

**Date:** ${date}
**Branch:** ${branch}

---

goal:         <outcome in one sentence>
contract:     <interface or API shape>
invariant:    <what must always hold>
test:         <acceptance criterion with given/when/then>
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

    shared.log("x-plan", `creating directory: ${runDir}`);
    shared.ensureDir(runDir);

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
