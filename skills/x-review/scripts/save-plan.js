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
    else if (argv[i] === "--branch" && i + 1 < argv.length) args.branch = argv[++i];
  }
  return args;
}

function sanitizeBranch(branch) {
  return branch.replace(/[/\\:*?"<>|\0]/g, "_");
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
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}-${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

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

  if (!args.output) {
    console.error("Usage: node save-plan.js --output <dir> [--branch <name>]");
    process.exit(1);
  }

  const branch = args.branch || getBranch();
  const date = getTimestamp();
  const dir = path.resolve(args.output);
  const filename = `${date}_${sanitizeBranch(branch)}.md`;
  const fullPath = path.join(dir, filename);

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
