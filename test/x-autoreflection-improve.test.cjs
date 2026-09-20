"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..", "skills", "x-autoreflection", "scripts");
const IMPROVE = path.join(SCRIPTS, "improve.mjs");

async function withTmpDir(prefix, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

describe("x-autoreflection improve period", async () => {
  const { parsePeriod, describePeriod, planPathFor } = await import(IMPROVE);

  it("reads a period as hours, however it is written", () => {
    assert.equal(parsePeriod("24"), 24);
    assert.equal(parsePeriod("24h"), 24);
    assert.equal(parsePeriod("7d"), 168);
    assert.equal(parsePeriod("2w"), 336);
    assert.equal(parsePeriod("1.5d"), 36);
    assert.equal(parsePeriod(" 12H "), 12);
    assert.equal(parsePeriod(undefined), 24, "no period means the last day");
    assert.equal(parsePeriod(""), 24);
  });

  it("refuses a period it cannot read, rather than picking one", () => {
    for (const bad of ["abc", "-5", "0h", "7 days", "30m"]) {
      assert.throws(() => parsePeriod(bad), /period/, `"${bad}" should not parse`);
    }
  });

  it("names the period the way the panel and the report do", () => {
    assert.equal(describePeriod(24), "24h (1d)");
    assert.equal(describePeriod(7 * 24), "168h (7d)");
    assert.equal(describePeriod(6), "6h");
  });

  it("puts the plan beside its report as the next artifact of the same run", () => {
    assert.equal(planPathFor("/runs/2026-09-20-1200-R01-autoreflection/E00-analysis.json"), "/runs/2026-09-20-1200-R01-autoreflection/E01-heal.json");
    assert.equal(planPathFor("/runs/x/E07-analysis.json"), "/runs/x/E08-heal.json");
    assert.equal(planPathFor("/runs/x/analysis.json"), "/runs/x/E00-heal.json");
  });
});

describe("x-autoreflection improve proposals", async () => {
  const { proposalCards, summarizeReport, improve } = await import(IMPROVE);

  const finding = {
    id: "F1",
    kind: "tool-failure",
    class: "doc-command-drift",
    skill: "x-epic",
    severity: "high",
    recurrence: 2,
    count: 3,
    summary: "the documented flag does not match the script",
    change: "align the documented flag with the script",
    evidence: [{ session: "s1", message: 12, excerpt: "Exit code 1" }],
  };
  const report = {
    schema: "x-autoreflection-analysis/1",
    window: { hours: 24 },
    stats: { sessions: 4, skillsTouched: 2, signals: 9, high: 2, findings: 1, portfolio: 1 },
    skills: [{ name: "x-epic", sessions: 2, loaded: 2, used: 2, unused: 0, high: 2, medium: 0, low: 1 }],
    findings: [finding],
  };

  it("summarizes the report's own numbers for the panel's first line", () => {
    const summary = summarizeReport(report);
    assert.equal(summary.sessions, 4);
    assert.equal(summary.findings, 1);
    assert.deepEqual(summary.topFindings, [
      { id: "F1", skill: "x-epic", kind: "tool-failure", class: "doc-command-drift", severity: "high", recurrence: 2, count: 3, summary: "the documented flag does not match the script" },
    ]);
  });

  it("carries the issue, the rate and the scores onto every proposal card", async () => {
    const { mintPlan } = await import(path.join(SCRIPTS, "heal.mjs"));
    const cards = proposalCards(mintPlan(report, { analysisPath: "E00-analysis.json" }));
    assert.equal(cards.length, 1);
    assert.equal(cards[0].issue, finding.summary);
    assert.equal(cards[0].severity, "high");
    assert.equal(cards[0].recurrence, 2);
    assert.match(cards[0].improvement, /^tool-failure signals on x-epic: 3 across 2 sessions → none in the next 14 days$/);
    assert.deepEqual(cards[0].scores, { sessions: 2, loaded: 2, used: 2, unused: 0, high: 2, medium: 0, low: 1 });
    assert.equal(cards[0].target, "skills/x-epic/SKILL.md");
  });

  /** The one command, end to end: signals on disk in, report + gated plan out, no CLI traversal. */
  it("writes the report and the gated plan from scans it was handed", async () => {
    await withTmpDir("improve", async (dir) => {
      const scans = path.join(dir, "scans");
      const out = path.join(dir, "run");
      fs.mkdirSync(scans, { recursive: true });
      fs.writeFileSync(
        path.join(scans, "crush--s1.signals.json"),
        JSON.stringify({
          source: { host: "crush", id: "s1", uuid: "s1", title: "session s1" },
          stats: { toolCalls: 3, toolFailures: 1 },
          skills: { loaded: ["x-epic"], used: ["x-epic"], unused: [] },
          signals: [{ id: "S1", kind: "tool-failure", severity: "high", summary: "the documented flag does not match the script", count: 1, suspects: ["x-epic"], evidence: [{ message: 3, excerpt: "x" }] }],
        })
      );

      const result = improve({ period: "24h", analyzeArgs: ["--scans", scans, "--out", out], cwd: dir });

      assert.equal(result.period, "24h (1d)");
      assert.ok(fs.existsSync(result.analysis), "the report JSON is written");
      assert.ok(fs.existsSync(result.report), "the markdown is written beside it");
      assert.ok(fs.existsSync(result.plan), "the plan is minted as the next artifact");
      assert.deepEqual(result.violations, [], "the report passed its gate");
      assert.equal(result.summary.sessions, 1);
      assert.equal(result.items.length, 1);
      assert.ok(result.items[0].issue, "a proposal names the issue it answers");
      assert.ok(result.items[0].improvement, "a proposal names the rate it should move");
      assert.equal(path.basename(result.plan), "E01-heal.json");

      const plan = JSON.parse(fs.readFileSync(result.plan, "utf8"));
      assert.equal(plan.items[0].find, "", "the edit fields wait for the agent to read the target");
      assert.equal(plan.items[0].auto, false);
    });
  });

  it("stops after the report when the plan is not wanted", async () => {
    await withTmpDir("improve-report-only", async (dir) => {
      const scans = path.join(dir, "scans");
      const out = path.join(dir, "run");
      fs.mkdirSync(scans, { recursive: true });
      fs.writeFileSync(
        path.join(scans, "crush--s1.signals.json"),
        JSON.stringify({ source: { host: "crush", id: "s1", uuid: "s1" }, stats: { toolCalls: 1 }, skills: {}, signals: [] })
      );
      const result = improve({ period: "1h", plan: false, analyzeArgs: ["--scans", scans, "--out", out], cwd: dir });
      assert.equal(result.plan, undefined, "no plan is minted");
      assert.equal(fs.readdirSync(out).filter((name) => name.endsWith("-heal.json")).length, 0);
      assert.ok(fs.existsSync(result.analysis));
    });
  });
});
