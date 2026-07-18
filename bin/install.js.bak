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
const { discoverSkillTools } = require("./mcp-tools");

// ── State ─────────────────────────────────────────────────────────────

let initialized = false;
let tools = [];
try {
  tools = discoverSkillTools();
} catch (err) {
  console.error(`Warning: skill discovery failed — ${err.message}`);
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
    const args = params?.arguments;
    const cmdArgs = Array.isArray(args) ? args.map(String) : Object.values(args || {}).map(String);
    // Properly shell-escape each argument
    const escapedArgs = cmdArgs.map((a) => {
      if (/^[A-Za-z0-9_\-./:=@+%]+$/.test(a)) return a; // safe: no quoting needed
      return `"${a.replace(/([\\"$`!])/g, '\\$1')}"`;
    });
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
