"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const TOOL = path.resolve(__dirname, "..", "tools", "x-search", "src", "cli.mjs");
const DIMS = 768;

function startStubEmbedder() {
  const calls = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
      calls.push({ model: payload.model, count: inputs.length, texts: inputs });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: payload.model, embeddings: inputs.map(() => new Array(DIMS).fill(0.5)) }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() }));
  });
}

const FILES = {
  "src/alpha.mjs": "/** Ruft eine Fähigkeit auf. */\nexport function zebra(name) {\n  return name;\n}\n",
  "src/beta.mjs": "/** Reads the run folder. */\nexport function resolveRunDir(slug) {\n  return slug;\n}\n",
  "docs/notes.md": "# Notes\n\nSomething about run folders.\n",
};

function fixture(label = "watch") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `x-search-${label}-`));
  for (const [rel, body] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  fs.mkdirSync(path.join(root, ".x-skills"), { recursive: true });
  return root;
}

const openStoreModule = () => import(new URL("../tools/x-search/src/store.mjs", `file://${__filename}`).href);

async function counts(root) {
  const { openStore, countRows, countVectors } = await openStoreModule();
  const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
  const result = { chunks: countRows(db, "chunks"), vectors: countVectors(db), fts: countRows(db, "chunks_fts") };
  db.close();
  return result;
}

function startWatcher(root, env) {
  const child = spawn(process.execPath, [TOOL, "watch", "--root", root], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`), X_SEARCH_DEBOUNCE: "200", X_SEARCH_SCAN_INTERVAL: "60000", ...env },
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  return { child, stderr: () => stderr.join(""), ready: waitFor(() => stderr.join("").includes("watching")) };
}

function waitFor(predicate, { timeout = 15000, interval = 100 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - started > timeout) return reject(new Error("timed out waiting for the watcher"));
      setTimeout(tick, interval);
    };
    tick();
  });
}

function runAsync(args, env = {}, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`), ...env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("exit", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function indexRoots(roots, env) {
  const args = ["index", ...roots.flatMap((root) => ["--root", root]), "--json"];
  const result = await runAsync(args, env);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function searchJson(root, query, extra = []) {
  const result = await runAsync(["search", query, "--root", root, ...extra, "--json"]);
  return { status: result.status, payload: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

async function waitForAsync(predicate, options = {}) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() - started > (options.timeout || 15000)) throw new Error("timed out waiting for the watcher");
    await new Promise((resolve) => setTimeout(resolve, options.interval || 200));
  }
}

test("watch: an edited file is re-indexed within the debounce window and no other file moves", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture();
  await indexRoots([root], { OLLAMA_URL: stub.url });
  const initial = await counts(root);

  const watcher = startWatcher(root, { OLLAMA_URL: stub.url });
  t.after(() => {
    watcher.child.kill();
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await watcher.ready;

  fs.writeFileSync(path.join(root, "src", "guard.mjs"), "/** Guards a store. */\nexport function storeGuard(repo) {\n  return repo;\n}\n");
  await waitForAsync(async () => {
    const { payload } = await searchJson(root, "storeGuard", ["--mode", "keyword"]);
    return payload?.hits?.some((hit) => hit.path === "src/guard.mjs");
  });

  const after = await counts(root);
  assert.ok(after.chunks > initial.chunks, "the new file added chunks");
  const alpha = await searchJson(root, "zebra", ["--mode", "keyword"]);
  assert.equal(alpha.payload.hits[0].path, "src/alpha.mjs", "the untouched file still answers");
});

test("watch: deleting a file removes its chunks, vectors and FTS rows", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("watch-delete");
  await indexRoots([root], { OLLAMA_URL: stub.url });

  const watcher = startWatcher(root, { OLLAMA_URL: stub.url });
  t.after(() => {
    watcher.child.kill();
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await watcher.ready;

  fs.rmSync(path.join(root, "src", "beta.mjs"));
  await waitForAsync(async () => {
    const { payload } = await searchJson(root, "resolveRunDir", ["--mode", "keyword"]);
    return payload && payload.hits.length === 0;
  });
  const state = await counts(root);
  assert.equal(state.chunks, state.vectors, "vectors went with the chunks");
  assert.equal(state.chunks, state.fts, "the index went with the chunks");
});

test("watch: rewriting a file with identical content embeds nothing", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("watch-noop");
  await indexRoots([root], { OLLAMA_URL: stub.url });
  const embeddedChunks = () => stub.calls.flatMap((call) => call.texts).filter((text) => text !== "probe").length;
  const embeddedBefore = embeddedChunks();

  const watcher = startWatcher(root, { OLLAMA_URL: stub.url });
  t.after(() => {
    watcher.child.kill();
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await watcher.ready;

  const same = fs.readFileSync(path.join(root, "src", "alpha.mjs"), "utf8");
  fs.writeFileSync(path.join(root, "src", "alpha.mjs"), same);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(embeddedChunks(), embeddedBefore, "an unchanged file costs no embedding");
});

test("watch: a hit for a file edited since the index says it is stale", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("watch-stale");
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await indexRoots([root], { OLLAMA_URL: stub.url });

  const fresh = await searchJson(root, "resolveRunDir", ["--mode", "keyword"]);
  assert.equal(fresh.payload.hits[0].stale, false);

  fs.writeFileSync(path.join(root, "src", "beta.mjs"), "/** Reads the run folder, now longer. */\nexport function resolveRunDir(slug) {\n  return slug + '!';\n}\n");
  const afterEdit = await searchJson(root, "resolveRunDir", ["--mode", "keyword"]);
  assert.equal(afterEdit.payload.hits[0].stale, true, "the reader is told the file moved on");
});

test("watch: a 300-file touch is one debounced batch and the store stays consistent", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("watch-storm");
  await indexRoots([root], { OLLAMA_URL: stub.url });

  const watcher = startWatcher(root, { OLLAMA_URL: stub.url });
  t.after(() => {
    watcher.child.kill();
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await watcher.ready;

  const batch = Date.now();
  for (let index = 0; index < 300; index += 1) {
    const dir = path.join(root, "src", "bulk", String(index % 10));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `file-${index}.mjs`), `export function bulk${index}() {\n  return ${index};\n}\n`);
  }
  await waitForAsync(async () => {
    const { payload } = await searchJson(root, "bulk299", ["--mode", "keyword"]);
    return payload?.hits?.some((hit) => hit.path === "src/bulk/9/file-299.mjs");
  }, { timeout: 60000 });

  const state = await counts(root);
  assert.equal(state.chunks, state.vectors);
  assert.equal(state.chunks, state.fts);
  assert.ok(Date.now() - batch > 0);
});

test("watch: a repository that disappears is reported once and the others keep working", async (t) => {
  const stub = await startStubEmbedder();
  const first = fixture("watch-gone-a");
  const second = fixture("watch-gone-b");
  await indexRoots([first, second], { OLLAMA_URL: stub.url });

  const child = spawn(process.execPath, [TOOL, "watch", "--root", first, "--root", second], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`), OLLAMA_URL: stub.url, X_SEARCH_DEBOUNCE: "200", X_SEARCH_SCAN_INTERVAL: "400" },
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  t.after(() => {
    child.kill();
    stub.close();
    fs.rmSync(second, { recursive: true, force: true });
    fs.rmSync(first, { recursive: true, force: true });
  });
  await waitFor(() => stderr.join("").includes("watching"));

  fs.rmSync(first, { recursive: true, force: true });
  await waitFor(() => /gone|missing/i.test(stderr.join("")), { timeout: 30000 });

  fs.writeFileSync(path.join(second, "src", "late.mjs"), "/** Late. */\nexport function latecomer() {\n  return 1;\n}\n");
  await waitForAsync(async () => (await searchJson(second, "latecomer", ["--mode", "keyword"])).payload?.hits?.length > 0, { timeout: 30000 });
  assert.equal(child.exitCode, null, "the watcher is still running");
});

test("watch: a symlink loop does not hang the walk", () => {
  const root = fixture("watch-loop");
  try {
    fs.symlinkSync(root, path.join(root, "src", "loop"));
    const started = Date.now();
    const result = spawnSync(process.execPath, [TOOL, "index", "--root", root, "--json"], { encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(Date.now() - started < 15000, "the pass finished");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
