"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TOOL = path.resolve(__dirname, "..", "tools", "x-search", "src", "cli.mjs");
const DEAD_EMBEDDER = { OLLAMA_URL: "http://127.0.0.1:1" };

const FILES = {
  "src/gamma.mjs": "/** Reads the run folder for a slug. */\nexport function resolveRunDir(slug) {\n  return join('runs', slug);\n}\n",
  "src/delta.mjs": "/** Copies a skill from the package into a project. */\nexport function installSkill(name) {\n  return copyDir(join('skills', name), join('.agents', 'skills', name));\n}\n",
  "docs/notes.md": "# Run folders\n\nA run folder is where a run writes its artifacts. Nothing here names a function.\n",
};

function fixture(files = FILES, label = "search") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `x-search-${label}-`));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  fs.mkdirSync(path.join(root, ".x-skills"), { recursive: true });
  return root;
}

function run(args, env) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", env: { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`), ...env } });
}

function indexAll(roots, env) {
  const args = roots.flatMap((root) => ["--root", root]);
  const result = run(["index", ...args, "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function search(query, roots, extra = [], env) {
  const args = roots.flatMap((root) => ["--root", root]);
  const result = run(["search", query, ...args, ...extra, "--json"], env);
  return { status: result.status, stderr: result.stderr, payload: result.stdout ? JSON.parse(result.stdout) : null };
}

test("search: keyword mode finds an exact identifier with the embedder down", () => {
  const root = fixture();
  try {
    indexAll([root]);
    const { status, payload } = search("resolveRunDir", [root], ["--mode", "keyword"], DEAD_EMBEDDER);
    assert.equal(status, 0);
    assert.equal(payload.hits[0].path, "src/gamma.mjs");
    assert.equal(payload.hits[0].symbol, "resolveRunDir");
    assert.equal(payload.index.degraded, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("search: hybrid finds a described behaviour that shares no words with the file", () => {
  const root = fixture();
  try {
    indexAll([root]);
    const { payload } = search("how does a skill get copied into a project", [root], ["--mode", "hybrid"]);
    assert.ok(
      payload.hits.slice(0, 3).some((hit) => hit.path === "src/delta.mjs"),
      `expected delta.mjs in the top 3, got ${payload.hits.map((hit) => hit.path).join(", ")}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("search: a document found by both rankers outranks one found by only one", () => {
  const root = fixture({
    "src/both.mjs": "/** Installs a skill by copying it. */\nexport function installSkillCopy(name) {\n  return copy(name);\n}\n",
    "src/only-word.mjs": "/** Filler, mentioned once. */\nexport function filler() {\n  // a skill gets copied into a project by this helper\n  return 1;\n}\n",
  }, "rrf");
  try {
    indexAll([root]);
    const { payload } = search("installSkillCopy", [root], ["--mode", "hybrid", "--limit", "5"]);
    assert.equal(payload.hits[0].path, "src/both.mjs", `expected the both-rankers document first, got ${JSON.stringify(payload.hits.map((h) => h.path))}`);
    assert.equal(payload.index.mode, "hybrid");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("search: chunks_fts stays in step with chunks", async () => {
  const root = fixture();
  try {
    indexAll([root]);
    const { openStore, countRows } = await import(new URL("../tools/x-search/src/store.mjs", `file://${__filename}`).href);
    const db = openStore(path.join(root, ".x-skills", ".index", "index.db"), { readOnly: true });
    assert.equal(countRows(db, "chunks_fts"), countRows(db, "chunks"));
    assert.ok(countRows(db, "chunks_fts") > 0);
    db.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("search: two repositories are told apart, and --project scopes to one", () => {
  const first = fixture(FILES, "multi-a");
  const second = fixture({ "src/only.mjs": "/** Installs a skill. */\nexport function installSkill(name) {\n  return name;\n}\n" }, "multi-b");
  try {
    indexAll([first, second]);
    const together = search("installSkill", [first, second], ["--mode", "keyword", "--limit", "10"], DEAD_EMBEDDER);
    const projects = new Set(together.payload.hits.map((hit) => hit.project));
    assert.equal(projects.size, 2, `expected hits from both projects, got ${[...projects].join(", ")}`);

    const scoped = search("installSkill", [first, second], ["--project", path.basename(second), "--mode", "keyword"], DEAD_EMBEDDER);
    assert.ok(scoped.payload.hits.length > 0);
    assert.ok(scoped.payload.hits.every((hit) => hit.project === path.basename(second)));
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test("search: vector mode without the embedder is an error, not an empty answer", () => {
  const root = fixture();
  try {
    indexAll([root]);
    const { status, stderr } = search("anything at all", [root], ["--mode", "vector"], DEAD_EMBEDDER);
    assert.equal(status, 3);
    assert.match(stderr, /embedder unreachable/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("search: a query too short for keyword says so and still answers from vectors", () => {
  const root = fixture();
  try {
    indexAll([root]);
    const { status, payload } = search("a b", [root], ["--mode", "hybrid"], DEAD_EMBEDDER);
    assert.equal(status, 0);
    assert.match(payload.index.degraded, /too short for keyword/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("search: a corrupt store is reported missing while the others still answer", () => {
  const good = fixture();
  const broken = fixture(FILES, "search-broken");
  try {
    indexAll([good, broken]);
    fs.writeFileSync(path.join(broken, ".x-skills", ".index", "index.db"), "not a database");
    const { status, payload } = search("resolveRunDir", [good, broken], ["--mode", "keyword"], DEAD_EMBEDDER);
    assert.equal(status, 0, "the query still answers from the store that is readable");
    assert.ok(payload.hits.length > 0);
    assert.ok(payload.index.unreadable.includes(path.basename(broken)), `expected the broken project named, got ${JSON.stringify(payload.index)}`);
  } finally {
    fs.rmSync(good, { recursive: true, force: true });
    fs.rmSync(broken, { recursive: true, force: true });
  }
});
