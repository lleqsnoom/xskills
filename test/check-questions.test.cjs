"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LINTER = path.join(__dirname, "..", "skills", "x-plan", "scripts", "check-questions.mjs");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [LINTER, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function write(dir, name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

const GOOD = `## Q1: Which database stores sessions?
**Why:** this decides the schema and the migration.
**Examples:** Postgres | SQLite | Redis

## Q2: How many users per day?
**Why:** this sets the sizing target.
**Examples:** under 100 | 1000 | 10000
`;

describe("check-questions", () => {
  let cwd;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "check-questions-"));
  });

  it("passes a well-formed file", async () => {
    const res = await run(["--file", write(cwd, "questions.md", GOOD)]);
    assert.equal(res.code, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.questions, 2);
    assert.deepEqual(out.violations, []);
  });

  it("flags an over-long question", async () => {
    const text = `## Q1: Which of the many possible database backends should this specific application really use here given the expected heavy write traffic plus the long term reporting needs?\n**Why:** decides schema.\n**Examples:** a | b\n`;
    const res = await run(["--file", write(cwd, "q.md", text)]);
    assert.equal(res.code, 1);
    assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "too-long"));
  });

  it("flags a missing example pair", async () => {
    const text = `## Q1: Which database?\n**Why:** decides schema.\n**Examples:** Postgres\n`;
    const res = await run(["--file", write(cwd, "q.md", text)]);
    assert.equal(res.code, 1);
    assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "no-examples"));
  });

  it("flags a multi-idea question", async () => {
    const text = `## Q1: Which database and which cache?\n**Why:** decides stack.\n**Examples:** a | b\n`;
    const res = await run(["--file", write(cwd, "q.md", text)]);
    assert.equal(res.code, 1);
    assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "multi-idea"));
  });

  it("reads questions.md from a run directory", async () => {
    write(cwd, "questions.md", GOOD);
    const res = await run(["--dir", cwd]);
    assert.equal(res.code, 0, res.stderr);
  });

  it("exits 2 on a missing file", async () => {
    const res = await run(["--file", path.join(cwd, "nope.md")]);
    assert.equal(res.code, 2);
  });
});