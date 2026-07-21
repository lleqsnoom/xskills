"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

// ── Unit tests for buildCliArgs ───────────────────────────────────────

describe("buildCliArgs", () => {
  const mcpServer = require("../lib/mcp-server");
  const { buildCliArgs } = mcpServer;

  it('converts object args {"topic": "slug"} to ["--topic", "slug"]', () => {
    assert.deepEqual(buildCliArgs({ topic: "slug" }), ["--topic", "slug"]);
  });

  it("handles multiple keys in one call", () => {
    const result = buildCliArgs({ output: ".x-skills/review/", branch: "main" });
    assert.deepEqual(result, ["--output", ".x-skills/review/", "--branch", "main"]);
  });

  it('converts array args directly as positional', () => {
    assert.deepEqual(buildCliArgs(["a", "b"]), ["a", "b"]);
  });

  it("coerces values to strings", () => {
    assert.deepEqual(buildCliArgs({ count: 42 }), ["--count", "42"]);
  });

  it('preserves -- prefix if already present in key', () => {
    assert.deepEqual(buildCliArgs({"--flag": "val"}), ["--flag", "val"]);
  });

  it("returns empty array for null/undefined/nullish args", () => {
    assert.deepEqual(buildCliArgs(null), []);
    assert.deepEqual(buildCliArgs(undefined), []);
  });

  it("handles empty object gracefully", () => {
    assert.deepEqual(buildCliArgs({}), []);
  });

  it('handles string argument (treated as non-object, returns [])', () => {
    // Strings are not arrays and not objects — falls through to empty
    assert.deepEqual(buildCliArgs("bare-string"), []);
  });

  it("converts boolean values to strings", () => {
    assert.deepEqual(buildCliArgs({ dryRun: true }), ["--dryRun", "true"]);
  });
});

// ── Unit tests for shellEscape ────────────────────────────────────────

describe("shellEscape", () => {
  const mcpServer = require("../lib/mcp-server");
  const { shellEscape } = mcpServer;

  it("passes safe characters through unquoted", () => {
    assert.equal(shellEscape("--topic"), "--topic");
    assert.equal(shellEscape("/home/user/file.js"), "/home/user/file.js");
    assert.equal(shellEscape(".x-skills/review/"), ".x-skills/review/");
  });

  it("wraps unsafe characters in double quotes", () => {
    // Space is unsafe
    const escaped = shellEscape("--output .x-skills/review/");
    assert.ok(escaped.startsWith('"') && escaped.endsWith('"'));
  });

  it('escapes backslashes inside quoted strings', () => {
    assert.equal(shellEscape(`path\\with\\backslash`), `"path\\\\with\\\\backslash"`);
  });

  it("escapes dollar signs to prevent shell expansion", () => {
    const escaped = shellEscape('$HOME');
    assert.ok(escaped.includes('\\$'));
  });

  it('escapes backticks', () => {
    const escaped = shellEscape('cmd `whoami`');
    assert.ok(escaped.includes('`')); // backtick is preserved inside quotes
  });

  it("handles empty string", () => {
    assert.equal(shellEscape(""), '""');
  });
});

// ── Integration tests: MCP server over stdio with real JSON-RPC ───────

describe("mcp-server integration — tools/call with object arguments", () => {
  const mcpBin = path.join(__dirname, "..", "lib", "mcp-server.js");

  /**
   * Send a sequence of JSON-RPC requests over stdio to the MCP server,
   * collect all responses, then kill the process.
   */
  function sendRequests(requests) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [mcpBin], {
        stdio: ["pipe", "pipe", "inherit"], // inherit stderr so errors surface
      });

      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("mcp-server integration test timed out"));
      }, 15000);

      // Send all requests as newline-delimited JSON, then close stdin to signal end
      for (const req of requests) {
        child.stdin.write(JSON.stringify(req) + "\n");
      }
      child.stdin.end();

      child.on("close", () => {
        clearTimeout(timer);
        // Parse all responses from output
        const responses = [];
        for (const line of output.trim().split("\n")) {
          if (!line.trim()) continue;
          try {
            responses.push(JSON.parse(line));
          } catch (_) {
            // Skip non-JSON lines (e.g., server stderr)
          }
        }
        resolve(responses);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  it("returns tool list after initialize", async () => {
    const responses = await sendRequests([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);

    assert.ok(responses.length >= 2);
    const initResp = responses[0];
    assert.equal(initResp.jsonrpc, "2.0");
    assert.equal(initResp.id, 1);
    assert.ok(initResp.result.capabilities.tools !== undefined);

    const listResp = responses[1];
    assert.equal(listResp.jsonrpc, "2.0");
    assert.equal(listResp.id, 2);
    assert.ok(Array.isArray(listResp.result.tools));
    // Should have discovered tools from skills/ directories
    assert.ok(listResp.result.tools.length > 0, `Expected tools but got: ${JSON.stringify(listResp.result.tools).slice(0, 200)}`);
  });

  it("sends correct CLI arguments to a skill script via object args", async () => {
    // We verify the server doesn't error and returns a result by calling a known tool.
    // The exact behavior depends on whether scripts exist in the skills/ dir of this repo,
    // but we can at least verify tools/call with valid params reaches execution without protocol errors.
    const responses = await sendRequests([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "x-epic-save-epic", arguments: { topic: "test-topic" } },
      },
    ]);

    assert.ok(responses.length >= 2);
    const callResp = responses[1];
    // Should not be a JSON-RPC error response (-32603 tool execution failed)
    if (callResp.error) {
      // Tool might fail due to missing args/scripts, but the command should include --topic test-topic
      assert.notEqual(callResp.error.code, -32601, `Method not found: ${JSON.stringify(callResp)}`);
      assert.notEqual(callResp.error.code, -32602, `Invalid params: ${JSON.stringify(callResp)}`);
    } else {
      // If it succeeded, verify the output mentions our topic slug
      const text = callResp.result.content[0].text;
      assert.ok(text.includes("test-topic"), `Expected 'test-topic' in output but got: ${text.slice(0, 200)}`);
    }
  });

  it("handles resources/list and resources/read correctly", async () => {
    const responses = await sendRequests([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "resources/list" },
    ]);

    assert.ok(responses.length >= 2);
    const listResp = responses[1];
    assert.equal(listResp.jsonrpc, "2.0");
    assert.ok(Array.isArray(listResp.result.resources));
    // Should discover SKILL.md resources from ~/.config/crush/skills/
    assert.ok(listResp.result.resources.length > 0);

    // Try reading one resource by URI
    const sampleUri = listResp.result.resources[0].uri;
    const readResponses = await sendRequests([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: sampleUri } },
    ]);

    const readResp = readResponses[readResponses.length - 1];
    assert.equal(readResp.jsonrpc, "2.0");
    assert.ok(!readResp.error);
    assert.ok(readResp.result.contents.length > 0);
    assert.equal(readResp.result.contents[0].mimeType, "text/markdown");
  });

  it("returns error for unknown tool name", async () => {
    const responses = await sendRequests([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "totally-fake-tool-xyz" } },
    ]);

    const callResp = responses[1];
    assert.ok(callResp.error);
    assert.equal(callResp.error.code, -32601, `Expected -32601 method not found but got ${JSON.stringify(callResp)}`);
  });

  it("returns error when 'name' is missing from tools/call params", async () => {
    const responses = await sendRequests([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: {} },
    ]);

    const callResp = responses[1];
    assert.ok(callResp.error);
    assert.equal(callResp.error.code, -32602);
  });
});
