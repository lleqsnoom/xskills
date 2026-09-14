"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "x-skill-lint", "scripts", "lint.mjs");
const MOD = pathToFileURL(SCRIPT).href;

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

const GOOD_SKILL = `---
name: x-good
description: A well-formed skill
version: 1.0.0
---

# Good

Run \`node <skill>/scripts/run.mjs\` and read \`references/notes.md\`.
`;

function makeRepo({ withBad }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-skill-lint-"));
  const good = path.join(root, "skills", "x-good");
  fs.mkdirSync(path.join(good, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(good, "references"), { recursive: true });
  fs.writeFileSync(path.join(good, "SKILL.md"), GOOD_SKILL);
  fs.writeFileSync(path.join(good, "scripts", "run.mjs"), "// runner\n");
  fs.writeFileSync(path.join(good, "references", "notes.md"), "notes\n");

  let readme = "# Repo\n\n| Skill | Description |\n|-------|-------------|\n| `x-good` | A well-formed skill |\n";

  if (withBad) {
    const bad = path.join(root, "skills", "x-bad-name");
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(
      path.join(bad, "SKILL.md"),
      `---\nname: x-wrong-name\ndescription: Broken\n---\n\nRun \`scripts/missing.mjs\`.\n\n</gate>\n`,
    );
    // x-bad-name intentionally omitted from the README table
  }

  fs.writeFileSync(path.join(root, "README.md"), readme);
  return root;
}

describe("x-skill-lint lintRepo", async () => {
  const mod = await import(MOD);

  it("passes a well-formed skill set", () => {
    const root = makeRepo({ withBad: false });
    try {
      const res = mod.lintRepo(root);
      assert.equal(res.skills, 1);
      assert.deepEqual(res.violations, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags name mismatch, missing ref, stray token and README gaps", () => {
    const root = makeRepo({ withBad: true });
    try {
      const rules = mod.lintRepo(root).violations.filter((v) => v.skill === "x-bad-name").map((v) => v.rule).sort();
      assert.deepEqual(rules, ["missing-ref", "name-mismatch", "readme", "stray-token"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("x-skill-lint CLI", () => {
  it("exits 0 on a clean repo root", async () => {
    const root = makeRepo({ withBad: false });
    try {
      const res = await runCli(["--root", root]);
      assert.equal(res.code, 0);
      assert.deepEqual(JSON.parse(res.stdout).violations, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 1 when a violation exists", async () => {
    const root = makeRepo({ withBad: true });
    try {
      const res = await runCli(["--root", root]);
      assert.equal(res.code, 1);
      assert.ok(JSON.parse(res.stdout).violations.length > 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 2 on an unknown flag", async () => {
    const res = await runCli(["--nope"]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /Unknown argument/);
  });
});

// ── standalone-script rules ──────────────────────────────────────────

describe("x-skill-lint — standalone scripts", async () => {
  const mod = await import(MOD);

  it("flags an import that reaches into another skill", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-skill-lint-import-"));
    const a = path.join(root, "skills", "x-alpha", "scripts");
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(root, "skills", "x-alpha", "SKILL.md"), "---\nname: x-alpha\ndescription: d\n---\n");
    fs.writeFileSync(path.join(a, "run.mjs"), "import { x } from '../../x-beta/scripts/util.mjs';\n");
    fs.writeFileSync(path.join(root, "README.md"), "| `x-alpha` | d |\n");

    const result = mod.lintRepo(root);
    assert.ok(result.violations.some((v) => v.rule === "cross-skill-import" && v.skill === "x-alpha"));

    const res = await runCli(["--root", root]);
    assert.equal(res.code, 1);
  });

  it("flags copy drift between shared scripts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-skill-lint-drift-"));
    for (const [name, body] of [["x-one", "one\n"], ["x-two", "two\n"]]) {
      const scripts = path.join(root, "skills", name, "scripts");
      fs.mkdirSync(scripts, { recursive: true });
      fs.writeFileSync(path.join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
      fs.writeFileSync(path.join(scripts, "check-questions.mjs"), body);
    }
    fs.writeFileSync(path.join(root, "README.md"), "| `x-one` | d |\n| `x-two` | d |\n");

    const result = mod.lintRepo(root);
    assert.ok(result.violations.some((v) => v.rule === "copy-drift"));
  });

  it("stays clean on the real repo", async () => {
    const res = await runCli([]);
    assert.equal(res.code, 0, res.stderr);
  });
});
