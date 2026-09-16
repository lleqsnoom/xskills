#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_OUTPUT = ".x-skills/runs/";

export function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "artifact";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function timestamp(date = new Date()) {
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

export function reportPath(runDir, ext = "md") {
  return path.join(runDir, `${nextE(runDir)}-critique.${ext}`);
}

export function renderHeader({ slug, type = "generic", date = new Date() }) {
  return [
    `# Roast — ${slug}`,
    "",
    `**Date:** ${timestamp(date)}`,
    `**Profile:** ${type}`,
    "",
    "## Central claim",
    "",
    "<!-- one sentence: what the artifact asserts -->",
    "",
    "## Score",
    "",
    "<!-- paste the JSON from scripts/score.mjs -->",
    "",
    "## Findings",
    "",
    "<!-- one bullet per dimension: score, anchor, evidence (file:line or source URL) -->",
    "",
    "## Creative alternatives",
    "",
    "<!-- reframings, missing perspectives, stronger structures -->",
    "",
    "## Improvement proposals",
    "",
    "<!-- ordered; each with expected score delta -->",
    "",
    "## Sources consulted",
    "",
    "<!-- every URL actually fetched, with what it confirmed/contradicted -->",
    "",
  ].join("\n");
}

export function createReport({ dir = DEFAULT_OUTPUT, slug, type = "generic", date = new Date() } = {}) {
  const runDir = dir === DEFAULT_OUTPUT ? resolveRunDir(slugify(slug), { now: date }) : dir;
  fs.mkdirSync(runDir, { recursive: true });
  const file = reportPath(runDir, "md");
  const header = renderHeader({ slug, type, date });
  if (fs.existsSync(file)) {
    return { path: file, created: false };
  }
  fs.writeFileSync(file, header);
  return { path: file, created: true };
}

function usage() {
  return [
    "x-roast save-report — create a timestamped critique report file.",
    "",
    "Usage:",
    "  node save-report.mjs --slug my-article --type article",
    "",
    "Flags:",
    "  --slug <name>     Artifact name (required)",
    "  --type <type>     Rubric profile (default: generic)",
    "  --output <dir>    Output directory (default: the run folder under .x-skills/runs/)",
    "  --help            Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  let slug = null;
  let type = "generic";
  let output = DEFAULT_OUTPUT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write(usage());
      return;
    } else if (args[i] === "--slug" && i + 1 < args.length) {
      slug = args[++i];
    } else if (args[i] === "--type" && i + 1 < args.length) {
      type = args[++i];
    } else if (args[i] === "--output" && i + 1 < args.length) {
      output = args[++i];
    } else {
      process.stderr.write(`${JSON.stringify({ error: `Unknown argument "${args[i]}"` })}\n`);
      process.exit(1);
    }
  }

  if (!slug) {
    process.stderr.write(`${JSON.stringify({ error: "--slug is required" })}\n`);
    process.exit(1);
  }

  try {
    const result = createReport({ dir: output, slug, type });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
