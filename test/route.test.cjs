"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ── route.js module tests ─────────────────────────────────────────────

describe("route.js — ROUTE_TABLE export", () => {
  const routeTablePath = path.join(
    __dirname,
    "..",
    "skills",
    "x-triage",
    "scripts",
    "route.js"
  );

  it("exports a ROUTE_TABLE object", () => {
    delete require.cache[require.resolve(routeTablePath)];
    const mod = require(routeTablePath);
    assert.ok(mod.ROUTE_TABLE, "ROUTE_TABLE must be exported");
    assert.equal(typeof mod.ROUTE_TABLE, "object");
  });

  for (const platform of ["web", "mobile", "tv", "backend", "gaming"]) {
    it(`includes the "${platform}" platform`, () => {
      delete require.cache[require.resolve(routeTablePath)];
      const ROUTE_TABLE = require(routeTablePath).ROUTE_TABLE;
      assert.ok(
        ROUTE_TABLE[platform],
        `ROUTE_TABLE must have a "${platform}" entry`
      );
    });

    it(`"${platform}" has reproduceTemplate (string)`, () => {
      delete require.cache[require.resolve(routeTablePath)];
      const ROUTE_TABLE = require(routeTablePath).ROUTE_TABLE;
      assert.equal(typeof ROUTE_TABLE[platform].reproduceTemplate, "string");
      assert.ok(
        ROUTE_TABLE[platform].reproduceTemplate.length > 0,
        `reproduceTemplate for "${platform}" must be non-empty`
      );
    });

    it(`"${platform}" has investigateTools (non-empty array of strings)`, () => {
      delete require.cache[require.resolve(routeTablePath)];
      const ROUTE_TABLE = require(routeTablePath).ROUTE_TABLE;
      const tools = ROUTE_TABLE[platform].investigateTools;
      assert.ok(Array.isArray(tools), `"${platform}.investigateTools" must be an array`);
      assert.ok(
        tools.length > 0,
        `"${platform}.investigateTools" must not be empty`
      );
      for (const tool of tools) {
        assert.equal(typeof tool, "string", `tool entry in "${platform}" must be a string`);
      }
    });
  }

  it("has exactly 5 platforms (no more, no fewer)", () => {
    delete require.cache[require.resolve(routeTablePath)];
    const ROUTE_TABLE = require(routeTablePath).ROUTE_TABLE;
    const keys = Object.keys(ROUTE_TABLE).sort();
    const expected = ["backend", "gaming", "mobile", "tv", "web"].sort();
    assert.deepEqual(keys, expected);
  });
});

// ── route.js structural constraints ───────────────────────────────────

describe("route.js — structural constraints (DOD)", () => {
  const routeTablePath = path.join(
    __dirname,
    "..",
    "skills",
    "x-triage",
    "scripts",
    "route.js"
  );

  it("file exists and is non-empty", () => {
    assert.ok(fs.existsSync(routeTablePath), "route.js must exist");
    const stat = fs.statSync(routeTablePath);
    assert.ok(stat.size > 0, "route.js must be non-empty");
  });

  it("must not exceed 300 lines", () => {
    const content = fs.readFileSync(routeTablePath, "utf8");
    const lineCount = content.split("\n").length;
    assert.ok(
      lineCount <= 300,
      `route.js has ${lineCount} lines (max 300)`
    );
  });

  it("must not contain require() calls (only module.exports)", () => {
    const content = fs.readFileSync(routeTablePath, "utf8");
    // Match require( but exclude the final module.exports line pattern
    const requireMatches = content.match(/require\(/g) || [];
    assert.equal(
      requireMatches.length,
      0,
      `route.js must not use require(); found ${requireMatches.length} call(s)`
    );
  });

  it("is valid CommonJS (exports ROUTE_TABLE via module.exports)", () => {
    // Already tested by the first describe block, but assert explicitly
    const mod = require(routeTablePath);
    assert.ok(
      "ROUTE_TABLE" in mod,
      "module must export ROUTE_TABLE property"
    );
  });
});

// ── SKILL.md structural constraints ───────────────────────────────────

describe("x-triage/SKILL.md — structural constraints (DOD)", () => {
  const skillMdPath = path.join(
    __dirname,
    "..",
    "skills",
    "x-triage",
    "SKILL.md"
  );

  it("file exists and is non-empty", () => {
    assert.ok(fs.existsSync(skillMdPath), "SKILL.md must exist");
    const stat = fs.statSync(skillMdPath);
    assert.ok(stat.size > 0, "SKILL.md must be non-empty");
  });

  it("must not exceed ~8000 chars (≤2000 tokens estimate)", () => {
    const content = fs.readFileSync(skillMdPath, "utf8");
    assert.ok(
      content.length < 8000,
      `SKILL.md is ${content.length} chars (max ~8000 for ≤2000 tokens)`
    );
  });

  it("has YAML frontmatter with name and description", () => {
    const content = fs.readFileSync(skillMdPath, "utf8");
    assert.ok(
      content.startsWith("---"),
      "SKILL.md must start with --- frontmatter delimiter"
    );
    // Extract frontmatter between first two ---
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(match, "frontmatter block must be parseable");
    const fm = match[1];
    assert.ok(/name:/.test(fm), "frontmatter must have 'name' field");
    assert.ok(
      /description:/.test(fm),
      "frontmatter must have 'description' field"
    );
  });

  it("never instructs running debug tools or reading source files", () => {
    const content = fs.readFileSync(skillMdPath, "utf8");
    // Check that the skill does NOT instruct bash/node/git/lsp tool usage
    const forbiddenPatterns = [
      /runs?\s+(node|git)\b/i,
      /invoke[sd]?\s+debug\s+tools/i,
      /read\s+(source\s+)?files?\s+via\s+/i,
    ];
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(content),
        `SKILL.md must not instruct: ${pattern}`
      );
    }
  });

  it("describes one-question-at-a-time conversation flow", () => {
    const content = fs.readFileSync(skillMdPath, "utf8");
    // Must mention asking questions or conversation flow
    assert.ok(
      /ask|question|conversation|one\s*at\s*a\s*time/i.test(content),
      "SKILL.md must describe conversational intake flow"
    );
  });

  it("describes writing triage-brief.md output", () => {
    const content = fs.readFileSync(skillMdPath, "utf8");
    assert.ok(
      /triage[- ]brief/i.test(content),
      "SKILL.md must describe producing a triage brief"
    );
  });

  it("mentions all 5 platform categories", () => {
    const content = fs.readFileSync(skillMdPath, "utf8");
    for (const p of ["web", "mobile", "tv|TV", "backend", "gaming"]) {
      assert.ok(
        new RegExp(p, "i").test(content),
        `SKILL.md must mention platform: ${p}`
      );
    }
  });

  it("mentions all bug types from spec", () => {
    const content = fs.readFileSync(skillMdPath, "utf8");
    for (const b of ["crash", "null.ref|null-ref", "race", "perf", "logic"]) {
      assert.ok(
        new RegExp(b).test(content),
        `SKILL.md must mention bug type: ${b}`
      );
    }
  });
});
