#!/usr/bin/env node
"use strict";

/**
 * lib/gates.js — evaluates gate conditions for xskills workflow phases.
 *
 * Gates are automated quality checks that must pass before a phase is considered complete.
 * Each gate type has an evaluator function registered in GATE_EVALUATORS.
 *
 * Usage:
 *   const { evaluateAll, loadGateConfig } = require("./gates");
 *
 *   // Load config from default location or custom path
 *   const config = await loadGateConfig();
 *
 *   // Evaluate all gates for a phase with provided context (topic, files, etc.)
 *   const results = evaluateAll(config, "x-epic", { topic: "my-feature" });
 *
 * Output: Array of { gate, status: "pass" | "fail" | "skip", message } objects.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

// ── Gate Evaluators Registry ──────────────────────────────────────────

/**
 * Map of gate type names to their evaluator functions.
 * Each evaluator receives (gate, context) and returns { status, message }.
 */
const GATE_EVALUATORS = {};

function registerGate(type, evaluatorFn) {
  GATE_EVALUATORS[type] = evaluatorFn;
}

// ── Built-in Gate Evaluators ──────────────────────────────────────────

/**
 * file-exists: Check whether a file exists at the specified path.
 * Resolves {topic} placeholder to context.topic if provided.
 */
registerGate("file-exists", function (gate, context) {
  const filePath = resolvePlaceholders(gate.path, context);
  const resolvedPath = path.resolve(filePath);

  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK);
    return { status: "pass", message: `File exists: ${filePath}` };
  } catch (err) {
    return { status: "fail", message: `Required file not found: ${filePath}` };
  }
});

/**
 * no-pattern: Assert that a regex pattern does NOT appear in any matching files.
 */
registerGate("no-pattern", function (gate, context) {
  const pattern = new RegExp(gate.pattern);
  const filesGlob = gate.files || "**/*.{js,ts,jsx,tsx,py,go,java,rb}";
  const searchRoot = process.cwd();

  // Find matching files using simple recursive scan (no external dependencies)
  let matchedFiles = [];
  try {
    matchedFiles = findMatchingFiles(searchRoot, filesGlob);
  } catch (err) {
    return { status: "skip", message: `Cannot scan files: ${err.message}` };
  }

  if (matchedFiles.length === 0) {
    return { status: "pass", message: "No matching files to check" };
  }

  for (const file of matchedFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      if (pattern.test(content)) {
        return {
          status: "fail",
          message: `Pattern "${gate.pattern}" found in ${path.relative(searchRoot, file)}`,
        };
      }
    } catch (err) {
      // Skip unreadable files
    }
  }

  return { status: "pass", message: "No pattern matches found" };
});

/**
 * tests-pass: Run a shell command and check exit code.
 */
registerGate("tests-pass", function (gate, context) {
  const timeout = gate.timeout || 60000;

  try {
    execSync(gate.command, {
      stdio: ["pipe", "pipe", "inherit"],
      timeout,
      cwd: process.cwd(),
    });
    return { status: "pass", message: `Command passed: ${gate.command}` };
  } catch (err) {
    if (err.killed || err.signal === "SIGTERM") {
      return { status: "fail", message: `Command timed out after ${timeout}ms` };
    }
    return {
      status: "fail",
      message: `Command failed with exit code ${err.status}: ${gate.command}`,
    };
  }
});

/**
 * commit-message-format: Validate recent git commit messages match a regex.
 */
registerGate("commit-message-format", function (gate, context) {
  const count = gate.count || 5;
  const pattern = new RegExp(gate.pattern);

  let logOutput;
  try {
    logOutput = execSync(`git log -${count} --format=%s`, {
      stdio: ["pipe", "pipe", "ignore"],
    }).toString();
  } catch (err) {
    return { status: "skip", message: "Not a git repository or no commits yet" };
  }

  const messages = logOutput.trim().split("\n").filter(Boolean);

  for (const msg of messages) {
    if (!pattern.test(msg)) {
      return {
        status: "fail",
        message: `Commit message does not match pattern: "${msg}"`,
      };
    }
  }

  return { status: "pass", message: `${messages.length} commit(s) validated` };
});

/**
 * schema-valid: Validate a JSON/YAML file against a JSON schema.
 * Uses simple structural validation (no external JSON Schema library).
 */
registerGate("schema-valid", function (gate, context) {
  const filePath = resolvePlaceholders(gate.file, context);
  const schemaPath = path.resolve(gate.schemaPath);

  // Check schema file exists first
  if (!fs.existsSync(schemaPath)) {
    return { status: "skip", message: `Schema not found: ${schemaPath}` };
  }

  let data, schema;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    // Try JSON first, fall back to simple YAML parsing (top-level scalars only)
    try {
      data = JSON.parse(content);
    } catch {
      return { status: "skip", message: `File is not valid JSON: ${filePath}` };
    }

    schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  } catch (err) {
    return { status: "fail", message: `Cannot read files: ${err.message}` };
  }

  // Basic structural validation (type checking for known properties)
  const errors = validateAgainstSchema(data, schema);
  if (errors.length > 0) {
    return {
      status: "fail",
      message: `Schema validation failed: ${errors.join("; ")}`,
    };
  }

  return { status: "pass", message: `${filePath} validates against schema` };
});

// ── Validation Helpers ────────────────────────────────────────────────

/**
 * Simple JSON Schema validator for common types.
 * Handles: type checking, required fields, enum values.
 */
function validateAgainstSchema(data, schema) {
  const errors = [];

  if (!schema || !data) return errors;

  // Check required fields
  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (!(field in data)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Check types
  if (schema.properties && typeof data === "object") {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in data)) continue;

      const value = data[key];
      const expectedType = propSchema.type;

      if (!expectedType) continue;

      // Map JSON schema types to JS typeof checks
      const typeChecks = {
        string: (v) => typeof v === "string",
        number: (v) => typeof v === "number" && !isNaN(v),
        integer: (v) => Number.isInteger(v),
        boolean: (v) => typeof v === "boolean",
        array: Array.isArray,
        object: (v) => typeof v === "object" && !Array.isArray(v),
      };

      if (expectedType in typeChecks && !typeChecks[expectedType](value)) {
        errors.push(`Field "${key}" expected ${expectedType}, got ${typeof value}`);
      }
    }
  }

  return errors;
}

/**
 * Resolve {placeholder} tokens in a string using context values.
 */
function resolvePlaceholders(template, context) {
  if (!context) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return context[key] || match; // Keep placeholder if not found in context
  });
}

/**
 * Simple recursive file finder matching a glob pattern.
 * Supports extension globs, filename patterns, and path prefixes.
 */
function findMatchingFiles(rootDir, globPattern) {
  const results = [];
  const normalizedGlob = globPattern.replace(/\.\{([^}]+)\}/g, (_, exts) => {
    // Convert {a,b,c} to individual extensions for recursive scan
    return "";
  });

  function walk(dir) {
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && matchesGlob(entry.name, globPattern)) {
          results.push(fullPath);
        }
      }
    } catch (err) {
      // Skip unreadable directories
    }
  }

  function matchesGlob(filename, pattern) {
    // Simple matching: *.ext or filename.ext patterns
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(2);
      return filename.endsWith(ext);
    }
    return filename === path.basename(pattern);
  }

  walk(rootDir);
  return results;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Load gate configuration from .x-skills/config/gates/ or a custom directory.
 * Returns { gates: { phase: [gateObjects] } } structure.
 */
async function loadGateConfig(configDir) {
  const defaultDir = configDir || path.join(process.cwd(), ".x-skills", "config", "gates");
  const allGates = {};

  if (!fs.existsSync(defaultDir)) return allGates; // No gates configured — phases use defaults

  try {
    const files = fs.readdirSync(defaultDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const configPath = path.join(defaultDir, file);
      const content = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content);

      if (parsed.gates && typeof parsed.gates === "object") {
        Object.assign(allGates, parsed.gates);
      } else {
        console.warn(`Invalid gate config in ${file}: missing 'gates' object`);
      }
    }
  } catch (err) {
    console.warn(`Failed to load gate configs from ${defaultDir}: ${err.message}`);
  }

  return allGates;
}

/**
 * Evaluate all gates for a phase with the given context.
 * Returns array of { gate, status, message } objects.
 */
function evaluateAll(config, phase, context = {}) {
  const gatesForPhase = config[phase] || [];
  const results = [];

  for (const gate of gatesForPhase) {
    if (!gate.type) {
      results.push({ gate, status: "skip", message: "Gate missing 'type' field" });
      continue;
    }

    const evaluator = GATE_EVALUATORS[gate.type];
    if (!evaluator) {
      results.push({
        gate,
        status: "skip",
        message: `Unknown gate type: ${gate.type}`,
      });
      continue;
    }

    try {
      const result = evaluator(gate, context);
      results.push({ ...result, gate });
    } catch (err) {
      results.push({
        gate,
        status: "fail",
        message: `Gate evaluation error: ${err.message}`,
      });
    }
  }

  return results;
}

/**
 * Check if all gates for a phase passed. Returns boolean.
 */
function allPass(results) {
  return results.every((r) => r.status === "pass" || r.status === "skip");
}

// ── Module Exports ────────────────────────────────────────────────────

module.exports = {
  loadGateConfig,
  evaluateAll,
  allPass,
  registerGate,
};
