#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { calibrationCases } from "./score.mjs";

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
  return path.join(runDir, `${nextE(runDir)}-critique.${ext}`);
}

// An artifact is named by its path from the working directory, so `./a/SKILL.md` and `a/SKILL.md` are one.
export function artifactKey(artifact) {
  const text = String(artifact ?? "").trim();
  if (!text || !fs.existsSync(text)) return text;
  return path.relative(process.cwd(), path.resolve(text)).split(path.sep).join("/") || ".";
}

// A roast of a skill's folder and a roast of its SKILL.md are roasts of the same artifact.
function sameArtifact(a, b) {
  return a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
}

// The newest finished critique of the same artifact, found by its **Artifact:** line in any run folder.
// Newest by its **Date:** line, then its run folder and E number, not by mtime: editing an old report
// must not make it the last roast. A report with no total is unfinished, perhaps another session's.
export function previousRoast(artifact, root = RUNS_ROOT) {
  root = path.resolve(root);
  const key = artifactKey(artifact);
  if (!key || !fs.existsSync(root)) return null;
  const found = fs.readdirSync(root)
    .flatMap((run) => {
      const dir = path.join(root, run);
      return fs.statSync(dir).isDirectory()
        ? fs.readdirSync(dir).filter((name) => name.endsWith("-critique.md")).map((name) => path.join(dir, name))
        : [];
    })
    .map((file) => {
      const text = fs.readFileSync(file, "utf8");
      const field = (name) => text.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+?)\\s*$`, "m"))?.[1];
      return { file, text, named: field("Artifact"), total: field("Total")?.match(/^[\d.]+/)?.[0] ?? null, order: `${field("Date") ?? ""} ${path.relative(root, file)}` };
    })
    .filter((entry) => entry.named !== undefined && entry.total !== null && sameArtifact(key, artifactKey(entry.named)))
    .sort((a, b) => a.order.localeCompare(b.order));
  if (!found.length) return null;
  const { file, text, total } = found[found.length - 1];
  const proposals = (text.split(/^## Improvement proposals\s*$/m)[1] ?? "").split(/^## /m)[0]
    .split(/\r?\n/).filter((row) => /^\d+\.\s/.test(row)).map((row) => row.replace(/^\d+\.\s+/, "").trim());
  return { file, total, proposals };
}

function renderSince(previous) {
  if (!previous) return [];
  return [
    "## Since last roast",
    "",
    `**Previous:** ${previous.file} — ${previous.total} / 100`,
    "",
    "<!-- replace each [ ] with closed, open or regressed, and say why in a few words; a dimension that rose by 2+ must be named on a closed line -->",
    ...previous.proposals.map((text) => `- [ ] ${text}`),
    "",
  ];
}

export function renderHeader({ slug, type = "generic", date = new Date(), artifact = slug, reviewer = null, reviewerModel = null, author = null, previous = null }) {
  return [
    `# Roast — ${slug}`,
    "",
    `**Date:** ${timestamp(date)}`,
    `**Artifact:** ${artifactKey(artifact)}`,
    `**Reviewer:** ${reviewer ?? "self | independent"} — ${reviewerModel ?? "<model id, or human>"}`,
    ...(author ? [`**Author:** ${author}`] : []),
    `**Profile:** ${type}`,
    "**Total:** ? / 100",
    "**Completeness:** ?",
    `**Calibration:** ? — score ${calibrationCases(type).map((entry) => entry.name).join(" or ")} blind, run score.mjs --calibrate, paste its line (or: skipped — <reason>)`,
    "",
    ...renderSince(previous),
    "## Central claim",
    "",
    "<!-- one sentence: what the artifact asserts -->",
    "",
    "## Claims",
    "",
    "<!-- 3-8 load-bearing claims, each quoted from the artifact; Backs names the scored dimensions it bears on; Source is a URL (external) or file:line / command (local); Result is confirmed, contradicted or unverified -->",
    "| # | Claim | Kind | Backs | Source | Result |",
    "|---|-------|------|-------|--------|--------|",
    "",
    "## Score",
    "",
    "<!-- paste the block printed by: score.mjs ... --report -->",
    "",
    "## Findings",
    "",
    "<!-- one bullet per scored dimension: - **name (n/5)**: evidence (a claim whose Backs names this dimension, a quote from the artifact, or a file:line) and why not higher -->",
    "",
    "## Creative alternatives",
    "",
    "<!-- three or more numbered items, each tagged `reframe`, `addition` or `restructure` -->",
    "",
    "## Improvement proposals",
    "",
    "<!-- numbered; each names where, and the delta: raises `logic` 3→4 -->",
    "",
  ].join("\n");
}

export function createReport({ dir = DEFAULT_OUTPUT, slug, type = "generic", date = new Date(), fresh = false, run = null, artifact = slug, reviewer = null, reviewerModel = null, author = null } = {}) {
  const previous = previousRoast(artifact);
  const runDir = dir === DEFAULT_OUTPUT ? resolveRunDir(slugify(slug), { now: date, fresh, run }) : dir;
  fs.mkdirSync(runDir, { recursive: true });
  const file = reportPath(runDir, "md");
  if (fs.existsSync(file)) {
    return { path: file, created: false };
  }
  fs.writeFileSync(file, renderHeader({ slug, type, date, artifact, reviewer, reviewerModel, author, previous }));
  return { path: file, created: true, previous: previous?.file ?? null };
}

function usage() {
  return [
    "x-roast save-report — create a timestamped critique report file.",
    "",
    "Usage:",
    "  node save-report.mjs --slug my-article --profile article",
    "",
    "Flags:",
    "  --slug <name>     Artifact name (required)",
    "  --profile <p>     Rubric profile (default: generic); --type is the same flag",
    "  --artifact <p>    What is roasted (a path); an earlier roast of it is carried into ## Since last roast",
    "  --reviewer <who>  self (a model of your family wrote, edited or is judging it, a fresh agent included) or independent (another model family, or a human)",
    "  --model <id>      The model that judges (your own id, or the independent one's; human for a person)",
    "  --author <id>     The model (or human) that wrote the artifact, when known; the gate refuses an independent reviewer of its family",
    "  --output <dir>    Output directory (default: the run folder under .x-skills/runs/)",
    "  --new-run         Start a second run for this artifact",
    "  --run <nn>        Join run R<nn> when the artifact has more than one",
    "  --help            Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  let slug = null;
  let type = "generic";
  let output = DEFAULT_OUTPUT;
  let newRun = false;
  let run = null;
  let artifact = null;
  let reviewer = null;
  let reviewerModel = null;
  let author = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write(usage());
      return;
    } else if (args[i] === "--slug" && i + 1 < args.length) {
      slug = args[++i];
    } else if ((args[i] === "--profile" || args[i] === "--type") && i + 1 < args.length) {
      type = args[++i];
    } else if (args[i] === "--output" && i + 1 < args.length) {
      output = args[++i];
    } else if (args[i] === "--artifact" && i + 1 < args.length) {
      artifact = args[++i];
    } else if (args[i] === "--reviewer" && i + 1 < args.length) {
      reviewer = args[++i];
    } else if (args[i] === "--model" && i + 1 < args.length) {
      reviewerModel = args[++i];
    } else if (args[i] === "--author" && i + 1 < args.length) {
      author = args[++i];
    } else if (args[i] === "--new-run") {
      newRun = true;
    } else if (args[i] === "--run" && i + 1 < args.length) {
      run = Number(args[++i]);
    } else {
      process.stderr.write(`${JSON.stringify({ error: `Unknown argument "${args[i]}"` })}\n`);
      process.exit(1);
    }
  }

  if (!slug) {
    process.stderr.write(`${JSON.stringify({ error: "--slug is required" })}\n`);
    process.exit(1);
  }

  if (reviewer && !["self", "independent"].includes(reviewer)) {
    process.stderr.write(`${JSON.stringify({ error: "--reviewer is self or independent" })}\n`);
    process.exit(1);
  }

  try {
    const result = createReport({ dir: output, slug, type, fresh: newRun, run, artifact: artifact ?? slug, reviewer, reviewerModel, author });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
