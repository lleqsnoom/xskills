#!/usr/bin/env node
"use strict";

/**
 * Refactor pattern analyzer — detects code smell opportunities in source files.
 * Merged from x-refactor to unify with x-review analysis pipeline.
 *
 * Patterns detected:
 *   1. Extract Method: functions >20 lines with compound verb names
 *   2. Rename Variable: single-letter or Hungarian-notation variables
 *   3. Replace Conditional: if/else chains with 4+ branches on same variable
 *   4. Inline Method: trivial methods called from exactly one location
 *
 * Usage:
 *   node analyze-patterns.js <file-or-dir> [--thresholds lines,branches]
 *   node analyze-patterns.js --all
 *
 * Output: JSON to stdout with suggestions grouped by file.
 */

const fs = require("node:fs");
const path = require("node:path");
const { findSourceFiles } = require("./utils/file-discovery");

// ── Thresholds ────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS = {
  extractMethodLines: 20,
  replaceConditionalBranches: 4,
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const fileArgs = [];
  let thresholds = { ...DEFAULT_THRESHOLDS };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--thresholds" && i + 1 < args.length) {
      const parts = args[++i].split(",").map(Number);
      if (parts.length >= 1) thresholds.extractMethodLines = parts[0];
      if (parts.length >= 2) thresholds.replaceConditionalBranches = parts[1];
    } else if (!args[i].startsWith("--")) {
      fileArgs.push(args[i]);
    }
  }

  return { fileArgs, thresholds };
}

// ── Pattern Detection Regexes ────────────────────────────────────────

const COMPOUND_VERB_RE = /\b(?:function\s+|async\s+function\s+|export\s+(?:default\s+)?(?:async\s+)?)(\w+)/g;

const SINGLE_LETTER_RE = /\b(?:let|const|var)\s+([a-zA-Z])\s*=/g;

const HUNGARIAN_RE = /\b(?:let|const|var)\s+(str[A-Z]\w*|n[A-Z]\d*\w*|b[A-Z]\w*|arr[A-Z]\w*|obj[A-Z]\w*)\s*=/g;

// ── Compound Verb Names ───────────────────────────────────────────────

const COMMON_NAMES = new Set([
  "parse", "format", "resolve", "detect", "extract", "find", "get", "set",
  "init", "validate", "sanitize", "collect", "compute", "analyze", "build",
  "setup", "ensure", "process", "convert", "transform", "map", "filter",
  "sort", "reduce", "count", "check", "verify", "create", "write", "read",
  "load", "save", "install", "list", "scan", "walk", "handle", "dispatch",
]);

function detectCompoundVerbs(source) {
  const suggestions = [];
  COMPOUND_VERB_RE.lastIndex = 0;

  let match;
  while ((match = COMPOUND_VERB_RE.exec(source)) !== null) {
    const name = match[1];
    if (name.length <= 3 || COMMON_NAMES.has(name.toLowerCase())) continue;

    const andMatch = name.match(/([a-z]+)(?:and|And|AND)([A-Z][a-z])/);
    if (!andMatch) continue;

    suggestions.push({
      type: "extract-method",
      pattern: "compound-verb-name",
      symbol: name,
      description: `Function "${name}" has a compound verb name suggesting multiple responsibilities.`,
    });
  }

  return suggestions;
}

// ── Long Functions ────────────────────────────────────────────────────

function detectLongFunctions(source, maxLines) {
  const suggestions = [];
  const funcPattern = /\b(?:function\s+(\w+)|async\s+function\s+(\w+)|export\s+(?:default\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{)/g;

  let match;
  while ((match = funcPattern.exec(source)) !== null) {
    const name = match[1] || match[2] || match[3];
    if (!name) continue;

    const headerEnd = match.index + match[0].length;
    let depth = 1;
    let pos = headerEnd;

    while (pos < source.length && depth > 0) {
      if (source[pos] === "{") depth++;
      else if (source[pos] === "}") depth--;
      pos++;
    }

    const bodyStart = match.index;
    let lineCount = 0;
    for (let i = bodyStart; i < pos && i < source.length; i++) {
      if (source[i] === "\n") lineCount++;
    }

    if (lineCount >= maxLines) {
      suggestions.push({
        type: "extract-method",
        pattern: "long-function",
        symbol: name,
        lines: lineCount + 1,
        description: `Function "${name}" is ${lineCount + 1} lines long (>${maxLines}). Consider extracting smaller units.`,
      });
    }
  }

  return suggestions;
}

// ── Single-Letter Variables ───────────────────────────────────────────

function detectSingleLetterVars(source) {
  const suggestions = [];
  SINGLE_LETTER_RE.lastIndex = 0;

  let match;
  while ((match = SINGLE_LETTER_RE.exec(source)) !== null) {
    const varName = match[1];
    if (["i", "j", "k"].includes(varName.toLowerCase())) continue;
    suggestions.push({
      type: "rename-variable",
      pattern: "single-letter",
      variable: varName,
      description: `Variable "${varName}" is a single letter. Use a descriptive name that conveys purpose.`,
    });
  }

  return suggestions;
}

// ── Hungarian Notation ────────────────────────────────────────────────

function detectHungarianNotation(source) {
  const suggestions = [];
  HUNGARIAN_RE.lastIndex = 0;

  let match;
  while ((match = HUNGARIAN_RE.exec(source)) !== null) {
    const varName = match[1];
    suggestions.push({
      type: "rename-variable",
      pattern: "hungarian-notation",
      variable: varName,
      description: `Variable "${varName}" uses Hungarian notation. Rely on TypeScript/IDE types instead.`,
    });
  }

  return suggestions;
}

// ── Conditional Chains (if/else if with N+ branches) ──────────────────

function detectConditionalChains(source, branchThreshold) {
  const suggestions = [];
  const lines = source.split("\n");
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const chainMatch = trimmed.match(/\b(if|else\s+if)\s*\(\s*(\w+)\s*[!=<>]=?/);

    if (chainMatch) {
      const varName = chainMatch[2];
      let branches = 1;
      let j = i + 1;

      while (j < lines.length) {
        const nextTrimmed = lines[j].trim();
        const nextChainMatch = nextTrimmed.match(/\belse\s+if\s*\(\s*(\w+)\s*[!=<>]=?/);

        if (nextChainMatch && nextChainMatch[1] === varName) {
          branches++;
          j++;
        } else {
          break;
        }
      }

      if (branches >= branchThreshold) {
        suggestions.push({
          type: "replace-conditional",
          pattern: "if-else-chain",
          variable: varName,
          branches,
          line: i + 1,
          description: `${branches}-branch if/else chain on "${varName}". Consider a strategy pattern or lookup table.`,
        });
      }

      i = j;
    } else {
      i++;
    }
  }

  return suggestions;
}

// ── Trivial Single-Call Methods ───────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectTrivialMethods(source) {
  const suggestions = [];
  const trivialPattern = /\b(?:async\s+)?(?:function\s+(\w+)\s*\([^)]*\)\s*\{[^{}]*\}|(\w+)\s*\([^)]*\)\s*[:=]\s*\{[^{}]*\})/g;

  let match;
  while ((match = trivialPattern.exec(source)) !== null) {
    const name = match[1] || match[2];
    if (!name || name.length <= 3) continue;

    const callPattern = new RegExp(`\\b${escapeRegex(name)}\\s*\\(`, "g");
    let callCount = 0;
    let callMatch;
    while ((callMatch = callPattern.exec(source)) !== null) {
      if (callMatch.index !== match.index) callCount++;
    }

    if (callCount <= 1) {
      suggestions.push({
        type: "inline-method",
        pattern: "trivial-single-call",
        symbol: name,
        description: `Trivial method "${name}" is called from at most one location. Consider inlining its logic directly.`,
      });
    }
  }

  return suggestions;
}

// ── Analysis Engine ───────────────────────────────────────────────────

function analyzeFile(filePath, thresholds) {
  let source;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { path: filePath, errors: [`Failed to read file: ${err.message}`] };
  }

  const relativePath = path.relative(process.cwd(), filePath);

  const suggestions = [];
  suggestions.push(...detectCompoundVerbs(source));
  suggestions.push(...detectLongFunctions(source, thresholds.extractMethodLines));
  suggestions.push(...detectSingleLetterVars(source));
  suggestions.push(...detectHungarianNotation(source));
  suggestions.push(...detectConditionalChains(source, thresholds.replaceConditionalBranches));
  suggestions.push(...detectTrivialMethods(source));

  return { path: relativePath, suggestions };
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const { fileArgs, thresholds } = parseArgs(process.argv);
  const files = findSourceFiles(fileArgs);

  if (files.length === 0) {
    console.log(JSON.stringify({ results: [], totalFiles: 0, message: "No source files found." }, null, 2));
    process.exit(0);
  }

  const results = [];
  for (const file of files) {
    const result = analyzeFile(file, thresholds);
    if (result.suggestions.length > 0 || result.errors) {
      results.push(result);
    }
  }

  const output = { results, totalFiles: files.length };
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

main();
