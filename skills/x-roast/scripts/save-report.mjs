#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_OUTPUT = ".x-skills/critique/";

export function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "artifact";
}

export function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${day}-${month}-${year}-${hours}:${minutes}`;
}

export function reportPath(dir, slug, date = new Date()) {
  return path.join(dir, `${timestamp(date)}-${slugify(slug)}.md`);
}

export function renderHeader({ slug, type = "generic", date = new Date() }) {
  return [
    `# Roast — ${slug}`,
    "",
    `**Date:** ${timestamp(date)}`,
    `**Artifact type:** ${type}`,
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
  fs.mkdirSync(dir, { recursive: true });
  const file = reportPath(dir, slug, date);
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
    "  --output <dir>    Output directory (default: .x-skills/critique/)",
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
