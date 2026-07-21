#!/usr/bin/env node

/**
 * Shared helpers for x-plan / x-epic / x-decompose save scripts.
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

// ── Timestamp (JS-generated only — never LLM-determined) ─────────────

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}-${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// ── Slug sanitization ────────────────────────────────────────────────
// Replaces non-alphanumeric chars (except -, _) with hyphens, collapses
// consecutive separators, trims leading/trailing dashes.

function sanitizeSlug(slug) {
  return slug.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

// ── File discovery by topic slug ──────────────────────────────────────

/**
 * Find the most recently modified .md file in a directory whose name
 * contains the given topic slug. Returns null if no match found or dir missing.
 */
function findFileByTopic(dirPath, slug) {
  const absDir = path.isAbsolute(dirPath) ? dirPath : path.resolve(dirPath);
  try {
    if (!fs.existsSync(absDir)) return null;
    const files = fs.readdirSync(absDir).filter((f) => f.endsWith(".md") && f.includes(slug));
    if (files.length === 0) return null;
    files.sort(
      (a, b) =>
        fs.statSync(path.join(absDir, b)).mtimeMs - fs.statSync(path.join(absDir, a)).mtimeMs
    );
    return path.join(absDir, files[0]);
  } catch {
    return null;
  }
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

module.exports = { log, parseArgs, getBranch, getTimestamp, sanitizeSlug, ensureDir, writeFile, findFileByTopic };
