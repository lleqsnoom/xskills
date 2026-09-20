#!/usr/bin/env node
"use strict";

/**
 * Keep the run-folder helpers identical in every skill that carries them.
 *
 * The repo forbids cross-skill imports (each skill installs standalone), so the
 * helpers are duplicated on purpose. This script makes the duplication
 * mechanical: one canonical block, pasted between `// #region run-folder`
 * markers in every target file.
 *
 *   node scripts/sync-run-folders.mjs           # rewrite every target
 *   node scripts/sync-run-folders.mjs --check    # exit 1 when any copy drifted
 */

const fs = require("node:fs");
const path = require("node:path");

const TARGETS = [
  "skills/x-plan/scripts/shared.js",
  "skills/x-epic/scripts/shared.js",
  "skills/x-decompose/scripts/shared.js",
  "skills/x-implement/scripts/shared.js",
  "skills/x-analyze/scripts/scenario.mjs",
  "skills/x-research/scripts/state.mjs",
  "skills/x-roast/scripts/save-report.mjs",
  "skills/x-humanize/scripts/save-report.mjs",
  "skills/x-essay/scripts/state.mjs",
  "skills/x-api-draft/scripts/save-design.js",
  "skills/x-api-swagger/scripts/save-spec.js",
  "skills/x-debug/scripts/analyze.js",
  "skills/x-review/scripts/save-plan.js",
  "skills/x-autoreflection/scripts/save-reflection.mjs",
  "skills/x-autoreflection-analysis/scripts/analyze.mjs",
  "skills/x-autoreflection-heal/scripts/heal.mjs",
];

const START = "// #region run-folder";
const END = "// #endregion run-folder";

// CJS/ESM safe: uses only fs, path, Date, String, so the same text pastes into
// a .js and a .mjs file.
const CANONICAL = `// #region run-folder
// Two digits, not more: a wider counter would sort E100 before E99.
const RUNS_ROOT = ".x-skills/runs";
const MAX_COUNTER = 99;

function padRunCounter(value) {
  return String(value).padStart(2, "0");
}

function runFolders(rootAbs, slug) {
  if (!fs.existsSync(rootAbs)) return [];
  return fs
    .readdirSync(rootAbs)
    .filter((name) => name.endsWith(\`-\${slug}\`))
    .sort();
}

// Counts runs of this slug only, so R<nn> reads as "the nth run of this topic".
// Works together with \`fresh\`: a global counter would make the number depend on
// unrelated topics, and per-slug numbering alone could never reach 02 because
// resolveRunDir joins an existing run for the slug.
function highestRun(rootAbs, slug) {
  return runFolders(rootAbs, slug).reduce((max, name) => {
    const match = name.match(/-R(\\d+)-/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function mintRunDir(rootAbs, slug, now) {
  const run = highestRun(rootAbs, slug) + 1;
  if (run > MAX_COUNTER) throw new Error(\`run counter would exceed R\${MAX_COUNTER}\`);
  const stamp = \`\${now.getFullYear()}-\${padRunCounter(now.getMonth() + 1)}-\${padRunCounter(now.getDate())}-\${padRunCounter(now.getHours())}\${padRunCounter(now.getMinutes())}\`;
  const dir = path.join(rootAbs, \`\${stamp}-R\${padRunCounter(run)}-\${slug}\`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Return the run folder for a slug, choosing in this order:
 * \`fresh\` mints a new R<nn>, \`run\` selects that R number, \`marker\` selects the
 * folder holding that artifact, one match is returned, none mints, and more
 * than one without a selector throws rather than guessing.
 */
function resolveRunDir(slug, { root = RUNS_ROOT, now = new Date(), marker = null, fresh = false, run = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const rootAbs = path.resolve(root);
  fs.mkdirSync(rootAbs, { recursive: true });

  if (fresh) return mintRunDir(rootAbs, slug, now);

  const folders = runFolders(rootAbs, slug);
  if (run !== null) {
    const wanted = \`-R\${padRunCounter(run)}-\`;
    const picked = folders.find((name) => name.includes(wanted));
    if (!picked) throw new Error(\`no run R\${padRunCounter(run)} for "\${slug}"\`);
    return path.join(rootAbs, picked);
  }
  if (marker) {
    const holding = folders.filter((name) => fs.existsSync(path.join(rootAbs, name, marker)));
    if (holding.length) return path.join(rootAbs, holding[holding.length - 1]);
  }
  if (folders.length > 1) {
    throw new Error(\`\${folders.length} runs match "\${slug}"; pass --run <nn> to pick one, or --new-run to start another\`);
  }
  if (folders.length) return path.join(rootAbs, folders[0]);
  return mintRunDir(rootAbs, slug, now);
}

function nextE(runDir) {
  const used = fs.existsSync(runDir)
    ? fs
        .readdirSync(runDir)
        .map((name) => {
          const match = name.match(/^E(\\d{2})-/);
          return match ? Number(match[1]) : null;
        })
        .filter((value) => value !== null)
    : [];
  const next = used.length ? Math.max(...used) + 1 : 0;
  if (next > MAX_COUNTER) throw new Error(\`artifact counter would exceed E\${MAX_COUNTER}\`);
  return \`E\${String(next).padStart(2, "0")}\`;
}
${END}`;

/** Index of the line that starts the region in a file that has no markers yet. */
function findRegionStart(lines) {
  const isStart = (line) =>
    line.startsWith("// ── Run folders") ||
    line.startsWith("// Two digits") ||
    line.startsWith("// Run folders:") ||
    line.startsWith("// Every artifact of one run") ||
    line.startsWith("// .x-skills/runs/") ||
    line.startsWith("const RUNS_ROOT");

  const nextAt = lines.findIndex((line) => line.startsWith("function nextE("));
  if (nextAt < 0) return -1;
  for (let i = nextAt; i >= 0; i--) {
    if (isStart(lines[i])) return i;
  }
  return -1;
}

/** Line index just past the closing brace of the `nextE` function. */
function findRegionEnd(lines, from) {
  const start = lines.findIndex((line, i) => i >= from && line.startsWith("function nextE("));
  if (start < 0) return -1;
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
  }
  return -1;
}

function withRegion(source) {
  const lines = source.split("\n");
  const start = lines.indexOf(START);
  if (start >= 0) {
    const end = lines.indexOf(END, start);
    if (end < 0) throw new Error(`region opened but never closed`);
    return [...lines.slice(0, start), CANONICAL, ...lines.slice(end + 1)].join("\n");
  }

  const from = findRegionStart(lines);
  const to = findRegionEnd(lines, from);
  if (from < 0 || to < 0) throw new Error("could not locate the run-folder block");
  return [...lines.slice(0, from), CANONICAL, ...lines.slice(to)].join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const drift = [];

  for (const target of TARGETS) {
    const file = path.join(__dirname, "..", target);
    if (!fs.existsSync(file)) {
      drift.push(`${target}: missing`);
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    if (check) {
      const expected = withRegion(source);
      if (expected !== source) drift.push(target);
      continue;
    }
    fs.writeFileSync(file, withRegion(source));
  }

  if (check) {
    if (drift.length) {
      process.stderr.write(`run-folder helpers have drifted:\n${drift.map((d) => `  ${d}`).join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write(`run-folder helpers match in ${TARGETS.length} files\n`);
    return;
  }
  process.stdout.write(`synced run-folder helpers into ${TARGETS.length} files\n`);
}

if (require.main === module) main();

module.exports = { CANONICAL, TARGETS, withRegion, START, END };
