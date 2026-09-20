"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const TOOL = path.resolve(__dirname, "..", "tools", "x-search", "src", "cli.mjs");
const FIXTURE_FILES = {
  "src/alpha.mjs":
    "/** Runs a skill by name. */\nexport function zebraquokka(name) {\n  return run(name);\n}\n\nexport function other() {\n  return 1;\n}\n",
  "src/beta.mjs": "/** Reads the run folder. */\nimport { join } from 'node:path';\nexport function resolveRunDir(slug) {\n  return join('runs', slug);\n}\n",
  "src/gamma.md": "# Zebraquokka notes\n\nThe zebraquokka token lives in alpha.mjs as a function name.\n\n## Details\n\nNothing else to see here.\n",
  "notes.txt": "zebraquokka zebraquokka\n",
  "package-lock.json": JSON.stringify({ name: "fixture", lockfileVersion: 3 }),
  "node_modules/dep/index.js": "module.exports = { zebraquokka: true };\n",
};

function buildFixture(label = "x-search-fixture-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  fs.mkdirSync(path.join(root, ".x-skills"), { recursive: true });
  fs.writeFileSync(path.join(root, ".x-skills", ".gitignore"), "/.index\n");
  return root;
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [TOOL, ...args], {
    encoding: "utf8",
    env: { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`), X_SEARCH_EMBED_CACHE: "0", ...options.env },
    cwd: options.cwd,
  });
}

function snapshotTree(root) {
  const entries = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (rel.startsWith(".x-skills" + path.sep + ".index")) continue;
      if (entry.isDirectory()) walk(abs);
      else entries.push(`${rel}:${fs.statSync(abs).size}`);
    }
  };
  walk(root);
  return entries.sort();
}

function ollamaUp() {
  const probe = spawnSync(process.execPath, ["-e", `
    fetch(process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/tags")
      .then((r) => process.exit(r.ok ? 0 : 1))
      .catch(() => process.exit(1));
  `], { timeout: 5000 });
  return probe.status === 0;
}

test("x-search: indexes a repository into .x-skills/.index and searches it", (t) => {
  if (!ollamaUp()) {
    assert.fail("embedder unreachable: start ollama serve (this test must not skip)");
  }
  const root = buildFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const before = snapshotTree(root);
  const indexed = run(["index", "--root", root, "--json"]);
  assert.equal(indexed.status, 0, indexed.stderr);

  const report = JSON.parse(indexed.stdout);
  assert.ok(report.files >= 4, `expected >=4 files, got ${report.files}`);
  assert.ok(report.skipped >= 2, `expected the lockfile and node_modules skipped, got ${report.skipped}`);
  assert.equal(report.store, path.join(root, ".x-skills", ".index", "index.db"));
  assert.ok(fs.existsSync(report.store), "store file exists");

  assert.deepEqual(snapshotTree(root), before, "nothing outside .x-skills/.index changed");

  const found = run(["search", "zebraquokka", "--root", root, "--json"]);
  assert.equal(found.status, 0, found.stderr);
  const hits = JSON.parse(found.stdout).hits;
  assert.ok(hits.length > 0, "at least one hit");
  assert.ok(
    hits.some((hit) => hit.path === "src/alpha.mjs"),
    `alpha.mjs expected among the hits, got ${hits.map((h) => h.path).join(", ")}`,
  );
  const carrying = hits.filter((hit) => fs.readFileSync(path.join(root, hit.path), "utf8").toLowerCase().includes("zebraquokka"));
  assert.ok(carrying.length > 0, "at least one hit comes from a file that mentions the token");
  assert.ok(hits[0].snippet.toLowerCase().includes("zebraquokka"), `the top hit is about the query, got ${hits[0].path}:${hits[0].lineStart}`);
  assert.ok(hits[0].lineStart >= 1 && hits[0].lineEnd >= hits[0].lineStart, "the hit carries a usable line range");

  const again = run(["index", "--root", root, "--json"]);
  assert.equal(again.status, 0, again.stderr);
  const { openStore, countRows } = require(path.resolve(__dirname, "..", "tools", "x-search", "src", "store.mjs"));
  const second = JSON.parse(again.stdout);
  assert.equal(second.chunks, report.chunks, "re-indexing unchanged files adds no chunks");
  const db = openStore(second.store, { readOnly: true });
  assert.equal(countRows(db, "chunks"), report.chunks);
  assert.equal(countRows(db, "chunks") > 0, true);
});

test("x-search: --root that does not exist exits 2", () => {
  const result = run(["index", "--root", path.join(os.tmpdir(), "x-search-missing-root")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no such root/i);
});

test("x-search: with the embedder down a fresh index exits 3 and writes nothing", () => {
  const root = buildFixture("x-search-nostore-");
  try {
    const result = run(["index", "--root", root], { env: { OLLAMA_URL: "http://127.0.0.1:1" } });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /embedder unreachable/i);
    assert.equal(fs.existsSync(path.join(root, ".x-skills", ".index", "index.db")), false, "no store was created");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("x-search: --json keeps stdout to one object and logs on stderr", () => {
  if (!ollamaUp()) assert.fail("embedder unreachable: start ollama serve");
  const root = buildFixture("x-search-json-");
  try {
    const result = run(["index", "--root", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
    assert.ok(result.stderr.length > 0, "progress goes to stderr");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("x-search: search with no store answers missing rather than failing", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-empty-"));
  try {
    const result = run(["search", "anything", "--root", empty, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.hits.length, 0);
    assert.equal(payload.index.missing, true);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("x-search: the root package still declares no runtime dependencies", () => {
  const manifest = require(path.resolve(__dirname, "..", "package.json"));
  assert.deepEqual(Object.keys(manifest.dependencies || {}), []);
  assert.ok(!(manifest.files || []).some((entry) => entry.startsWith("tools")), "tools/ is not published");
});

test("x-search: a repository with no .x-skills gets one, and nothing else is touched", () => {
  if (!ollamaUp()) assert.fail("embedder unreachable: start ollama serve");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-bare-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "only.mjs"), "export const zebraquokka = 1;\n");
  try {
    assert.equal(fs.existsSync(path.join(root, ".x-skills")), false);
    const result = run(["index", "--root", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(fs.existsSync(path.join(root, ".x-skills", ".index", "index.db")), true);
    assert.deepEqual(fs.readdirSync(path.join(root, ".x-skills")).sort(), [".index"]);
    assert.equal(report.files, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
