#!/usr/bin/env node
/**
 * Helpers every host adapter shares. They live apart from `index.mjs` on purpose: the registry
 * imports the adapters, so an adapter importing the registry back would be a cycle.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const HOUR_MS = 3600_000;

export function homeDir(env = process.env) {
  return env.HOME || os.homedir();
}

/** A CLI's error text arrives wrapped in its stack; the first line is the part worth reporting. */
export function firstLine(value, limit = 200) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, limit) ?? "unknown error";
}

/** The default command runner: stdout as text, and a non-zero exit throws. */
export function defaultRun(env = process.env) {
  return (command, args = [], { cwd = null } = {}) =>
    execFileSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}

/**
 * The window rule, applied once for every host: a session with an unreadable timestamp is dropped
 * rather than counted, because guessing "recent" would scan last month's work every day.
 */
export function withinWindow(sessions, { hours, now }) {
  const cutoff = now.getTime() - hours * HOUR_MS;
  const out = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const ms = Date.parse(session?.modified ?? "");
    if (Number.isFinite(ms) && ms >= cutoff) out.push({ ...session, modifiedMs: ms });
  }
  return out;
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function matchesSuffix(name, suffixes) {
  return suffixes.some((suffix) => name.endsWith(suffix));
}

function walkFiles(dir, level, { suffixes, depth }, found) {
  for (const entry of readDir(dir)) {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) {
      if (matchesSuffix(entry.name, suffixes)) found.push(full);
    } else if (level < depth) {
      walkFiles(full, level + 1, { suffixes, depth }, found);
    }
  }
}

/** Files under `root` whose name ends with one of `suffixes`, walking at most `depth` levels down. */
export function findFiles(root, { suffixes = [".jsonl"], depth = 4 } = {}) {
  const found = [];
  walkFiles(root, 0, { suffixes, depth }, found);
  return found;
}
