"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const HYPOTHESIZE_SCRIPT = path.join(
  __dirname,
  "..",
  "skills",
  "x-investigate",
  "scripts",
  "hypothesize.js"
);

/**
 * Run hypothesize.js with the given arguments and return { code, stdout, stderr }.
 */
function runHypothesize(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [HYPOTHESIZE_SCRIPT, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

/**
 * Helper to parse JSON output and return the parsed value.
 */
function parseOutput(result) {
  assert.equal(result.code, 0, `Expected exit code 0, got ${result.code}. stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  return parsed;
}

// ── Happy path: known patterns ─────────────────────────────────────

describe("hypothesize.js — null-reference pattern", () => {
  it("matches 'Cannot read property' of undefined", async () => {
    const res = await runHypothesize(["--error", "Cannot read property 'foo' of undefined"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    assert.equal(results[0].id, "null-reference", `Expected null-reference at rank 1, got ${results[0]?.id}`);
    assert.equal(results[0].likelihood, "high");
  });

  it("matches 'Cannot read properties' (plural) of undefined", async () => {
    const res = await runHypothesize(["--error", "Cannot read properties 'bar' of null"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    assert.equal(results[0].id, "null-reference");
  });

  it("includes description and test fields for null-reference", async () => {
    const res = await runHypothesize(["--error", "Cannot read property 'x' of undefined"]);
    const results = parseOutput(res);
    assert.ok(results[0].description, "Expected non-empty description");
    assert.ok(results[0].test, "Expected non-null test field");
  });

  it("includes rank field starting at 1", async () => {
    const res = await runHypothesize(["--error", "Cannot read property 'x' of undefined"]);
    const results = parseOutput(res);
    assert.equal(results[0].rank, 1);
  });

  it("outputs valid JSON", async () => {
    const res = await runHypothesize(["--error", "Cannot read property 'foo' of undefined"]);
    // Should not throw
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed), "Expected array output");
  });
});

describe("hypothesize.js — not-a-function pattern", () => {
  it("matches 'is not a function'", async () => {
    const res = await runHypothesize(["--error", "TypeError: foo is not a function"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    // null-reference also matches (because 'foo' is in the text as 'foo is') - check both
    const ids = results.map((r) => r.id);
    assert.ok(ids.includes("not-a-function"), `Expected not-a-function in ${ids}`);
  });

  it("places not-a-function at rank 1 when only it matches", async () => {
    const res = await runHypothesize(["--error", "TypeError: bar is not a function"]);
    const results = parseOutput(res);
    assert.ok(results.length >= 1, "Expected at least one hypothesis");
    // With fixed matching, only not-a-function should match this text
    const funcIdx = results.findIndex((r) => r.id === "not-a-function");
    assert.equal(funcIdx, 0, "Expected not-a-function as the first/only match");
  });
});

describe("hypothesize.js — infinite-recursion pattern", () => {
  it("matches 'Maximum call stack size exceeded'", async () => {
    const res = await runHypothesize(["--error", "RangeError: Maximum call stack size exceeded"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    assert.equal(results[0].id, "infinite-recursion");
  });

  it("includes appropriate test guidance for infinite recursion", async () => {
    const res = await runHypothesize(["--error", "Maximum call stack size exceeded"]);
    const results = parseOutput(res);
    assert.ok(results[0].test.includes("depth") || results[0].test.includes("recursive"),
      `Expected test guidance about recursion depth, got: ${results[0].test}`);
  });
});

describe("hypothesize.js — connection-error pattern", () => {
  it("matches 'ECONNREFUSED'", async () => {
    const res = await runHypothesize(["--error", "Error: connect ECONNREFUSED 127.0.0.1:3000"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    assert.equal(results[0].id, "connection-error");
  });

  it("matches 'Connection refused'", async () => {
    const res = await runHypothesize(["--error", "Error: Connection refused"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    assert.equal(results[0].id, "connection-error");
  });

  it("includes appropriate test guidance for connection errors", async () => {
    const res = await runHypothesize(["--error", "ECONNREFUSED"]);
    const results = parseOutput(res);
    assert.ok(results[0].test.includes("nc") || results[0].test.includes("host"),
      `Expected test guidance about checking host/port, got: ${results[0].test}`);
  });
});

describe("hypothesize.js — missing-module pattern", () => {
  it("matches 'Module not found'", async () => {
    const res = await runHypothesize(["--error", "Error: Module not found: can't resolve 'lodash'"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    assert.equal(results[0].id, "missing-module");
  });

  it("matches 'Cannot find module'", async () => {
    const res = await runHypothesize(["--error", "Error: Cannot find module 'express'"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    assert.equal(results[0].id, "missing-module");
  });

  it("includes appropriate test guidance for missing modules", async () => {
    const res = await runHypothesize(["--error", "Module not found"]);
    const results = parseOutput(res);
    assert.ok(results[0].test.includes("require") || results[0].test.includes("package.json"),
      `Expected test guidance about checking module, got: ${results[0].test}`);
  });
});

describe("hypothesize.js — syntax-error pattern", () => {
  it("matches 'SyntaxError'", async () => {
    const res = await runHypothesize(["--error", "SyntaxError: Unexpected token in JSON"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    assert.equal(results[0].id, "syntax-error");
  });

  it("matches 'Unexpected token'", async () => {
    const res = await runHypothesize(["--error", "SyntaxError: Unexpected token ';'"]);
    const results = parseOutput(res);
    assert.ok(results.length > 0, "Expected at least one hypothesis");
    assert.equal(results[0].id, "syntax-error");
  });

  it("includes appropriate test guidance for syntax errors", async () => {
    const res = await runHypothesize(["--error", "SyntaxError"]);
    const results = parseOutput(res);
    assert.ok(results[0].test.includes("node -c") || results[0].test.includes("syntax"),
      `Expected test guidance about syntax check, got: ${results[0].test}`);
  });
});

// ── Error paths ────────────────────────────────────────────────────

describe("hypothesize.js — unknown patterns", () => {
  it("returns empty array for unrecognized error text (does not crash)", async () => {
    const res = await runHypothesize(["--error", "Something completely unrelated happened"]);
    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed), "Expected array output");
    // Should be empty or contain no matches for this text
    // The script returns whatever patterns match; unknown text should yield []
    assert.equal(parsed.length, 0, `Expected empty array, got ${JSON.stringify(parsed)}`);
  });

  it("treats empty error string same as no --error flag", async () => {
    const res = await runHypothesize(["--error", ""]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Usage:/i);
  });

  it("returns empty array for generic Error message", async () => {
    const res = await runHypothesize(["--error", "Error: something went wrong"]);
    const parsed = JSON.parse(res.stdout);
    // Generic errors shouldn't match any specific pattern
    assert.equal(parsed.length, 0);
  });
});

describe("hypothesize.js — no --error flag", () => {
  it("exits with code 1 when called without arguments", async () => {
    const res = await runHypothesize([]);
    assert.equal(res.code, 1);
  });

  it("prints usage message to stderr", async () => {
    const res = await runHypothesize([]);
    assert.match(res.stderr, /Usage:/i);
  });

  it("does not produce JSON output on error", async () => {
    const res = await runHypothesize([]);
    // stdout should be empty or contain a usage message (not JSON)
    if (res.stdout.trim()) {
      assert.throws(() => JSON.parse(res.stdout), "Expected non-JSON output");
    }
  });
});

// ── Output structure validation ────────────────────────────────────

describe("hypothesize.js — output structure", () => {
  it("each hypothesis has required fields: rank, id, description, test, likelihood", async () => {
    const res = await runHypothesize(["--error", "Cannot read property 'x' of undefined"]);
    const results = parseOutput(res);
    for (const h of results) {
      assert.ok(typeof h.rank === "number" && h.rank > 0, `Expected positive rank number`);
      assert.ok(typeof h.id === "string" && h.id.length > 0, `Expected non-empty id string`);
      assert.ok(typeof h.description === "string" && h.description.length > 0, `Expected non-empty description`);
      assert.ok(h.test !== null && typeof h.test === "string", `Expected non-null test string`);
      assert.ok(["high", "medium", "low"].includes(h.likelihood), `Expected high/medium/low likelihood, got: ${h.likelihood}`);
    }
  });

  it("preserves ranking order (rank increments by 1)", async () => {
    const res = await runHypothesize(["--error", "Cannot read property 'x' of undefined"]);
    const results = parseOutput(res);
    for (let i = 0; i < results.length; i++) {
      assert.equal(results[i].rank, i + 1, `Expected rank ${i + 1} at index ${i}`);
    }
  });

  it("handles --context flag without error", async () => {
    const res = await runHypothesize(["--error", "Cannot read property 'x' of undefined", "--context", "/tmp"]);
    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed), "Expected array output with --context flag");
  });

  it("handles error text with special characters gracefully", async () => {
    const res = await runHypothesize(["--error", "Error: <div> is not a function & causes issues"]);
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed), "Expected array output");
  });
});
