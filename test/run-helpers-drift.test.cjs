"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sync = require("../scripts/sync-run-folders.js");

describe("run-folder helpers", () => {
  it("are byte-identical in every skill that carries them", () => {
    const drifted = [];
    for (const target of sync.TARGETS) {
      const file = path.join(__dirname, "..", target);
      const source = fs.readFileSync(file, "utf8");
      if (!source.includes(sync.START) || !source.includes(sync.END)) {
        drifted.push(`${target}: no region markers`);
        continue;
      }
      if (sync.withRegion(source) !== source) drifted.push(target);
    }
    assert.deepEqual(
      drifted,
      [],
      `run \`node scripts/sync-run-folders.js\` to fix:\n${drifted.join("\n")}`
    );
  });

  it("covers every skill that defines the resolver", () => {
    const skillsRoot = path.join(__dirname, "..", "skills");
    const files = [];
    for (const skill of fs.readdirSync(skillsRoot)) {
      const scripts = path.join(skillsRoot, skill, "scripts");
      if (!fs.existsSync(scripts)) continue;
      for (const name of fs.readdirSync(scripts)) {
        const file = path.join(scripts, name);
        if (!fs.statSync(file).isFile() || !/\.(js|mjs)$/.test(name)) continue;
        if (fs.readFileSync(file, "utf8").includes("function nextE(")) {
          files.push(path.relative(path.join(__dirname, ".."), file));
        }
      }
    }
    assert.deepEqual(files.sort(), [...sync.TARGETS].sort());
  });

  it("keeps the canonical block free of require and import", () => {
    assert.ok(!/require\(|^import /m.test(sync.CANONICAL), "the block must paste into ESM and CJS");
  });
});
