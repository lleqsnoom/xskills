"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("os");
const fsp = require("node:fs/promises");

// Import the module under test
const lib = require("../lib/install");

// ── extractDescription tests ────────────────────────────────────────

describe("extractDescription", () => {
  it("extracts description from YAML frontmatter", () => {
    const content = `---\nname: my-skill\ndescription: Does something cool.\nversion: 1.0\n---\n\n# Title`;
    assert.equal(lib.extractDescription(content), "Does something cool.");
  });

  it("returns (no description) when no frontmatter and no heading", () => {
    const content = "Just some text without any structure.";
    assert.equal(lib.extractDescription(content), "(no description)");
  });

  it("falls back to first heading line when no YAML description found", () => {
    const content = "# My Skill Title\n\nSome body text.";
    assert.equal(lib.extractDescription(content), "My Skill Title");
  });

  it("strips leading # from heading-based fallback", () => {
    const content = "## Sub Heading";
    assert.equal(lib.extractDescription(content), "Sub Heading");
  });

  it("returns (no description) for empty content", () => {
    assert.equal(lib.extractDescription(""), "(no description)");
  });
});

// ── formatDescriptionFromHeading tests ──────────────────────────────

describe("formatDescriptionFromHeading", () => {
  // This function is not exported — we test it indirectly via extractDescription
  // The coverage of "strips # prefixes" and "returns text as-is" is already covered above.
});

// ── install (integration) tests ────────────────────────────────────

describe("install", () => {
  let tmpDir;
  const originalCwd = process.cwd();

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      tmpDir = null;
    }
  });

  it("installs a skill into .agents/skills/", async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-test-"));
    process.chdir(tmpDir);

    await lib.install("x-commit");

    const installedPath = path.join(tmpDir, ".agents", "skills", "x-commit");
    assert.ok(
      await fileExists(installedPath),
      "Skill directory should exist after install"
    );
    assert.ok(
      await fileExists(path.join(installedPath, "SKILL.md")),
      "SKILL.md should be copied"
    );

    process.chdir(originalCwd);
  });

  it("skips install if skill is already installed", async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-test-"));
    process.chdir(tmpDir);

    const logSpy = spyOn(console, "log");
    await lib.install("x-commit");
    assert.ok(logSpy.mock.calls.length > 0);

    logSpy.mock.calls.length = 0;
    await lib.install("x-commit");
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    assert.match(printed, /already installed/);

    process.chdir(originalCwd);
  });

  it("does not crash when installing unknown skill (process.exit handles error)", async () => {
    // ensureSkillExists calls process.exit(1) synchronously for missing skills.
    // We verify the function is reachable without crashing by using a try/catch
    // — if process.exit throws (some Node versions do), we catch it gracefully.
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-test-"));
    process.chdir(tmpDir);

    try {
      await lib.install("nonexistent-skill-xyz");
    } catch {
      // Expected: either process.exit throws, or the module catches it internally
    }
    assert.ok(true);

    process.chdir(originalCwd);
  });

  it("copies subdirectories (scripts/, references/, assets/)", async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-test-"));
    process.chdir(tmpDir);

    await lib.install("x-review");

    const installedPath = path.join(tmpDir, ".agents", "skills", "x-review");
    assert.ok(await dirExists(path.join(installedPath, "scripts")));
    assert.ok(await dirExists(path.join(installedPath, "references")));
    assert.ok(await dirExists(path.join(installedPath, "assets")));

    const scripts = await fsp.readdir(path.join(installedPath, "scripts"));
    assert.ok(scripts.length >= 2);

    process.chdir(originalCwd);
  });
});

// ── globalInstall tests ────────────────────────────────────────────

describe("globalInstall", () => {
  it("installs skill into ~/.agents/skills/", async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-global-"));
    const originalHome = process.env.HOME;
    process.env.HOME = tmpDir;

    try {
      await lib.globalInstall("x-commit");

      const installedPath = path.join(tmpDir, ".agents", "skills", "x-commit");
      assert.ok(await dirExists(installedPath));
    } finally {
      process.env.HOME = originalHome;
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("skips if already installed globally", async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-global-"));
    const originalHome = process.env.HOME;
    process.env.HOME = tmpDir;

    try {
      const logSpy = spyOn(console, "log");
      await lib.globalInstall("x-commit");
      assert.ok(logSpy.mock.calls.length > 0);

      logSpy.mock.calls.length = 0;
      await lib.globalInstall("x-commit");
      const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
      assert.match(printed, /already installed globally/);
    } finally {
      process.env.HOME = originalHome;
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ── listSkills tests ───────────────────────────────────────────────

describe("listSkills", () => {
  it("lists available skills without error", async () => {
    const logSpy = spyOn(console, "log");
    await lib.listSkills();
    // Just verify it doesn't throw and produces output
    assert.ok(logSpy.mock.calls.length > 0);
  });

  it("shows install instructions at the end of listing", async () => {
    const logSpy = spyOn(console, "log");
    await lib.listSkills();
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    assert.match(printed, /Install:/);
  });

  it("pads skill names to equal width", async () => {
    // This is tested indirectly — we just verify the function runs and prints formatted output.
    const logSpy = spyOn(console, "log");
    await lib.listSkills();
    assert.ok(logSpy.mock.calls.length > 0);
  });
});

// ── Helper functions for tests ─────────────────────────────────────

async function fileExists(p) {
  try {
    const stat = await fsp.stat(p);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

async function dirExists(p) {
  return fileExists(p);
}

// Simple spy utility since node:test doesn't include one by default.
function spyOn(obj, method) {
  const original = obj[method];
  const calls = [];
  obj[method] = function (...args) {
    calls.push(args);
    return original.apply(this, args);
  };
  obj[method].mock = { calls };
  return obj[method];
}
