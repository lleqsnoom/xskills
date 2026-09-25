#!/usr/bin/env node
// x-unbloat verdicts — the record that proves the ladder was walked.
//   new   --slug <topic>   create <run folder>/E<nn>-unbloat.md from the template
//   check --file <path>    exit 0 when every unit has a verdict and a reason, every cut shows in the diff,
//                          and the measure is in; 1 otherwise
// Exit 2 = usage error.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_OUTPUT = ".x-skills/runs/";
const VERDICTS = new Set(["keep", "cut"]);

export function slugify(name) {
  return (
    String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "unbloat"
  );
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

export function renderTemplate(slug, base) {
  return [
    `# Unbloat — ${slug}`,
    "",
    `**Base:** ${base}`,
    "",
    "## Verdicts",
    "",
    "| Unit | Verdict | Why | Call sites |",
    "|------|---------|-----|------------|",
    "",
    "## Measure",
    "",
    "<!-- filled by: measure.mjs --record <this file> -->",
    "",
    "## Left for the user",
    "",
    "<!-- public API, dropped capabilities, anything not yours to cut; or \"nothing\" -->",
    "",
  ].join("\n");
}

// The base is taken here, before the first cut, so no later step has to carry it in a shell variable.
const headCommit = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export function createVerdicts({ dir = DEFAULT_OUTPUT, slug, base = headCommit(), fresh = false, run = null, now = new Date() } = {}) {
  const runDir = dir === DEFAULT_OUTPUT ? resolveRunDir(slugify(slug), { now, fresh, run }) : dir;
  fs.mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, `${nextE(runDir)}-unbloat.md`);
  fs.writeFileSync(file, renderTemplate(slug, base));
  return { path: file, created: true, base };
}

const section = (text, heading) => text.split(/^## /m).find((part) => part.startsWith(heading)) ?? "";

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

const unfilled = (cell) => !cell || cell.startsWith("<!--");

export function parseVerdicts(text) {
  return section(text, "Verdicts").split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .slice(2)
    .map(cells)
    .map(([unit, verdict, why, callSites]) => ({ unit, verdict: (verdict ?? "").toLowerCase(), why, callSites }));
}

export const baseOf = (text) => text.match(/^\*\*Base:\*\* ([0-9a-f]{7,40})\s*$/m)?.[1] ?? null;

// Every line deleted since the base, file headers included, so a deleted file counts as removed.
export function removedSince(base, cwd = process.cwd()) {
  try {
    const diff = execFileSync("git", ["diff", "--no-color", "--no-renames", base, "--"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
    return diff.split("\n").filter((line) => line.startsWith("-")).join("\n");
  } catch {
    return null;
  }
}

// `getUser()` and `` `getUser` `` both name getUser.
const unitName = (unit) => unit.replace(/[`*]/g, "").replace(/\(.*\)\s*$/, "").trim();

// Whole identifiers only, so a cut `id` is not confirmed by a removed `width`.
const namedIn = (text, name) =>
  new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`).test(text);

// `removed` is the text of every line deleted since the base, or null when it could not be read.
export function checkVerdicts(text, removed = null) {
  const violations = [];
  const rows = parseVerdicts(text);
  if (!baseOf(text)) violations.push("Base is not a commit hash: create the file with verdicts.mjs new");
  if (!rows.length) violations.push("no verdict rows: walk the ladder over every unit in scope");
  for (const row of rows) {
    if (unfilled(row.unit)) violations.push("a verdict row names no unit");
    if (!VERDICTS.has(row.verdict)) violations.push(`${row.unit}: verdict must be keep or cut, got "${row.verdict}"`);
    if (unfilled(row.why)) violations.push(`${row.unit}: no reason (the rung, the table row, or the Never Cut rule)`);
    if (row.verdict === "cut" && unfilled(row.callSites)) violations.push(`${row.unit}: a cut must list its call sites, or "none"`);
  }

  const cuts = rows.filter((row) => row.verdict === "cut" && !unfilled(row.unit));
  if (cuts.length && removed === null) violations.push("cannot read the diff since the base: run check from the repository");
  for (const row of removed === null ? [] : cuts) {
    if (!namedIn(removed, unitName(row.unit))) violations.push(`${row.unit}: marked cut, but no line removed since the base names it`);
  }

  const json = section(text, "Measure").match(/```json\s*([\s\S]*?)```/);
  let measure = null;
  try { measure = json && JSON.parse(json[1]); } catch { /* reported below */ }
  if (typeof measure?.netLines !== "number") violations.push("Measure has no JSON from measure.mjs (netLines missing)");

  if (unfilled(section(text, "Left for the user").replace(/^Left for the user\s*/, "").trim())) {
    violations.push("Left for the user is empty: write what is left, or \"nothing\"");
  }

  return {
    units: rows.length,
    cut: rows.filter((row) => row.verdict === "cut").length,
    kept: rows.filter((row) => row.verdict === "keep").length,
    netLines: measure?.netLines ?? null,
    violations,
  };
}

function flag(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1] ?? "";
}

function fail(message, code) {
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exit(code);
}

function main(args) {
  const [command, ...rest] = args;
  if (command === "new") {
    const slug = flag(rest, "--slug");
    if (!slug) fail("usage: verdicts.mjs new --slug <topic> [--new-run] [--run <nn>]", 2);
    const run = flag(rest, "--run");
    try {
      console.log(JSON.stringify(createVerdicts({ slug, fresh: rest.includes("--new-run"), run: run ? Number(run) : null }), null, 2));
    } catch (error) {
      fail(error.stderr?.toString().trim() || error.message, 2);
    }
    return;
  }
  if (command === "check") {
    const file = flag(rest, "--file");
    if (!file) fail("usage: verdicts.mjs check --file <E<nn>-unbloat.md>", 2);
    if (!fs.existsSync(file)) fail(`no such file: ${file}`, 2);
    const text = fs.readFileSync(file, "utf8");
    const base = baseOf(text);
    const result = { file, ...checkVerdicts(text, base && removedSince(base)) };
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.violations.length ? 1 : 0);
  }
  fail("usage: verdicts.mjs new --slug <topic> | check --file <path>", 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2));
}
