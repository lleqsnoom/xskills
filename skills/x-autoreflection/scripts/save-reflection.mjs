#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./read-session.mjs";

export const DEFAULT_OUTPUT = ".x-skills/runs/";

export function slugify(name) {
  return (
    String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "session-reflection"
  );
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function timestamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
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

export function reflectionPath(runDir) {
  return path.join(runDir, `${nextE(runDir)}-reflection.md`);
}

export function renderHeader({ session = "unknown session", date = new Date() }) {
  return [
    `# Reflection — ${session}`,
    "",
    `**Session:** <id> · <created> → <modified>`,
    `**Written:** ${timestamp(date)}`,
    "**Messages:** <!-- n --> · **Tool calls:** <!-- n --> · **Tool failures:** <!-- n --> · **Panels asked:** <!-- n -->",
    "**Skills loaded:** <!-- a, b --> · **Skills never used:** <!-- c -->",
    "",
    "## Signals",
    "",
    "```json",
    "<!-- paste the JSON from scan-session.mjs, signals and stats only -->",
    "```",
    "",
    "## Gaps",
    "",
    "<!-- one bullet per signal you checked: - **S1 (high, kept)** — why, with file:line -->",
    "",
    "## Quality",
    "",
    "<!-- one line per kept quality anchor: - **S5** — user: \"<their words>\" — skill: `skills/<x>/SKILL.md:<line>` \"<that line>\" -->",
    "",
    "## Proposals",
    "",
    "<!-- ### P1 — <kind>: <change>, with Signal, Target, Change and Check lines, and Watch for a quality gap -->",
    "",
    "## Routes",
    "",
    "<!-- - P1 → direct edit / x-fix / x-plan -->",
    "",
  ].join("\n");
}

export function createReflection({ dir = DEFAULT_OUTPUT, slug, session = "unknown session", date = new Date(), fresh = false, run = null } = {}) {
  const runDir = dir === DEFAULT_OUTPUT ? resolveRunDir(slugify(slug), { now: date, fresh, run }) : dir;
  fs.mkdirSync(runDir, { recursive: true });
  const file = reflectionPath(runDir);
  if (fs.existsSync(file)) return { path: file, created: false };
  fs.writeFileSync(file, renderHeader({ session, date }));
  return { path: file, created: true };
}

function usage() {
  return [
    "x-autoreflection save-reflection — create the reflection artifact in the run folder.",
    "",
    "Usage:",
    "  node save-reflection.mjs --slug my-topic --session \"Session title\"",
    "",
    "Flags:",
    "  --slug <name>     Slug of the run being reflected on (default: derived from --session)",
    "  --session <t>     Session title, for the header (required)",
    "  --output <dir>    Output directory (default: the run folder under .x-skills/runs/)",
    "  --new-run         Start a second run instead of joining an existing one",
    "  --run <nn>        Join run R<nn> when the slug has more than one",
    "  --help            Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ["new-run", "help"],
    known: ["slug", "session", "output", "new-run", "run", "help"],
  });
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    if (!args.session) throw new Error("--session <title> is required");
    const result = createReflection({
      dir: args.output || DEFAULT_OUTPUT,
      slug: args.slug || args.session,
      session: args.session,
      fresh: args["new-run"] === true,
      run: args.run === undefined ? null : Number(args.run),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
