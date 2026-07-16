#!/usr/bin/env node

/**
 * Multi-language code complexity analyzer using web-tree-sitter.
 *
 * Supports: JavaScript, TypeScript, Python, Go, Rust, Java, Ruby, PHP, Bash, and more.
 * Uses AST-based parsing for accurate cyclomatic complexity, function length,
 * and parameter count analysis — no regex heuristics.
 *
 * Usage:
 *   node analyze-complexity.js <file1> [file2] ...
 *   node analyze-complexity.js --all [--root ./src]
 *
 * Output: JSON report of functions exceeding thresholds.
 */

const fs = require("node:fs");
const path = require("node:path");
const { findSourceFiles, findTrackedSourceFiles } = require("./utils/file-discovery");

// ── Thresholds (override via ASSETS_CONFIG env or defaults) ─────────

const DEFAULTS = {
  maxComplexity: 5,
  maxLength: 20,
  maxParams: 3,
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

// ── web-tree-sitter loader (WASM-based, no native compilation) ─────

let Parser = null;
let Language = null;

/**
 * Resolve the global npm prefix (where -g packages are installed).
 */
function getGlobalPrefix() {
  try {
    const cp = require("node:child_process");
    return cp.execSync("npm config get prefix", { stdio: ["pipe", "pipe", "ignore"] }).toString().trim();
  } catch {
    return path.join(require("os").homedir(), ".npm-global");
  }
}

/**
 * Detect which language grammars are already installed for the given extensions.
 * Checks both local (cwd) and global node_modules paths.
 */
function detectInstalledGrammars(extSet) {
  const searchDirs = [process.cwd(), getGlobalPrefix()];

  const hasParser = (() => {
    for (const dir of searchDirs) {
      try { require.resolve("web-tree-sitter", { paths: [dir] }); return true; } catch {}
    }
    return false;
  })();

  const hasLangs = {};
  for (const ext of extSet) {
    const langName = EXTENSION_MAP[ext];
    if (!langName) continue;
    let found = false;
    for (const dir of searchDirs) {
      try {
        require.resolve(`tree-sitter-${langName}/package.json`, { paths: [dir] });
        found = true;
        break;
      } catch {}
    }
    hasLangs[langName] = found;
  }

  return { hasParser, hasLangs };
}

/**
 * Build the deduplicated list of grammars to install.
 */
function buildGrammarList(hasParser, hasLangs) {
  if (hasParser && Object.values(hasLangs).every(Boolean)) return null;

  const grammarOnly = [];
  for (const langName of Object.keys(hasLangs)) {
    if (!hasLangs[langName]) {
      grammarOnly.push(`tree-sitter-${langName}`);
    }
  }

  if (!grammarOnly.includes("tree-sitter-javascript")) {
    grammarOnly.unshift("tree-sitter-javascript");
  }

  const neededGrammars = ["web-tree-sitter", ...grammarOnly];
  return neededGrammars;
}

/**
 * Install grammars globally via npm. Returns the list of installed packages, or null on failure.
 */
async function installGrammars(neededGrammars) {
  const childProcess = require("node:child_process");
  console.error("[x-review] Installing web-tree-sitter globally for AST-based analysis...");

  try {
    childProcess.execSync(
      `npm install -g --no-audit --no-fund ${neededGrammars.join(" ")}`,
      { stdio: "pipe" }
    );
    console.error("[x-review] Installed globally:", neededGrammars.join(", "));
  } catch {
    console.error(
      "[x-review] Failed to auto-install tree-sitter. Install manually:\n" +
      `  npm install -g web-tree-sitter ${neededGrammars.filter(g => g !== 'web-tree-sitter').join(' ')}`
    );
    return null;
  }

  return ["web-tree-sitter", ...neededGrammars.filter((g) => g.startsWith("tree-sitter-"))];
}

/**
 * Auto-install web-tree-sitter + needed language grammars if missing.
 * Runs `npm install --save-dev` non-interactively.
 */
async function ensureTreeSitterInstalled() {
  // Collect extensions from input files to determine which grammars are needed.
  // When --all is passed without specific files, use git-tracked source files
  // so we only install grammars for languages actually present in the repo.
  const extSet = new Set();
  if (process.argv.slice(2).includes("--all") && !process.argv.slice(2).some((a) => !a.startsWith("--"))) {
    const tracked = findTrackedSourceFiles();
    for (const f of tracked) extSet.add(path.extname(f));
  } else {
    const allArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    for (const arg of allArgs) {
      try {
        const stat = require("node:fs").statSync(arg);
        if (!stat.isDirectory()) extSet.add(require("node:path").extname(arg));
        else collectExtsRecursive(arg, extSet);
      } catch {}
    }
  }

  // Detect installed state and build install list
  const { hasParser, hasLangs } = detectInstalledGrammars(extSet);
  const neededGrammars = buildGrammarList(hasParser, hasLangs);

  // If everything is installed, skip install
  if (!neededGrammars) return [];

  // Attempt installation with fallback
  return (await installGrammars(neededGrammars)) || [];
}

/**
 * Directory names to skip during recursive scanning.
 */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".agents"]);

/**
 * Check if a directory should be skipped during recursive walking.
 */
function shouldSkipDirectory(name) {
  return SKIP_DIRS.has(name);
}

/**
 * Extract and normalize the file extension from a filename.
 */
function extractFileExtension(fileName) {
  const ext = require("node:path").extname(fileName);
  return ext ? ext.toLowerCase() : null;
}

/**
 * Process a single directory entry — recurse into subdirectories or extract file extensions.
 */
function processDirEntry(entry, dir, extSet) {
  const full = require("node:path").join(dir, entry.name);
  if (entry.isDirectory()) {
    if (!shouldSkipDirectory(entry.name)) {
      collectExtsRecursive(full, extSet);
    }
  } else {
    const ext = extractFileExtension(entry.name);
    if (ext) extSet.add(ext);
  }
}

function collectExtsRecursive(dir, extSet) {
  try {
    for (const entry of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
      processDirEntry(entry, dir, extSet);
    }
  } catch {}
}

try {
  // Try to resolve web-tree-sitter from cwd, skill dir, parent dirs, then global prefix
  const searchDirs = [process.cwd(), __dirname, path.join(__dirname, "..", ".."), getGlobalPrefix()];
  let resolved = null;
  for (const dir of searchDirs) {
    try { resolved = require.resolve("web-tree-sitter", { paths: [dir] }); break; } catch {}
  }
  if (!resolved) throw new Error("not found");
  const ws = require(resolved);
  Parser = ws.Parser;
  Language = ws.Language;
} catch {
  // web-tree-sitter not found — will fall back to regex parser below or auto-install in main()
}

// ── Language grammar discovery ─────────────────────────────────────

const EXTENSION_MAP = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
};

function findWasmFile(langName) {
  // Search from cwd first (where source files are), then skill dir, parent dirs, then global prefix
  const searchDirs = [process.cwd(), __dirname, path.join(__dirname, "..", ".."), getGlobalPrefix()];
  
  for (const baseDir of searchDirs) {
    try {
      const resolvedPkg = require.resolve(`tree-sitter-${langName}/package.json`, { paths: [baseDir] });
      const dir = path.dirname(resolvedPkg);
      const wasmFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".wasm"));
      if (wasmFiles.length === 0) continue;
      // Prefer the non-TSX variant for .ts, use TSX for .tsx
      if (langName === "typescript") {
        const tsx = wasmFiles.find((f) => f.includes("tsx"));
        return path.join(dir, tsx || wasmFiles[0]);
      }
      // PHP has both php and php_only — prefer the full one
      if (langName === "php") {
        const full = wasmFiles.find((f) => !f.includes("_only"));
        return path.join(dir, full || wasmFiles[0]);
      }
      return path.join(dir, wasmFiles[0]);
    } catch {
      continue; // try next search directory
    }
  }
  
  return null;
}

// Cache loaded languages to avoid re-loading WASM on every file
const languageCache = new Map();

async function getLanguage(langName) {
  if (languageCache.has(langName)) return languageCache.get(langName);
  const wasmPath = findWasmFile(langName);
  if (!wasmPath || !fs.existsSync(wasmPath)) return null;
  try {
    const lang = await Language.load(fs.readFileSync(wasmPath));
    languageCache.set(langName, lang);
    return lang;
  } catch {
    return null;
  }
}

async function initTreeSitter() {
  if (!Parser || !Language) return false;
  try {
    await Parser.init();
    return true;
  } catch {
    return false;
  }
}

// ── AST-based function extraction and complexity (multi-language) ───

/**
 * Common decision-point node types across tree-sitter grammars.
 */
const DECISION_NODE_TYPES = new Set([
  // If/switch/case
  "if_statement", "switch_statement", "match_statement",
  "type_switch_statement", "select_statement",
  // Loops
  "for_statement", "for_in_statement", "for_of_statement",
  "while_statement", "do_statement",
  // Exception handling
  "try_statement", "catch_clause", "catch_declaration",
  // Ternary / conditional expressions
  "conditional_expression",
]);

/**
 * Extra decision nodes that appear in specific language grammars.
 */
const LANGUAGE_DECISION_TYPES = {
  rust: new Set(["if_expression", "loop_expression", "for_expression",
                  "while_expression", "match_expression"]),
  bash: new Set(["case_statement", "select_statement"]),
};

function countDecisionNodes(node, langName) {
  let count = 0;
  const extraTypes = LANGUAGE_DECISION_TYPES[langName];

  function walk(n) {
    if (DECISION_NODE_TYPES.has(n.type)) {
      count++;
    } else if (extraTypes && extraTypes.has(n.type)) {
      count++;
    }
    for (const child of n.children) {
      walk(child);
    }
  }

  walk(node);
  return count;
}

/**
 * Dispatch table for extracting parameter names by node type.
 */
const PARAM_EXTRACTORS = {
  identifier: (child) => child.text && !child.text.startsWith("(") ? child.text : null,
  formal_parameter: (child) => child.text && !child.text.startsWith("(") ? child.text : null,
  parameter_declaration: (child) => {
    const nameNode = child.childForFieldName("name");
    return nameNode ? nameNode.text : null;
  },
  optional_parameter: (child) => {
    const nameNode = child.childForFieldName("name");
    return nameNode ? nameNode.text : null;
  },
  parameter: (child) => {
    if (child.childCount > 0) {
      const first = child.children[0];
      if (first.type === "identifier") return first.text;
    }
    return null;
  },
  assignment_parameter: (child) => {
    const nameNode = child.childForFieldName("left");
    return nameNode ? nameNode.text : null;
  },
};

/**
 * Extract parameter names from function declaration — handles multiple languages.
 */
function extractParams(paramNode) {
  if (!paramNode) return [];
  const params = [];

  for (const child of paramNode.children) {
    const extractor = PARAM_EXTRACTORS[child.type];
    if (extractor) {
      const name = extractor(child);
      if (name) params.push(name);
    }
  }

  return params.filter(Boolean);
}

/**
 * Extract functions from source using tree-sitter AST.
 */
async function extractFunctionsTS(source, langName) {
  const parser = await setupParser(langName);
  if (!parser) return [];

  const FUNCTION_NODE_TYPES = [
    "function_declaration",   // JS, TS, Go, Java, PHP, C-family
    "function_definition",     // Python, Ruby (some grammars)
    "method_declaration",      // Java, C-family
    "method_definition",       // JS, TS
    "arrow_function",          // JS, TS
  ];

  const functions = [];

  function walk(node) {
    if (FUNCTION_NODE_TYPES.includes(node.type)) {
      const info = findFunctionNodeInfo(node);
      if (!info) return;

      const params = extractParams(info.paramsNode);
      const bodyNode = node.childForFieldName("body");
      if (!bodyNode) return;

      const result = computeFunctionMetrics(info.name, params, bodyNode, node, source, langName);
      if (result) functions.push(result);

      // Don't recurse into the function body — we've already counted its decisions
      return;
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(parser.parse(source).rootNode);
  return functions;
}

/**
 * Initialize and configure a tree-sitter parser for the given language.
 */
async function setupParser(langName) {
  const lang = await getLanguage(langName);
  if (!lang) return null;
  const parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

/**
 * Extract name and parameters node from a function AST node.
 */
function findFunctionNodeInfo(node) {
  let name = "(anonymous)";
  let paramsNode = null;

  // Extract name based on field names
  const nameNode = node.childForFieldName("name");
  if (nameNode) name = nameNode.text;

  // Find the parameters node — try field first, then scan children
  const paramsField = node.childForFieldName("parameters");
  if (paramsField) {
    paramsNode = paramsField;
  } else if (node.childCount > 0) {
    for (const child of node.children) {
      if (child.type.includes("parameter") || child.type === "formal_parameters" ||
          child.type === "formal_parameter_list" ||
          child.type === "parameters") {
        paramsNode = child;
        break;
      }
    }
  }

  return { name, paramsNode };
}

/**
 * Compute metrics (length, complexity, decisions) for a single function.
 */
function computeFunctionMetrics(name, params, bodyNode, node, source, langName) {
  const lines = source.split("\n");
  const funcLines = lines.slice(Math.max(0, node.startPosition.row), bodyNode.endPosition.row + 1);
  const length = funcLines.length;

  const decisions = countDecisionNodes(bodyNode, langName);

  // Count && / || in JS/TS as extra decision points (they're binary expressions)
  let operatorDecisions = 0;
  if (langName === "javascript" || langName === "typescript") {
    for (const line of funcLines) {
      const andMatches = (line.match(/&&/g) || []).length;
      const orMatches = (line.match(/\|\|/g) || []).length;
      operatorDecisions += andMatches + orMatches;
    }
  }

  return {
    name,
    params,
    paramCount: params.length,
    startLine: node.startPosition.row + 1, // 1-indexed
    endLine: bodyNode.endPosition.row + 1, // 1-indexed
    length,
    complexity: 1 + decisions + operatorDecisions,
  };
}

// ── Regex-based fallback parser (no tree-sitter dependency) ────────

const REGEX_MATCHERS = [
  { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/, nameExtractor: (m) => m[1] || "(anonymous)" },
  { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/, nameExtractor: (m) => m[1] || "(anonymous)" },
];

/**
 * Keywords that look like method signatures but are control flow.
 */
const CONTROL_FLOW_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "class", "function"]);

/**
 * Try to match a line against known regex function patterns and record the result.
 * Returns true if a match was found and processed.
 */
function tryMatchRegexPattern(lines, i, functions) {
  for (const matcher of REGEX_MATCHERS) {
    const match = lines[i].match(matcher.regex);
    if (match) {
      const name = matcher.nameExtractor(match);
      const startLine = i;
      const endLine = findFunctionEndLine(lines, startLine);
      pushRegexFunction(functions, { name, startLine, endLine });
      return endLine;
    }
  }
  return null;
}

function extractFunctionsRegex(source) {
  const functions = [];
  const lines = source.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Try standard regex matchers (function declarations, arrow functions)
    const endLine = tryMatchRegexPattern(lines, i, functions);
    if (endLine !== null) {
      i = endLine + 1;
      continue;
    }

    // Class methods: methodName(...) { or async methodName(...) {
    const methodMatch = lines[i].match(/^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*{/);
    if (methodMatch) {
      const name = methodMatch[1];
      if (!CONTROL_FLOW_KEYWORDS.has(name)) {
        const startLine = i;
        const endLine = findFunctionEndLine(lines, startLine);
        pushRegexFunction(functions, { name, startLine, endLine });
        i = endLine + 1;
        continue;
      }
    }

    i++;
  }

  return functions;
}

/**
 * Find the closing brace of a function body starting from startLine.
 */
function findFunctionEndLine(lines, startLine) {
  let depth = 0, endLine = startLine;
  for (let j = startLine; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { endLine = j; j = lines.length; } }
    }
  }
  return endLine;
}

/**
 * Push a regex-detected function entry with computed metrics.
 */
function pushRegexFunction(functions, { name, startLine, endLine }) {
  functions.push({
    name, params: [], paramCount: 0, startLine, endLine,
    length: endLine - startLine + 1,
    complexity: regexComplexity(lines.slice(startLine, endLine + 1).join("\n")),
  });
}

function regexComplexity(body) {
  let c = 1;
  for (const p of [/\bif\s*\(/g, /\belse\s+if\s*\(/g, /\bfor\s*\(/g, /\bwhile\s*\(/g,
                   /\bcase\s+/g, /\bcatch\s*\(/g, /\&\&/g, /\|\|/g]) {
    const m = body.match(p);
    if (m) c += m.length;
  }
  return c;
}

// ── Main ───────────────────────────────────────────────────────────

function parseArgs(args) {
  const rootDir = args.includes("--root") ? args[args.indexOf("--root") + 1] : undefined;
  // Keep --all in fileArgs so findSourceFiles can detect it; strip other flags
  const fileArgs = args.includes("--all") ? args.filter((a) => a === "--all" || !a.startsWith("--")) : args.filter((a) => !a.startsWith("--"));
  return { rootDir, fileArgs };
}

async function initEngine() {
  try {
    await ensureTreeSitterInstalled();
  } catch {}

  if (!Parser || !Language) {
    try {
      const resolved = require.resolve("web-tree-sitter", { paths: [process.cwd(), __dirname, path.join(__dirname, "..", "..")] });
      const ws = require(resolved);
      Parser = ws.Parser; Language = ws.Language;
    } catch {}
  }

  if (Parser && Language) {
    try { return await initTreeSitter(); } catch {}
  }
  return false;
}

async function collectReport(files, useTS) {
  const report = {
    files: [],
    summary: {
      totalFiles: files.length,
      totalFunctions: 0,
      highComplexity: 0,
      longFunctions: 0,
      tooManyParams: 0,
      language: useTS ? "tree-sitter (AST-based)" : "regex fallback",
    },
  };

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const ext = path.extname(file).toLowerCase();
    const langName = EXTENSION_MAP[ext];
    const functions = useTS && langName ? await extractFunctionsTS(source, langName) : extractFunctionsRegex(source);

    const fileReport = analyzeFile(path.relative(process.cwd(), file), functions, report.summary);
    if (fileReport.functions.length > 0) {
      report.files.push(fileReport);
    }
  }

  return report;
}

/**
 * Analyze a single function against configured thresholds and return issues.
 */
function analyzeFunction(fn) {
  const issues = [];
  if (fn.complexity > CONFIG.maxComplexity) issues.push({ type: "complexity", value: fn.complexity, threshold: CONFIG.maxComplexity });
  if (fn.length > CONFIG.maxLength) issues.push({ type: "length", value: fn.length, threshold: CONFIG.maxLength });
  if (fn.paramCount > CONFIG.maxParams) issues.push({ type: "params", value: fn.paramCount, threshold: CONFIG.maxParams });
  return issues;
}

/**
 * Aggregate a single function's metrics into the running summary counters.
 */
function aggregateSummary(fn, summary) {
  summary.totalFunctions++;
  if (fn.complexity > CONFIG.maxComplexity) summary.highComplexity++;
  if (fn.length > CONFIG.maxLength) summary.longFunctions++;
  if (fn.paramCount > CONFIG.maxParams) summary.tooManyParams++;
}

/**
 * Analyze all functions in a file and produce the per-file report entry.
 */
function analyzeFile(relativePath, functions, summary) {
  const fileReport = { file: relativePath, functions: [] };
  let hasIssues = false;

  for (const fn of functions) {
    const issues = analyzeFunction(fn);

    if (issues.length > 0) hasIssues = true;

    fileReport.functions.push({ name: fn.name, line: fn.startLine, length: fn.length, complexity: fn.complexity, paramCount: fn.paramCount, issues });

    aggregateSummary(fn, summary);
  }

  if (hasIssues || functions.length > 0) {
    fileReport.functionCount = functions.length;
  }

  return fileReport;
}

function warnAboutMissingTreeSitter(files) {
  const nonJsTs = files.filter((f) => !/\.(js|ts|jsx|tsx|mjs|cjs)$/.test(f));
  if (nonJsTs.length > 0) {
    console.error(
      "Warning: tree-sitter not available. Non-JS/TS files will use regex-based analysis.\n" +
      "Install web-tree-sitter for accurate multi-language AST parsing:\n" +
      "  npm install --save-dev web-tree-sitter"
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const { rootDir, fileArgs } = parseArgs(args);

  const useTS = await initEngine();
  const files = findSourceFiles(fileArgs, rootDir);

  if (files.length === 0) {
    console.error("No source files found.");
    process.exit(1);
  }

  warnAboutMissingTreeSitter(files);
  const report = await collectReport(files, useTS);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
