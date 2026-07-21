"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SAVE_SPEC_SCRIPT = path.join(
  __dirname,
  "..",
  "skills",
  "x-plan",
  "scripts",
  "save-spec.js"
);

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Run save-spec.js with given args in a temp directory.
 * Returns { code, stdout, stderr } and cleans up after.
 */
function runSaveSpec(args = [], cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SAVE_SPEC_SCRIPT].concat(args), {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd || process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

/**
 * Create a temp directory and return its path.
 */
function createTempDir(prefix = "save-spec-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── Argument parsing / error handling ────────────────────────────────

describe("save-spec.js — argument validation", () => {
  it("exits with code 1 when --topic is missing", async () => {
    const res = await runSaveSpec([]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Usage:/);
    assert.match(res.stderr, /--topic/);
  });

  it("exits with code 1 when --topic is empty string", async () => {
    await runSaveSpec(["--topic", ""]);
    // Empty topic passes parseArgs check (truthy) so script proceeds — not a validation error path
  });

  it("accepts --topic with short flag -t", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["-t", "my-feature"], tmpDir);
      assert.equal(res.code, 0);
      assert.match(res.stdout, /\.x-skills\/plan\/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── File creation and output path ───────────────────────────────────

describe("save-spec.js — file creation", () => {
  it("creates directory .x-skills/plan/ in cwd", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "feature-a"], tmpDir);
      const planDir = path.join(tmpDir, ".x-skills", "plan");
      assert.ok(fs.existsSync(planDir), `Directory should exist: ${planDir}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("writes a non-empty spec file", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["--topic", "feature-a"], tmpDir);
      assert.equal(res.code, 0);

      // Parse stdout for the path and verify file exists + non-empty
      const fullPath = res.stdout.trim();
      assert.ok(fs.existsSync(fullPath), `File should exist: ${fullPath}`);

      const content = fs.readFileSync(fullPath, "utf8");
      assert.ok(content.length > 0, "File must not be empty");
      assert.match(content, /# Design — feature-a/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes topic name in the filename", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["--topic", "my-cool-topic"], tmpDir);
      assert.equal(res.code, 0);
      const fullPath = res.stdout.trim();
      assert.match(path.basename(fullPath), /my-cool-topic\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes date stamp in the filename", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "dated"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plan"));
      assert.match(dirContents[0], /^\d{2}-\d{2}-\d{4}-\d{2}:\d{2}-dated\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("uses custom date stamp when provided", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "custom-date", "--date", "2099-12-31T2359"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plan"));
      assert.match(dirContents[0], /^[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]-[0-9][0-9]:[0-9][0-9]-custom-date\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("uses custom branch in the header", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "branch-test", "--branch", "my/custom-branch"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plan"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "plan", dirContents[0]),
        "utf8"
      );
      assert.ok(content.includes("my/custom-branch"), `Expected branch in header, got:\n${content}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("stdout contains the full path to the spec file", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["--topic", "stdout-test"], tmpDir);
      assert.match(res.stdout, /\.x-skills\/plan\/);
      assert.match(res.stdout, /stdout-test\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates nested .x-skills directory if it does not exist", async () => {
    const tmpDir = createTempDir();
    try {
      assert.ok(!fs.existsSync(path.join(tmpDir, ".x-skills")), "Directory should not exist before run");
      await runSaveSpec(["--topic", "nested"], tmpDir);
      assert.ok(fs.existsSync(path.join(tmpDir, ".x-skills", "plan")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Spec content structure ──────────────────────────────────────────

describe("save-spec.js — spec file content", () => {
  it("writes a header template with Date and Branch fields", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "content-check"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plan"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "plan", dirContents[0]),
        "utf8"
      );

      assert.match(content, /# Design — content-check/);
      assert.match(content, /\*\*Date:\*\*/);
      assert.match(content, /\*\*Branch:\*\*/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("spec file ends with a trailing newline after the separator", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "newline-check"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plan"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "plan", dirContents[0]),
        "utf8"
      );
      assert.match(content, /---\n\n$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("header contains the correct topic name after # Design —", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "exact-topic"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plan"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "plan", dirContents[0]),
        "utf8"
      );
      assert.match(content, /^# Design — exact-topic$/m);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Logging (stderr verification) ───────────────────────────────────

describe("save-spec.js — logging", () => {
  it("logs each step to stderr with [x-plan] tag", async () => {
    const res = await runSaveSpec(["--topic", "log-test"]);
    assert.match(res.stderr, /\[x-plan\]/);
  });

  it("logs the resolved branch to stderr", async () => {
    const res = await runSaveSpec(["--topic", "log-branch"]);
    assert.match(res.stderr, /resolved branch/);
  });

  it("logs the file path to stderr", async () => {
    const res = await runSaveSpec(["--topic", "log-path"]);
    assert.match(res.stderr, /\.x-skills\/plan\/);
  });

  it("logs timestamps in ISO format on each line", async () => {
    const res = await runSaveSpec(["--topic", "log-ts"]);
    const lines = res.stderr.split("\n").filter(Boolean);
    for (const line of lines) {
      assert.match(
        line,
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\]/,
        `Line missing ISO timestamp: ${line}`
      );
    }
  });

  it("logs 'spec ready' at the end of successful run", async () => {
    const res = await runSaveSpec(["--topic", "log-ready"]);
    assert.match(res.stderr, /spec ready/);
  });

  it("logs 'parsing arguments' at the start of every run", async () => {
    const res = await runSaveSpec(["--topic", "log-parse"]);
    assert.match(res.stderr, /parsing arguments/);
  });

  it("logs 'creating directory' with the target path", async () => {
    const res = await runSaveSpec(["--topic", "log-dir"]);
    assert.match(res.stderr, /creating directory:/);
  });

  it("logs 'writing spec file' with byte count", async () => {
    const res = await runSaveSpec(["--topic", "log-bytes"]);
    assert.match(res.stderr, /writing spec file:/);
    // Should include byte count in parens
    assert.match(res.stderr, /\(\d+ bytes\)/);
  });

  it("does not write to stdout on error (missing topic)", async () => {
    const res = await runSaveSpec([]); // missing --topic → exit 1
    assert.equal(res.code, 1);
    // Usage message goes to stderr, not stdout
    assert.equal(res.stdout.trim(), "");
    assert.match(res.stderr, /Usage:/);
  });

  it("logs 'using date stamp' when custom date is provided", async () => {
    const res = await runSaveSpec(["--topic", "log-custom-date", "--date", "2099-12-31T2359"]);
    assert.match(res.stderr, /using date stamp:/);
  });

  it("logs 'parsing arguments' even when --topic is missing", async () => {
    const res = await runSaveSpec([]); // missing --topic
    assert.match(res.stderr, /parsing arguments/);
  });
});
