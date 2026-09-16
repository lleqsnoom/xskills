#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Decide whether a finished run can be posted to GitHub, without calling GitHub.
 * Prints { action: "comment" | "skip", ... } on stdout and exits 0 either way.
 *
 * Usage: node notify-github.mjs --run <runDir>
 */

export function newestSummary(runDir) {
  if (!fs.existsSync(runDir)) return null;
  const matches = fs
    .readdirSync(runDir)
    .filter((name) => /^E\d{2}-summary\.md$/.test(name))
    .sort();
  return matches.length ? path.join(runDir, matches[matches.length - 1]) : null;
}

export function readIssue(runDir) {
  if (!fs.existsSync(runDir)) return "";
  const epic = fs
    .readdirSync(runDir)
    .filter((name) => /^E\d{2}-epic\.md$/.test(name))
    .sort()
    .pop();
  if (!epic) return "";
  const match = fs.readFileSync(path.join(runDir, epic), "utf8").match(/^issue:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function commandExists(command, args) {
  try {
    execFileSync(command, args, { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

export function planNotification({ runDir }) {
  const summary = newestSummary(runDir);
  if (!summary) return { action: "skip", reason: `no summary artifact in ${runDir}` };

  const issue = readIssue(runDir);
  if (!issue) return { action: "skip", reason: "the epic carries no issue number" };

  if (!commandExists("git", ["remote", "get-url", "origin"])) {
    return { action: "skip", reason: "no origin remote" };
  }
  if (!commandExists("gh", ["--version"])) {
    return { action: "skip", reason: "gh is not installed" };
  }
  return { action: "comment", issue, file: summary };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run" && i + 1 < argv.length) out.run = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.run) {
    process.stderr.write(`${JSON.stringify({ error: "--run <runDir> is required" })}\n`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(planNotification({ runDir: args.run }), null, 2)}\n`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
