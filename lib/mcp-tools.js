#!/usr/bin/env node
"use strict";

/**
 * MCP tool registry and configuration generator for xskills.
 *
 * Scans installed skills for executable scripts in their scripts/ directories,
 * then generates JSON-RPC 2.0 compliant MCP server responses or agent-specific config snippets.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Skill Script Discovery ────────────────────────────────────────────

/**
 * Resolve the skills directory relative to this module's location.
 * Works whether installed globally or locally.
 */
function resolveSkillsDir() {
  return path.join(__dirname, "..", "skills");
}

/**
 * Scan all skill directories and discover their executable scripts.
 * Returns array of { name, description, scriptPath } objects.
 */
function discoverSkillTools() {
  const skillsDir = resolveSkillsDir();
  const tools = [];

  if (!fs.existsSync(skillsDir)) return tools;

  for (const skillName of fs.readdirSync(skillsDir)) {
    const skillPath = path.join(skillsDir, skillName);
    if (!fs.statSync(skillPath).isDirectory()) continue;

    // Check for SKILL.md to get description
    const skillMdPath = path.join(skillPath, "SKILL.md");
    let description = `${skillName} skill`;
    if (fs.existsSync(skillMdPath)) {
      try {
        const content = fs.readFileSync(skillMdPath, "utf-8");
        const descMatch = content.match(/^description:\s*(.+?)\s*$/m);
        if (descMatch) description = descMatch[1].trim();
      } catch {}
    }

    // Scan scripts/ directory for executable files
    const scriptsDir = path.join(skillPath, "scripts");
    if (!fs.existsSync(scriptsDir)) continue;

    for (const scriptFile of fs.readdirSync(scriptsDir)) {
      if (!/\.(js|mjs|cjs)$/.test(scriptFile)) continue;
      const scriptPath = path.join(scriptsDir, scriptFile);
      const toolName = `${skillName}-${path.basename(scriptFile, path.extname(scriptFile))}`;

      tools.push({
        name: toolName,
        description: `${description} — runs ${scriptFile}`,
        skillName,
        scriptPath,
      });
    }
  }

  return tools;
}

// ── MCP Server Response Generation ────────────────────────────────────

/**
 * Generate JSON-RPC 2.0 initialize response with capabilities.
 */
function getInitializeResponse() {
  return {
    jsonrpc: "2.0",
    id: null, // Null for responses to notifications/initialization
    result: {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "xskills-mcp-server",
        version: "1.0.0",
      },
    },
  };
}

/**
 * Generate JSON-RPC 2.0 tools/list response.
 */
function getToolsListResponse() {
  const tools = discoverSkillTools();

  return {
    jsonrpc: "2.0",
    result: {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      })),
    },
  };
}

/**
 * Execute a skill script and return its output.
 */
async function callTool(toolName) {
  const tools = discoverSkillTools();
  const tool = tools.find((t) => t.name === toolName);

  if (!tool) {
    throw new Error(`Method not found: ${toolName}`);
  }

  // Execute script via child_process (synchronous for simplicity in this phase)
  const { execSync } = require("node:child_process");
  try {
    const output = execSync(`node "${tool.scriptPath}"`, {
      encoding: "utf-8",
      timeout: 30000, // 30 second timeout
      stdio: ["pipe", "pipe", "inherit"],
    });
    return output.trim();
  } catch (err) {
    throw new Error(`Tool execution failed: ${err.message}`);
  }
}

// ── Agent Config Generation ───────────────────────────────────────────

const SUPPORTED_AGENTS = ["claude", "codex", "cursor"];

/**
 * Generate MCP configuration snippet for a specific agent.
 * Returns formatted JSON/YAML config that can be added to the agent's MCP settings.
 */
function generateMCPConfig(agent) {
  if (!SUPPORTED_AGENTS.includes(agent)) {
    throw new Error(`Unsupported agent: "${agent}". Supported: ${SUPPORTED_AGENTS.join(", ")}`);
  }

  const tools = discoverSkillTools();

  // Generate agent-specific config format
  switch (agent) {
    case "claude":
      return generateClaudeConfig(tools);
    case "codex":
      return generateCodexConfig(tools);
    case "cursor":
      return generateCursorConfig(tools);
    default:
      throw new Error(`No config template for agent: ${agent}`);
  }
}

function generateClaudeConfig(tools) {
  // Claude Code MCP configuration format (JSON in ~/.claude/settings.json or .mdx/mcp.json)
  const mcpServers = {};
  for (const tool of tools) {
    if (!mcpServers[tool.skillName]) {
      mcpServers[tool.skillName] = {
        command: "node",
        args: [tool.scriptPath],
      };
    }
  }

  const config = {
    mcpServers,
    _generatedBy: "xskills",
    _timestamp: new Date().toISOString(),
  };

  return JSON.stringify(config, null, 2);
}

function generateCodexConfig(tools) {
  // OpenAI Codex MCP configuration format (YAML in .codex/mcp.yaml or similar)
  const lines = [];
  lines.push("# Generated by xskills — add to your Codex MCP config");
  lines.push(`# Timestamp: ${new Date().toISOString()}`);
  lines.push("");

  for (const tool of tools) {
    lines.push(`${tool.skillName}:`);
    lines.push(`  command: node`);
    lines.push(`  args:`);
    lines.push(`    - "${tool.scriptPath}"`);
    lines.push("");
  }

  return lines.join("\n");
}

function generateCursorConfig(tools) {
  // Cursor MCP configuration format (JSON in .cursor/mcp.json or similar)
  const mcpServers = {};
  for (const tool of tools) {
    if (!mcpServers[tool.skillName]) {
      mcpServers[tool.skillName] = {
        command: "node",
        args: [tool.scriptPath],
      };
    }
  }

  const config = {
    mcpServers,
    _generatedBy: "xskills",
    _timestamp: new Date().toISOString(),
  };

  return JSON.stringify(config, null, 2);
}

// ── Module Exports ────────────────────────────────────────────────────

module.exports = {
  discoverSkillTools,
  getInitializeResponse,
  getToolsListResponse,
  callTool,
  generateMCPConfig,
};
