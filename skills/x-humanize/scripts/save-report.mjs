#!/usr/bin/env node
// x-humanize save-report — create a timestamped humanize report under
// .x-skills/humanize/. Mirrors the x-roast report helper.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_OUTPUT = ".x-skills/humanize/";

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
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}-${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function reportPath(dir, slug, date = new Date()) {
  return path.join(dir, `${timestamp(date)}-${slugify(slug)}.md`);
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
  fs.mkdirSync(dir, { recursive: true });
  const file = reportPath(dir, slug, date);
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
    "  --output <dir>   Output directory (default: .x-skills/humanize/)",
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
