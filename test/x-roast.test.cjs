"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
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
    assert.deepEqual(mod.PROFILES.skill.slice(-3), ["triggers", "procedure", "verification"]);
    assert.deepEqual(mod.PROFILES.spec.slice(-1), ["testability"]);
  });

  it("every calibration case is on disk and scores exactly its profile's dimensions", () => {
    const skill = path.join(__dirname, "..", "skills", "x-roast");
    const { cases } = JSON.parse(fs.readFileSync(path.join(skill, "evals", "calibration.json"), "utf8"));
    const { references } = JSON.parse(fs.readFileSync(path.join(skill, "evals", "calibration-answers.json"), "utf8"));
    for (const profile of Object.keys(mod.PROFILES)) {
      assert.ok(cases.filter((entry) => entry.profile === profile).length >= 2, `${profile}: two cases`);
    }
    assert.deepEqual(Object.keys(references).sort(), cases.map((entry) => entry.name).sort());
    for (const entry of cases) {
      assert.ok(!("reference" in entry), `${entry.name}: the answer is kept out of the case list`);
      assert.ok(fs.existsSync(path.join(skill, entry.artifact)), entry.artifact);
      assert.deepEqual(Object.keys(references[entry.name]).sort(), [...mod.PROFILES[entry.profile]].sort(), entry.name);
      assert.equal(mod.computeScore({ profile: entry.profile, scores: references[entry.name] }).completeness, 1, entry.name);
    }
  });

  it("records a second reviewer's blind scores for every case, and explains each disagreement over 1", () => {
    const skill = path.join(__dirname, "..", "skills", "x-roast");
    const answers = JSON.parse(fs.readFileSync(path.join(skill, "evals", "calibration-answers.json"), "utf8"));
    const disputed = new Set(answers.disputes.map((d) => `${d.case}.${d.dimension}`));
    for (const [name, reference] of Object.entries(answers.references)) {
      assert.deepEqual(Object.keys(answers.second[name]).sort(), Object.keys(reference).sort(), name);
      for (const [dimension, score] of Object.entries(reference)) {
        if (Math.abs(score - answers.second[name][dimension]) > 1) assert.ok(disputed.has(`${name}.${dimension}`), `${name}.${dimension} needs a dispute`);
      }
    }
  });

  it("dimensionsFor throws on an unknown profile", () => {
    assert.throws(() => mod.dimensionsFor("nope"), /Unknown profile/);
  });

  it("normalizeScore clamps to 1-5 and rejects non-numbers", () => {
    assert.equal(mod.normalizeScore("4"), 4);
    assert.equal(mod.normalizeScore(6), 5);
    assert.equal(mod.normalizeScore(0), 1);
    assert.equal(mod.normalizeScore(3.5), null, "the anchors are whole levels");
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

  it("timestamp uses YYYY-MM-DD-hhmm", () => {
    const date = new Date(2026, 0, 5, 9, 7);
    assert.equal(mod.timestamp(date), "2026-01-05-0907");
  });

  it("reportPath numbers the critique artifact in the run folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-roast-path-"));
    try {
      assert.equal(mod.reportPath(dir), path.join(dir, "E00-critique.md"));
      fs.writeFileSync(path.join(dir, "E00-critique.md"), "");
      assert.equal(mod.reportPath(dir), path.join(dir, "E01-critique.md"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renderHeader includes type and slug", () => {
    const header = mod.renderHeader({ slug: "doc", type: "epic", date: new Date(2026, 0, 5, 9, 7) });
    assert.match(header, /# Roast — doc/);
    assert.match(header, /\*\*Profile:\*\* epic/);
  });
});

describe("x-roast save-report — filesystem", async () => {
  const mod = await import(SAVE);

  it("createReport appends a new numbered report each time", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-roast-"));
    try {
      const date = new Date(2026, 0, 5, 9, 7);
      const first = mod.createReport({ dir, slug: "Doc One", type: "analysis", date });
      assert.equal(first.created, true);
      assert.equal(path.basename(first.path), "E00-critique.md");
      const content = await fsp.readFile(first.path, "utf8");
      assert.match(content, /# Roast — Doc One/);

      const second = mod.createReport({ dir, slug: "Doc One", type: "analysis", date });
      assert.equal(second.created, true);
      assert.equal(path.basename(second.path), "E01-critique.md");
      assert.equal(await fsp.readFile(first.path, "utf8"), content, "the earlier report is untouched");
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

  it("--na drops a dimension from the profile without making the total provisional", async () => {
    const args = ["--profile", "generic", "--na", "evidence=no factual claims"];
    for (const d of ["accuracy", "logic", "originality", "clarity", "completeness", "actionability", "balance"]) args.push("--score", `${d}=5`);
    const parsed = JSON.parse((await run(SCORE, args)).stdout);
    assert.equal(parsed.total, 100);
    assert.equal(parsed.completeness, 1);
    assert.deepEqual(parsed.missing, []);
    assert.deepEqual(parsed.na, [{ dimension: "evidence", reason: "no factual claims" }]);
  });

  it("--na needs a reason, a dimension of the profile, and no score beside it", async () => {
    assert.match((await run(SCORE, ["--profile", "generic", "--na", "evidence"])).stderr, /needs a reason/);
    assert.match((await run(SCORE, ["--profile", "generic", "--na", "triggers=x"])).stderr, /not a dimension/);
    assert.match((await run(SCORE, ["--profile", "generic", "--na", "balance=x", "--score", "balance=3"])).stderr, /both scored/);
  });

  it("--na refuses the dimensions every text with claims has", async () => {
    for (const d of ["accuracy", "logic", "clarity", "completeness"]) {
      assert.match((await run(SCORE, ["--profile", "generic", "--na", `${d}=x`])).stderr, /always applies/, d);
    }
  });

  it("--report prints only the block a report carries", async () => {
    const res = await run(SCORE, ["--profile", "article", "--score", "accuracy=5", "--score", "logic=3", "--na", "balance=opinion piece", "--report"]);
    assert.deepEqual(JSON.parse(res.stdout), {
      profile: "article",
      scores: { accuracy: 5, logic: 3 },
      na: { balance: "opinion piece" },
      total: 75,
      band: "strong",
      completeness: 0.4,
    });
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

  it("--calibrate passes scores within 1 of the reference and takes the case's profile", async () => {
    const res = await run(SCORE, ["--calibrate", "pr-summary", "--scores",
      "accuracy=3,logic=3,evidence=1,originality=2,clarity=3,completeness=2,actionability=3,balance=1,triggers=1,procedure=2,verification=2"]);
    assert.equal(res.code, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.deepEqual({ ...out, line: undefined }, { case: "pr-summary", profile: "skill", drift: [], line: undefined });
    assert.match(out.line, /^\*\*Calibration:\*\* pr-summary — accuracy=3, .*verification=2 — no drift$/);
  });

  it("the skill's own instructions never print a calibration answer", () => {
    const skill = path.join(__dirname, "..", "skills", "x-roast");
    const { references } = JSON.parse(fs.readFileSync(path.join(skill, "evals", "calibration-answers.json"), "utf8"));
    const docs = [path.join(skill, "SKILL.md"), path.join(skill, "references", "rubric.md")].map((file) => fs.readFileSync(file, "utf8").replace(/\s+/g, ""));
    for (const [name, reference] of Object.entries(references)) {
      const answer = Object.entries(reference).slice(0, 4).map(([dimension, score]) => `${dimension}=${score}`).join(",");
      for (const doc of docs) assert.ok(!doc.includes(answer), `${name}'s answer is printed in the docs`);
    }
  });

  it("--agreement counts the second reviewer's scores within 1 of the references, and shows none of them", async () => {
    const res = await run(SCORE, ["--agreement"]);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { second: "deepseek-v4-flash", cases: 16, scores: 148, within1: 147, equal: 100, disputes: ["rate-limit-precise.logic"] });
  });

  it("--cases lists a profile's cases without their answers", async () => {
    const res = await run(SCORE, ["--cases", "--profile", "skill"]);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout).map((entry) => entry.name), ["pr-summary", "changelog-entry"]);
    assert.ok(!res.stdout.includes("reference"));
  });

  it("--calibrate exits 1 and names each dimension that drifts or is left out", async () => {
    const res = await run(SCORE, ["--calibrate", "pr-summary", "--scores",
      "accuracy=4,logic=3,evidence=1,originality=2,clarity=3,completeness=2,actionability=3,balance=1,triggers=1,procedure=2"]);
    assert.equal(res.code, 1);
    const drift = JSON.parse(res.stdout).drift.map((d) => d.detail.split(":")[0]);
    assert.deepEqual(drift, ["accuracy", "verification"]);
  });

  it("--calibrate refuses a case of another profile", async () => {
    const res = await run(SCORE, ["--calibrate", "pr-summary", "--profile", "task", "--score", "accuracy=2"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /is a skill, not a task/);
  });

  it("save-report writes a file and prints its path", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-roast-save-"));
    try {
      const res = await run(SAVE, ["--slug", "CLI Doc", "--type", "research", "--output", dir]);
      assert.equal(res.code, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.created, true);
      assert.match(parsed.path, /E\d{2}-critique\.md$/);
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
