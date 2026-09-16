#!/usr/bin/env node

/**
 * Shared helpers for x-plan / x-epic / x-decompose / x-implement save scripts.
 * Each skill ships its own copy so the skills remain independent install units.
 */

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

// ── Logging ───────────────────────────────────────────────────────────

function log(skill, stage) {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [${skill}] ${stage}\n`);
}

// ── Argument parsing ────────────────────────────────────────────────
// flagMap: { "--topic": "topic", "-t": "topic", "--epic": "epic", ... }
function parseArgs(argv, flagMap) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!(flag in flagMap)) continue;
    const key = flagMap[flag];
    if (i + 1 >= argv.length) {
      process.stderr.write(`Error: ${flag} requires a value\n`);
      process.exit(1);
    }
    args[key] = argv[++i];
  }
  return args;
}

// ── Git branch detection ────────────────────────────────────────────

function getBranch() {
  try {
    const result = cp.execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.toString().trim();
  } catch {
    return process.env.GIT_BRANCH || "unknown";
  }
}

// ── Timestamp (JS-generated only - never LLM-determined) ─────────────

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

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

function highestRun(rootAbs) {
  if (!fs.existsSync(rootAbs)) return 0;
  return fs.readdirSync(rootAbs).reduce((max, name) => {
    const match = name.match(/-R(\d+)-/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function mintRunDir(rootAbs, slug, now) {
  const run = highestRun(rootAbs) + 1;
  if (run > MAX_COUNTER) throw new Error(`run counter would exceed R${MAX_COUNTER}`);
  const stamp = `${now.getFullYear()}-${padRunCounter(now.getMonth() + 1)}-${padRunCounter(now.getDate())}-${padRunCounter(now.getHours())}${padRunCounter(now.getMinutes())}`;
  const dir = path.join(rootAbs, `${stamp}-R${padRunCounter(run)}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Return the run folder for a slug: the folder holding `marker` when given,
 * the sole match when only one exists, or a newly minted R<nn>.
 */
function resolveRunDir(slug, { root = RUNS_ROOT, now = new Date(), marker = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const rootAbs = path.resolve(root);
  fs.mkdirSync(rootAbs, { recursive: true });

  const folders = runFolders(rootAbs, slug);
  if (marker) {
    const holding = folders.filter((name) => fs.existsSync(path.join(rootAbs, name, marker)));
    if (holding.length) return path.join(rootAbs, holding[holding.length - 1]);
  }
  if (folders.length > 1) {
    throw new Error(`${folders.length} runs match "${slug}"; resolve the run explicitly`);
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

/**
 * Path for a single-instance artifact: the lowest existing match, else the
 * next free number. Repeatable kinds call `nextE` directly instead.
 */
function resolveArtifact(runDir, kind, ext = "md") {
  const suffix = ext ? `${kind}.${ext}` : kind;
  if (fs.existsSync(runDir)) {
    const matches = fs
      .readdirSync(runDir)
      .filter((name) => /^E\d{2}-/.test(name) && name.endsWith(`-${suffix}`))
      .sort();
    if (matches.length) return path.join(runDir, matches[0]);
  }
  return path.join(runDir, `${nextE(runDir)}-${suffix}`);
}

// ── Slug sanitization ────────────────────────────────────────────────
// Replaces non-alphanumeric chars (except -, _) with hyphens, collapses
// consecutive separators, trims leading/trailing dashes.

function sanitizeSlug(slug) {
  return slug.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

// ── Directory creation ───────────────────────────────────────────────

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// ── File write with idempotency guard ─────────────────────────────────

function writeFile(filePath, content) {
  if (fs.existsSync(filePath)) {
    process.stderr.write(`Warning: ${filePath} already exists - overwriting\n`);
  }
  fs.writeFileSync(filePath, content, "utf8");
}

module.exports = {
  log,
  parseArgs,
  getBranch,
  formatStamp,
  resolveRunDir,
  nextE,
  resolveArtifact,
  sanitizeSlug,
  ensureDir,
  writeFile,
};
