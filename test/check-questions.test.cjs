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
**Panel:** single
**Options:** Postgres | SQLite | Redis

## Q2: Which non-functional requirements matter?
**Why:** this sets the scope of the work.
**Panel:** multi
**Options:** performance | security | cost

## Q3: What is the peak request rate?
**Why:** this sets the sizing target.
**Panel:** open

## Q4: Should we keep the legacy endpoint?
**Why:** this decides the migration path.
**Panel:** confirm
`;

describe("check-questions", () => {
  let cwd;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "check-questions-"));
  });

  it("passes a well-formed file with all four panels", async () => {
    const res = await run(["--file", write(cwd, "questions.md", GOOD)]);
    assert.equal(res.code, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.questions, 4);
    assert.deepEqual(out.violations, []);
  });

  it("flags an over-long question", async () => {
    const text = `## Q1: Which of the many possible database backends should this specific application really use here given the expected heavy write traffic plus the long term reporting needs?\n**Why:** decides schema.\n**Panel:** single\n**Options:** a | b\n`;
    const res = await run(["--file", write(cwd, "q.md", text)]);
    assert.equal(res.code, 1);
    assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "too-long"));
  });

  it("flags a counting panel with fewer than two options", async () => {
    const text = `## Q1: Which database?\n**Why:** decides schema.\n**Panel:** single\n**Options:** Postgres\n`;
    const res = await run(["--file", write(cwd, "q.md", text)]);
    assert.equal(res.code, 1);
    assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "no-options"));
  });

  it("flags a multi-idea question", async () => {
    const text = `## Q1: Which database and which cache?\n**Why:** decides stack.\n**Panel:** single\n**Options:** a | b\n`;
    const res = await run(["--file", write(cwd, "q.md", text)]);
    assert.equal(res.code, 1);
    assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "multi-idea"));
  });

  it("flags a question with no panel", async () => {
    const text = `## Q1: Which database?\n**Why:** decides schema.\n`;
    const res = await run(["--file", write(cwd, "q.md", text)]);
    assert.equal(res.code, 1);
    assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "no-panel"));
  });

  it("flags an unknown panel name", async () => {
    const text = `## Q1: Which database?\n**Why:** decides schema.\n**Panel:** dropdown\n`;
    const res = await run(["--file", write(cwd, "q.md", text)]);
    assert.equal(res.code, 1);
    assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "bad-panel"));
  });

  it("flags options on a panel that cannot take them", async () => {
    const text = `## Q1: Should we ship today?\n**Why:** decides the release.\n**Panel:** confirm\n**Options:** yes | no\n`;
    const res = await run(["--file", write(cwd, "q.md", text)]);
    assert.equal(res.code, 1);
    assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "unexpected-options"));
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