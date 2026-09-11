"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..", "skills", "x-roast", "scripts");
const SCORE = path.join(SCRIPTS, "score.mjs");
const SAVE = path.join(SCRIPTS, "save-report.mjs");

function run(script, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options.cwd,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

describe("x-roast score — pure scoring", async () => {
  const mod = await import(SCORE);

  it("exposes anchored profiles and dimensions", () => {
    assert.ok(mod.DIMENSIONS.accuracy.weight >= 1);
    assert.deepEqual(mod.PROFILES.research.slice(-2), ["method", "recency"]);
    assert.deepEqual(mod.PROFILES.epic.slice(-2), ["decomposition", "acceptance"]);
    assert.deepEqual(mod.PROFILES.task.slice(-2), ["testability", "estimation"]);
  });

  it("dimensionsFor throws on an unknown profile", () => {
    assert.throws(() => mod.dimensionsFor("nope"), /Unknown profile/);
  });

  it("normalizeScore clamps to 1-5 and rejects non-numbers", () => {
    assert.equal(mod.normalizeScore("4"), 4);
    assert.equal(mod.normalizeScore(6), 5);
    assert.equal(mod.normalizeScore(0), 1);
    assert.equal(mod.normalizeScore(3.5), 3.5);
    assert.equal(mod.normalizeScore("abc"), null);
    assert.equal(mod.normalizeScore(null), null);
    assert.equal(mod.normalizeScore(""), null);
  });

  it("all 1s scores 0 (raw), all 5s scores 100 (exemplary)", () => {
    const ones = mod.computeScore({ profile: "article", scores: Object.fromEntries(mod.PROFILES.article.map((d) => [d, 1])) });
    assert.equal(ones.total, 0);
    assert.equal(ones.band.key, "raw");

    const fives = mod.computeScore({ profile: "article", scores: Object.fromEntries(mod.PROFILES.article.map((d) => [d, 5])) });
    assert.equal(fives.total, 100);
    assert.equal(fives.band.key, "exemplary");
  });

  it("all 3s scores 50 (weak band)", () => {
    const scores = Object.fromEntries(mod.PROFILES.article.map((d) => [d, 3]));
    const result = mod.computeScore({ profile: "article", scores });
    assert.equal(result.total, 50);
    assert.equal(result.band.key, "weak");
    assert.equal(result.completeness, 1);
  });

  it("computes an exact weighted total for mixed scores", () => {
    const result = mod.computeScore({
      profile: "article",
      scores: {
        accuracy: 5,
        logic: 5,
        evidence: 1,
        originality: 1,
        clarity: 3,
        completeness: 3,
        actionability: 1,
        balance: 5,
      },
    });
    assert.equal(result.total, 56.3);
    assert.equal(result.band.key, "weak");
    assert.equal(result.breakdown.length, 8);
  });

  it("normalizes weights over supplied dimensions and reports missing", () => {
    const result = mod.computeScore({ profile: "article", scores: { accuracy: 5, logic: 5 } });
    assert.equal(result.total, 100);
    assert.equal(result.presentWeight, 6);
    assert.equal(result.requiredWeight, 16);
    assert.equal(result.completeness, 0.375);
    assert.deepEqual(result.missing.sort(), ["actionability", "balance", "clarity", "completeness", "evidence", "originality"]);
  });

  it("reports unknown, out-of-range, and invalid dimensions", () => {
    const result = mod.computeScore({
      profile: "task",
      scores: { accuracy: 7, logic: "abc", vibes: 3 },
    });
    assert.deepEqual(result.unknown, ["vibes"]);
    assert.deepEqual(result.outOfRange, ["accuracy"]);
    assert.deepEqual(result.invalid, ["logic"]);
    assert.equal(result.total, 100);
  });

  it("returns null total when no scores are supplied", () => {
    const result = mod.computeScore({ profile: "epic", scores: {} });
    assert.equal(result.total, null);
    assert.equal(result.band, null);
    assert.equal(result.completeness, 0);
    assert.equal(result.missing.length, mod.PROFILES.epic.length);
  });

  it("bandFor maps thresholds to the right band", () => {
    assert.equal(mod.bandFor(100).key, "exemplary");
    assert.equal(mod.bandFor(75).key, "strong");
    assert.equal(mod.bandFor(60).key, "adequate");
    assert.equal(mod.bandFor(40).key, "weak");
    assert.equal(mod.bandFor(0).key, "raw");
  });
});

describe("x-roast save-report — pure helpers", async () => {
  const mod = await import(SAVE);

  it("slugify lowercases and hyphenates", () => {
    assert.equal(mod.slugify("My Great Article!"), "my-great-article");
    assert.equal(mod.slugify("///"), "artifact");
    assert.equal(mod.slugify(""), "artifact");
  });

  it("timestamp uses DD-MM-YYYY-hh:mm", () => {
    const date = new Date(2026, 0, 5, 9, 7);
    assert.equal(mod.timestamp(date), "05-01-2026-09:07");
  });

  it("reportPath combines directory, timestamp, and slug", () => {
    const date = new Date(2026, 0, 5, 9, 7);
    assert.equal(mod.reportPath("out", "My Article", date), path.join("out", "05-01-2026-09:07-my-article.md"));
  });

  it("renderHeader includes type and slug", () => {
    const header = mod.renderHeader({ slug: "doc", type: "epic", date: new Date(2026, 0, 5, 9, 7) });
    assert.match(header, /# Roast — doc/);
    assert.match(header, /\*\*Profile:\*\* epic/);
  });
});

describe("x-roast save-report — filesystem", async () => {
  const mod = await import(SAVE);

  it("createReport writes the file once and is idempotent", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-roast-"));
    try {
      const date = new Date(2026, 0, 5, 9, 7);
      const first = mod.createReport({ dir, slug: "Doc One", type: "analysis", date });
      assert.equal(first.created, true);
      const content = await fsp.readFile(first.path, "utf8");
      assert.match(content, /# Roast — Doc One/);

      const second = mod.createReport({ dir, slug: "Doc One", type: "analysis", date });
      assert.equal(second.created, false);
      assert.equal(second.path, first.path);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("x-roast CLI", async () => {
  it("--help prints usage and exits 0", async () => {
    const res = await run(SCORE, ["--help"]);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Usage:/);
  });

  it("scores from repeated --score flags", async () => {
    const args = ["--profile", "task"];
    for (const d of ["testability", "estimation", "accuracy", "logic", "evidence", "originality", "clarity", "completeness", "actionability", "balance"]) {
      args.push("--score", `${d}=4`);
    }
    const res = await run(SCORE, args);
    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.total, 75);
    assert.equal(parsed.band.key, "strong");
    assert.equal(parsed.completeness, 1);
  });

  it("scores from --scores inline list", async () => {
    const res = await run(SCORE, ["--profile", "article", "--scores", "accuracy=5,logic=5"]);
    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.total, 100);
    assert.ok(parsed.missing.includes("evidence"));
  });

  it("reads { profile, scores } from --input", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-roast-cli-"));
    try {
      const file = path.join(dir, "scores.json");
      await fsp.writeFile(file, JSON.stringify({ profile: "epic", scores: { accuracy: 5, logic: 5 } }));
      const res = await run(SCORE, ["--input", file]);
      assert.equal(res.code, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.profile, "epic");
      assert.equal(parsed.total, 100);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 on an unknown profile", async () => {
    const res = await run(SCORE, ["--profile", "nope", "--score", "accuracy=5"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Unknown profile/);
  });

  it("exits 1 on a malformed --score", async () => {
    const res = await run(SCORE, ["--profile", "article", "--score", "accuracy"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /expected key=value/);
  });

  it("exits 1 on an unknown flag", async () => {
    const res = await run(SCORE, ["--bogus"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Unknown argument/);
  });

  it("save-report writes a file and prints its path", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-roast-save-"));
    try {
      const res = await run(SAVE, ["--slug", "CLI Doc", "--type", "research", "--output", dir]);
      assert.equal(res.code, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.created, true);
      assert.match(parsed.path, /cli-doc\.md$/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("save-report exits 1 without --slug", async () => {
    const res = await run(SAVE, []);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--slug is required/);
  });
});
