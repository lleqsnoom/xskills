#!/usr/bin/env node
// x-humanize save-report — create a numbered humanize report in the run folder.
// Mirrors the x-roast report helper.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_OUTPUT = ".x-skills/runs/";

export function slugify(name) {
  return (
    String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document"
  );
}

export function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
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

export function reportPath(runDir, ext = "md") {
  return path.join(runDir, `${nextE(runDir)}-humanize.${ext}`);
}

export function renderHeader({ slug, level = "B2", date = new Date() }) {
  return [
    `# Humanize — ${slug}`,
    "",
    `**Date:** ${timestamp(date)}`,
    `**Target level:** ${level}`,
    "",
    "## Before / After",
    "",
    "<!-- paste the JSON from scripts/verify.mjs: before, after, deltas -->",
    "",
    "## Verification",
    "",
    "<!-- pass/fail per check: target-met, no-noise-added, urls/code/numbers preserved, meaning-retained -->",
    "",
    "## Rewrites",
    "",
    "<!-- the hard sentences, the reason, and the simplified version -->",
    "",
    "## Noise removed",
    "",
    "<!-- filler phrases deleted; confirm none were introduced -->",
    "",
  ].join("\n");
}

export function createReport({ dir = DEFAULT_OUTPUT, slug, level = "B2", date = new Date() } = {}) {
  const runDir = dir === DEFAULT_OUTPUT ? resolveRunDir(slugify(slug), { now: date }) : dir;
  fs.mkdirSync(runDir, { recursive: true });
  const file = reportPath(runDir, "md");
  if (fs.existsSync(file)) return { path: file, created: false };
  fs.writeFileSync(file, renderHeader({ slug, level, date }));
  return { path: file, created: true };
}

function usage() {
  return [
    "x-humanize save-report — create a timestamped humanize report file.",
    "",
    "Usage:",
    "  node save-report.mjs --slug my-article --level B2",
    "",
    "Flags:",
    "  --slug <name>    Document name (required)",
    "  --level <lvl>    Target reader level (default: B2)",
    "  --output <dir>   Output directory (default: the run folder under .x-skills/runs/)",
    "  --help           Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  let slug = null;
  let level = "B2";
  let output = DEFAULT_OUTPUT;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(usage());
      return;
    } else if (a === "--slug" && i + 1 < args.length) slug = args[++i];
    else if (a === "--level" && i + 1 < args.length) level = args[++i];
    else if (a === "--output" && i + 1 < args.length) output = args[++i];
    else {
      process.stderr.write(`${JSON.stringify({ error: `Unknown argument "${a}"` })}\n`);
      process.exit(1);
    }
  }
  if (!slug) {
    process.stderr.write(`${JSON.stringify({ error: "--slug is required" })}\n`);
    process.exit(1);
  }
  try {
    process.stdout.write(`${JSON.stringify(createReport({ dir: output, slug, level }), null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
