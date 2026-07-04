#!/usr/bin/env node

/**
 * Analyze cyclomatic complexity, function length, and parameter count
 * for JavaScript/TypeScript source files.
 *
 * Usage: node scripts/analyze-complexity.js <file1> [file2] ...
 *        node scripts/analyze-complexity.js --all [--root ./src]
 *
 * Outputs a JSON report of functions exceeding thresholds.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Thresholds (override via ASSETS_CONFIG env or defaults) ─────────

const DEFAULTS = {
  maxComplexity: 5,
  maxLength: 20,
  maxParams: 3,
  maxDepth: 2,
};

function loadConfig() {
  try {
    const configPath = path.join(__dirname, "..", "assets", "config.json");
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

const CONFIG = { ...DEFAULTS, ...loadConfig() };

// ── Decision point patterns ────────────────────────────────────────

const DECISION_PATTERNS = [
  /\bif\s*\(/g,
  /\belse\s+if\s*\(/g,
  /\bfor\s*\(/g,
  /\bwhile\s*\(/g,
  /\bcase\s+/g,
  /\bcatch\s*\(/g,
  /\?\s*[^:]+:\s*/g, // ternary
  /\&\&/g,
  /\|\|/g,
];

// ── Function extraction ────────────────────────────────────────────

function extractFunctions(source) {
  const functions = [];
  const lines = source.split("\n");

  // Track brace depth to find function boundaries
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Match function declarations, arrow functions assigned to const/let/var, methods
    const funcMatch = line.match(
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/
    );

    if (funcMatch) {
      const name = funcMatch[1] || "(anonymous)";
      const params = parseParams(funcMatch[2]);
      const startLine = i;

      // Find matching closing brace
      let depth = 0;
      let endLine = startLine;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              endLine = j;
              j = lines.length; // break outer
            }
          }
        }
      }

      const body = lines.slice(startLine, endLine + 1).join("\n");
      const length = endLine - startLine + 1;
      const complexity = calculateComplexity(body);

      functions.push({
        name,
        params,
        paramCount: params.length,
        startLine,
        endLine,
        length,
        complexity,
      });

      i = endLine + 1;
      continue;
    }

    // Arrow functions: const/let/var name = (...) => or async (...) =>
    const arrowMatch = line.match(
      /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/
    );

    if (arrowMatch) {
      const name = arrowMatch[1] || "(anonymous)";
      const params = parseParams(arrowMatch[2]);
      const startLine = i;

      let depth = 0;
      let endLine = startLine;
      for (let j = i; j < lines.length; j++) {
        if (lines[j].includes("{")) {
          for (const ch of lines[j]) {
            if (ch === "{") depth++;
            else if (ch === "}") {
              depth--;
              if (depth === 0) {
                endLine = j;
                j = lines.length;
              }
            }
          }
        }
      }

      const body = lines.slice(startLine, endLine + 1).join("\n");
      const length = endLine - startLine + 1;
      const complexity = calculateComplexity(body);

      functions.push({
        name,
        params,
        paramCount: params.length,
        startLine,
        endLine,
        length,
        complexity,
      });

      i = endLine + 1;
      continue;
    }

    // Class methods: methodName(...) { or async methodName(...) {
    const methodMatch = line.match(
      /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*{/
    );

    if (methodMatch && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
      const name = methodMatch[1];
      // Skip non-method keywords
      if (["if", "for", "while", "switch", "catch", "class", "function"].includes(name)) {
        i++;
        continue;
      }

      const params = parseParams(methodMatch[2]);
      const startLine = i;

      let depth = 0;
      let endLine = startLine;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              endLine = j;
              j = lines.length;
            }
          }
        }
      }

      const body = lines.slice(startLine, endLine + 1).join("\n");
      const length = endLine - startLine + 1;
      const complexity = calculateComplexity(body);

      functions.push({
        name,
        params,
        paramCount: params.length,
        startLine,
        endLine,
        length,
        complexity,
      });

      i = endLine + 1;
      continue;
    }

    i++;
  }

  return functions;
}

function parseParams(paramStr) {
  if (!paramStr.trim()) return [];
  // Strip default values for counting purposes
  return paramStr.split(",").map((p) => p.trim().split("=")[0].trim()).filter(Boolean);
}

function calculateComplexity(body) {
  let complexity = 1; // base

  for (const pattern of DECISION_PATTERNS) {
    const matches = body.match(pattern);
    if (matches) complexity += matches.length;
  }

  return complexity;
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

  return [...new Set(files)]; // deduplicate
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
    // skip inaccessible dirs
  }
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const rootDir = args.includes("--root") ? args[args.indexOf("--root") + 1] : undefined;

  const fileArgs = args.filter((a) => !a.startsWith("--"));
  const files = findSourceFiles(fileArgs, rootDir);

  if (files.length === 0) {
    console.error("No source files found.");
    process.exit(1);
  }

  const report = {
    files: [],
    summary: {
      totalFiles: files.length,
      totalFunctions: 0,
      highComplexity: 0,
      longFunctions: 0,
      tooManyParams: 0,
    },
  };

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const functions = extractFunctions(source);
    const fileReport = { file: path.relative(process.cwd(), file), functions: [] };
    let hasIssues = false;

    for (const fn of functions) {
      const issues = [];

      if (fn.complexity > CONFIG.maxComplexity) {
        issues.push({ type: "complexity", value: fn.complexity, threshold: CONFIG.maxComplexity });
      }
      if (fn.length > CONFIG.maxLength) {
        issues.push({ type: "length", value: fn.length, threshold: CONFIG.maxLength });
      }
      if (fn.paramCount > CONFIG.maxParams) {
        issues.push({ type: "params", value: fn.paramCount, threshold: CONFIG.maxParams });
      }

      if (issues.length > 0) hasIssues = true;

      fileReport.functions.push({
        name: fn.name,
        line: fn.startLine + 1, // 1-indexed
        length: fn.length,
        complexity: fn.complexity,
        paramCount: fn.paramCount,
        issues,
      });

      report.summary.totalFunctions++;
      if (fn.complexity > CONFIG.maxComplexity) report.summary.highComplexity++;
      if (fn.length > CONFIG.maxLength) report.summary.longFunctions++;
      if (fn.paramCount > CONFIG.maxParams) report.summary.tooManyParams++;
    }

    if (hasIssues) report.files.push(fileReport);
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
