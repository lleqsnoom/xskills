"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const REGISTRY = path.join(ROOT, "tools", "x-search", "src", "registry.mjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "xskills-registry-"));
const storeAt = (name) => `/code/${name}/.x-skills/.index/index.db`;

/** Each writer's entry only lands if the file was read after the writer before it finished. */
function writeInParallel(state, names) {
  const module = pathToFileURL(REGISTRY).href;
  return Promise.all(
    names.map(
      (name) =>
        new Promise((resolve) => {
          const child = spawn(
            process.execPath,
            ["--input-type=module", "--eval", `import { recordStore } from ${JSON.stringify(module)}; recordStore(${JSON.stringify(storeAt(name))}, process.env);`],
            { env: { ...process.env, X_SEARCH_STATE: state } },
          );
          child.on("exit", resolve);
        }),
    ),
  );
}

describe("the store registry", async () => {
  const registry = await import(pathToFileURL(REGISTRY).href);
  const env = (state) => ({ X_SEARCH_STATE: state });

  it("records a store once, in order", () => {
    const state = path.join(tmp(), "stores.json");
    registry.recordStore(storeAt("b"), env(state));
    registry.recordStore(storeAt("a"), env(state));
    registry.recordStore(storeAt("b"), env(state));
    assert.deepEqual(registry.readRegistry(env(state)), [storeAt("a"), storeAt("b")]);
  });

  it("mutates the list as it stands now, not as the caller last saw it", () => {
    const state = path.join(tmp(), "stores.json");
    registry.recordStore(storeAt("a"), env(state));
    registry.updateRegistry((stores) => [...stores, storeAt("b")], env(state));
    assert.deepEqual(registry.readRegistry(env(state)), [storeAt("a"), storeAt("b")]);
  });

  it("keeps every entry when several writers race for the file", async () => {
    const state = path.join(tmp(), "stores.json");
    const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
    await writeInParallel(state, names);
    assert.deepEqual(registry.readRegistry(env(state)), names.map(storeAt).sort());
  });

  it("reclaims a lock left behind by a writer that died", () => {
    const state = path.join(tmp(), "stores.json");
    fs.writeFileSync(`${state}.lock`, "999999");
    fs.utimesSync(`${state}.lock`, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
    registry.recordStore(storeAt("a"), env(state));
    assert.deepEqual(registry.readRegistry(env(state)), [storeAt("a")]);
    assert.equal(fs.existsSync(`${state}.lock`), false, "the stale lock is gone");
  });

  it("publishes through a temp file and leaves nothing behind", () => {
    const dir = tmp();
    const state = path.join(dir, "stores.json");
    registry.recordStore(storeAt("a"), env(state));
    assert.deepEqual(fs.readdirSync(dir), ["stores.json"], "no lock and no half-written temp file survive the write");
    assert.deepEqual(JSON.parse(fs.readFileSync(state, "utf8")), { stores: [storeAt("a")] });
  });
});
