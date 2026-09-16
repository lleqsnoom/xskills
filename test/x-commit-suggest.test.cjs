"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SUGGEST = path.join(__dirname, "..", "skills", "x-commit", "scripts", "suggest-type.mjs");

const diffOf = (...headers) => headers.map((header) => `${header}\n@@ -1 +1 @@\n-a\n+b\n`).join("");

describe("x-commit suggest-type — scope from the diff header", async () => {
  const mod = await import(SUGGEST);

  it("reads the new-side path of every file", () => {
    assert.deepEqual(
      mod.parseDiffPaths(diffOf("diff --git a/skills/x-commit/scripts/a.mjs b/skills/x-commit/scripts/a.mjs")),
      ["skills/x-commit/scripts/a.mjs"]
    );
    assert.deepEqual(
      mod.parseDiffPaths(
        diffOf(
          "diff --git a/lib/install.js b/lib/install.js",
          "diff --git a/README.md b/README.md"
        )
      ),
      ["lib/install.js", "README.md"]
    );
  });

  it("unquotes a path that git quoted", () => {
    assert.deepEqual(
      mod.parseDiffPaths(diffOf('diff --git "a/my docs/plan.md" "b/my docs/plan.md"')),
      ["my docs/plan.md"],
      "a quoted path keeps its space and loses its quotes"
    );
  });

  it("copes with prefixes other than a/ and b/", () => {
    assert.deepEqual(
      mod.parseDiffPaths(diffOf("diff --git i/.agents/rules/xskills.md w/.agents/rules/xskills.md")),
      [".agents/rules/xskills.md"],
      "git's prefixes are configurable, so they are not assumed to be a/ and b/"
    );
    assert.deepEqual(
      mod.parseDiffPaths(diffOf("diff --git skills/x-commit/a.mjs skills/x-commit/a.mjs")),
      ["skills/x-commit/a.mjs"],
      "and there may be no prefix at all"
    );
  });

  it("takes the file list from git when it has one", () => {
    const diff = diffOf("diff --git a/one/a.js b/one/a.js", "diff --git a/one/b.js b/one/b.js");
    assert.equal(mod.suggestScope(diff, ["docs/readme.md"]), "docs");
    assert.equal(mod.suggestScope(diff, ["one/a.js", "two/b.js"]), null);
  });

  it("never returns a fragment of the header as a scope", () => {
    const diff = diffOf("diff --git a/skills/x-commit/scripts/a.mjs b/skills/x-commit/scripts/a.mjs");
    const scope = mod.suggestScope(diff);
    assert.equal(scope, "skills");
    assert.doesNotMatch(String(scope), /diff/, "the header is not the answer");
  });

  it("prefers a known scope, and returns null when the files disagree", () => {
    assert.equal(mod.suggestScope(diffOf("diff --git a/src/a.js b/src/a.js")), "src");
    assert.equal(
      mod.suggestScope(diffOf("diff --git a/one/a.js b/one/a.js", "diff --git a/two/b.js b/two/b.js")),
      null,
      "two top-level directories name no scope"
    );
    assert.equal(mod.suggestScope(""), null);
  });

  it("still classifies a diff by type", () => {
    const added = `diff --git a/x.js b/x.js\n@@ -0,0 +1,120 @@\n${"+const x = 1;\n".repeat(120)}`;
    assert.equal(mod.suggestType(added), "feat");
  });
});
