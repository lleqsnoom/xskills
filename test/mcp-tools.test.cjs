"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { generateMCPConfig, discoverSkillTools } = require("../lib/mcp-tools");

// ── Schema extraction from skill scripts ─────────────────────────────

describe("discoverSkillTools — inputSchema", () => {
  it("extracts topic and branch parameters for x-plan-save-spec", () => {
    const tools = discoverSkillTools();
    const planTool = tools.find((t) => t.name === "x-plan-save-spec");
    
    assert.ok(planTool, "x-plan-save-spec tool should exist");
    assert.ok(planTool.inputSchema, "inputSchema should be defined");
    assert.equal(planTool.inputSchema.type, "object");
    assert.ok(planTool.inputSchema.properties.topic, "topic property should exist");
    assert.equal(planTool.inputSchema.properties.topic.type, "string");
    assert.ok(planTool.inputSchema.properties.branch, "branch property should exist");
    assert.equal(planTool.inputSchema.properties.branch.type, "string");
    assert.ok(
      Array.isArray(planTool.inputSchema.required),
      "required should be an array"
    );
    assert.ok(
      planTool.inputSchema.required.includes("topic"),
      "topic should be required"
    );
  });

  it("extracts epic parameter for x-decompose-save-tasks", () => {
    const tools = discoverSkillTools();
    const decomposeTool = tools.find((t) => t.name === "x-decompose-save-tasks");
    
    assert.ok(decomposeTool, "x-decompose-save-tasks tool should exist");
    assert.ok(decomposeTool.inputSchema.properties.epic, "epic property should exist");
    assert.equal(decomposeTool.inputSchema.properties.epic.type, "string");
  });

  it("extracts error and file parameters for x-debug-analyze", () => {
    const tools = discoverSkillTools();
    const debugTool = tools.find((t) => t.name === "x-debug-analyze");
    
    assert.ok(debugTool, "x-debug-analyze tool should exist");
    assert.ok(debugTool.inputSchema.properties.error, "error property should exist");
    assert.ok(debugTool.inputSchema.properties.file, "file property should exist");
  });

  it("has empty schema for scripts without parameters (e.g., x-triage-route)", () => {
    const tools = discoverSkillTools();
    const triageTool = tools.find((t) => t.name === "x-triage-route");
    
    assert.ok(triageTool, "x-triage-route tool should exist");
    assert.deepEqual(triageTool.inputSchema.properties, {});
  });

  it("all tools have valid inputSchema structure", () => {
    const tools = discoverSkillTools();
    
    for (const tool of tools) {
      assert.ok(tool.inputSchema, `${tool.name} should have inputSchema`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} schema type should be object`);
      assert.ok(
        typeof tool.inputSchema.properties === "object",
        `${tool.name} properties should be an object`
      );
    }
  });
});

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
