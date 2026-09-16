#!/usr/bin/env node

/**
 * Create .x-skills/review/ directory and generate a fix plan file.
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

// ── Self-discovery ────────────────────────────────────────────────────

const SKILL_DIR = path.resolve(__dirname, ".."); // parent of scripts/

function scriptPath(rel) {
  return path.join(SKILL_DIR, "scripts", rel);
}

function runAnalysis(scriptName, args = []) {
  try {
    const output = execSync(`node "${scriptPath(scriptName)}" ${args.join(" ")}`, {
      cwd: process.cwd(),
      timeout: 120_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(output);
  } catch (err) {
    console.error(`[x-review] Warning: ${scriptName} failed:`, err.message);
    return null;
  }
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

  // Complexity stats — use defaults if no config loaded (analyze-complexity has its own config)
  const C = { maxComplexity: 5, maxLength: 20, maxParams: 3 };
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

function generatePlanHeader(stats, branch) {
  const totalFiles = stats.totalFilesAnalyzed.size;
  const lines = [];
  lines.push("# Code Review — Fix Plan");
  lines.push("");
  lines.push(`**Date:** ${getTimestamp()}`);
  lines.push(`**Branch:** ${branch}`);
  lines.push(`**Total files analyzed:** ${totalFiles}`);
  lines.push(`**Functions with complexity > 5:** ${stats.functionsHighComplexity}`);
  lines.push(`**Functions longer than 20 lines:** ${stats.functionsLong}`);
  lines.push(`**Duplicated blocks found:** ${stats.duplicatedBlocks}`);
  lines.push("");

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
  const dir = args.output ? path.resolve(args.output) : resolveRunDir(args.slug || "review");
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
  const stats = aggregateStats(complexity, duplication, patterns);
  const header = generatePlanHeader(stats, branch);

  fs.writeFileSync(fullPath, header + "\n\n---\n\n## Issues (fill in during review)\n");
  console.log(fullPath);
}

main();
