#!/usr/bin/env node

/**
 * Detect duplicated code blocks in source files.
 * Uses a simple line-hashing approach to find repeated sequences.
 *
 * Usage: node scripts/check-duplication.js <file1> [file2] ...
 *        node scripts/check-duplication.js --all [--root ./src]
 *
 * Outputs duplicated blocks as JSON.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Config ─────────────────────────────────────────────────────────

function loadConfig() {
  try {
    const configPath = path.join(__dirname, "..", "assets", "config.json");
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

const CONFIG = { minDupLines: 5, ...loadConfig() };

// ── Deduplication checker ──────────────────────────────────────────

function normalizeLines(source) {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"))
    .map((line) => line.replace(/\s+/g, " ")); // collapse whitespace
}

function findDuplicates(source, filePath) {
  const lines = normalizeLines(source);
  const duplicates = [];

  if (lines.length < CONFIG.minDupLines) return duplicates;

  // Sliding window: hash every N-line block
  const windowSize = CONFIG.minDupLines;
  const hashes = new Map();

  for (let i = 0; i <= lines.length - windowSize; i++) {
    const block = lines.slice(i, i + windowSize).join("\n");
    if (!hashes.has(block)) {
      hashes.set(block, []);
    }
    hashes.get(block).push({ startLine: i + 1, block });
  }

  // Collect blocks that appear more than once
  for (const [, occurrences] of hashes) {
    if (occurrences.length > 1) {
      duplicates.push({
        file: filePath,
        lines: windowSize,
        occurrences: occurrences.map((o) => o.startLine),
        sample: occurrences[0].block.split("\n").slice(0, 3).join("\n"),
      });
    }
  }

  return duplicates;
}

// ── File discovery ─────────────────────────────────────────────────

function findSourceFiles(fileArgs, rootDir) {
  const files = [];
  const extensions = /\.(js|ts|jsx|tsx|mjs|cjs)$/;

  const useAll = fileArgs.includes("--all");

  for (const arg of fileArgs) {
    if (arg.startsWith("--")) continue;
    const resolved = path.resolve(arg);
    try {
      if (fs.statSync(resolved).isDirectory()) {
        walkDir(resolved, extensions, files);
      } else if (extensions.test(resolved)) {
        files.push(resolved);
      }
    } catch {
      // skip inaccessible
    }
  }

  // If --all flag was passed without specific file args, scan rootDir
  if (useAll && !fileArgs.some((a) => !a.startsWith("--"))) {
    const root = rootDir || process.cwd();
    walkDir(root, extensions, files);
  }

  return [...new Set(files)];
}

function walkDir(dir, extPattern, out) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if ([".git", "node_modules", "dist", "build", ".agents"].includes(entry.name)) continue;
        walkDir(full, extPattern, out);
      } else if (extPattern.test(entry.name)) {
        out.push(full);
      }
    }
  } catch {
    // skip
  }
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const rootDir = args.includes("--root") ? args[args.indexOf("--root") + 1] : undefined;

  const files = findSourceFiles(args, rootDir);

  if (files.length === 0) {
    console.error("No source files found.");
    process.exit(1);
  }

  const allDuplicates = [];

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const relPath = path.relative(process.cwd(), file);
    const dups = findDuplicates(source, relPath);
    if (dups.length > 0) allDuplicates.push(...dups);
  }

  const report = {
    totalFiles: files.length,
    duplicatedBlocks: allDuplicates.length,
    duplicates: allDuplicates,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
