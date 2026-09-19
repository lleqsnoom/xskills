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
    fs.mkdirSync(path.join(bad, "scripts", ".x-skills", "debug"), { recursive: true });
    fs.writeFileSync(path.join(bad, "scripts", ".x-skills", "debug", "report.md"), "# Debug\n");
    fs.writeFileSync(
      path.join(bad, "SKILL.md"),
      `---\nname: x-wrong-name\ndescription: Broken\n---\n\nRun \`scripts/missing.mjs\`.\n\nFollow the order in \`.agents/rules/xskills.md\`.\n\n</gate>\n`,
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

  it("flags name mismatch, missing ref, repo-only ref, stray run folder, stray token and README gaps", () => {
    const root = makeRepo({ withBad: true });
    try {
      const rules = mod.lintRepo(root).violations.filter((v) => v.skill === "x-bad-name").map((v) => v.rule).sort();
      assert.deepEqual(rules, [
        "missing-ref",
        "name-mismatch",
        "readme",
        "repo-only-ref",
        "stray-run-folder",
        "stray-token",
      ]);
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

  it("flags copy drift between shared references", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-skill-lint-ref-drift-"));
    for (const [name, body] of [["x-one", "one\n"], ["x-two", "two\n"]]) {
      const references = path.join(root, "skills", name, "references");
      fs.mkdirSync(references, { recursive: true });
      fs.writeFileSync(path.join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
      fs.writeFileSync(path.join(references, "questions.md"), body);
    }
    fs.writeFileSync(path.join(root, "README.md"), "| `x-one` | d |\n| `x-two` | d |\n");

    const result = mod.lintRepo(root);
    assert.ok(
      result.violations.some((v) => v.rule === "copy-drift" && v.file === "references/questions.md"),
    );
  });

  it("flags a main guard that a symlinked install never passes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-skill-lint-guard-"));
    try {
      const guards = {
        "x-fragile": 'if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {\n  main();\n}\n',
        "x-sturdy": 'if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {\n  main();\n}\n',
      };
      for (const [name, guard] of Object.entries(guards)) {
        const scripts = path.join(root, "skills", name, "scripts");
        fs.mkdirSync(scripts, { recursive: true });
        fs.writeFileSync(path.join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
        fs.writeFileSync(path.join(scripts, "run.mjs"), guard);
      }
      fs.writeFileSync(path.join(root, "README.md"), "| `x-fragile` | d |\n| `x-sturdy` | d |\n");
      const hits = mod.lintRepo(root).violations.filter((v) => v.rule === "fragile-main-guard");
      assert.deepEqual(hits.map((v) => [v.skill, v.file]), [["x-fragile", "scripts/run.mjs"]]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks a skill's expectations file only when it has one", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-skill-lint-expect-"));
    try {
      const make = (name, expectations) => {
        fs.mkdirSync(path.join(root, "skills", name, "evals"), { recursive: true });
        fs.writeFileSync(path.join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
        if (expectations !== undefined) fs.writeFileSync(path.join(root, "skills", name, "evals", "expectations.json"), expectations);
      };
      make("x-none");
      make("x-good", JSON.stringify({ skill: "x-good", expected_behavior: ["reads every named input, or says which it could not"], source: ["F3"] }));
      make("x-wrong", JSON.stringify({ skill: "x-other", expected_behavior: [], source: "F1" }));
      make("x-broken", "{ not json");
      fs.writeFileSync(path.join(root, "README.md"), "| `x-none` | d |\n| `x-good` | d |\n| `x-wrong` | d |\n| `x-broken` | d |\n");
      const hits = mod.lintRepo(root).violations.filter((v) => v.rule === "expectations-shape");
      assert.deepEqual([...new Set(hits.map((v) => v.skill))].sort(), ["x-broken", "x-wrong"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks a skill's triggers file only when it has one", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-skill-lint-triggers-"));
    try {
      const make = (name, triggers) => {
        fs.mkdirSync(path.join(root, "skills", name, "evals"), { recursive: true });
        fs.writeFileSync(path.join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
        if (triggers !== undefined) fs.writeFileSync(path.join(root, "skills", name, "evals", "triggers.json"), triggers);
      };
      const queries = (positives, negatives) =>
        JSON.stringify({
          skill: "x-good",
          queries: [
            ...Array.from({ length: positives }, (_, i) => ({ query: `positive ${i}`, should_trigger: true })),
            ...Array.from({ length: negatives }, (_, i) => ({ query: `negative ${i}`, should_trigger: false })),
          ],
        });
      make("x-none");
      make("x-good", queries(4, 4));
      make("x-thin", JSON.stringify({ skill: "x-thin", queries: [{ query: "only one", should_trigger: true }] }));
      make("x-misnamed", queries(4, 4).replace('"x-good"', '"x-other"'));
      fs.writeFileSync(path.join(root, "README.md"), "| `x-none` | d |\n| `x-good` | d |\n| `x-thin` | d |\n| `x-misnamed` | d |\n");
      const hits = mod.lintRepo(root).violations.filter((v) => v.rule === "triggers-shape");
      assert.deepEqual([...new Set(hits.map((v) => v.skill))].sort(), ["x-misnamed", "x-thin"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stays clean on the real repo", async () => {    const res = await runCli([]);
    assert.equal(res.code, 0, res.stderr);
  });
});

describe("a skill script launched through a symlinked install", () => {
  function runNode(file, args = []) {
    return new Promise((resolve, reject) => {
      const child = spawn("node", [file, ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (c) => (stdout += c.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout: stdout.trim() }));
    });
  }

  function linkedInstall(target) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-skill-link-"));
    const link = path.join(dir, "skills");
    fs.symlinkSync(target, link);
    return { dir, link };
  }

  it("runs main() with the realpath guard, and silently does nothing with the old one", async () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "x-skill-real-"));
    const { dir, link } = linkedInstall(real);
    try {
      const head = 'import fs from "node:fs";\nimport { pathToFileURL } from "node:url";\n';
      fs.writeFileSync(path.join(real, "old.mjs"), `${head}if (import.meta.url === pathToFileURL(process.argv[1] || "").href) console.log("ran");\n`);
      fs.writeFileSync(
        path.join(real, "new.mjs"),
        `${head}if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) console.log("ran");\n`,
      );
      assert.deepEqual(await runNode(path.join(link, "old.mjs")), { code: 0, stdout: "" }, "the bug: exit 0, no output");
      assert.deepEqual(await runNode(path.join(link, "new.mjs")), { code: 0, stdout: "ran" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  it("prints help for the repo's own scripts when reached through a symlink", async () => {
    const { dir, link } = linkedInstall(path.join(__dirname, "..", "skills"));
    try {
      for (const script of ["x-autoreflection/scripts/read-session.mjs", "x-autoreflection/scripts/scan-session.mjs", "x-research/scripts/state.mjs"]) {
        const res = await runNode(path.join(link, script), ["--help"]);
        assert.notEqual(res.stdout, "", `${script} printed nothing through the symlink`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
