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
 * Extract parameter schema from a skill script by analyzing its source code.
 * Looks for parseArgs calls and flag patterns to build JSON Schema properties.
 */
function extractScriptSchema(scriptPath) {
  try {
    const content = fs.readFileSync(scriptPath, "utf-8");
    const properties = {};
    const required = [];

    // Pattern 1: shared.parseArgs with flagMap object
    // e.g., parseArgs(process.argv.slice(2), { "--topic": "topic", "-t": "topic", "--branch": "branch" })
    const flagMapMatch = content.match(/parseArgs\([^,]+,\s*\{([^}]+)\}/);
    if (flagMapMatch) {
      const flagMapContent = flagMapMatch[1];
      const flagPairs = flagMapContent.match(/"[^"]+"\s*:\s*"[^"]+"/g) || [];
      
      for (const pair of flagPairs) {
        const match = pair.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
        if (match) {
          const [, flag, paramName] = match;
          // Skip short flags like "-t", only use long ones like "--topic"
          if (flag.startsWith("--")) {
            const cleanName = flag.substring(2);
            properties[cleanName] = {
              type: "string",
              description: `${paramName} parameter`,
            };
            // If there's no default value check, mark as required
            if (!content.includes(`args.${paramName} ||`) && !content.includes(`${paramName} ||`)) {
              required.push(cleanName);
            }
          }
        }
      }
    }

    // Pattern 2: Manual argument parsing with --flag checks
    // e.g., if (argv[i] === "--topic" || argv[i] === "-t") args.topic = argv[++i];
    // OR: if (args[i] === "--error" && i + 1 < args.length) errorText = args[++i];
    // OR: let target = null; ... if (args[i] === "--target") target = args[++i];
    if (Object.keys(properties).length === 0) {
      // Extract all flag names from if conditions along with their positions
      const flagMatches = [...content.matchAll(/(?:if|else if)\s*\([^)]*(?:args|argv)\[i\]\s*===\s*"(--[^"]+)"/g)];
      
      // For each flag, find the corresponding variable assignment on nearby lines
      for (const match of flagMatches) {
        const flag = match[1];
        const paramName = flag.substring(2);
        const flagIndex = match.index;
        
        // Search in a window around the flag position (skip comments by looking for function context)
        // Look backwards to find the start of the function containing this flag
        const funcStart = content.lastIndexOf("function", flagIndex);
        const searchStart = funcStart !== -1 ? funcStart : Math.max(0, flagIndex - 500);
        const searchEnd = Math.min(content.length, flagIndex + 500);
        const searchWindow = content.substring(searchStart, searchEnd);
        
        // Find the specific assignment that comes after THIS flag in the search window
        const flagInWindow = searchWindow.indexOf(flag);
        if (flagInWindow !== -1) {
          const afterFlag = searchWindow.substring(flagInWindow);
          const assignMatch = afterFlag.match(/(\w+)\s*=\s*(?:args|argv)\[\+\+i\]/);
          
          if (assignMatch) {
            const varName = assignMatch[1];
            properties[paramName] = {
              type: "string",
              description: `${varName} parameter`,
            };
            
            // Check if initialized as null/undefined in the function
            const hasDefault = new RegExp(`let\\s+${varName}\\s*=\\s*(null|undefined)`).test(searchWindow);
            if (!hasDefault) {
              required.push(paramName);
            }
          }
        }
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  } catch (_err) {
    // Return empty schema on error
    return {
      type: "object",
      properties: {},
      required: [],
    };
  }
}

/**
 * Scan all skill directories and discover their executable scripts.
 * Returns array of { name, description, scriptPath, inputSchema } objects.
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
      const inputSchema = extractScriptSchema(scriptPath);

      tools.push({
        name: toolName,
        description: `${description} — runs ${scriptFile}`,
        skillName,
        scriptPath,
        inputSchema,
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
        inputSchema: tool.inputSchema || {
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

  switch (agent) {
    case "claude":
      return generateClaudeConfig();
    case "codex":
      return generateCodexConfig();
    case "cursor":
      return generateCursorConfig();
    default:
      throw new Error(`No config template for agent: ${agent}`);
  }
}

function generateClaudeConfig() {
  // Single unified xskills MCP server — all tools route through mcp-server.js.
  // Each skill name as a separate entry causes agents to try read_mcp_resource with that name, which fails.
  const mcpServerPath = path.join(path.dirname(__dirname), "mcp-server.js");

  const config = {
    mcpServers: {
      xskills: {
        command: "node",
        args: [mcpServerPath],
      },
    },
    _generatedBy: "xskills",
    _timestamp: new Date().toISOString(),
  };

  return JSON.stringify(config, null, 2);
}

function generateCodexConfig() {
  // Single unified xskills MCP server — all tools route through mcp-server.js.
  const mcpServerPath = path.join(path.dirname(__dirname), "mcp-server.js");

  const lines = [];
  lines.push("# Generated by xskills — add to your Codex MCP config");
  lines.push(`# Timestamp: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("xskills:");
  lines.push("  command: node");
  lines.push("  args:");
  lines.push(`    - "${mcpServerPath}"`);
  lines.push("");

  return lines.join("\n");
}

function generateCursorConfig() {
  // Single unified xskills MCP server — all tools route through mcp-server.js.
  const mcpServerPath = path.join(path.dirname(__dirname), "mcp-server.js");

  const config = {
    mcpServers: {
      xskills: {
        command: "node",
        args: [mcpServerPath],
      },
    },
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
