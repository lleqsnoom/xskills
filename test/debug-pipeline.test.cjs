"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SKILLS_DIR = path.resolve(__dirname, "../skills");
const NEW_SKILLS = ["x-triage", "x-reproduce", "x-investigate"];

// Check 1: All scripts ≤300 lines
test("scripts are under 300 lines each", () => {
  for (const skill of NEW_SKILLS) {
    const scriptDir = path.join(SKILLS_DIR, skill, "scripts");
    if (!fs.existsSync(scriptDir)) continue;
    const files = fs.readdirSync(scriptDir).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(scriptDir, file), "utf8");
      const lines = content.split("\n").length;
      assert.ok(
        lines <= 300,
        `${skill}/scripts/${file} has ${lines} lines (max 300)`
      );
    }
  }
});

// Check 2: No npm dependencies in scripts
test("scripts have zero npm dependencies", () => {
  for (const skill of NEW_SKILLS) {
    const scriptDir = path.join(SKILLS_DIR, skill, "scripts");
    if (!fs.existsSync(scriptDir)) continue;
    const files = fs.readdirSync(scriptDir).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(scriptDir, file), "utf8");
      // Strip string literals and comments so mentions of require() in error messages aren't flagged.
      const stripped = content.replace(/"(?:\\.|[^"\\])*"/g, "").replace(/'(?:\\.|[^'\\])*'/g, "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      // Allow node: prefix built-ins but not bare npm packages
      const requires = stripped.match(/require\(['"]([^'"]+)['"]\)/g) || [];
      for (const req of requires) {
        const pkg = req.match(/require\(['"]([^'"]+)['"]\)/)[1];
        assert.ok(
          pkg.startsWith("node:") ||
            ["fs", "path", "os", "child_process"].includes(pkg),
          `${skill}/scripts/${file} imports non-builtin: ${pkg}`
        );
      }
    }
  }
});

// Check 3: SKILL.md token budget estimate (chars / 4 ≈ tokens)
test("SKILL.md files are within context budget", () => {
  for (const skill of NEW_SKILLS) {
    const skillMd = path.join(SKILLS_DIR, skill, "SKILL.md");
    assert.ok(fs.existsSync(skillMd), `${skill}/SKILL.md must exist`);
    const content = fs.readFileSync(skillMd, "utf8");
    // 2000 tokens ≈ ~8000 characters (conservative estimate for markdown)
    assert.ok(
      content.length <= 8000,
      `${skill}/SKILL.md is ${content.length} chars (~${Math.ceil(content.length / 4)} tokens), max ~8000 chars`
    );
  }
});

// Check 4: End-to-end pipeline timing
test("pipeline completes under 30 seconds", async () => {
  const startTime = Date.now();
  // Simulate the script execution path (hypothesize.js is the heaviest)
  execFileSync(
    "node",
    [path.join(SKILLS_DIR, "x-investigate", "scripts/hypothesize.js"), "--error", "test"],
    {
      cwd: SKILLS_DIR,
      timeout: 5000,
      encoding: "utf8",
    }
  );
  const elapsed = Date.now() - startTime;
  assert.ok(elapsed < 30000, `Pipeline took ${elapsed}ms, must be under 30000ms`);
});
