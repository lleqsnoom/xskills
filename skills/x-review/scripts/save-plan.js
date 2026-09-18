#!/usr/bin/env node

/**
 * Write E<nn>-review-plan.md into the run folder, or into --output when given.
 * Runs all analysis scripts (complexity, duplication, refactor patterns)
 * and pre-fills the plan with aggregated statistics.
 *
 * Usage:
 *   node save-plan.js --output <dir> [--branch <name>]
 *
 * Output (stdout): absolute path to the plan file, ready to write into with `write`.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--output" || argv[i] === "-o") && i + 1 < argv.length) args.output = argv[++i];
    else if (argv[i] === "--slug" && i + 1 < argv.length) args.slug = argv[++i];
    else if (argv[i] === "--branch" && i + 1 < argv.length) args.branch = argv[++i];
    else if (argv[i] === "--new-run") args.newRun = true;
    else if (argv[i] === "--run" && i + 1 < argv.length) args.run = argv[++i];
  }
  return args;
}

function getBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GIT_BRANCH || "unknown";
  }
}

// ── Timestamp (JS-generated only — never LLM-determined) ─────────────

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// ── Run folders ──────────────────────────────────────────────────────
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

// ── Self-discovery ────────────────────────────────────────────────────

const SKILL_DIR = path.resolve(__dirname, ".."); // parent of scripts/

function scriptPath(rel) {
  return path.join(SKILL_DIR, "scripts", rel);
}

/**
 * Run one analysis script. The result carries `ok` so the caller can tell "found nothing" from
 * "never ran": a crashed analyzer that reports zero issues is a false all-clear, and the plan must
 * say so rather than print a clean bill of health.
 */
function runAnalysis(scriptName, args = []) {
  try {
    const output = execSync(`node "${scriptPath(scriptName)}" ${args.join(" ")}`, {
      cwd: process.cwd(),
      timeout: 120_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, data: JSON.parse(output) };
  } catch (err) {
    console.error(`[x-review] Warning: ${scriptName} failed:`, err.message);
    return { ok: false, script: scriptName, error: firstLine(err.message) };
  }
}

/** execSync packs the command and its stderr into one message; the plan needs only the gist. */
function firstLine(message) {
  return String(message ?? "").split("\n").filter((line) => line.trim())[0].slice(0, 200) || "unknown error";
}

// ── Stats aggregation ────────────────────────────────────────────────

function aggregateStats(complexity, duplication, patterns) {
  const stats = {
    totalFilesAnalyzed: new Set(),
    functionsHighComplexity: 0,
    functionsLong: 0,
    functionsTooManyParams: 0,
    duplicatedBlocks: 0,
    refactorSuggestions: 0,
    byType: {},
  };

  // Count with the thresholds the analyzer actually applied, falling back to the defaults only when
  // an older analyzer did not report them.
  const C = { maxComplexity: 5, maxLength: 20, maxParams: 3, ...(complexity?.summary?.thresholds || {}) };
  if (complexity) {
    for (const f of complexity.files || []) {
      stats.totalFilesAnalyzed.add(f.file);
      for (const fn of f.functions || []) {
        if (fn.complexity > C.maxComplexity) stats.functionsHighComplexity++;
        if (fn.length > C.maxLength) stats.functionsLong++;
        if (fn.paramCount > C.maxParams) stats.functionsTooManyParams++;
      }
    }
  }

  // Duplication stats
  if (duplication) {
    stats.duplicatedBlocks = duplication.duplicatedBlocks || 0;
    for (const d of duplication.duplicates || []) {
      stats.totalFilesAnalyzed.add(d.file);
    }
  }

  // Refactor pattern stats
  if (patterns) {
    for (const r of patterns.results || []) {
      stats.totalFilesAnalyzed.add(r.path);
      for (const s of r.suggestions || []) {
        stats.refactorSuggestions++;
        const type = s.type.replace(/-/g, " ");
        if (!stats.byType[type]) stats.byType[type] = 0;
        stats.byType[type]++;
      }
    }
  }

  return stats;
}

// ── Plan header generation ───────────────────────────────────────────

function generatePlanHeader(stats, branch, failed = []) {
  const failedNames = new Set(failed.map((run) => run.script));
  const totalFiles = stats.totalFilesAnalyzed.size;
  const metric = (label, value, script) =>
    failedNames.has(script)
      ? `**${label}:** unknown — ${script} failed, so this was not measured`
      : `**${label}:** ${value}`;
  const lines = [];
  lines.push("# Code Review — Fix Plan");
  lines.push("");
  lines.push(`**Date:** ${getTimestamp()}`);
  lines.push(`**Branch:** ${branch}`);
  lines.push("**Counts below:** repo-wide (`--all`), so they describe the whole repository, not the scope you were asked to review.");
  lines.push(`**Total files analyzed:** ${totalFiles}`);
  lines.push(metric("Functions with complexity > 5", stats.functionsHighComplexity, "analyze-complexity.js"));
  lines.push(metric("Functions longer than 20 lines", stats.functionsLong, "analyze-complexity.js"));
  lines.push(metric("Duplicated blocks found", stats.duplicatedBlocks, "check-duplication.js"));
  lines.push("");

  if (failed.length) {
    lines.push("> ⚠️ **Analysis incomplete.** A count above is unknown, not zero:");
    for (const run of failed) lines.push(`> - \`${run.script}\` failed: ${run.error}`);
    lines.push("");
  }

  if (stats.refactorSuggestions > 0) {
    lines.push("## Refactoring Suggestions Summary");
    lines.push("");
    for (const [type, count] of Object.entries(stats.byType)) {
      lines.push(`- **${type}:** ${count}`);
    }
    lines.push("");
  }

  if (stats.functionsTooManyParams > 0) {
    lines.push(`> ⚠️ ${stats.functionsTooManyParams} function(s) have more than 3 parameters.`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.output && !args.slug) {
    console.error("Usage: node save-plan.js [--output <dir> | --slug <topic>] [--branch <name>]");
    process.exit(1);
  }

  const branch = args.branch || getBranch();
  const dir = args.output
    ? path.resolve(args.output)
    : resolveRunDir(args.slug || "review", {
        fresh: args.newRun === true,
        run: args.run === undefined ? null : Number(args.run),
      });
  const fullPath = path.join(dir, `${nextE(dir)}-review-plan.md`);

  fs.mkdirSync(dir, { recursive: true });

  // Run all three analysis scripts
  console.error("[x-review] Running complexity analysis...");
  const complexity = runAnalysis("analyze-complexity.js", ["--all"]);

  console.error("[x-review] Running duplication check...");
  const duplication = runAnalysis("check-duplication.js", ["--all"]);

  console.error("[x-review] Running refactor pattern detection...");
  const patterns = runAnalysis("analyze-patterns.js", ["--all"]);

  // Aggregate and write plan header
  const stats = aggregateStats(complexity.data, duplication.data, patterns.data);
  const failed = [complexity, duplication, patterns].filter((run) => !run.ok);
  const header = generatePlanHeader(stats, branch, failed);

  fs.writeFileSync(fullPath, header + "\n\n---\n\n## Issues (fill in during review)\n");
  console.log(fullPath);
}

module.exports = { generatePlanHeader };

if (require.main === module) {
  main();
}
