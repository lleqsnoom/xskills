#!/usr/bin/env node
"use strict";

/**
 * stdio MCP Server for xskills — JSON-RPC 2.0 compliant.
 *
 * Reads JSON-RPC requests from stdin, writes responses to stdout.
 * Handles: initialize, tools/list, tools/call, shutdown.
 *
 * Usage:
 *   node lib/mcp-server.js
 *
 * Protocol: MCP 1.0 over stdio transport (JSON-RPC 2.0)
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { discoverSkillTools } = require("./mcp-tools");

/**
 * Convert MCP tool call arguments into shell command-line argument pairs.
 * - Array form: pass values directly as positional args (e.g. ["a", "b"])
 * - Object form: convert {key: value} → ["--key", "value"] so scripts receive CLI flags
 * - Empty/null: returns []
 */
function buildCliArgs(args) {
  if (Array.isArray(args)) {
    return args.map(String);
  } else if (args && typeof args === "object") {
    const cmdArgs = [];
    for (const [key, value] of Object.entries(args)) {
      const flagName = key.startsWith("--") ? key : `--${key}`;
      cmdArgs.push(flagName, String(value));
    }
    return cmdArgs;
  }
  return [];
}

function shellEscape(arg) {
  if (/^[A-Za-z0-9_\-./:=@+%]+$/.test(arg)) return arg; // safe: no quoting needed
  return `"${arg.replace(/([\\"$`!])/g, '\\$1')}"`;
}

// ── State ─────────────────────────────────────────────────────────────

let initialized = false;
let tools = [];
try {
  tools = discoverSkillTools();
} catch (err) {
  console.error(`Warning: skill discovery failed — ${err.message}`);
}

// ── Resource Discovery ────────────────────────────────────────────────

const SKILLS_DIR = path.join(__dirname, "..", "skills");

function discoverSkillResources() {
  const resources = [];
  try {
    if (!fs.existsSync(SKILLS_DIR)) return resources;
    for (const name of fs.readdirSync(SKILLS_DIR)) {
      const skillMd = path.join(SKILLS_DIR, name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        resources.push({
          uri: `crush://skills/${name}/SKILL.md`,
          name: `${name} — SKILL.md`,
          description: `Skill definition for ${name}`,
          mimeType: "text/markdown",
        });
      }
    }
  } catch (_err) {
    // Skip unreadable directories silently
  }
  return resources;
}

function readResource(uri) {
  try {
    const relative = uri.replace(/^crush:\/\/skills\//, "").replace(/\/SKILL\.md$/, "/SKILL.md");
    const filePath = path.join(SKILLS_DIR, relative);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch (_err) {
    return null;
  }
}

function listResources() {
  try {
    return discoverSkillResources();
  } catch (_err) {
    return [];
  }
}

// ── Request Handlers ──────────────────────────────────────────────────

function handleInitialize(request) {
  initialized = true;
  return {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {},
        resources: {},
      },
      serverInfo: {
        name: "xskills-mcp-server",
        version: "1.0.0",
      },
    },
  };
}

function handleToolsList(request) {
  return {
    jsonrpc: "2.0",
    id: request.id,
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

function handleToolsCall(request, params) {
  const toolName = params?.name;
  if (!toolName) {
    return errorResponse(request.id, -32602, "Invalid params: 'name' is required");
  }

  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    return errorResponse(request.id, -32601, `Method not found: ${toolName}`);
  }

  // Build CLI arguments from MCP call parameters and execute script with timeout
  try {
    const cmdArgs = buildCliArgs(params?.arguments);

    // Properly shell-escape each argument
    const escapedArgs = cmdArgs.map(shellEscape);
    const command = `node "${tool.scriptPath}" ${escapedArgs.join(" ")}`;

    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 30000, // 30 second timeout per task spec
      stdio: ["pipe", "pipe", "inherit"],
    });

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [
          {
            type: "text",
            text: output.trim() || "(no output)",
          },
        ],
      },
    };
  } catch (err) {
    return errorResponse(request.id, -32603, `Tool execution failed: ${err.message}`);
  }
}

function handleResourcesList(request) {
  return {
    jsonrpc: "2.0",
    id: request.id,
    result: { resources: listResources() },
  };
}

function handleResourcesRead(request, params) {
  const uri = params?.uri;
  if (!uri) {
    return errorResponse(request.id, -32602, "Invalid params: 'uri' is required");
  }
  const content = readResource(uri);
  if (content === null) {
    return errorResponse(request.id, -32601, `Resource not found: ${uri}`);
  }
  return {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      contents: [{ uri, mimeType: "text/markdown", text: content }],
    },
  };
}

// ── Error Response Helper ─────────────────────────────────────────────

function handleShutdown() {
  // Graceful shutdown — exit after responding
}

function errorResponse(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

// ── Request Router ────────────────────────────────────────────────────

function routeRequest(request) {
  const { method, params } = request;

  switch (method) {
    case "initialize":
      return handleInitialize(request);

    case "tools/list":
      if (!initialized) {
        return errorResponse(request.id, -32600, "Invalid request: server not initialized");
      }
      return handleToolsList(request);

    case "tools/call":
      if (!initialized) {
        return errorResponse(request.id, -32600, "Invalid request: server not initialized");
      }
      return handleToolsCall(request, params);

    case "notifications/initialized":
    case "notifications/error":
      // Ignore notifications — no response needed per JSON-RPC spec
      return null;

    case "shutdown":
      initialized = false;
      handleShutdown();
      return null; // Server will exit after this response

    case "resources/list":
      if (!initialized) {
        return errorResponse(request.id, -32600, "Invalid request: server not initialized");
      }
      return handleResourcesList(request);

    case "resources/read":
      if (!initialized) {
        return errorResponse(request.id, -32600, "Invalid request: server not initialized");
      }
      return handleResourcesRead(request, params);

    default:
      return errorResponse(request.id, -32601, `Method not found: ${method}`);
  }
}

// ── stdio Transport ───────────────────────────────────────────────────

function processLine(line) {
  let request;
  try {
    request = JSON.parse(line.trim());
  } catch (err) {
    // Malformed JSON — return parse error (-32700)
    const id = extractIdFromLine(line);
    const response = errorResponse(id || null, -32700, `Parse error: ${err.message}`);
    process.stdout.write(JSON.stringify(response) + "\n");
    return;
  }

  // Handle batch requests (array of requests) by processing each individually
  if (Array.isArray(request)) {
    for (const item of request) {
      const response = routeRequest(item);
      if (response !== null) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    }
    return;
  }

  // Single request
  const response = routeRequest(request);
  if (response !== null) {
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  // After shutdown, exit cleanly
  if (request.method === "shutdown") {
    setTimeout(() => process.exit(0), 100);
  }
}

function extractIdFromLine(line) {
  try {
    const parsed = JSON.parse(line.trim());
    return parsed.id;
  } catch {
    return null;
  }
}

// ── Main Loop (MCP stdio Content-Length framing) ─────────────────────

let buffer = "";
const CONTENT_LENGTH_RE = /^Content-Length:\s*(\d+)(?:\r?\n)?$/i;

function drainBuffer() {
  while (buffer.length > 0) {
    // Check if the buffer starts with a Content-Length header line
    const firstLineEnd = buffer.indexOf("\r\n");
    let headersText, rest;

    if (firstLineEnd !== -1) {
      const firstLine = buffer.substring(0, firstLineEnd).trim();
      const clMatch = firstLine.match(CONTENT_LENGTH_RE);

      if (clMatch) {
        // Content-Length framed message. After extracting the header line and its \r\n,
        // `rest` starts with the blank-line separator (\r\n). Skip it to get the body.
        rest = buffer.substring(firstLineEnd + 4); // skip header \r\n + blank-line \r\n
        const contentLength = parseInt(clMatch[1], 10);
        if (rest.length < contentLength) return null; // wait for full body

        headersText = rest.substring(0, contentLength); // the JSON payload
        buffer = rest.substring(contentLength);
      } else {
        // Fallback: newline-delimited JSON — parse the first complete line
        rest = buffer.substring(firstLineEnd + 1);
        headersText = firstLine;
        buffer = rest;
      }
    } else if (buffer.indexOf("\n") !== -1) {
      const nlIdx = buffer.indexOf("\n");
      headersText = buffer.substring(0, nlIdx).trim();
      rest = buffer.substring(nlIdx + 1);
      buffer = rest;
    } else {
      return null; // need more data
    }

    processLine(headersText);
  }
}

if (require.main === module) {
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    drainBuffer();
  });

  process.stdin.on("end", () => {
    // Process any remaining buffered content
    if (buffer.trim()) processLine(buffer);
    process.exit(0);
  });

  // Signal handling for graceful shutdown
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  console.error("xskills MCP server started. Waiting for JSON-RPC requests on stdin...");
}

module.exports = { buildCliArgs, shellEscape };
