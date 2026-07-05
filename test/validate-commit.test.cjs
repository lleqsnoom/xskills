"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const VALIDATE_SCRIPT = path.join(
  __dirname,
  "..",
  "skills",
  "x-commit",
  "scripts",
  "validate-commit.js"
);

/**
 * Run validate-commit.js with the given message and return { code, stdout, stderr }.
 */
function runValidate(msg) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [VALIDATE_SCRIPT, msg], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

// ── Valid conventional commit messages ──────────────────────────────

describe("validate-commit.js — valid messages", () => {
  it("accepts a simple feat message", async () => {
    const res = await runValidate("feat: add user authentication");
    assert.equal(res.code, 0);
    assert.match(res.stdout, /^OK:/);
  });

  it("accepts a feat with scope", async () => {
    const res = await runValidate("feat(auth): add OAuth2 login");
    assert.equal(res.code, 0);
    assert.match(res.stdout, /^OK:/);
  });

  it("accepts a fix with scope", async () => {
    const res = await runValidate("fix(parser): handle missing closing tag");
    assert.equal(res.code, 0);
    assert.match(res.stdout, /^OK:/);
  });

  it("accepts all valid conventional commit types", async () => {
    const types = [
      "feat: new feature",
      "fix: bug fix",
      "docs: update readme",
      "style: format code",
      "refactor: restructure module",
      "perf: optimize query",
      "test: add unit tests",
      "build: update deps",
      "ci: add github actions",
      "chore: clean up",
      "revert: undo last commit",
    ];
    for (const msg of types) {
      const res = await runValidate(msg);
      assert.equal(res.code, 0, `Expected OK for: ${msg}`);
    }
  });

  it("accepts breaking change with ! prefix", async () => {
    const res = await runValidate("feat(api)!: remove deprecated endpoints");
    assert.equal(res.code, 0);
    assert.match(res.stdout, /^OK:/);
  });

  it("accepts message with parentheses in scope", async () => {
    const res = await runValidate("chore(deps): update packages");
    assert.equal(res.code, 0);
    assert.match(res.stdout, /^OK:/);
  });

  it("preserves description in OK output", async () => {
    const res = await runValidate("feat: add user authentication");
    assert.match(res.stdout, /add user authentication/);
  });
});

// ── Invalid messages ────────────────────────────────────────────────

describe("validate-commit.js — invalid messages", () => {
  it("rejects message without type", async () => {
    const res = await runValidate("add a new feature");
    assert.equal(res.code, 1);
    assert.match(res.stderr, /not a valid conventional commit message/);
  });

  it("rejects message with unknown type", async () => {
    const res = await runValidate("wip: work in progress");
    assert.equal(res.code, 1);
    assert.match(res.stderr, /not a valid conventional commit message/);
  });

  it("rejects missing colon-space separator", async () => {
    const res = await runValidate("feat:add something");
    assert.equal(res.code, 1);
    assert.match(res.stderr, /not a valid conventional commit message/);
  });

  it("rejects empty description after colon", async () => {
    const res = await runValidate("feat:");
    assert.equal(res.code, 1);
    assert.match(res.stderr, /not a valid conventional commit message/);
  });

  it("rejects message ending with period", async () => {
    const res = await runValidate("feat: add feature.");
    assert.equal(res.code, 1);
    assert.match(res.stderr, /must not end with a period/);
  });

  it("rejects multi-line message", async () => {
    const res = await runValidate("feat: line one\nfix: line two");
    assert.equal(res.code, 1);
    assert.match(res.stderr, /must be a single line/);
  });

  it("rejects message with newline in description", async () => {
    const res = await runValidate("feat: first line\nsecond line");
    assert.equal(res.code, 1);
    assert.match(res.stderr, /must be a single line/);
  });

  it("rejects bare text with no conventional format", async () => {
    const res = await runValidate("just some random text");
    assert.equal(res.code, 1);
    assert.match(res.stderr, /not a valid conventional commit message/);
  });

  it("rejects empty string", async () => {
    const res = await runValidate("");
    assert.equal(res.code, 2);
    assert.match(res.stderr, /Usage:/);
  });
});

// ── AI attribution guard ───────────────────────────────────────────

describe("validate-commit.js — AI attribution guard", () => {
  it("rejects message with 'Assisted-by:' (case-insensitive)", async () => {
    const res = await runValidate(
      "feat: add feature Assisted-by: Crush:test-model"
    );
    assert.equal(res.code, 1);
    assert.match(res.stderr, /AI attribution/);
  });

  it("rejects message with 'assisted-by:' lowercase", async () => {
    const res = await runValidate(
      "fix: bug fix assisted-by: some-tool"
    );
    assert.equal(res.code, 1);
    assert.match(res.stderr, /AI attribution/);
  });

  it("rejects message with 'Assisted-By:' mixed case", async () => {
    const res = await runValidate(
      "docs: update docs Assisted-By: AI Assistant"
    );
    assert.equal(res.code, 1);
    assert.match(res.stderr, /AI attribution/);
  });

  it("accepts normal message without attribution", async () => {
    const res = await runValidate("feat: add new endpoint");
    assert.equal(res.code, 0);
    assert.match(res.stdout, /^OK:/);
  });

  it("rejects message with attribution in scope", async () => {
    const res = await runValidate(
      "feat(ai-tool): integration Assisted-by: GPT"
    );
    assert.equal(res.code, 1);
    assert.match(res.stderr, /AI attribution/);
  });
});
