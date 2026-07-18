#!/usr/bin/env node
"use strict";

/**
 * x-test-gen — generates test stub files from source code analysis.
 *
 * Detects function signatures, error handling patterns, and edge cases,
 * then generates scaffolded test files with TODO comments for manual completion.
 *
 * Usage:
 *   node generate.js <file-or-dir> [--output tests/unit/ --framework jest|vitest|mocha]
 *
 * Output: Test stub files written to specified directory (default: tests/unit/)
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Framework Detection ───────────────────────────────────────────────

function detectFramework(cwd) {
  // Check for framework config files
  const configs = [
    { file: "jest.config.js", name: "jest" },
    { file: "jest.config.ts", name: "vitest" },
    { file: "vitest.config.ts", name: "vitest" },
    { file: ".mocharc.yml", name: "mocha" },
    { file: ".mocharc.json", name: "mocha" },
    { file: "pytest.ini", name: "pytest" },
  ];

  for (const config of configs) {
    if (fs.existsSync(path.join(cwd, config.file))) {
      return config.name;
    }
  }

  // Check package.json for test scripts
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.dependencies || pkg.devDependencies) {
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if ("jest" in deps) return "jest";
        if ("vitest" in deps) return "vitest";
        if ("mocha" in deps) return "mocha";
      }
    } catch {}
  }

  // Default to Jest (most common)
  return "jest";
}

// ── Source Analysis ───────────────────────────────────────────────────

function extractExports(source, filePath) {
  const exports = [];
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".py") {
    // Python: detect function definitions and classes
    const funcPattern = /^\s*def\s+(\w+)\s*\(([^)]*)\)/gm;
    let match;
    while ((match = funcPattern.exec(source)) !== null) {
      exports.push({
        type: "function",
        name: match[1],
        params: extractPythonParams(match[2]),
      });
    }

    const classPattern = /^\s*class\s+(\w+)/gm;
    while ((match = classPattern.exec(source)) !== null) {
      exports.push({ type: "class", name: match[1] });
    }
  } else {
    // JavaScript/TypeScript: detect exported functions and classes
    const funcPattern = /\b(?:export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|export\s+(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>)/gm;
    let match;

    while ((match = funcPattern.exec(source)) !== null) {
      const name = match[1] || match[3];
      if (!name) continue;
      exports.push({
        type: "function",
        name,
        params: extractJSParams(match[2] || match[4]),
      });
    }

    // Also detect exported classes
    const classPattern = /\bexport\s+(?:default\s+)?class\s+(\w+)/gm;
    while ((match = classPattern.exec(source)) !== null) {
      exports.push({ type: "class", name: match[1] });
    }

    // Detect TypeScript interface/type exports
    const tsPattern = /\bexport\s+(?:interface|type)\s+(\w+)/gm;
    while ((match = tsPattern.exec(source)) !== null) {
      exports.push({ type: "type", name: match[1] });
    }
  }

  return exports;
}

function extractPythonParams(paramStr) {
  if (!paramStr.trim()) return [];
  const params = paramStr.split(",").map((p) => p.trim());
  // Remove 'self' and 'cls' parameters
  return params.filter((p) => !["self", "cls"].includes(p));
}

function extractJSParams(paramStr) {
  if (!paramStr.trim()) return [];
  const params = paramStr.split(",").map((p) => p.trim());
  // Extract parameter names (handle destructuring, default values, types)
  return params.map((p) => {
    // Remove TypeScript type annotations
    let cleaned = p.replace(/:\s*[^,=]+/g, "");
    // Handle destructured parameters: {a, b} -> 'obj'
    if (cleaned.startsWith("{") || cleaned.startsWith("[")) return "params";
    // Remove default values: name = defaultValue -> name
    const eqIdx = cleaned.indexOf("=");
    if (eqIdx !== -1) cleaned = cleaned.substring(0, eqIdx).trim();
    return cleaned;
  });
}

function detectErrorPatterns(source) {
  const patterns = [];

  // Try/catch blocks
  const tryCatchPattern = /\btry\s*\{/g;
  let match;
  while ((match = tryCatchPattern.exec(source)) !== null) {
    patterns.push({ type: "try-catch", position: match.index });
  }

  // Throw statements
  const throwPattern = /\bthrow\s+(?:new\s+\w+|Error\(|reject\()/g;
  while ((match = throwPattern.exec(source)) !== null) {
    patterns.push({ type: "throw", position: match.index });
  }

  // Null/undefined checks (guard clauses)
  const guardPattern = /\bif\s*\(\s*(?:!|typeof\s+\w+\s*===\s*['\"]undefined['\"]|\w+\s*===?\s*null)/g;
  while ((match = guardPattern.exec(source)) !== null) {
    patterns.push({ type: "guard-clause", position: match.index });
  }

  return patterns;
}

function detectEdgeCases(source) {
  const edgeCases = [];

  // Look for TODO/FIXME comments that mention edge cases
  const commentPattern = /\/\/\s*(?:TODO|FIXME|HACK):\s*([^\n]+)/g;
  let match;
  while ((match = commentPattern.exec(source)) !== null) {
    edgeCases.push(match[1].trim());
  }

  // Look for boundary conditions in code (e.g., === 0, >= max, <= min)
  const boundaryPattern = /\b(?:===?\s*0\b|>=?\s*(?:MAX|min|max)\b)/g;
  while ((match = boundaryPattern.exec(source)) !== null) {
    edgeCases.push(`boundary: ${match[0].trim()}`);
  }

  return [...new Set(edgeCases)]; // Deduplicate
}

// ── Test Generation ───────────────────────────────────────────────────

function generateJestTests(exports, sourcePath, errorPatterns, edgeCases) {
  const lines = [];
  const moduleName = path.basename(sourcePath, path.extname(sourcePath));

  lines.push(`import { describe, it, expect } from "jest";`);
  if (exports.some((e) => e.type === "function")) {
    lines.push(`const { ${exports.map((e) => e.name).join(", ")} } = require("../src/${moduleName}");`);
  } else {
    lines.push(`const ${moduleName} = require("../src/${moduleName}");`);
  }
  lines.push("");

  for (const exp of exports) {
    if (exp.type === "function") {
      lines.push(`describe("${exp.name}", () => {`);
      lines.push(`  // TODO: Add test cases based on implementation analysis`);
      lines.push("");

      // Happy path template
      const paramList = exp.params.length > 0 ? exp.params.join(", ") : "";
      lines.push(`  it("should handle valid input", async () => {`);
      if (exp.params.length > 0) {
        lines.push(`    // Given: ${exp.params.map((p, i) => `${p}=${i + 1}`).join(", ")}`);
      }
      lines.push(`    // Expect: <define expected behavior>`);
      lines.push(`  });`);
      lines.push("");

      // Error case template if errors detected
      if (errorPatterns.some((p) => p.type === "throw" || p.type === "try-catch")) {
        lines.push(`  it("should throw when invalid input is provided", async () => {`);
        lines.push(`    // TODO: Verify error handling from implementation`);
        lines.push(`  });`);
        lines.push("");
      }

      // Edge case templates
      for (const edgeCase of edgeCases) {
        lines.push(`  it("should handle ${edgeCase.replace(/:/g, "")}", async () => {`);
        lines.push(`    // TODO: Test edge case: ${edgeCase}`);
        lines.push(`  });`);
      }

      lines.push(`});`);
      lines.push("");
    } else if (exp.type === "class") {
      lines.push(`describe("${exp.name}", () => {`);
      lines.push(`  // TODO: Add test cases for class methods and behavior`);
      lines.push(`});`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function generateVitestTests(exports, sourcePath, errorPatterns, edgeCases) {
  const lines = [];
  const moduleName = path.basename(sourcePath, path.extname(sourcePath));

  lines.push(`import { describe, it, expect } from "vitest";`);
  if (exports.some((e) => e.type === "function")) {
    lines.push(`import { ${exports.map((e) => e.name).join(", ")} } from "../src/${moduleName}";`);
  } else {
    lines.push(`import * as ${moduleName} from "../src/${moduleName}";`);
  }
  lines.push("");

  for (const exp of exports) {
    if (exp.type === "function") {
      lines.push(`describe("${exp.name}", () => {`);
      lines.push(`  // TODO: Add test cases based on implementation analysis`);
      lines.push("");
      const paramList = exp.params.length > 0 ? exp.params.join(", ") : "";
      lines.push(`  it("should handle valid input", async () => {`);
      if (exp.params.length > 0) {
        lines.push(`    // Given: ${exp.params.map((p, i) => `${p}=${i + 1}`).join(", ")}`);
      }
      lines.push(`    // Expect: <define expected behavior>`);
      lines.push(`  });`);
      lines.push("");

      if (errorPatterns.some((p) => p.type === "throw" || p.type === "try-catch")) {
        lines.push(`  it("should throw when invalid input is provided", async () => {`);
        lines.push(`    // TODO: Verify error handling from implementation`);
        lines.push(`  });`);
        lines.push("");
      }

      for (const edgeCase of edgeCases) {
        lines.push(`  it("should handle ${edgeCase.replace(/:/g, "")}", async () => {`);
        lines.push(`    // TODO: Test edge case: ${edgeCase}`);
        lines.push(`  });`);
      }

      lines.push(`});`);
      lines.push("");
    } else if (exp.type === "class") {
      lines.push(`describe("${exp.name}", () => {`);
      lines.push(`  // TODO: Add test cases for class methods and behavior`);
      lines.push(`});`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function generateMochaTests(exports, sourcePath, errorPatterns, edgeCases) {
  const lines = [];
  const moduleName = path.basename(sourcePath, path.extname(sourcePath));

  lines.push(`const { describe, it } = require("mocha");`);
  lines.push(`const { expect } = require("chai");`);
  if (exports.some((e) => e.type === "function")) {
    lines.push(`const { ${exports.map((e) => e.name).join(", ")} } = require("../src/${moduleName}");`);
  } else {
    lines.push(`const ${moduleName} = require("../src/${moduleName}");`);
  }
  lines.push("");

  for (const exp of exports) {
    if (exp.type === "function") {
      lines.push(`describe("${exp.name}", () => {`);
      lines.push(`  // TODO: Add test cases based on implementation analysis`);
      lines.push("");
      const paramList = exp.params.length > 0 ? exp.params.join(", ") : "";
      lines.push(`  it("should handle valid input", async () => {`);
      if (exp.params.length > 0) {
        lines.push(`    // Given: ${exp.params.map((p, i) => `${p}=${i + 1}`).join(", ")}`);
      }
      lines.push(`    // Expect: <define expected behavior>`);
      lines.push(`  });`);
      lines.push("");

      if (errorPatterns.some((p) => p.type === "throw" || p.type === "try-catch")) {
        lines.push(`  it("should throw when invalid input is provided", async () => {`);
        lines.push(`    // TODO: Verify error handling from implementation`);
        lines.push(`  });`);
        lines.push("");
      }

      for (const edgeCase of edgeCases) {
        lines.push(`  it("should handle ${edgeCase.replace(/:/g, "")}", async () => {`);
        lines.push(`    // TODO: Test edge case: ${edgeCase}`);
        lines.push(`  });`);
      }

      lines.push(`});`);
      lines.push("");
    } else if (exp.type === "class") {
      lines.push(`describe("${exp.name}", () => {`);
      lines.push(`  // TODO: Add test cases for class methods and behavior`);
      lines.push(`});`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function generatePytestTests(exports, sourcePath) {
  const lines = [];
  const moduleName = path.basename(sourcePath, ".py").replace(/-/g, "_");

  lines.push(`import pytest`);
  if (exports.some((e) => e.type === "function")) {
    lines.push(`from src.${moduleName} import ${", ".join(exports.map((e) => e.name))}`);
  } else {
    lines.push(`from src import ${moduleName}`);
  }
  lines.push("");

  for (const exp of exports) {
    if (exp.type === "function") {
      const paramStr = exp.params.length > 0 ? ", ".join(exp.params) : "";
      lines.push(`def test_${exp.name}_valid_input(${paramStr}):`);
      lines.push(`    # TODO: Add implementation analysis and assertions`);
      lines.push(`    pass`);
      lines.push("");

      lines.push(`def test_${exp.name}_error_handling():`);
      lines.push(`    # TODO: Verify error handling from implementation`);
      lines.push(`    with pytest.raises(Exception):`);
      lines.push(`        ${exp.name}()`);
      lines.push("");
    } else if (exp.type === "class") {
      lines.push(`class Test${exp.name}:`);
      lines.push(`    # TODO: Add test cases for class methods and behavior`);
      lines.push(`    pass`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── File Discovery ────────────────────────────────────────────────────

const SOURCE_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx", ".py"];

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function discoverFiles(targetPath, results = []) {
  const resolved = path.resolve(targetPath);

  if (fs.statSync(resolved).isFile()) {
    if (isSourceFile(resolved)) results.push(resolved);
    return results;
  }

  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    const fullPath = path.join(resolved, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== ".git") {
      discoverFiles(fullPath, results);
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

// ── Test Generation Router ────────────────────────────────────────────

function generateTests(exports, sourcePath, framework, errorPatterns, edgeCases) {
  switch (framework) {
    case "jest":
      return generateJestTests(exports, sourcePath, errorPatterns, edgeCases);
    case "vitest":
      return generateVitestTests(exports, sourcePath, errorPatterns, edgeCases);
    case "mocha":
      return generateMochaTests(exports, sourcePath, errorPatterns, edgeCases);
    case "pytest":
      return generatePytestTests(exports, sourcePath);
    default:
      return generateJestTests(exports, sourcePath, errorPatterns, edgeCases);
  }
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let target = ".";
  let outputDir = "tests/unit/";
  let framework = null; // Auto-detect if null
  let allFiles = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (args[i] === "--framework" && i + 1 < args.length) {
      framework = args[++i].toLowerCase();
    } else if (args[i] === "--all") {
      allFiles = true;
    } else if (!args[i].startsWith("--")) {
      target = args[i];
    }
  }

  // Auto-detect framework from project config
  const cwd = process.cwd();
  if (!framework) {
    framework = detectFramework(cwd);
    console.error(`Auto-detected test framework: ${framework}`);
  }

  // Discover source files
  const files = discoverFiles(target);
  if (files.length === 0) {
    console.error(`No source files found in "${path.resolve(target)}"`);
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate tests for each file
  let generated = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf-8");
    const exports = extractExports(source, file);

    if (exports.length === 0) continue;

    const errorPatterns = detectErrorPatterns(source);
    const edgeCases = detectEdgeCases(source);

    // Determine output filename
    const relPath = path.relative(cwd, file);
    const testFileName = `test_${path.basename(file)}.test.js`;
    const outputPath = allFiles ? path.join(outputDir, testFileName) : path.join(outputDir, path.basename(file).replace(/\.[^.]+$/, ".test.js"));

    // Generate and write test stub
    const testContent = generateTests(exports, file, framework, errorPatterns, edgeCases);
    fs.writeFileSync(outputPath, testContent);
    console.error(`Generated: ${outputPath}`);
    generated++;
  }

  console.log(JSON.stringify({ generated, files: files.length, framework }, null, 2));
}

main();
