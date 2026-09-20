"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TOOL = path.resolve(__dirname, "..", "tools", "x-search", "src", "cli.mjs");
const DIMS = 768;

function startStubEmbedder() {
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: payload.model, embeddings: inputs.map(() => new Array(DIMS).fill(0.5)) }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

function runAsync(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("exit", (status) => resolve({ status, stdout, stderr }));
  });
}

function fixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `x-search-${label}-`));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.mjs"), "/** Alpha. */\nexport function zebra() {\n  return 1;\n}\n");
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "skip.md"), "# Docs\nnothing to find here\n");
  return root;
}

test("status: reports each store's own numbers, engine and source", async (t) => {
  const stub = await startStubEmbedder();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-state-"));
  const root = fixture("status");
  const env = { OLLAMA_URL: stub.url, X_SEARCH_STATE: path.join(state, "stores.json") };
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
  });

  const indexed = await runAsync(["index", "--root", root, "--json"], env);
  assert.equal(indexed.status, 0, indexed.stderr);

  const status = await runAsync(["status", "--root", root, "--json"], env);
  assert.equal(status.status, 0, status.stderr);
  const [store] = JSON.parse(status.stdout).stores;
  assert.equal(store.chunks, JSON.parse(indexed.stdout).chunks);
  assert.equal(store.vectors, store.chunks);
  assert.equal(store.mismatched, false);
  assert.equal(store.engine, "vec0");
  assert.match(store.builtAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.source, "flag");
  assert.equal(store.pending, 0);

  const plain = await runAsync(["status", "--root", root], env);
  assert.match(plain.stdout, /store\(s\), \d+ chunks/);
});

test("status: a repository that disappeared is gone and prunable, an unlisted one is left alone", async (t) => {
  const stub = await startStubEmbedder();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-state-"));
  const env = { OLLAMA_URL: stub.url, X_SEARCH_STATE: path.join(stateDir, "stores.json") };
  const goneRoot = fixture("status-gone");
  const unlistedRoot = fixture("status-unlisted");
  t.after(() => {
    stub.close();
    fs.rmSync(goneRoot, { recursive: true, force: true });
    fs.rmSync(unlistedRoot, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  assert.equal((await runAsync(["index", "--root", goneRoot, "--root", unlistedRoot], env)).status, 0);
  fs.rmSync(goneRoot, { recursive: true, force: true });

  const status = await runAsync(["status", "--root", unlistedRoot, "--json"], env);
  const rows = Object.fromEntries(JSON.parse(status.stdout).stores.map((row) => [row.id, row]));
  assert.equal(rows[path.basename(goneRoot)].source, "gone");
  assert.equal(rows[path.basename(unlistedRoot)].source, "flag");

  const dry = await runAsync(["index", "--prune", "--dry-run", "--root", unlistedRoot], env);
  assert.match(dry.stdout, new RegExp(`would prune .*${path.basename(goneRoot)}`));
  assert.equal(fs.existsSync(path.join(unlistedRoot, ".x-skills", ".index", "index.db")), true, "a dry run removes nothing");

  const pruned = await runAsync(["index", "--prune", "--root", unlistedRoot], env);
  assert.equal(pruned.status, 0, pruned.stderr);
  assert.match(pruned.stdout, /pruned/);
  const after = await runAsync(["status", "--root", unlistedRoot, "--json"], env);
  assert.equal(JSON.parse(after.stdout).stores.length, 1, "only the unlisted store is left");
  assert.equal(fs.existsSync(path.join(unlistedRoot, ".x-skills", ".index", "index.db")), true);
});

test("status: a store whose vectors went missing is reported as a mismatch", async (t) => {
  const stub = await startStubEmbedder();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-state-"));
  const root = fixture("status-mismatch");
  const env = { OLLAMA_URL: stub.url, X_SEARCH_STATE: path.join(stateDir, "stores.json") };
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  assert.equal((await runAsync(["index", "--root", root], env)).status, 0);
  const store = path.join(root, ".x-skills", ".index", "index.db");
  const { openStore } = await import(new URL("../tools/x-search/src/store.mjs", `file://${__filename}`).href);
  const db = openStore(store);
  db.exec("DELETE FROM vec_rows");
  db.close();

  const status = await runAsync(["status", "--root", root, "--json"], env);
  const [row] = JSON.parse(status.stdout).stores;
  assert.equal(row.mismatched, true);
  assert.equal(row.vectors, 0);
  assert.ok(row.chunks > 0);
});

test("status: no roots is an empty table and the sentence to add one", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-state-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-emptyhome-"));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));

  const result = await runAsync(["status"], { X_SEARCH_STATE: path.join(stateDir, "stores.json"), ORCA_CONFIG_DIR: empty, HOME: empty });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no repository to index/);
});

test("status: the same repository listed twice appears once", async (t) => {
  const stub = await startStubEmbedder();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-state-"));
  const root = fixture("status-dup");
  const env = { OLLAMA_URL: stub.url, X_SEARCH_STATE: path.join(stateDir, "stores.json") };
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  assert.equal((await runAsync(["index", "--root", root, "--root", root], env)).status, 0);
  const status = await runAsync(["status", "--root", root, "--root", root, "--json"], env);
  assert.equal(JSON.parse(status.stdout).stores.length, 1);
});

test("search: --path narrows to a subtree in both modes", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("status-path");
  const env = { OLLAMA_URL: stub.url, X_SEARCH_STATE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "x-search-state-")), "stores.json") };
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal((await runAsync(["index", "--root", root], env)).status, 0);
  for (const mode of ["keyword", "hybrid"]) {
    const found = await runAsync(["search", "nothing", "--root", root, "--path", "docs/", "--mode", mode, "--json"], env);
    assert.equal(found.status, 0, found.stderr);
    const hits = JSON.parse(found.stdout).hits;
    assert.ok(hits.length > 0, `${mode} found the docs file`);
    assert.ok(hits.every((hit) => hit.path.startsWith("docs/")), `${mode} returned only docs hits`);
  }
});
