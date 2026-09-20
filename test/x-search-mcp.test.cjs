"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");

const TOOL = path.resolve(__dirname, "..", "tools", "x-search", "src", "cli.mjs");
const CHILD_ENV = { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`) };

const FIXTURE = {
  "src/alpha.mjs": "/** Runs a skill by name. */\nexport function zebraquokka(name) {\n  return run(name);\n}\n",
  "src/beta.mjs": "/** Reads the run folder. */\nexport function resolveRunDir(slug) {\n  return join('runs', slug);\n}\n",
};

function buildFixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `x-search-${label}-`));
  for (const [rel, body] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  fs.mkdirSync(path.join(root, ".x-skills", ".index"), { recursive: true });
  return root;
}

function indexFixture(root) {
  const result = spawnSync(process.execPath, [TOOL, "index", "--root", root, "--json"], { encoding: "utf8", env: CHILD_ENV });
  assert.equal(result.status, 0, result.stderr);
}

class McpClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.malformed = [];
    this.lines = readline.createInterface({ input: child.stdout });
    this.lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.malformed.push(line);
        return;
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
    });
  }

  send(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    const answered = new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => reject(new Error(`no answer to ${method}`)), 15000).unref();
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return answered;
  }

  notify(method) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }
}

function startServer(root) {
  const child = spawn(process.execPath, [TOOL, "mcp", "--root", root], { stdio: ["pipe", "pipe", "pipe"], env: CHILD_ENV });
  const client = new McpClient(child);
  return { child, client };
}

test("x-search mcp: handshake, tools/list and tools/call search", async (t) => {
  const root = buildFixture("mcp");
  indexFixture(root);
  const { child, client } = startServer(root);
  t.after(() => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const started = await client.send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(started.result.protocolVersion, "2024-11-05");
  assert.equal(started.result.serverInfo.name, "x-search");
  client.notify("notifications/initialized");

  const listed = await client.send("tools/list", {});
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    ["search", "projects", "stats"],
  );
  for (const tool of listed.result.tools) {
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.inputSchema.type, "object");
  }

  const found = await client.send("tools/call", { name: "search", arguments: { query: "zebraquokka", limit: 3 } });
  assert.equal(found.result.isError, false);
  const payload = JSON.parse(found.result.content[0].text);
  assert.ok(payload.hits.length > 0, "a hit came back");
  assert.ok(payload.hits.every((hit) => typeof hit.path === "string" && hit.lineStart >= 1));
  assert.ok(payload.index.missing === false);

  const projects = await client.send("tools/call", { name: "projects", arguments: {} });
  const list = JSON.parse(projects.result.content[0].text);
  assert.equal(list.length, 1);
  assert.ok(list[0].chunks > 0);

  const viaCli = spawnSync(process.execPath, [TOOL, "search", "zebraquokka", "--root", root, "--limit", "3", "--json"], { encoding: "utf8", env: CHILD_ENV });
  assert.equal(viaCli.status, 0, viaCli.stderr);
  const cliHits = JSON.parse(viaCli.stdout).hits;
  assert.equal(payload.hits[0].path, cliHits[0].path, "one implementation, so both surfaces rank the same file first");
  assert.equal(payload.hits[0].lineStart, cliHits[0].lineStart);

  const stats = await client.send("tools/call", { name: "stats", arguments: { project: list[0].id } });
  const detail = JSON.parse(stats.result.content[0].text);
  assert.equal(detail.chunks > 0, true);
  assert.ok(detail.builtAt);

  child.stdin.end();
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0);
  assert.deepEqual(client.malformed, [], "stdout carried only JSON-RPC");
});

test("x-search mcp: unknown tool and unknown method answer errors without killing the server", async (t) => {
  const root = buildFixture("mcp-errors");
  const { child, client } = startServer(root);
  t.after(() => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await client.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } });

  const badTool = await client.send("tools/call", { name: "nope", arguments: {} });
  assert.equal(badTool.error.code, -32602);

  const badMethod = await client.send("does/not/exist", {});
  assert.equal(badMethod.error.code, -32601);

  const after = await client.send("tools/list", {});
  assert.equal(after.result.tools.length, 3, "the server is still answering");

  const missing = await client.send("tools/call", { name: "search", arguments: { query: "anything" } });
  const payload = JSON.parse(missing.result.content[0].text);
  assert.equal(payload.index.missing, true);
  assert.equal(payload.hits.length, 0);

  const noQuery = await client.send("tools/call", { name: "search", arguments: {} });
  assert.equal(noQuery.result.isError, true);
  assert.match(noQuery.result.content[0].text, /query/);
});

test("x-search mcp: every stdout line is a JSON-RPC message", async (t) => {
  const root = buildFixture("mcp-stream");
  indexFixture(root);
  const { child, client } = startServer(root);
  t.after(() => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await client.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  await client.send("tools/list", {});
  await client.send("tools/call", { name: "search", arguments: { query: "run folder" } });

  assert.deepEqual(client.malformed, [], "no non-JSON line reached stdout");
});
