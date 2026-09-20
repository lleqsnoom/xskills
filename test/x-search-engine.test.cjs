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
  let calls = 0;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
      calls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: payload.model, embeddings: inputs.map(() => new Array(DIMS).fill(0.5)) }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls: () => calls, close: () => server.close() }));
  });
}

function runAsync(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`), ...env } });
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

function fixture(label, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `x-search-${label}-`));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const storeModule = () => import(new URL("../tools/x-search/src/store.mjs", `file://${__filename}`).href);

// npm run test exports npm_config_* into the test process; a nested npm run inside the suite then
// inherits flags it refuses (EALLOWSCRIPTS), so the child gets a clean npm environment.
const npmEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_")));

test("engine: vec0 is used when the binary resolves, and the store says so", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("engine-vec0", { "src/a.mjs": "/** Alpha. */\nexport function zebra() {\n  return 1;\n}\n" });
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const indexed = await runAsync(["index", "--root", root, "--json"], { OLLAMA_URL: stub.url });
  assert.equal(indexed.status, 0, indexed.stderr);
  const { openStore, metaAll, countVectors, hasTable } = await storeModule();
  const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
  assert.equal(metaAll(db).engine, "vec0");
  assert.equal(hasTable(db, "vec_rows"), true);
  assert.equal(countVectors(db) > 0, true);
  db.close();

  const found = await runAsync(["search", "zebra", "--root", root, "--json"], { OLLAMA_URL: stub.url });
  assert.equal(found.status, 0, found.stderr);
  assert.equal(JSON.parse(found.stdout).hits[0].path, "src/a.mjs");
});

test("engine: the blob path is used when vec0 is unavailable, and search still answers", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("engine-blob", { "src/a.mjs": "/** Alpha. */\nexport function zebra() {\n  return 1;\n}\n" });
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const indexed = await runAsync(["index", "--root", root, "--json"], { OLLAMA_URL: stub.url, X_SEARCH_NO_VEC0: "1" });
  assert.equal(indexed.status, 0, indexed.stderr);
  const { openStore, metaAll, countVectors, hasTable } = await storeModule();
  const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
  assert.equal(metaAll(db).engine, "blob");
  assert.equal(hasTable(db, "vectors"), true);
  assert.equal(hasTable(db, "vec_rows"), false);
  assert.equal(countVectors(db) > 0, true);
  db.close();

  const found = await runAsync(["search", "run folder", "--root", root, "--json"], { OLLAMA_URL: stub.url, X_SEARCH_NO_VEC0: "1" });
  assert.equal(found.status, 0, found.stderr);
  assert.equal(JSON.parse(found.stdout).hits.length > 0, true);
});

test("engine: a vec0 store read without the binary degrades to keyword instead of failing", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("engine-mismatch", { "src/a.mjs": "/** Alpha. */\nexport function zebra() {\n  return 1;\n}\n" });
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await runAsync(["index", "--root", root], { OLLAMA_URL: stub.url });

  const found = await runAsync(["search", "zebra", "--root", root, "--json"], { OLLAMA_URL: stub.url, X_SEARCH_NO_VEC0: "1" });
  assert.equal(found.status, 0, found.stderr);
  const payload = JSON.parse(found.stdout);
  assert.ok(payload.hits.length > 0, "the keyword side answered");
  assert.match(payload.index.degraded || "", /vector engine unavailable/);
});

test("engine: a bogus X_SEARCH_VEC0 falls back to the platform binary", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("engine-bogus", { "src/a.mjs": "/** Alpha. */\nexport function zebra() {\n  return 1;\n}\n" });
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const indexed = await runAsync(["index", "--root", root], { OLLAMA_URL: stub.url, X_SEARCH_VEC0: "/nonexistent/vec0.so" });
  assert.equal(indexed.status, 0, indexed.stderr);
  assert.doesNotMatch(indexed.stderr, /Error:/);
});

test("engine: the package packs, installs into a scratch directory and answers from there", async (t) => {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-pack-"));
  t.after(() => fs.rmSync(staging, { recursive: true, force: true }));
  const pack = spawnSync("npm", ["pack", "--pack-destination", staging, "--silent"], {
    encoding: "utf8",
    cwd: path.resolve(__dirname, "..", "tools", "x-search"),
    env: npmEnv(),
  });
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = fs
    .readdirSync(staging)
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => path.join(staging, name))
    .find(Boolean);
  assert.ok(tarball, `npm pack produced a tarball (${pack.stdout.trim().slice(-120)})`);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-scratch-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const installed = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefix", scratch, tarball], {
    encoding: "utf8",
    timeout: 180000,
    env: npmEnv(),
  });
  assert.equal(installed.status, 0, installed.stderr);

  const listed = spawnSync(path.join(scratch, "node_modules", ".bin", "x-search"), ["help"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /x-search index/);

  const listedFiles = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" }).stdout;
  assert.match(listedFiles, /package\/src\/cli\.mjs/);
  assert.doesNotMatch(listedFiles, /package\/test\//, "tests are not shipped");
});

test("engine: the published x-skills package still declares no runtime dependencies", () => {
  const manifest = require(path.resolve(__dirname, "..", "package.json"));
  assert.deepEqual(Object.keys(manifest.dependencies || {}), []);
  const tool = require(path.resolve(__dirname, "..", "tools", "x-search", "package.json"));
  assert.ok(tool.optionalDependencies["sqlite-vec"], "sqlite-vec is optional, never required");
  assert.equal(tool.dependencies["sqlite-vec"], undefined);
  assert.ok(tool.dependencies["web-tree-sitter"], "the grammar loader is a real dependency of the tool");
  assert.equal(tool.dependencies["sqlite-vec"], undefined, "sqlite-vec must stay optional");
});
