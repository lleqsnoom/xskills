"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "x-search-test-env.mjs");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xskills-test-env-"));
}

/** A directory with a manifest and, for each name, an installed package a `require.resolve` finds. */
function packageDir(deps = {}, installed = []) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", devDependencies: deps }));
  for (const name of installed) {
    const target = path.join(dir, "node_modules", name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name, main: "index.js" }));
    fs.writeFileSync(path.join(target, "index.js"), "module.exports = {};\n");
  }
  return dir;
}

describe("the provisioning `npm test` runs first", async () => {
  const env = await import(pathToFileURL(SCRIPT).href);

  it("reads every declared group, so a new dependency needs no change here", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { runtime: "1" }, devDependencies: { dev: "1" }, optionalDependencies: { optional: "1" } }),
    );
    assert.deepEqual(env.declaredModules(dir), ["runtime", "dev", "optional"]);
  });

  it("names what is missing and installs only then", () => {
    const dir = packageDir({ left: "1", pad: "1" }, ["left"]);
    assert.deepEqual(env.missingModules(dir), ["pad"]);

    const calls = [];
    const spawnImpl = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      for (const name of env.missingModules(dir)) {
        const target = path.join(dir, "node_modules", name);
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name, main: "index.js" }));
        fs.writeFileSync(path.join(target, "index.js"), "module.exports = {};\n");
      }
      return { status: 0 };
    };

    assert.deepEqual(env.installDependencies({ dir, label: "fixture", spawnImpl, log: () => {} }), { installed: true, missing: ["pad"] });
    assert.deepEqual(calls, [{ command: "npm", args: ["install", "--no-audit", "--no-fund"], cwd: dir }]);
    assert.deepEqual(env.missingModules(dir), []);

    assert.deepEqual(env.installDependencies({ dir, label: "fixture", spawnImpl, log: () => {} }), { installed: false, missing: [] });
    assert.equal(calls.length, 1, "an install that is not needed is not made");
  });

  it("knows the embedders it may start from the ones it may only reach", () => {
    assert.equal(env.isLocalEmbedder("http://127.0.0.1:11434"), true);
    assert.equal(env.isLocalEmbedder("http://localhost:11434"), true);
    assert.equal(env.isLocalEmbedder("http://10.0.0.9:11434"), false);
    assert.equal(env.isLocalEmbedder("not a url"), false);
  });

  it("knows the runtimes whose `node:sqlite` is not behind a flag", () => {
    assert.equal(env.nodeHasSqlite("25.8.0"), true);
    assert.equal(env.nodeHasSqlite("24.0.0"), true);
    assert.equal(env.nodeHasSqlite("23.4.0"), true, "where Node un-flagged it");
    assert.equal(env.nodeHasSqlite("23.3.9"), false);
    assert.equal(env.nodeHasSqlite("22.13.0"), true, "and the release it was backported to");
    assert.equal(env.nodeHasSqlite("22.12.0"), false);
    assert.equal(env.nodeHasSqlite("22.5.0"), false, "where the module first appeared, still flag-only");
    assert.equal(env.nodeHasSqlite("20.11.0"), false);
  });

  it("leaves a working embedder alone", async () => {
    const events = [];
    const fetchImpl = async (url) => {
      if (url.endsWith("/api/embed")) return { ok: true, status: 200, json: async () => ({ embeddings: [[0.5, 0.5]] }) };
      throw new Error(`unexpected ${url}`);
    };
    const result = await env.ensureEmbedder({
      env: { OLLAMA_URL: "http://127.0.0.1:11434" },
      fetchImpl,
      spawnImpl: (...args) => events.push(args),
      spawnSyncImpl: (...args) => events.push(args),
      log: () => {},
    });
    assert.equal(result.started, false);
    assert.deepEqual(events, []);
  });

  it("starts the daemon and pulls the model a down embedder needs", async () => {
    const events = [];
    let serving = false;
    const fetchImpl = async (url, options) => {
      if (!serving) throw new Error("fetch failed");
      if (url.endsWith("/api/tags")) {
        return { ok: true, status: 200, json: async () => ({ models: [{ name: "other-model:latest" }] }) };
      }
      const { input } = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ embeddings: input.map(() => [0.5, 0.5]) }) };
    };
    const spawnImpl = (command, args) => {
      events.push([command, ...args]);
      serving = true;
      return { unref: () => {} };
    };
    const spawnSyncImpl = (command, args) => {
      events.push([command, ...args]);
      return { status: 0 };
    };

    const result = await env.ensureEmbedder({
      env: { OLLAMA_URL: "http://127.0.0.1:11434", X_SEARCH_EMBED_MODEL: "nomic-embed-text" },
      fetchImpl,
      spawnImpl,
      spawnSyncImpl,
      log: () => {},
    });

    assert.equal(result.started, true);
    assert.deepEqual(events, [
      ["ollama", "--version"],
      ["ollama", "serve"],
      ["ollama", "pull", "nomic-embed-text"],
    ]);
  });

  it("does not pull a model the daemon already serves", async () => {
    const events = [];
    let serving = false;
    const fetchImpl = async (url) => {
      if (!serving) throw new Error("fetch failed");
      if (url.endsWith("/api/tags")) {
        return { ok: true, status: 200, json: async () => ({ models: [{ name: "nomic-embed-text:latest" }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ embeddings: [[0.5, 0.5]] }) };
    };

    await env.ensureEmbedder({
      env: { OLLAMA_URL: "http://127.0.0.1:11434" },
      fetchImpl,
      spawnImpl: (command, args) => {
        events.push([command, ...args]);
        serving = true;
        return { unref: () => {} };
      },
      spawnSyncImpl: (command, args) => {
        events.push([command, ...args]);
        return { status: 0 };
      },
      log: () => {},
    });

    assert.deepEqual(events, [["ollama", "--version"], ["ollama", "serve"]]);
  });

  it("ends the run with the reason when there is no embedder to reach and none to start", () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, PATH: tmp(), OLLAMA_URL: "http://127.0.0.1:1" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no embedder at http:\/\/127\.0\.0\.1:1 and no `ollama` on PATH/);
    assert.match(result.stderr, /ollama\.com\/download/, "the run names the command that fixes it");
  });

  it("is what `npm test` runs before the suite", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts.pretest, "node scripts/x-search-test-env.mjs");
    assert.match(pkg.scripts.test, /^node --test/, "and the suite it precedes is unchanged");
  });
});
