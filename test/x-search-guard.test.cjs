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
const DEAD_EMBEDDER = "http://127.0.0.1:1";

function startStubEmbedder({ delayMs = 0, failAfter = Infinity } = {}) {
  const state = { calls: 0 };
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
      state.calls += 1;
      const respond = () => {
        if (state.calls > failAfter) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "boom" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ model: payload.model, embeddings: inputs.map(() => new Array(DIMS).fill(0.5)) }));
      };
      if (delayMs) setTimeout(respond, delayMs);
      else respond();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, state, close: () => server.close() }));
  });
}

function runAsync(args, env = {}, timeoutMs = 30000) {
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

function fixture(label = "guard", files = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `x-search-${label}-`));
  const contents = files || { "src/alpha.mjs": "/** Alpha. */\nexport function zebra() {\n  return 1;\n}\n" };
  for (const [rel, body] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

function isolatedGitEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-home-"));
  return { home, env: { HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_GLOBAL: path.join(home, "gitconfig"), GIT_CONFIG_SYSTEM: "/dev/null" } };
}

function gitInit(root, { track = true, ignore = false } = {}) {
  const run = (args) => require("node:child_process").execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  run(["init", "-q"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "test"]);
  if (track) {
    fs.mkdirSync(path.join(root, ".x-skills"), { recursive: true });
    fs.writeFileSync(path.join(root, ".x-skills", "keep.md"), "# kept\n");
    run(["add", "-f", ".x-skills/keep.md"]);
    run(["commit", "-qm", "keep"]);
  }
  if (ignore) fs.writeFileSync(path.join(root, ".gitignore"), "/.x-skills\n");
}

const storeModule = () => import(new URL("../tools/x-search/src/store.mjs", `file://${__filename}`).href);

async function storeState(root) {
  const { openStore, countRows, metaAll } = await storeModule();
  const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
  const state = { chunks: countRows(db, "chunks"), meta: metaAll(db) };
  db.close();
  return state;
}

test("guard: a tracked, unignored .x-skills is refused before anything is written", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture();
  gitInit(root, { track: true, ignore: false });
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const isolated = isolatedGitEnv();
  t.after(() => fs.rmSync(isolated.home, { recursive: true, force: true }));
  const result = await runAsync(["index", "--root", root], { OLLAMA_URL: stub.url, ...isolated.env });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /refusing to index/);
  assert.match(result.stderr, /echo '\/\.x-skills' >>/);
  assert.equal(fs.existsSync(path.join(root, ".x-skills", ".index")), false, "no store was created");
});

test("guard: --allow-dirty indexes the same repository", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("guard-dirty");
  gitInit(root, { track: true, ignore: false });
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const isolated = isolatedGitEnv();
  t.after(() => fs.rmSync(isolated.home, { recursive: true, force: true }));
  const result = await runAsync(["index", "--root", root, "--allow-dirty"], { OLLAMA_URL: stub.url, ...isolated.env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(root, ".x-skills", ".index", "index.db")), true);
});

test("guard: an ignored .x-skills and a plain directory both index quietly", async (t) => {
  const stub = await startStubEmbedder();
  const ignored = fixture("guard-ignored");
  const plain = fixture("guard-plain");
  gitInit(ignored, { track: true, ignore: true });
  t.after(() => {
    stub.close();
    fs.rmSync(ignored, { recursive: true, force: true });
    fs.rmSync(plain, { recursive: true, force: true });
  });

  const isolated = isolatedGitEnv();
  t.after(() => fs.rmSync(isolated.home, { recursive: true, force: true }));
  const one = await runAsync(["index", "--root", ignored], { OLLAMA_URL: stub.url, ...isolated.env });
  assert.equal(one.status, 0, one.stderr);
  assert.doesNotMatch(one.stderr, /refusing/);

  const two = await runAsync(["index", "--root", plain], { OLLAMA_URL: stub.url });
  assert.equal(two.status, 0, two.stderr);
});

test("guard: the embedder being down leaves an existing store intact and searchable", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("guard-embedder");
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const first = await runAsync(["index", "--root", root], { OLLAMA_URL: stub.url });
  assert.equal(first.status, 0, first.stderr);
  const before = await storeState(root);

  fs.writeFileSync(path.join(root, "src", "alpha.mjs"), "/** Alpha, edited. */\nexport function zebra() {\n  return 2;\n}\n");
  const second = await runAsync(["index", "--root", root], { OLLAMA_URL: DEAD_EMBEDDER });
  assert.equal(second.status, 3);
  assert.match(second.stderr, /embedder unreachable/);
  assert.equal((await storeState(root)).chunks, before.chunks, "the store kept its rows");

  const found = await runAsync(["search", "zebra", "--root", root, "--mode", "keyword", "--json"], { OLLAMA_URL: DEAD_EMBEDDER });
  assert.equal(found.status, 0);
  assert.equal(JSON.parse(found.stdout).hits.length > 0, true);
});

test("guard: a store from a newer version is refused without being modified", async (t) => {
  const stub = await startStubEmbedder();
  const root = fixture("guard-schema");
  t.after(() => {
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await runAsync(["index", "--root", root], { OLLAMA_URL: stub.url });
  const store = path.join(root, ".x-skills", ".index", "index.db");
  const { openStore, metaSet } = await storeModule();
  const db = openStore(store);
  metaSet(db, "schema", 99);
  db.close();
  const before = fs.statSync(store).mtimeMs;

  const result = await runAsync(["index", "--root", root], { OLLAMA_URL: stub.url });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /newer x-search/);
  assert.equal(fs.statSync(store).mtimeMs, before, "the refused store was not written");
});

test("guard: SIGINT mid-build leaves a resumable pending list and exit 130", async (t) => {
  const files = {};
  for (let index = 0; index < 12; index += 1) {
    files[`src/file-${index}.mjs`] = `/** File ${index}. */\nexport function file${index}() {\n  return ${index};\n}\n`;
  }
  const slow = await startStubEmbedder({ delayMs: 400 });
  const root = fixture("guard-sigint", files);
  t.after(() => {
    slow.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const child = spawn(process.execPath, [TOOL, "index", "--root", root], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`), OLLAMA_URL: slow.url, X_SEARCH_BATCH_SIZE: "2" },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const batches = () => (stderr.match(/embedded \d+ chunks/g) || []).length;
  await new Promise((resolve) => {
    const poll = setInterval(() => {
      if (batches() >= 2) {
        clearInterval(poll);
        child.kill("SIGINT");
        resolve();
      }
    }, 50);
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 130);
  assert.match(stderr, /resume with/);

  const state = await storeState(root);
  assert.ok(state.meta.pending, "the pending list was written");
  assert.ok(JSON.parse(state.meta.pending).length > 0);

  const fast = await startStubEmbedder();
  t.after(() => fast.close());
  const resumed = await runAsync(["index", "--root", root, "--json"], { OLLAMA_URL: fast.url, X_SEARCH_BATCH_SIZE: "2" });
  assert.equal(resumed.status, 0, resumed.stderr);
  const after = await storeState(root);
  assert.equal(after.meta.pending ?? null, null, "the pending list was cleared when the build finished");
  assert.equal(after.chunks >= state.chunks, true);
});

test("guard: a batch that fails mid-way rolls back and counts stay consistent", async (t) => {
  const files = {};
  for (let index = 0; index < 8; index += 1) {
    files[`src/roll-${index}.mjs`] = `/** Roll ${index}. */\nexport function roll${index}() {\n  return ${index};\n}\n`;
  }
  const flaky = await startStubEmbedder({ failAfter: 1 });
  const root = fixture("guard-rollback", files);
  t.after(() => {
    flaky.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const result = await runAsync(["index", "--root", root], { OLLAMA_URL: flaky.url, X_SEARCH_BATCH_SIZE: "2" });
  assert.equal(result.status, 3, result.stderr);
  const { openStore, countRows, countVectors } = await storeModule();
  const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
  assert.equal(countRows(db, "chunks"), countVectors(db), "no chunk without its vector");
  assert.equal(countRows(db, "chunks"), countRows(db, "chunks_fts"), "no chunk without its index row");
  db.close();
});
