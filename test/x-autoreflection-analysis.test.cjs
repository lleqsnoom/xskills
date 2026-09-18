"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-autoreflection-analysis");
const ANALYZE = path.join(SKILL, "scripts", "analyze.mjs");
const CHECK = path.join(SKILL, "scripts", "check-analysis.mjs");

async function withTmpDir(prefix, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function scan(id, signals = [], skills = { loaded: [], used: [], unused: [] }) {
  return {
    source: { host: "crush", id, uuid: id, title: `session ${id}` },
    stats: { toolCalls: 3, toolFailures: 1, panels: 0, proseQuestions: 0, repeats: 0 },
    skills,
    signals,
  };
}

function signal(kind, { severity = "high", suspect = null, summary = "x", count = 1, message = 3 } = {}) {
  return {
    id: "S1",
    kind,
    severity,
    summary,
    count,
    suspects: suspect ? [suspect] : [],
    evidence: [{ message, excerpt: summary }],
  };
}

describe("x-autoreflection-analysis aggregate", async () => {
  const { aggregate } = await import(ANALYZE);

  it("groups the same gap across sessions into one finding with recurrence", () => {
    const scans = [
      scan("s1", [signal("tool-failure", { suspect: "x-epic" })], { loaded: ["x-epic"], used: ["x-epic"] }),
      scan("s2", [signal("tool-failure", { suspect: "x-epic" })], { loaded: ["x-epic"], used: ["x-epic"] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.equal(report.stats.sessions, 2);
    assert.equal(report.stats.findings, 1);
    assert.equal(report.findings[0].recurrence, 2);
    assert.equal(report.findings[0].skill, "x-epic");
    assert.equal(report.findings[0].class, "doc-command-drift");
  });

  it("drops expected-exit as a non-gap", () => {
    const scans = [scan("s1", [signal("expected-exit", { severity: "low" })], { loaded: [], used: [] })];
    const report = aggregate(scans, { hours: 24 });
    assert.equal(report.stats.findings, 0);
  });

  it("turns skill-unused into a delete portfolio item", () => {
    const scans = [
      scan("s1", [signal("skill-unused", { severity: "low", suspect: "x-triage" })], { loaded: ["x-triage"], used: [], unused: ["x-triage"] }),
      scan("s2", [signal("skill-unused", { severity: "low", suspect: "x-triage" })], { loaded: ["x-triage"], used: [], unused: ["x-triage"] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    const deletes = report.portfolio.filter((item) => item.action === "delete");
    assert.equal(deletes.length, 1);
    assert.deepEqual(deletes[0].skills, ["x-triage"]);
  });

  it("proposes a create item for a recurring failure no skill names", () => {
    const scans = [
      scan("s1", [signal("tool-failure", { suspect: null })], { loaded: [], used: [] }),
      scan("s2", [signal("tool-failure", { suspect: null })], { loaded: [], used: [] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.ok(report.portfolio.some((item) => item.action === "create"));
  });

  it("proposes a split when one skill spans three kinds", () => {
    const scans = [
      scan(
        "s1",
        [
          signal("tool-failure", { suspect: "x-plan" }),
          signal("user-correction", { suspect: "x-plan" }),
          signal("prose-question", { suspect: "x-plan", severity: "medium" }),
        ],
        { loaded: ["x-plan"], used: ["x-plan"] }
      ),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.ok(report.portfolio.some((item) => item.action === "split" && item.skills.includes("x-plan")));
  });

  it("ranks findings recurrence first", () => {
    const scans = [
      scan("s1", [signal("tool-failure", { suspect: "x-a" })], { loaded: ["x-a"], used: ["x-a"] }),
      scan("s2", [signal("tool-failure", { suspect: "x-a" })], { loaded: ["x-a"], used: ["x-a"] }),
      scan("s3", [signal("tool-failure", { suspect: "x-a" })], { loaded: ["x-a"], used: ["x-a"] }),
      scan("s1", [signal("tool-failure", { suspect: "x-b" })], { loaded: ["x-b"], used: ["x-b"] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.equal(report.findings[0].skill, "x-a");
    assert.equal(report.findings[0].recurrence, 3);
    assert.equal(report.findings[1].skill, "x-b");
  });
});

describe("x-autoreflection-analysis report writing", async () => {
  const { aggregate, renderMarkdown, writeReport } = await import(ANALYZE);

  it("writes one JSON and one markdown from the same object", async () => {
    await withTmpDir("analysis", async (dir) => {
      const report = aggregate([scan("s1", [signal("tool-failure", { suspect: "x-epic" })], { loaded: ["x-epic"], used: ["x-epic"] })], { hours: 24 });
      const { jsonPath, mdPath } = writeReport(report, dir);
      assert.ok(fs.existsSync(jsonPath));
      assert.ok(fs.existsSync(mdPath));
      const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      assert.equal(json.stats.sessions, 1);
      const md = fs.readFileSync(mdPath, "utf8");
      assert.ok(md.includes("## Findings"));
      assert.ok(md.includes("x-epic"));
    });
  });

  it("renders markdown that names the finding", () => {
    const report = aggregate([scan("s1", [signal("tool-failure", { suspect: "x-epic" })], { loaded: ["x-epic"], used: ["x-epic"] })], { hours: 24 });
    const md = renderMarkdown(report);
    assert.ok(md.includes("F1"));
    assert.ok(md.includes("doc-command-drift"));
  });
});

describe("x-autoreflection-analysis check-analysis", async () => {
  const { aggregate } = await import(ANALYZE);
  const { lintAnalysis } = await import(CHECK);

  it("accepts a well-shaped report", () => {
    const report = aggregate([scan("s1", [signal("tool-failure", { suspect: "x-epic" })], { loaded: ["x-epic"], used: ["x-epic"] })], { hours: 24 });
    const { violations } = lintAnalysis(report);
    assert.deepEqual(violations, []);
  });

  it("fails a report with no evidence and a bad portfolio action", () => {
    const report = { schema: "x-autoreflection-analysis/1", stats: { sessions: 0 }, findings: [], portfolio: [{ id: "PF1", action: "rename", skills: ["x"], reason: "" }] };
    const { violations } = lintAnalysis(report);
    assert.ok(violations.some((v) => v.rule === "no-evidence"));
    assert.ok(violations.some((v) => v.rule === "portfolio-action"));
  });
});
