"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-research");
const STATE = path.join(SKILL, "scripts", "state.mjs");
const EVALUATE = path.join(SKILL, "scripts", "evaluate.mjs");

function run(script, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], {
      stdio: [options.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      cwd: options.cwd,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

function base(overrides = {}) {
  return {
    slug: "tune",
    metric: "throughput",
    direction: "maximize",
    target: 100,
    policy: "score_improvement",
    evaluator: "node eval.mjs",
    cap: 5,
    ...overrides,
  };
}

describe("x-research state — pure", async () => {
  const m = await import(STATE);

  it("startState applies defaults and validates the contract", () => {
    const s = m.startState({ slug: "a", metric: "m", target: 5, evaluator: "echo" });
    assert.equal(s.phase, "baseline");
    assert.equal(s.iteration, 0);
    assert.equal(s.direction, "maximize");
    assert.equal(s.policy, "score_improvement");
    assert.equal(s.cap, m.DEFAULT_CAP);
    assert.equal(s.minDelta, 0);
    assert.equal(s.noiseRuns, 1);
    assert.equal(s.timeoutMs, m.DEFAULT_TIMEOUT_MS);
    assert.deepEqual(s.search, { allowed: [], forbidden: [] });
    assert.equal(s.best, null);
  });

  it("startState rejects bad input", () => {
    assert.throws(() => m.startState({}), /slug is required/);
    assert.throws(() => m.startState(base({ metric: undefined })), /metric is required/);
    assert.throws(() => m.startState(base({ target: undefined })), /target must be a number/);
    assert.throws(() => m.startState(base({ evaluator: undefined })), /evaluator command is required/);
    assert.throws(() => m.startState(base({ direction: "sideways" })), /direction/);
    assert.throws(() => m.startState(base({ policy: "wish" })), /policy/);
    assert.throws(() => m.startState(base({ cap: 0 })), /cap/);
    assert.throws(() => m.startState(base({ minDelta: -1 })), /minDelta/);
    assert.throws(() => m.startState(base({ noiseRuns: 0 })), /noiseRuns/);
    assert.throws(() => m.startState(base({ timeoutMs: 0 })), /timeoutMs/);
  });

  it("matchesGlob: * is per-segment, ** crosses directories", () => {
    assert.equal(m.matchesGlob("src/*.js", "src/a.js"), true);
    assert.equal(m.matchesGlob("src/*.js", "src/deep/a.js"), false);
    assert.equal(m.matchesGlob("src/**", "src/deep/a.js"), true);
    assert.equal(m.matchesGlob("**/*.test.*", "src/a.test.js"), true);
    assert.equal(m.matchesGlob("src/**", "lib/a.js"), false);
  });

  it("searchVerdict enforces allowed and forbidden globs", () => {
    const search = { allowed: ["src/**"], forbidden: ["**/*.test.*"] };
    assert.equal(m.searchVerdict(search, ["src/a.js"]).pass, true);
    const outside = m.searchVerdict(search, ["lib/a.js"]);
    assert.equal(outside.pass, false);
    assert.deepEqual(outside.outsideAllowed, ["lib/a.js"]);
    const forbidden = m.searchVerdict(search, ["src/a.test.js"]);
    assert.equal(forbidden.pass, false);
    assert.deepEqual(forbidden.forbiddenHits, ["src/a.test.js"]);
    assert.equal(m.searchVerdict({ allowed: [], forbidden: [] }, ["anything"]).pass, true);
  });

  it("targetMet respects direction", () => {
    const max = m.startState(base({ direction: "maximize", target: 100 }));
    assert.equal(m.targetMet(max, 100), true);
    assert.equal(m.targetMet(max, 99), false);
    const min = m.startState(base({ direction: "minimize", target: 10 }));
    assert.equal(m.targetMet(min, 10), true);
    assert.equal(m.targetMet(min, 11), false);
  });

  it("baseline records the held value and enters iterate", () => {
    const s = m.startState(base());
    m.recordBaseline(s, { score: 40 });
    assert.equal(s.phase, "iterate");
    assert.equal(s.iteration, 1);
    assert.equal(s.best.score, 40);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].kind, "baseline");
  });

  it("baseline finishing at the target stops immediately as done", () => {
    const s = m.startState(base({ target: 100 }));
    m.recordBaseline(s, { score: 100 });
    assert.equal(s.phase, "done");
    assert.match(s.stopReason, /already met at baseline/);
  });

  it("score_improvement keeps a better candidate and reverts a worse one", () => {
    const s = m.startState(base({ minDelta: 1 }));
    m.recordBaseline(s, { score: 50 });
    m.recordCandidate(s, { pass: true, score: 55, changed: ["src/a.js"] });
    assert.equal(s.history.at(-1).decision, "keep");
    assert.equal(s.best.score, 55);
    assert.equal(s.history.at(-1).delta, 5);
    m.recordCandidate(s, { pass: true, score: 54 });
    assert.equal(s.history.at(-1).decision, "revert");
    assert.equal(s.best.score, 55);
    assert.equal(s.history.at(-1).delta, -1);
  });

  it("min_delta turns a small improvement into a revert", () => {
    const s = m.startState(base({ minDelta: 3 }));
    m.recordBaseline(s, { score: 50 });
    m.recordCandidate(s, { pass: true, score: 51 });
    assert.equal(s.history.at(-1).decision, "revert");
    assert.deepEqual(s.history.at(-1).gates.improvement, { actual: 1, expected: 3, pass: false });
  });

  it("pass_only keeps any passing candidate, even a worse score", () => {
    const s = m.startState(base({ policy: "pass_only", target: 200 }));
    m.recordBaseline(s, { score: 100 });
    m.recordCandidate(s, { pass: true, score: 90 });
    assert.equal(s.history.at(-1).decision, "keep");
    assert.equal(s.best.score, 90);
    m.recordCandidate(s, { pass: false, score: 200 });
    assert.equal(s.history.at(-1).decision, "revert");
  });

  it("the evaluator pass flag gates a keep under either policy", () => {
    const s = m.startState(base({ policy: "score_improvement" }));
    m.recordBaseline(s, { score: 50 });
    m.recordCandidate(s, { pass: false, score: 90 });
    assert.equal(s.history.at(-1).decision, "revert");
  });

  it("a failed guard reverts the candidate", () => {
    const s = m.startState(base({ guard: "npm test" }));
    m.recordBaseline(s, { score: 50 });
    m.recordCandidate(s, { pass: true, score: 90, guardPass: false });
    assert.equal(s.history.at(-1).decision, "revert");
    assert.deepEqual(s.history.at(-1).gates.guard, { actual: 0, expected: 1, pass: false });
    m.recordCandidate(s, { pass: true, score: 90, guardPass: true });
    assert.equal(s.history.at(-1).decision, "keep");
  });

  it("a multi-path change fails the atomicity gate and is reverted", () => {
    const s = m.startState(base());
    m.recordBaseline(s, { score: 50 });
    m.recordCandidate(s, { pass: true, score: 90, changed: ["src/a.js", "src/b.js"] });
    assert.equal(s.history.at(-1).decision, "revert");
    assert.deepEqual(s.history.at(-1).gates.atomic, { actual: 2, expected: 1, pass: false });
  });

  it("a change outside the search space is reverted", () => {
    const s = m.startState(base({ allowed: ["src/**"], forbidden: ["**/*.test.*"] }));
    m.recordBaseline(s, { score: 50 });
    m.recordCandidate(s, { pass: true, score: 90, changed: ["lib/a.js"] });
    assert.equal(s.history.at(-1).decision, "revert");
    assert.equal(s.history.at(-1).gates.search.pass, false);
    m.recordCandidate(s, { pass: true, score: 90, changed: ["src/a.test.js"] });
    assert.equal(s.history.at(-1).decision, "revert");
    m.recordCandidate(s, { pass: true, score: 90, changed: ["src/a.js"] });
    assert.equal(s.history.at(-1).decision, "keep");
  });

  it("noise_runs requires enough samples and averages them", () => {
    const s = m.startState(base({ noiseRuns: 3 }));
    m.recordBaseline(s, { score: 0 });
    m.recordCandidate(s, { pass: true, samples: [1, 2] });
    assert.equal(s.history.at(-1).decision, "revert");
    assert.deepEqual(s.history.at(-1).gates.noise, { actual: 2, expected: 3, pass: false });
    m.recordCandidate(s, { pass: true, samples: [1, 2, 3] });
    assert.equal(s.history.at(-1).decision, "keep");
    assert.equal(s.history.at(-1).score, 2);
    assert.deepEqual(s.history.at(-1).gates.noise, { actual: 3, expected: 3, pass: true });
  });

  it("meeting the target stops as done; verify re-derives it", () => {
    const s = m.startState(base({ target: 100 }));
    m.recordBaseline(s, { score: 50 });
    m.recordCandidate(s, { pass: true, score: 100, changed: ["src/a.js"] });
    assert.equal(s.phase, "done");
    assert.equal(m.isStopped(s), true);
    const v = m.verify(s);
    assert.equal(v.ok, true);
    assert.deepEqual(v.checks.map((c) => c.pass), [true, true]);
  });

  it("minimize direction stops when the value drops to the target", () => {
    const s = m.startState(base({ direction: "minimize", target: 10 }));
    m.recordBaseline(s, { score: 50 });
    m.recordCandidate(s, { pass: true, score: 8 });
    assert.equal(s.phase, "done");
    assert.throws(() => m.recordCandidate(s, { pass: true, score: 1 }), /already stopped/);
  });

  it("hitting the cap without the target escalates and verify fails", () => {
    const s = m.startState(base({ target: 100, cap: 2 }));
    m.recordBaseline(s, { score: 0 });
    m.recordCandidate(s, { pass: true, score: 10 });
    assert.equal(s.phase, "iterate");
    m.recordCandidate(s, { pass: true, score: 20 });
    assert.equal(s.phase, "escalate");
    assert.match(s.stopReason, /cap 2 reached/);
    const v = m.verify(s);
    assert.equal(v.ok, false);
    assert.equal(v.phase, "escalate");
  });

  it("rejects out-of-order records", () => {
    const s = m.startState(base());
    assert.throws(() => m.recordCandidate(s, { pass: true, score: 5 }), /not awaiting a candidate/);
    m.recordBaseline(s, { score: 0 });
    assert.throws(() => m.recordBaseline(s, { score: 0 }), /not awaiting baseline/);
    assert.throws(() => m.recordCandidate(s, { score: 5 }), /candidate needs pass/);
    assert.throws(() => m.recordCandidate(s, { pass: true }), /numeric score/);
  });

  it("summarize reports the numeric arc", () => {
    const s = m.startState(base({ target: 100 }));
    m.recordBaseline(s, { score: 40 });
    m.recordCandidate(s, { pass: true, score: 46 });
    m.recordCandidate(s, { pass: true, score: 55 });
    m.recordCandidate(s, { pass: true, score: 54 }); // reverted
    const sum = m.summarize(s);
    assert.equal(sum.baselineScore, 40);
    assert.equal(sum.bestScore, 55);
    assert.equal(sum.gain, 15);
    assert.equal(sum.experiments, 3);
    assert.equal(sum.kept, 2);
  });

  it("renders the audit trail: research.md and results.tsv", () => {
    const s = m.startState(base({ goal: "go faster" }));
    m.recordBaseline(s, { score: 40 });
    m.recordCandidate(s, { pass: true, score: 46, changed: ["src/a.js"], change: "inline map" });
    const md = m.renderResearchMd(s);
    assert.match(md, /# Research — tune/);
    assert.match(md, /\*\*Metric:\*\* throughput/);
    assert.match(md, /go faster/);
    const tsv = m.renderResultsTsv(s);
    const lines = tsv.trim().split("\n");
    assert.equal(lines[0], "iteration\tkind\tscore\tpass\tguard_pass\tdelta\tdecision\tchange");
    assert.equal(lines.length, 3);
    assert.match(lines[2], /candidate\t46\ttrue\t\t6\tkeep\tinline map/);
  });
});

describe("x-research evaluate — pure", async () => {
  const m = await import(EVALUATE);

  it("normalizeEvalOutput accepts the contract shape and a bare number", () => {
    assert.deepEqual(m.normalizeEvalOutput({ pass: true, score: 7 }), { pass: true, score: 7 });
    assert.deepEqual(m.normalizeEvalOutput({ score: "3.5" }), { pass: false, score: 3.5 });
    assert.deepEqual(m.normalizeEvalOutput(9), { pass: false, score: 9 });
  });

  it("normalizeEvalOutput rejects missing or non-numeric scores", () => {
    assert.throws(() => m.normalizeEvalOutput({ pass: true }), /numeric score/);
    assert.throws(() => m.normalizeEvalOutput(null), /no output/);
    assert.throws(() => m.normalizeEvalOutput("nope"), /object or number/);
  });

  it("runEvaluator parses JSON from the command", () => {
    const res = m.runEvaluator({ command: 'node -e "console.log(JSON.stringify({pass:true,score:12}))"' });
    assert.equal(res.ok, true);
    assert.equal(res.pass, true);
    assert.equal(res.score, 12);
  });

  it("runEvaluator reports invalid output instead of throwing", () => {
    const res = m.runEvaluator({ command: 'node -e "console.log(\'nope\')"' });
    assert.equal(res.ok, false);
    assert.match(res.error, /valid JSON|numeric score/);
  });

  it("runEvaluator enforces the timeout", () => {
    const res = m.runEvaluator({ command: 'node -e "setTimeout(function(){}, 5000)"', timeoutMs: 300 });
    assert.equal(res.ok, false);
    assert.equal(res.timedOut, true);
  });

  it("runGuard treats exit 0 as pass and a timeout as fail", () => {
    assert.equal(m.runGuard({ command: 'node -e "process.exit(0)"' }).guardPass, true);
    assert.equal(m.runGuard({ command: 'node -e "process.exit(2)"' }).guardPass, false);
    assert.equal(m.runGuard({ command: 'node -e "setTimeout(function(){}, 5000)"', timeoutMs: 300 }).guardPass, false);
  });
});

describe("x-research CLI", async () => {
  it("drives a full passing loop, writes the trail, and verify exits 0", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "x-research-"));
    try {
      const started = JSON.parse(
        (
          await run(STATE, [
            "start",
            "--slug",
            "demo",
            "--metric",
            "throughput",
            "--target",
            "100",
            "--policy",
            "score_improvement",
            "--min-delta",
            "1",
            "--cap",
            "5",
            "--evaluator",
            'node -e "console.log(JSON.stringify({pass:true,score:1}))"',
            "--root",
            root,
          ])
        ).stdout
      );
      assert.equal(started.next, "baseline");
      const dir = started.dir;
      for (const f of ["state.json", "research.md", "research_log.md", "results.tsv"]) {
        assert.ok(await fsp.stat(path.join(dir, f)), `${f} missing`);
      }

      assert.equal(JSON.parse((await run(STATE, ["record", "--dir", dir, "--baseline", "50"])).stdout).next, "iterate");

      const cand = path.join(root, "cand.json");
      await fsp.writeFile(cand, JSON.stringify({ pass: true, score: 100 }));
      const rec = JSON.parse((await run(STATE, ["record", "--dir", dir, "--candidate", cand, "--changed", "src/a.js"])).stdout);
      assert.equal(rec.phase, "done");
      assert.equal(rec.stop, true);
      assert.equal(rec.summary.bestScore, 100);

      assert.ok(await fsp.stat(path.join(dir, "final_report.md")));

      const v = await run(STATE, ["verify", "--dir", dir]);
      assert.equal(v.code, 0, v.stderr);
      assert.equal(JSON.parse(v.stdout).ok, true);

      const status = JSON.parse((await run(STATE, ["status", "--dir", dir])).stdout);
      assert.equal(status.summary.experiments, 1);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("reads a candidate from stdin and escalates at the cap (verify exits 1)", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "x-research-"));
    try {
      const started = JSON.parse(
        (await run(STATE, ["start", "--slug", "weak", "--metric", "m", "--target", "100", "--cap", "1", "--evaluator", "true", "--root", root])).stdout
      );
      const dir = started.dir;
      await run(STATE, ["record", "--dir", dir, "--baseline", "10"]);
      const rec = JSON.parse(
        (await run(STATE, ["record", "--dir", dir, "--candidate", "-"], { input: JSON.stringify({ pass: true, score: 20 }) })).stdout
      );
      assert.equal(rec.phase, "escalate");
      assert.match(rec.reason, /cap 1 reached/);
      const v = await run(STATE, ["verify", "--dir", dir]);
      assert.equal(v.code, 1);
      const report = await fsp.readFile(path.join(dir, "final_report.md"), "utf8");
      assert.match(report, /Open findings/);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("errors go to stderr with exit 1", async () => {
    const bad = await run(STATE, ["record", "--dir", "/nonexistent/xyz", "--baseline", "1"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /no state.json/);

    const missingSlug = await run(STATE, ["start", "--metric", "m"]);
    assert.equal(missingSlug.code, 1);
    assert.match(missingSlug.stderr, /--slug is required/);

    const missingTarget = await run(STATE, ["start", "--slug", "s", "--metric", "m", "--evaluator", "true"]);
    assert.equal(missingTarget.code, 1);
    assert.match(missingTarget.stderr, /target must be a number/);

    const noRecord = await run(STATE, ["record", "--dir", "/tmp/none"]);
    assert.equal(noRecord.code, 1);
    assert.match(noRecord.stderr, /--baseline or --candidate|no state.json/);

    const unknown = await run(STATE, ["frobnicate"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /unknown command/);
  });

  it("--help prints usage and exits 0", async () => {
    const help = await run(STATE, ["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /x-research state/);
  });

  it("evaluate.mjs runs a command and prints the verdict JSON", async () => {
    const ok = await run(EVALUATE, ["--command", 'node -e "console.log(JSON.stringify({pass:true,score:5}))"']);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).score, 5);
    assert.equal(JSON.parse(ok.stdout).pass, true);

    const bad = await run(EVALUATE, ["--command", 'node -e "console.log(\'nope\')"']);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /numeric score|valid JSON/);

    const help = await run(EVALUATE, ["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /x-research evaluate/);
  });
});

describe("x-research agent-judged evaluator — pure", async () => {
  const m = await import(STATE);

  it("coverageVerdict maps k/n to { pass, score } and validates", () => {
    assert.deepEqual(m.coverageVerdict("3/3"), { met: 3, total: 3, score: 1, pass: true });
    const partial = m.coverageVerdict("2/3");
    assert.equal(partial.pass, false);
    assert.equal(partial.score, 0.667);
    assert.equal(m.coverageVerdict(" 1 / 4 ").score, 0.25);
    assert.throws(() => m.coverageVerdict("nope"), /k\/n/);
    assert.throws(() => m.coverageVerdict("1/0"), /denominator/);
    assert.throws(() => m.coverageVerdict("4/3"), /exceed/);
  });

  it("countCriteriaEntries counts non-empty, non-comment lines", () => {
    assert.equal(m.countCriteriaEntries("a\n\nb\n# note\nc\n"), 3);
    assert.equal(m.countCriteriaEntries(""), 0);
  });

  it("startState agent kind records the honest evaluator and defaults the target", () => {
    const s = m.startState({ slug: "topic", metric: "criteria_coverage", evaluator: "agent", criteria: 4 });
    assert.equal(s.evaluatorKind, "agent");
    assert.equal(s.criteria, 4);
    assert.equal(s.evaluator, "agent (coverage of 4 criteria)");
    assert.equal(s.target, 1);
    assert.equal(s.direction, "maximize");
  });

  it("startState agent kind needs a positive criteria count", () => {
    assert.throws(
      () => m.startState({ slug: "t", metric: "m", evaluator: "agent" }),
      /criteria/
    );
    assert.throws(
      () => m.startState({ slug: "t", metric: "m", evaluator: "agent", criteria: 0 }),
      /criteria/
    );
  });

  it("agent coverage drives the same keep/revert/stop machinery", () => {
    const s = m.startState({ slug: "t", metric: "criteria_coverage", evaluator: "agent", criteria: 3 });
    m.recordBaseline(s, { score: m.coverageVerdict("1/3").score, pass: m.coverageVerdict("1/3").pass });
    m.recordCandidate(s, { pass: false, score: m.coverageVerdict("2/3").score, changed: ["notes.md"] });
    assert.equal(s.history.at(-1).decision, "revert");
    assert.equal(s.best.score, 0.333);
    m.recordCandidate(s, { pass: true, score: m.coverageVerdict("3/3").score, changed: ["notes.md"] });
    assert.equal(s.phase, "done");
    assert.equal(m.verify(s).ok, true);
  });
});

describe("x-research agent-judged evaluator — CLI", async () => {
  it("start --evaluator agent records the label and a default target of 1", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "x-research-agent-"));
    try {
      const started = JSON.parse(
        (await run(STATE, ["start", "--slug", "topic", "--metric", "criteria_coverage", "--evaluator", "agent", "--criteria", "3", "--root", root])).stdout
      );
      assert.equal(started.state.evaluator, "agent (coverage of 3 criteria)");
      assert.equal(started.state.evaluatorKind, "agent");
      assert.equal(started.state.target, 1);
      assert.equal(started.next, "baseline");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("drives a coverage loop from --coverage to done, and verify exits 0", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "x-research-agent-"));
    try {
      const started = JSON.parse(
        (await run(STATE, ["start", "--slug", "lit", "--metric", "criteria_coverage", "--evaluator", "agent", "--criteria", "2", "--root", root])).stdout
      );
      const dir = started.dir;
      const base = JSON.parse((await run(STATE, ["record", "--dir", dir, "--baseline", "--coverage", "0/2"])).stdout);
      assert.equal(base.next, "iterate");
      assert.equal(base.summary.baselineScore, 0);
      const rec = JSON.parse(
        (await run(STATE, ["record", "--dir", dir, "--candidate", "--coverage", "2/2", "--changed", "notes.md", "--change", "cover the second source"])).stdout
      );
      assert.equal(rec.phase, "done");
      assert.equal(rec.stop, true);
      assert.equal(rec.summary.bestScore, 1);
      const v = await run(STATE, ["verify", "--dir", dir]);
      assert.equal(v.code, 0, v.stderr);
      assert.equal(JSON.parse(v.stdout).ok, true);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("accepts a criteria file and errors on bad agent input", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "x-research-agent-"));
    try {
      const criteria = path.join(root, "criteria.md");
      await fsp.writeFile(criteria, "- q1\n- q2\n# heading\n\n- q3\n");
      const started = JSON.parse(
        (await run(STATE, ["start", "--slug", "file", "--metric", "criteria_coverage", "--evaluator", "agent", "--criteria", criteria, "--root", root])).stdout
      );
      assert.equal(started.state.criteria, 3);

      const noCriteria = await run(STATE, ["start", "--slug", "bad", "--metric", "m", "--evaluator", "agent", "--root", root]);
      assert.equal(noCriteria.code, 1);
      assert.match(noCriteria.stderr, /criteria/);

      const badCoverage = await run(STATE, ["record", "--dir", started.dir, "--baseline", "--coverage", "nope"]);
      assert.equal(badCoverage.code, 1);
      assert.match(badCoverage.stderr, /k\/n/);

      const orphanCoverage = await run(STATE, ["record", "--dir", started.dir, "--coverage", "1/3"]);
      assert.equal(orphanCoverage.code, 1);
      assert.match(orphanCoverage.stderr, /--baseline or --candidate/);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
