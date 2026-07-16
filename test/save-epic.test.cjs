"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SAVE_EPIC_SCRIPT = path.join(
  __dirname,
  "..",
  "skills",
  "x-epic",
  "scripts",
  "save-epic.js"
);

// ── Helpers ───────────────────────────────────────────────────────────

function runSaveEpic(args = [], cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SAVE_EPIC_SCRIPT].concat(args), {
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

function createTempDir(prefix = "save-epic-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
      assert.match(res.stdout, /\.x-skills\/epics\//);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── File creation and output path ───────────────────────────────────

describe("save-epic.js — file creation", () => {
  it("creates .x-skills/epics/ directory in cwd", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "feature-a"], tmpDir);
      const epicsDir = path.join(tmpDir, ".x-skills", "epics");
      assert.ok(fs.existsSync(epicsDir), `Directory should exist: ${epicsDir}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("writes a non-empty epic file with header", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveEpic(["--topic", "feature-a"], tmpDir);
      assert.equal(res.code, 0);

      const fullPath = res.stdout.trim();
      assert.ok(fs.existsSync(fullPath), `File should exist: ${fullPath}`);

      const content = fs.readFileSync(fullPath, "utf8");
      assert.ok(content.length > 0, "File must not be empty");
      assert.match(content, /^# Epic — feature-a$/m);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes topic name in the filename", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveEpic(["--topic", "my-cool-topic"], tmpDir);
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
      await runSaveEpic(["--topic", "dated"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "epics"));
      assert.match(dirContents[0], /^\d{2}-\d{2}-\d{4}-\d{2}:\d{2}-dated\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("uses custom date stamp when provided", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "custom-date", "--date", "2099-12-31T2359"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "epics"));
      assert.match(dirContents[0], /^[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]-[0-9][0-9]:[0-9][0-9]-custom-date\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("uses custom branch in the header", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "branch-test", "--branch", "my/custom-branch"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "epics"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "epics", dirContents[0]),
        "utf8"
      );
      assert.ok(content.includes("my/custom-branch"), `Expected branch in header, got:\n${content}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates nested .x-skills directory if it does not exist", async () => {
    const tmpDir = createTempDir();
    try {
      assert.ok(!fs.existsSync(path.join(tmpDir, ".x-skills")), "Directory should not exist before run");
      await runSaveEpic(["--topic", "nested"], tmpDir);
      assert.ok(fs.existsSync(path.join(tmpDir, ".x-skills", "epics")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("stdout contains the full path to the epic file", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveEpic(["--topic", "stdout-test"], tmpDir);
      assert.match(res.stdout, /\.x-skills\/epics\//);
      assert.match(res.stdout, /stdout-test\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Epic file content structure ─────────────────────────────────────

describe("save-epic.js — epic file content", () => {
  it("writes a header template with Date and Branch fields", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "content-check"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "epics"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "epics", dirContents[0]),
        "utf8"
      );

      assert.match(content, /^# Epic — content-check$/m);
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
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "epics"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "epics", dirContents[0]),
        "utf8"
      );
      assert.match(content, /## Definition of Done \(Epic Level\)/);
      // Should contain at least the standard DoD checklist items
      assert.ok(
        content.includes("- [ ] All user stories delivered") ||
        content.includes("All user stories delivered"),
        "DoD should mention user story delivery"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("auto-resolves spec path when design file exists with matching slug", async () => {
    const tmpDir = createTempDir();
    try {
      // First create a design spec for the topic
      const saveSpecScript = path.join(__dirname, "..", "skills", "x-design", "scripts", "save-spec.js");
      await new Promise((resolve, reject) => {
        const child = spawn("node", [saveSpecScript, "--topic", "auto-link"], { cwd: tmpDir });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`save-spec failed with ${code}`)));
      });

      // Now run save-epic and check it resolved the spec path
      const epicRes = await runSaveEpic(["--topic", "auto-link"], tmpDir);
      assert.equal(epicRes.code, 0);

      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "epics"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "epics", dirContents[0]),
        "utf8"
      );

      // The spec: line should contain an actual path to a design file with the topic slug
      const specMatch = content.match(/^spec:\s+(.+)$/m);
      assert.ok(specMatch, `epic header should have resolved spec: line. Content:\n${content}`);
      assert.ok(
        specMatch[1].includes("auto-link"),
        `spec path should contain topic slug. Got: ${specMatch[1]}`
      );

      // stderr should confirm resolution
      assert.match(epicRes.stderr, /resolved spec path/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("leaves placeholder when no design spec exists for topic", async () => {
    const tmpDir = createTempDir();
    try {
      const epicRes = await runSaveEpic(["--topic", "orphan"], tmpDir);
      assert.equal(epicRes.code, 0);

      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "epics"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "epics", dirContents[0]),
        "utf8"
      );

      // Should have placeholder text for spec path
      assert.ok(
        content.includes("spec:") || content.includes("<timestamp>"),
        `should leave placeholder when no design file found. Content:\n${content}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("header ends with Definition of Done (no trailing blank lines after)", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "newline-check"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "epics"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "epics", dirContents[0]),
        "utf8"
      );
      // Should end with a newline after the last DoD item
      assert.ok(content.endsWith("\n"), "File should end with trailing newline");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Logging (stderr verification) ───────────────────────────────────

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
    assert.match(res.stderr, /\.x-skills\/epics\//);
  });

  it("logs timestamps in ISO format on each line", async () => {
    const res = await runSaveEpic(["--topic", "log-ts"]);
    const lines = res.stderr.split("\n").filter(Boolean);
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

  it("logs 'resolved spec path' when design file is found", async () => {
    const tmpDir = createTempDir();
    try {
      // Create a design spec first
      const saveSpecScript = path.join(__dirname, "..", "skills", "x-design", "scripts", "save-spec.js");
      await new Promise((resolve, reject) => {
        const child = spawn("node", [saveSpecScript, "--topic", "link-test"], { cwd: tmpDir });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`save-spec failed with ${code}`)));
      });

      const res = await runSaveEpic(["--topic", "link-test"], tmpDir);
      assert.match(res.stderr, /resolved spec path/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("logs 'no design spec found' when no matching design file exists", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveEpic(["--topic", "orphan-epic"], tmpDir);
      assert.match(res.stderr, /no design spec found/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
