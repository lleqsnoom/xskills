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
 * Run save-spec.js with given args. Without an explicit cwd it runs in a fresh
 * temp directory and cleans it up, so the suite never writes into the repo.
 */
async function runSaveSpec(args = [], cwd) {
  const dir = cwd || createTempDir();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("node", [SAVE_SPEC_SCRIPT].concat(args), {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: dir,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
  } finally {
    if (!cwd) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create a temp directory and return its path.
 */
function createTempDir(prefix = "save-spec-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Path of the single run folder a spec run creates. */
function runFolder(tmpDir) {
  const runsRoot = path.join(tmpDir, ".x-skills", "runs");
  return path.join(runsRoot, fs.readdirSync(runsRoot)[0]);
}

/** Read the plan artifact a run created. */
function planContent(tmpDir) {
  return fs.readFileSync(path.join(runFolder(tmpDir), "E00-plan.md"), "utf8");
}

// ── Argument parsing / error handling ────────────────────────────────

describe("save-spec.js — argument validation", () => {
  it("exits with code 1 when --topic is missing", async () => {
    const res = await runSaveSpec([]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Usage:/);
    assert.match(res.stderr, /--topic/);
  });

  it("accepts --topic with short flag -t", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["-t", "my-feature"], tmpDir);
      assert.equal(res.code, 0);
      assert.match(res.stdout, /\.x-skills\/runs\//);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── File creation and output path ───────────────────────────────────

describe("save-spec.js — file creation", () => {
  it("creates one run folder in cwd", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "feature-a"], tmpDir);
      const runsRoot = path.join(tmpDir, ".x-skills", "runs");
      assert.ok(fs.existsSync(runsRoot), `Directory should exist: ${runsRoot}`);
      assert.equal(fs.readdirSync(runsRoot).length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("writes a non-empty spec file", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["--topic", "feature-a"], tmpDir);
      assert.equal(res.code, 0);

      const fullPath = res.stdout.trim();
      assert.ok(fs.existsSync(fullPath), `File should exist: ${fullPath}`);

      const content = fs.readFileSync(fullPath, "utf8");
      assert.ok(content.length > 0, "File must not be empty");
      assert.match(content, /# Plan — feature-a/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes the topic name in the run folder", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["--topic", "my-cool-topic"], tmpDir);
      assert.equal(res.code, 0);
      const fullPath = res.stdout.trim();
      assert.match(path.basename(path.dirname(fullPath)), /-my-cool-topic$/);
      assert.equal(path.basename(fullPath), "E00-plan.md");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("names the plan E00-plan.md", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "dated"], tmpDir);
      assert.deepEqual(fs.readdirSync(runFolder(tmpDir)), ["E00-plan.md"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("names the run folder <stamp>-R<nn>-<topic>", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "dated"], tmpDir);
      assert.match(path.basename(runFolder(tmpDir)), /^\d{4}-\d{2}-\d{2}-\d{4}-R01-dated$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("uses custom branch in the header", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "branch-test", "--branch", "my/custom-branch"], tmpDir);
      const content = planContent(tmpDir);
      assert.ok(content.includes("my/custom-branch"), `Expected branch in header, got:\n${content}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("stdout contains the full path to the spec file", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["--topic", "stdout-test"], tmpDir);
      assert.match(res.stdout, /\.x-skills\/runs\//);
      assert.match(res.stdout, /E00-plan\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates nested .x-skills directory if it does not exist", async () => {
    const tmpDir = createTempDir();
    try {
      assert.ok(!fs.existsSync(path.join(tmpDir, ".x-skills")), "Directory should not exist before run");
      await runSaveSpec(["--topic", "nested"], tmpDir);
      assert.ok(fs.existsSync(path.join(tmpDir, ".x-skills", "runs")));
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
      const content = planContent(tmpDir);

      assert.match(content, /# Plan — content-check/);
      assert.match(content, /\*\*Date:\*\*/);
      assert.match(content, /\*\*Branch:\*\*/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("spec file ends with a trailing newline", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "newline-check"], tmpDir);
      assert.match(planContent(tmpDir), /\n$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("header contains the correct topic name after # Plan —", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "exact-topic"], tmpDir);
      assert.match(planContent(tmpDir), /^# Plan — exact-topic$/m);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("skeleton satisfies the handoff declarations", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "handoff-check"], tmpDir);
      const content = planContent(tmpDir);
      for (const marker of ["goal:", "contract:", "invariant:", "test:", "constraint:", "## Layers"]) {
        assert.ok(content.includes(marker), `skeleton is missing ${marker}`);
      }
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
    assert.match(res.stderr, /\.x-skills\/runs\//);
  });

  it("logs timestamps in ISO format on each line", async () => {
    const res = await runSaveSpec(["--topic", "log-ts"]);
    const lines = res.stderr.split("\n").filter(Boolean).filter((line) => !line.startsWith("Warning:"));
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
    assert.match(res.stderr, /\(\d+ bytes\)/);
  });

  it("does not write to stdout on error (missing topic)", async () => {
    const res = await runSaveSpec([]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), "");
    assert.match(res.stderr, /Usage:/);
  });

  it("logs 'using date stamp'", async () => {
    const res = await runSaveSpec(["--topic", "log-custom-date"]);
    assert.match(res.stderr, /using date stamp:/);
  });

  it("logs 'parsing arguments' even when --topic is missing", async () => {
    const res = await runSaveSpec([]);
    assert.match(res.stderr, /parsing arguments/);
  });
});
