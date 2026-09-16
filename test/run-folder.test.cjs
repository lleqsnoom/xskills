"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SHARED_COPIES = [
  "x-plan",
  "x-epic",
  "x-decompose",
  "x-implement",
].map((skill) => path.join(__dirname, "..", "skills", skill, "scripts", "shared.js"));

const SAVE_SPEC = path.join(__dirname, "..", "skills", "x-plan", "scripts", "save-spec.js");

const shared = require(SHARED_COPIES[0]);

function createTempDir(prefix = "run-folder-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Run save-spec.js. Without an explicit cwd it runs in a fresh temp directory
 * and cleans it up, so the suite never writes into the repo.
 */
async function runSaveSpec(args = [], cwd) {
  const dir = cwd || createTempDir();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("node", [SAVE_SPEC].concat(args), {
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

// ── formatStamp ──────────────────────────────────────────────────────

describe("shared.formatStamp", () => {
  it("formats a date as YYYY-MM-DD-hhmm with leading zeros", () => {
    assert.equal(shared.formatStamp(new Date(2026, 0, 5, 9, 7)), "2026-01-05-0907");
  });

  it("does not use a colon", () => {
    assert.ok(!shared.formatStamp(new Date(2026, 0, 5, 9, 7)).includes(":"));
  });

  it("sorts two stamps chronologically", () => {
    const older = shared.formatStamp(new Date(2026, 8, 15, 21, 30));
    const newer = shared.formatStamp(new Date(2026, 8, 16, 9, 0));
    assert.deepEqual([newer, older].sort(), [older, newer]);
  });
});

// ── resolveRun ───────────────────────────────────────────────────────

describe("shared.resolveRun", () => {
  it("mints R01 for a new slug", () => {
    const root = createTempDir();
    try {
      const dir = shared.resolveRunDir("s", { root });
      assert.match(path.basename(dir), /^\d{4}-\d{2}-\d{2}-\d{4}-R01-s$/);
      assert.ok(fs.existsSync(dir));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the first folder on a second call instead of minting R02", () => {
    const root = createTempDir();
    try {
      const first = shared.resolveRunDir("s", { root });
      const second = shared.resolveRunDir("s", { root });
      assert.equal(second, first);
      assert.equal(fs.readdirSync(root).length, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates the runs root when it is absent", () => {
    const root = createTempDir();
    const missing = path.join(root, "nested", "runs");
    try {
      shared.resolveRunDir("s", { root: missing });
      assert.ok(fs.existsSync(missing));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("picks the folder holding the marker when two runs share a slug", () => {
    const root = createTempDir();
    try {
      const older = path.join(root, "2026-09-15-2130-R01-s");
      const newer = path.join(root, "2026-09-16-0900-R02-s");
      fs.mkdirSync(older, { recursive: true });
      fs.mkdirSync(newer, { recursive: true });
      fs.writeFileSync(path.join(older, "E00-plan.md"), "plan");

      assert.equal(shared.resolveRunDir("s", { marker: "E00-plan.md", root }), older);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to guess when two runs share a slug and no marker is given", () => {
    const root = createTempDir();
    try {
      fs.mkdirSync(path.join(root, "2026-09-15-2130-R01-s"), { recursive: true });
      fs.mkdirSync(path.join(root, "2026-09-16-0900-R02-s"), { recursive: true });

      assert.throws(() => shared.resolveRunDir("s", { root }), /2 runs match/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing slug", () => {
    assert.throws(() => shared.resolveRunDir(), /slug/);
  });
});

// ── nextE and resolveArtifact ────────────────────────────────────────

describe("shared.nextE and shared.resolveArtifact", () => {
  it("returns E00 for an empty run folder", () => {
    const root = createTempDir();
    try {
      assert.equal(shared.nextE(root), "E00");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the highest number plus one", () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, "E00-plan.md"), "");
      fs.writeFileSync(path.join(dir, "E02-analysis.md"), "");
      assert.equal(shared.nextE(dir), "E03");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws instead of widening past E99", () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, "E99-plan.md"), "");
      assert.throws(() => shared.nextE(dir), /E99/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reuses an existing artifact for a single-instance kind", () => {
    const dir = createTempDir();
    try {
      const first = shared.resolveArtifact(dir, "plan", "md");
      assert.equal(path.basename(first), "E00-plan.md");
      assert.equal(shared.resolveArtifact(dir, "plan", "md"), first);
      assert.equal(fs.readdirSync(dir).length, 0, "resolveArtifact must not create the file");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the lowest existing artifact when several match", () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, "E00-plan.md"), "");
      fs.writeFileSync(path.join(dir, "E01-plan.md"), "");
      assert.equal(path.basename(shared.resolveArtifact(dir, "plan", "md")), "E00-plan.md");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends a fresh number for a repeatable kind", () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, "E00-analysis.md"), "");
      assert.equal(shared.nextE(dir), "E01");
      assert.equal(path.basename(path.join(dir, `${shared.nextE(dir)}-analysis.md`)), "E01-analysis.md");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds a directory name when ext is empty", () => {
    const dir = createTempDir();
    try {
      assert.equal(path.basename(shared.resolveArtifact(dir, "tasks", "")), "E00-tasks");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── helper copies stay identical ─────────────────────────────────────

describe("pipeline shared.js copies", () => {
  it("are byte-identical", () => {
    const contents = SHARED_COPIES.map((file) => fs.readFileSync(file));
    for (const other of contents.slice(1)) {
      assert.ok(contents[0].equals(other), "shared.js copies have drifted apart");
    }
  });
});

// ── save-spec.js writes into the run folder ──────────────────────────

describe("save-spec.js — run folder", () => {
  it("creates the plan inside a run folder and nothing under .x-skills/plan", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["--topic", "demo"], tmpDir);
      assert.equal(res.code, 0, res.stderr);

      const runsRoot = path.join(tmpDir, ".x-skills", "runs");
      const runs = fs.readdirSync(runsRoot);
      assert.equal(runs.length, 1);
      assert.match(runs[0], /^\d{4}-\d{2}-\d{2}-\d{4}-R01-demo$/);
      assert.ok(fs.existsSync(path.join(runsRoot, runs[0], "E00-plan.md")));
      assert.ok(!fs.existsSync(path.join(tmpDir, ".x-skills", "plan")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reuses E00-plan.md on a second call", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveSpec(["--topic", "demo"], tmpDir);
      await runSaveSpec(["--topic", "demo"], tmpDir);

      const runsRoot = path.join(tmpDir, ".x-skills", "runs");
      const runs = fs.readdirSync(runsRoot);
      assert.equal(runs.length, 1, "a second call must not mint another run");
      const artifacts = fs.readdirSync(path.join(runsRoot, runs[0]));
      assert.deepEqual(artifacts, ["E00-plan.md"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("still writes the handoff declarations", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveSpec(["--topic", "demo"], tmpDir);
      const content = fs.readFileSync(res.stdout.trim(), "utf8");
      for (const marker of ["goal:", "contract:", "invariant:", "test:", "## Layers"]) {
        assert.ok(content.includes(marker), `skeleton is missing ${marker}`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
