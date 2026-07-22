"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { generateMCPConfig } = require("../lib/mcp-tools");

// ── Config generation: single unified server (not per-skill) ────────

describe("generateMCPConfig — Claude", () => {
  it('produces a single "xskills" MCP server entry', () => {
    const config = JSON.parse(generateMCPConfig("claude"));
    assert.deepEqual(Object.keys(config.mcpServers), ["xskills"]);
  });

  it("points xskills to mcp-server.js, not individual skill scripts", () => {
    const config = JSON.parse(generateMCPConfig("claude"));
    const args = config.mcpServers.xskills.args;
    assert.ok(
      args.some((a) => a.includes("mcp-server.js")),
      `Expected mcp-server.js in args but got: ${JSON.stringify(args)}`
    );
  });

  it("does not create per-skill server entries (x-commit, x-implement, etc.)", () => {
    const config = JSON.parse(generateMCPConfig("claude"));
    for (const key of Object.keys(config.mcpServers)) {
      assert.ok(
        !key.startsWith("x-"),
        `Per-skill server entry "${key}" should not exist — agents copy verbatim and try read_mcp_resource with that name`
      );
    }
  });

  it('includes metadata (_generatedBy, _timestamp)', () => {
    const config = JSON.parse(generateMCPConfig("claude"));
    assert.equal(config._generatedBy, "xskills");
    assert.ok(typeof config._timestamp === "string");
  });
});

describe("generateMCPConfig — Cursor", () => {
  it('produces a single "xskills" MCP server entry', () => {
    const config = JSON.parse(generateMCPConfig("cursor"));
    assert.deepEqual(Object.keys(config.mcpServers), ["xskills"]);
  });

  it("points xskills to mcp-server.js", () => {
    const config = JSON.parse(generateMCPConfig("cursor"));
    assert.ok(
      config.mcpServers.xskills.args.some((a) => a.includes("mcp-server.js"))
    );
  });

  it('does not create per-skill server entries', () => {
    const config = JSON.parse(generateMCPConfig("cursor"));
    for (const key of Object.keys(config.mcpServers)) {
      assert.ok(
        !key.startsWith("x-"),
        `Per-skill server entry "${key}" should not exist`
      );
    }
  });
});

describe("generateMCPConfig — Codex", () => {
  it('produces YAML with a single "xskills" entry', () => {
    const yaml = generateMCPConfig("codex");
    assert.ok(yaml.includes("xskills:"), `Expected "xskills:" in YAML output: ${yaml}`);
  });

  it("does not create per-skill entries (no x-commit:, x-implement:, etc.)", () => {
    const yaml = generateMCPConfig("codex");
    assert.ok(
      !/^\s*x-[a-z]+:$/.test(yaml),
      `Per-skill YAML entry found in output:\n${yaml}`
    );
  });

  it("points xskills to mcp-server.js", () => {
    const yaml = generateMCPConfig("codex");
    assert.ok(
      yaml.includes('mcp-server.js'),
      `Expected "mcp-server.js" in YAML output: ${yaml}`
    );
  });
});

// ── Error handling ────────────────────────────────────────────────────

describe("generateMCPConfig — error cases", () => {
  it("throws on unsupported agent name", () => {
    assert.throws(() => generateMCPConfig("unknown-agent"), /Unsupported agent/);
  });

  it('includes supported agents in error message', () => {
    try {
      generateMCPConfig("not-a-real-agent");
    } catch (err) {
      assert.ok(err.message.includes("claude"));
      assert.ok(err.message.includes("codex"));
      assert.ok(err.message.includes("cursor"));
    }
  });
});
