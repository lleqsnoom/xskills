#!/usr/bin/env node

/**
 * Create <run folder>/E<nn>-api-spec.yaml and return its full path.
 * Auto-detects branch name from git if not provided. Generates timestamp.
 * Logs each step to stderr for verification.
 *
 * Usage:
 *   node save-spec.js --topic <slug> [--branch <name>]
 *
 * Output (stdout): absolute path to the YAML spec file, ready to write into with `write`.
 * NOTE: Timestamps are always JS-generated. No --date flag is accepted.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Logging ───────────────────────────────────────────────────────────

function log(stage) {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [x-api-swagger] ${stage}\n`);
}

// ── Argument parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--topic" || argv[i] === "-t") && i + 1 < argv.length) args.topic = argv[++i];
    else if (argv[i] === "--branch" && i + 1 < argv.length) args.branch = argv[++i];
    else if (argv[i] === "--new-run") args.newRun = true;
    else if (argv[i] === "--run" && i + 1 < argv.length) args.run = argv[++i];
  }
  return args;
}

// ── Helpers ───────────────────────────────────────────────────────────

function getBranch() {
  try {
    const cp = require("node:child_process");
    const result = cp.execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] });
    return result.toString().trim();
  } catch {
    return process.env.GIT_BRANCH || "unknown";
  }
}

// ── Timestamp (JS-generated only — never LLM-determined) ─────────────

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// ── Run folders ──────────────────────────────────────────────────────

// #region run-folder
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
    .filter((name) => name.endsWith(`-${slug}`))
    .sort();
}

// Counts runs of this slug only, so R<nn> reads as "the nth run of this topic".
// Works together with `fresh`: a global counter would make the number depend on
// unrelated topics, and per-slug numbering alone could never reach 02 because
// resolveRunDir joins an existing run for the slug.
function highestRun(rootAbs, slug) {
  return runFolders(rootAbs, slug).reduce((max, name) => {
    const match = name.match(/-R(\d+)-/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function mintRunDir(rootAbs, slug, now) {
  const run = highestRun(rootAbs, slug) + 1;
  if (run > MAX_COUNTER) throw new Error(`run counter would exceed R${MAX_COUNTER}`);
  const stamp = `${now.getFullYear()}-${padRunCounter(now.getMonth() + 1)}-${padRunCounter(now.getDate())}-${padRunCounter(now.getHours())}${padRunCounter(now.getMinutes())}`;
  const dir = path.join(rootAbs, `${stamp}-R${padRunCounter(run)}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Return the run folder for a slug, choosing in this order:
 * `fresh` mints a new R<nn>, `run` selects that R number, `marker` selects the
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
    const wanted = `-R${padRunCounter(run)}-`;
    const picked = folders.find((name) => name.includes(wanted));
    if (!picked) throw new Error(`no run R${padRunCounter(run)} for "${slug}"`);
    return path.join(rootAbs, picked);
  }
  if (marker) {
    const holding = folders.filter((name) => fs.existsSync(path.join(rootAbs, name, marker)));
    if (holding.length) return path.join(rootAbs, holding[holding.length - 1]);
  }
  if (folders.length > 1) {
    throw new Error(`${folders.length} runs match "${slug}"; pass --run <nn> to pick one, or --new-run to start another`);
  }
  if (folders.length) return path.join(rootAbs, folders[0]);
  return mintRunDir(rootAbs, slug, now);
}

function nextE(runDir) {
  const used = fs.existsSync(runDir)
    ? fs
        .readdirSync(runDir)
        .map((name) => {
          const match = name.match(/^E(\d{2})-/);
          return match ? Number(match[1]) : null;
        })
        .filter((value) => value !== null)
    : [];
  const next = used.length ? Math.max(...used) + 1 : 0;
  if (next > MAX_COUNTER) throw new Error(`artifact counter would exceed E${MAX_COUNTER}`);
  return `E${String(next).padStart(2, "0")}`;
}
// #endregion run-folder

// ── Self-discovery ────────────────────────────────────────────────────
// __dirname resolves to wherever the script actually lives, whether invoked
// from a global install ( ~/.agents/skills/x-api-swagger/scripts/ ) or a local one
// (.agents/skills/<project>/x-api-swagger/scripts/). This lets us find sibling
// scripts and resources without the agent needing to know <skill-install-dir>.

const SKILL_DIR = path.resolve(__dirname, ".."); // parent of scripts/

function skillScript(relPath) {
  return path.join(SKILL_DIR, "scripts", relPath);
}

function skillResource(relPath) {
  return path.join(SKILL_DIR, relPath);
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  log("parsing arguments");

  if (!args.topic) {
    console.error("Usage: node save-spec.js --topic <slug> [--branch <name>]\n");
    process.exit(1);
  }

  const branch = args.branch || getBranch();
  log(`resolved branch: ${branch}`);

  const date = getTimestamp();
  log(`using date stamp: ${date}`);

  const runDir = resolveRunDir(args.topic, {
    fresh: args.newRun === true,
    run: args.run === undefined ? null : Number(args.run),
  });
  const fullPath = path.join(runDir, `${nextE(runDir)}-api-spec.yaml`);

  log(`creating directory: ${runDir}`);
  fs.mkdirSync(runDir, { recursive: true });

  const header = `# OpenAPI — ${args.topic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n**Scope:** \n**Status:** Draft — awaiting user approval\n\n---\n\n`;
  log(`writing YAML spec file: ${fullPath} (${header.length} bytes)`);
  fs.writeFileSync(fullPath, header);

  // Verify the write succeeded
  const stats = fs.statSync(fullPath);
  if (stats.size === 0) {
    console.error("ERROR: YAML spec file was written but is empty.");
    process.exit(1);
  }

  log(`YAML spec ready: ${fullPath}`);
  console.log(fullPath);
}

main();
