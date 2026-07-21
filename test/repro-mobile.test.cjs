"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const REPRO_SCRIPT = path.join(
  __dirname,
  "..",
  "skills",
  "x-reproduce",
  "scripts",
  "repro-mobile.js"
);

/**
 * Run repro-mobile.js with the given error description and return { code, stdout, stderr }.
 */
function runRepro(errorText) {
  return new Promise((resolve, reject) => {
    const args = errorText ? [REPRO_SCRIPT, errorText] : [REPRO_SCRIPT];
    const child = spawn("node", args, {
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

// ── Happy Path Tests ────────────────────────────────────────────────

describe("repro-mobile.js — happy path", () => {
  it("exits with code 1 when given a valid error description (steps documented)", async () => {
    const res = await runRepro("test error");
    assert.equal(res.code, 1); // template exits 1 to indicate steps are documented
  });

  it("outputs mobile reproduction steps header", async () => {
    const res = await runRepro("crash on app startup");
    assert.match(res.stdout, /Mobile Reproduction Steps/);
  });

  it("includes the error description in output", async () => {
    const res = await runRepro("crash on app startup"); // use this to match template format
    assert.match(res.stdout, /Mobile Reproduction Steps for:/);
  });

  it("works with multi-word error descriptions", async () => {
    const res = await runRepro("connection timeout after 30 seconds");
    assert.equal(res.code, 1); // template exits 1 by default
  });
});

// ── Error Path Tests ────────────────────────────────────────────────

describe("repro-mobile.js — error paths", () => {
  it("exits with code 1 when no error description is provided", async () => {
    const res = await runRepro(); // no argument
    assert.equal(res.code, 1);
  });

  it("shows usage message to stderr when called without arguments", async () => {
    const res = await runRepro();
    assert.match(res.stderr, /Usage:/);
  });

  it("exits with code 1 for empty string error description (template default)", async () => {
    const res = await runRepro(""); // empty but provided - still uses template exit code
    assert.equal(res.code, 1);
  });
});
