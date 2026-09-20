"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const TOOL = path.resolve(__dirname, "..", "tools", "x-search", "src", "cli.mjs");
const CHILD_ENV = { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`) };
const chunkModule = () => import(pathToFileURL(path.resolve(__dirname, "..", "tools", "x-search", "src", "chunk.mjs")).href);
const storeModule = () => import(pathToFileURL(path.resolve(__dirname, "..", "tools", "x-search", "src", "store.mjs")).href);

const JS_SOURCE = `/** Runs a skill by name. */
export function zebra(name) {
  return run(name);
}

const unrelated = 1;
`;

const PY_SOURCE = `@decorator
def alpha():
    return 1


@other
def beta():
    return 2
`;

function fixture(files, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `x-search-${label}-`));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

test("chunking: a documented function is one symbol chunk that starts at its docstring", async () => {
  const { chunkSource } = await chunkModule();
  const chunks = await chunkSource(JS_SOURCE, { relPath: "src/alpha.mjs", lang: "javascript" });
  const symbols = chunks.filter((chunk) => chunk.kind === "symbol");
  assert.equal(symbols.length, 1, `expected one symbol chunk, got ${JSON.stringify(chunks.map((c) => [c.kind, c.symbol]))}`);
  assert.equal(symbols[0].symbol, "zebra");
  assert.match(symbols[0].text, /^\/\*\* Runs a skill by name\. \*\//);
  assert.equal(symbols[0].startLine, 1);
  assert.equal(symbols[0].endLine, 4);
});

test("chunking: python decorators stay inside their function's chunk", async () => {
  const { chunkSource } = await chunkModule();
  const chunks = await chunkSource(PY_SOURCE, { relPath: "src/beta.py", lang: "python" });
  const symbols = chunks.filter((chunk) => chunk.kind === "symbol");
  assert.deepEqual(symbols.map((chunk) => chunk.symbol).sort(), ["alpha", "beta"]);
  for (const chunk of symbols) assert.match(chunk.text, /^@/);
  assert.equal(symbols.find((chunk) => chunk.symbol === "alpha").endLine, 3);
});

test("chunking: markdown is windows and says so", async () => {
  const { chunkSource } = await chunkModule();
  const chunks = await chunkSource("# Title\n\nbody text\n", { relPath: "src/notes.md", lang: "markdown" });
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every((chunk) => chunk.kind === "window"));
});

test("chunking: re-indexing the same file twice does not grow the store", async () => {
  const root = fixture({ "src/alpha.mjs": JS_SOURCE, "src/beta.py": PY_SOURCE }, "chunk-idem");
  try {
    const first = spawnSync(process.execPath, [TOOL, "index", "--root", root, "--json"], { encoding: "utf8", env: CHILD_ENV });
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSync(process.execPath, [TOOL, "index", "--root", root, "--json"], { encoding: "utf8", env: CHILD_ENV });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).chunks, JSON.parse(first.stdout).chunks);
    const { openStore, countRows } = await storeModule();
    const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
    assert.equal(countRows(db, "chunks"), JSON.parse(first.stdout).chunks);
    db.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("chunking: a file that will not parse falls back to windows and says so", async () => {
  const root = fixture({ "src/broken.mjs": "export function broken( {\n  return 1\n" }, "chunk-broken");
  try {
    const result = spawnSync(process.execPath, [TOOL, "index", "--root", root, "--json"], { encoding: "utf8", env: CHILD_ENV });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /parse failed/i);
    const { openStore } = await storeModule();
    const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
    const kinds = db.prepare("SELECT kind, count(*) AS n FROM chunks GROUP BY kind").all().map((row) => `${row.kind}:${row.n}`);
    assert.deepEqual(kinds, [`window:${kinds.length ? kinds[0].split(":")[1] : 0}`], "every chunk of an unparseable file is a window");
    db.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("chunking: a language with no grammar installs nothing and uses windows", async () => {
  const root = fixture({ "src/one.rb": "def alpha\n  1\nend\n" }, "chunk-nogrammar");
  try {
    const result = spawnSync(process.execPath, [TOOL, "index", "--root", root, "--json"], { encoding: "utf8", env: CHILD_ENV });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no grammar for ruby/);
    const { openStore } = await storeModule();
    const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
    assert.equal(db.prepare("SELECT count(*) AS n FROM chunks WHERE kind = 'window'").get().n > 0, true);
    db.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("chunking: a file above the size ceiling is skipped, and no chunk is oversized", async () => {
  const big = `// generated\n${"const x = 1;\n".repeat(120000)}`;
  const root = fixture({ "src/huge.js": big, "src/small.mjs": JS_SOURCE }, "chunk-huge");
  try {
    const result = spawnSync(process.execPath, [TOOL, "index", "--root", root, "--json"], { encoding: "utf8", env: CHILD_ENV });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.skipped >= 1, "the oversized file is counted as skipped");
    const { openStore } = await storeModule();
    const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
    const longest = db.prepare("SELECT max(length(text)) AS n FROM chunks").get().n;
    assert.ok(longest <= 8192, `no chunk over 8 KB, longest was ${longest}`);
    db.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
