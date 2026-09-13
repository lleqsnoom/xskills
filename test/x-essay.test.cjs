"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-essay");
const STATE = path.join(SKILL, "scripts", "state.mjs");

function run(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [STATE, ...args], {
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      cwd: options.cwd,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    if (options.input) child.stdin.end(options.input);
  });
}

describe("x-essay state — pure", async () => {
  const m = await import(STATE);

  it("startState applies defaults and derives the profile from type", () => {
    const s = m.startState({ slug: "a" });
    assert.equal(s.phase, "draft");
    assert.equal(s.iteration, 1);
    assert.deepEqual(s.gates, { minScore: m.DEFAULT_MIN_SCORE, coverageGate: 1, cap: m.DEFAULT_CAP });
    assert.equal(s.profile, "article");
    assert.equal(m.startState({ slug: "p", type: "paper" }).profile, "research");
  });

  it("startState rejects bad input", () => {
    assert.throws(() => m.startState({}), /slug is required/);
    assert.throws(() => m.startState({ slug: "a", cap: 0 }), /cap/);
    assert.throws(() => m.startState({ slug: "a", coverageGate: 2 }), /coverageGate/);
  });

  it("passing the score gate routes to humanize and records the numeric verdict", () => {
    const s = m.startState({ slug: "a", minScore: 75 });
    m.recordRoast(s, { total: 81, band: { key: "strong" }, completeness: 1 });
    assert.equal(s.phase, "humanize");
    const e = s.history.at(-1);
    assert.deepEqual(e.roastGate, { actual: 81, expected: 75, pass: true });
    assert.equal(e.band, "strong");
  });

  it("failing the score gate increments the iteration and records a score delta", () => {
    const s = m.startState({ slug: "a", minScore: 75, cap: 3 });
    m.recordRoast(s, { total: 60 });
    assert.equal(s.phase, "revise");
    assert.equal(s.iteration, 2);
    assert.equal(s.history.at(-1).scoreDelta, null);
    m.recordRoast(s, { total: 68 });
    assert.equal(s.history.at(-1).scoreDelta, 8);
    assert.deepEqual(s.history.at(-1).roastGate, { actual: 68, expected: 75, pass: false });
  });

  it("escalates when the cap is reached without passing", () => {
    const s = m.startState({ slug: "a", minScore: 75, cap: 2 });
    m.recordRoast(s, { total: 60 });
    m.recordRoast(s, { total: 61 });
    assert.equal(s.phase, "escalate");
    assert.equal(m.isStopped(s), true);
    assert.match(s.stopReason, /roast 61 < gate 75/);
  });

  it("humanize exit 0 -> final-check, non-zero -> revise", () => {
    const ok = m.startState({ slug: "a" });
    m.recordRoast(ok, { total: 80 });
    m.recordHumanize(ok, { exit: 0, gradeBefore: 12.4, gradeAfter: 8.1 });
    assert.equal(ok.phase, "final-check");
    assert.equal(ok.history.at(-1).gradeAfter, 8.1);
    assert.deepEqual(ok.history.at(-1).humanizeGate, { actual: 0, expected: 0, pass: true });

    const bad = m.startState({ slug: "a", cap: 5 });
    m.recordRoast(bad, { total: 80 });
    m.recordHumanize(bad, { exit: 1 });
    assert.equal(bad.phase, "revise");
    assert.equal(bad.iteration, 2);
  });

  it("final-check is a coverage ratio, not a vote", () => {
    const done = m.startState({ slug: "a" });
    m.recordRoast(done, { total: 80 });
    m.recordHumanize(done, { exit: 0 });
    m.recordFinalCheck(done, { kept: 12, total: 12 });
    assert.equal(done.phase, "done");
    assert.equal(done.history.at(-1).coverage, 1);
    assert.deepEqual(done.history.at(-1).coverageGate, { actual: 1, expected: 1, pass: true });

    const partial = m.startState({ slug: "a", cap: 5 });
    m.recordRoast(partial, { total: 80 });
    m.recordHumanize(partial, { exit: 0 });
    m.recordFinalCheck(partial, { kept: 11, total: 12 });
    assert.equal(partial.phase, "revise");
    assert.equal(partial.history.at(-1).coverage, 0.917);
  });

  it("a custom coverage gate can tolerate a documented loss", () => {
    const s = m.startState({ slug: "a", coverageGate: 0.9 });
    m.recordRoast(s, { total: 80 });
    m.recordHumanize(s, { exit: 0 });
    m.recordFinalCheck(s, { kept: 11, total: 12 });
    assert.equal(s.phase, "done");
  });

  it("rejects out-of-order records", () => {
    const s = m.startState({ slug: "a" });
    assert.throws(() => m.recordHumanize(s, { exit: 0 }), /not awaiting humanize/);
    assert.throws(() => m.recordFinalCheck(s, { kept: 1, total: 1 }), /not awaiting final-check/);
    m.recordRoast(s, { total: 50 });
    m.recordRoast(s, { total: 50 });
    m.recordRoast(s, { total: 50 });
    assert.throws(() => m.recordRoast(s, { total: 90 }), /already stopped/);
  });

  it("summarize reports the numeric arc; verify re-derives the stop", () => {
    const s = m.startState({ slug: "a", minScore: 75, cap: 3 });
    m.recordRoast(s, { total: 62.5 });
    m.recordRoast(s, { total: 81 });
    m.recordHumanize(s, { exit: 0 });
    m.recordFinalCheck(s, { kept: 9, total: 9 });
    const sum = m.summarize(s);
    assert.equal(sum.firstRoastTotal, 62.5);
    assert.equal(sum.bestRoastTotal, 81);
    assert.equal(sum.scoreGain, 18.5);
    const v = m.verify(s);
    assert.equal(v.ok, true);
    assert.deepEqual(v.checks.map((c) => c.pass), [true, true, true]);
    assert.equal(v.checks[0].expected, 75);
  });

  it("verify fails on an escalated state", () => {
    const s = m.startState({ slug: "a", minScore: 90, cap: 1 });
    m.recordRoast(s, { total: 60 });
    const v = m.verify(s);
    assert.equal(v.ok, false);
    assert.equal(v.phase, "escalate");
  });
});

describe("x-essay state — CLI", async () => {
  it("drives a full passing loop and verify exits 0", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "x-essay-"));
    try {
      const start = await run(["start", "--slug", "demo", "--root", root, "--min-score", "75", "--cap", "3"]);
      assert.equal(start.code, 0, start.stderr);
      const started = JSON.parse(start.stdout);
      assert.equal(started.next, "draft");
      assert.deepEqual(started.summary.gates, { minScore: 75, coverageGate: 1, cap: 3 });
      const dir = started.dir;
      assert.ok(await fsp.stat(path.join(dir, "state.json")));

      const scoreFile = path.join(root, "score.json");
      await fsp.writeFile(scoreFile, JSON.stringify({ total: 81, band: { key: "strong" }, completeness: 1 }));

      assert.equal(JSON.parse((await run(["record", "--dir", dir, "--roast", scoreFile])).stdout).next, "humanize");
      assert.equal(
        JSON.parse((await run(["record", "--dir", dir, "--humanize-exit", "0", "--grade-after", "8.1"])).stdout).next,
        "final-check"
      );
      const fin = JSON.parse((await run(["record", "--dir", dir, "--final-check", "12/12"])).stdout);
      assert.equal(fin.phase, "done");
      assert.equal(fin.stop, true);

      const v = await run(["verify", "--dir", dir]);
      assert.equal(v.code, 0);
      assert.equal(JSON.parse(v.stdout).ok, true);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("a failed loop escalates and verify exits 1", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "x-essay-"));
    try {
      const started = JSON.parse(
        (await run(["start", "--slug", "weak", "--root", root, "--min-score", "75", "--cap", "1"])).stdout
      );
      const scoreFile = path.join(root, "score.json");
      await fsp.writeFile(scoreFile, JSON.stringify({ total: 60 }));
      const rec = JSON.parse((await run(["record", "--dir", started.dir, "--roast", scoreFile])).stdout);
      assert.equal(rec.phase, "escalate");
      assert.match(rec.reason, /roast 60 < gate 75/);
      const v = await run(["verify", "--dir", started.dir]);
      assert.equal(v.code, 1);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("errors go to stderr with exit 1", async () => {
    const bad = await run(["record", "--dir", "/nonexistent/xyz", "--final-check", "pass"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /no state.json/);

    const missing = await run(["start"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /--slug is required/);

    const unknown = await run(["frobnicate"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /unknown command/);
  });

  it("--help prints usage and exits 0", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /x-essay state/);
  });
});
