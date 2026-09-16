"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SAVE_EPIC_SCRIPT = path.join(__dirname, "..", "skills", "x-epic", "scripts", "save-epic.js");
const SAVE_SPEC_SCRIPT = path.join(__dirname, "..", "skills", "x-plan", "scripts", "save-spec.js");

// ── Helpers ───────────────────────────────────────────────────────────

function runScript(script, args = [], cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script].concat(args), {
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

function runSaveEpic(args = [], cwd) {
  return runScript(SAVE_EPIC_SCRIPT, args, cwd);
}

function createTempDir(prefix = "save-epic-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Path of the single run folder created in a temp dir. */
function runFolder(tmpDir) {
  const runsRoot = path.join(tmpDir, ".x-skills", "runs");
  return path.join(runsRoot, fs.readdirSync(runsRoot)[0]);
}

/** Path of the epic artifact in the run folder. */
function epicPath(tmpDir) {
  const name = fs.readdirSync(runFolder(tmpDir)).find((f) => f.endsWith("-epic.md"));
  return path.join(runFolder(tmpDir), name);
}

function epicContent(tmpDir) {
  return fs.readFileSync(epicPath(tmpDir), "utf8");
}

// ── Argument validation ─────────────────────────────────────────────

describe("save-epic.js — argument validation", () => {
  it("exits with code 1 when --topic is missing", async () => {
    const res = await runSaveEpic([]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Usage:/);
    assert.match(res.stderr, /--topic/);
  });

  it("exits with code 1 when --topic is empty string", async () => {
    const res = await runSaveEpic(["--topic", ""]);
    assert.equal(res.code, 1);
  });

  it("accepts --topic with short flag -t", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveEpic(["-t", "my-feature"], tmpDir);
      assert.equal(res.code, 0);
      assert.match(res.stdout, /\.x-skills\/runs\//);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── File creation ───────────────────────────────────────────────────

describe("save-epic.js — file creation", () => {
  it("creates the run folder in cwd", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "feature-a"], tmpDir);
      const runsRoot = path.join(tmpDir, ".x-skills", "runs");
      assert.ok(fs.existsSync(runsRoot), `Directory should exist: ${runsRoot}`);
      assert.equal(fs.readdirSync(runsRoot).length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("writes a non-empty epic file with header", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveEpic(["--topic", "feature-a"], tmpDir);
      assert.equal(res.code, 0);
      const content = fs.readFileSync(res.stdout.trim(), "utf8");
      assert.match(content, /# Epic — feature-a/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes the topic name in the run folder", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "my-cool-topic"], tmpDir);
      assert.match(path.basename(runFolder(tmpDir)), /-my-cool-topic$/);
      assert.equal(path.basename(epicPath(tmpDir)), "E00-epic.md");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("numbers the epic after an existing plan", async () => {
    const tmpDir = createTempDir();
    try {
      await runScript(SAVE_SPEC_SCRIPT, ["--topic", "dated"], tmpDir);
      await runSaveEpic(["--topic", "dated"], tmpDir);
      assert.deepEqual(fs.readdirSync(runFolder(tmpDir)).sort(), ["E00-plan.md", "E01-epic.md"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("reuses the epic file on a second run", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "once"], tmpDir);
      await runSaveEpic(["--topic", "once"], tmpDir);
      assert.deepEqual(fs.readdirSync(runFolder(tmpDir)), ["E00-epic.md"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("uses custom branch in the header", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "branch-test", "--branch", "my/custom-branch"], tmpDir);
      assert.match(epicContent(tmpDir), /my\/custom-branch/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates nested .x-skills directory if it does not exist", async () => {
    const tmpDir = createTempDir();
    try {
      assert.ok(!fs.existsSync(path.join(tmpDir, ".x-skills")));
      await runSaveEpic(["--topic", "nested"], tmpDir);
      assert.ok(fs.existsSync(path.join(tmpDir, ".x-skills", "runs")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("stdout contains the full path to the epic file", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveEpic(["--topic", "stdout-test"], tmpDir);
      assert.match(res.stdout, /\.x-skills\/runs\//);
      assert.match(res.stdout, /E00-epic\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Epic file content ───────────────────────────────────────────────

describe("save-epic.js — epic file content", () => {
  it("writes a header template with Date and Branch fields", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "content-check"], tmpDir);
      const content = epicContent(tmpDir);
      assert.match(content, /# Epic — content-check/);
      assert.match(content, /\*\*Date:\*\*/);
      assert.match(content, /\*\*Branch:\*\*/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes Definition of Done section", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "dod-check"], tmpDir);
      assert.match(epicContent(tmpDir), /Definition of Done/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("auto-resolves spec path when plan file exists with matching slug", async () => {
    const tmpDir = createTempDir();
    try {
      await runScript(SAVE_SPEC_SCRIPT, ["--topic", "link-test"], tmpDir);
      await runSaveEpic(["--topic", "link-test"], tmpDir);

      const specMatch = epicContent(tmpDir).match(/spec:\s+(.+)$/m);
      assert.ok(specMatch, "epic header should carry a spec line");
      assert.match(specMatch[1], /link-test/);
      assert.match(specMatch[1], /E00-plan\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("leaves placeholder when no plan spec exists for topic", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "orphan"], tmpDir);
      assert.match(epicContent(tmpDir), /spec:\s+<run folder>\/E00-plan\.md/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("header ends with Definition of Done (no trailing blank lines after)", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "trailing"], tmpDir);
      assert.match(epicContent(tmpDir), /Documentation updated where contracts changed\n$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Logging ─────────────────────────────────────────────────────────

describe("save-epic.js — logging", () => {
  it("logs each step to stderr with [x-epic] tag", async () => {
    const res = await runSaveEpic(["--topic", "log-test"]);
    assert.match(res.stderr, /\[x-epic\]/);
  });

  it("logs 'parsing arguments' at the start of every run", async () => {
    const res = await runSaveEpic(["--topic", "log-parse"]);
    assert.match(res.stderr, /parsing arguments/);
  });

  it("logs the file path to stderr", async () => {
    const res = await runSaveEpic(["--topic", "log-path"]);
    assert.match(res.stderr, /\.x-skills\/runs\//);
  });

  it("logs timestamps in ISO format on each line", async () => {
    const res = await runSaveEpic(["--topic", "log-ts"]);
    const lines = res.stderr.split("\n").filter(Boolean).filter((line) => !line.startsWith("Warning:"));
    for (const line of lines) {
      assert.match(
        line,
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\]/,
        `Line missing ISO timestamp: ${line}`
      );
    }
  });

  it("logs 'epic ready' at the end of successful run", async () => {
    const res = await runSaveEpic(["--topic", "log-ready"]);
    assert.match(res.stderr, /epic ready/);
  });

  it("does not write to stdout on error (missing topic)", async () => {
    const res = await runSaveEpic([]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), "");
    assert.match(res.stderr, /Usage:/);
  });

  it("logs 'resolved spec path' when plan file is found", async () => {
    const tmpDir = createTempDir();
    try {
      await runScript(SAVE_SPEC_SCRIPT, ["--topic", "link-log"], tmpDir);
      const res = await runSaveEpic(["--topic", "link-log"], tmpDir);
      assert.match(res.stderr, /resolved spec path/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("logs 'no plan spec found' when no matching plan file exists", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveEpic(["--topic", "orphan-log"], tmpDir);
      assert.match(res.stderr, /no plan spec found/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
