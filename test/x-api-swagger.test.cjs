"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCRIPT = path.join(__dirname, "..", "skills", "x-api-swagger", "scripts", "save-spec.js");

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCRIPT, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd || process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

describe("x-api-swagger save-spec.js", () => {
  it("writes an OpenAPI YAML spec file and prints its absolute path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-api-swagger-"));
    try {
      const res = await run(["--topic", "auth"], dir);
      assert.equal(res.code, 0);
      assert.ok(path.isAbsolute(res.stdout), "stdout should be an absolute path");
      assert.ok(path.basename(res.stdout).endsWith("-api-spec.yaml"), "filename should be E<nn>-api-spec.yaml");
      assert.match(res.stdout, /\.x-skills\/runs\/[^/]+-auth\/E\d{2}-api-spec\.yaml$/);
      assert.ok(fs.existsSync(res.stdout), "spec file should exist");
      const content = fs.readFileSync(res.stdout, "utf8");
      assert.match(content, /# OpenAPI — auth/);
      assert.match(content, /Draft — awaiting user approval/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 without --topic and keeps stdout empty", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-api-swagger-"));
    try {
      const res = await run([], dir);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /Usage:/);
      assert.equal(res.stdout, "");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
