"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-autoreflection");
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

describe("x-autoreflection analyze aggregate", async () => {
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

  it("gives each quality anchor its improvement class, and keeps an interrupt out of the findings", () => {
    const scans = [
      scan("s1", [
        signal("user-redo", { suspect: "x-research" }),
        signal("user-handoff", { suspect: "x-research" }),
        signal("tool-rejected", { suspect: "x-analyze" }),
        signal("skill-script-silent", { suspect: "x-plan" }),
        signal("interrupt", { severity: "low", suspect: "x-analyze" }),
      ]),
    ];
    const report = aggregate(scans, { hours: 24 });
    const classOf = Object.fromEntries(report.findings.map((finding) => [finding.kind, finding.class]));
    assert.deepEqual(classOf, {
      "user-redo": "missing-expectation",
      "user-handoff": "missing-expectation",
      "tool-rejected": "ritual-cost",
      "skill-script-silent": "silent-success",
    });
    assert.ok(report.findings.every((finding) => finding.change), "every quality class carries a change hint");
  });

  it("adds the retries and the reading order the anchors script computed", async () => {
    const { withAnchors, renderMarkdown } = await import(ANALYZE);
    const report = withAnchors(aggregate([scan("s1")], { hours: 24 }), {
      retries: [{ earlier: "crush:s1", later: "claude:s2", hours: 0.4, overlap: 0.97, excerpt: "do a deep research" }],
      select: [{ session: "crush:s1", reason: "cross-session-retry", owner: "x-research", model: "deepseek-v4-pro", anchors: [{ kind: "cross-session-retry", owner: "x-research", message: 2 }] }],
      recurring: [],
      audit: null,
    });
    assert.equal(report.retries.length, 1);
    const markdown = renderMarkdown(report);
    assert.match(markdown, /## Read first/);
    assert.match(markdown, /crush:s1.*cross-session-retry.*x-research/);
    assert.match(markdown, /## Asked again in a later session/);
  });

  it("names every signal kind and improvement class the code emits in gap-taxonomy.md", async () => {
    const { CLASS_BY_KIND } = await import(ANALYZE);
    const taxonomy = fs.readFileSync(path.join(SKILL, "references", "gap-taxonomy.md"), "utf8");
    const kinds = [...Object.keys(CLASS_BY_KIND), "skill-unused", "expected-exit", "interrupt", "cross-session-retry"];
    for (const name of [...kinds, ...new Set(Object.values(CLASS_BY_KIND))]) {
      assert.ok(taxonomy.includes(`\`${name}\``), `gap-taxonomy.md does not name ${name}`);
    }
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

  it("gates delete at two sessions, and groups skill-unused per skill", () => {
    const unusedSignal = (suspects) => ({ id: "S1", kind: "skill-unused", severity: "low", summary: "unused", count: suspects.length, suspects, evidence: [] });
    const scans = [
      scan("s1", [unusedSignal(["x-a", "x-b"])], { loaded: ["x-a", "x-b"], used: [], unused: ["x-a", "x-b"] }),
      scan("s2", [unusedSignal(["x-a"])], { loaded: ["x-a"], used: [], unused: ["x-a"] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    const deletes = report.portfolio.filter((item) => item.action === "delete");
    assert.equal(deletes.length, 1, "only x-a recurs across two sessions");
    assert.deepEqual(deletes[0].skills, ["x-a"]);
    assert.equal(deletes[0].reason, "loaded but never used in 2 session(s)");
  });

  it("proposes a create item for a recurring failure no skill names", () => {
    const scans = [
      scan("s1", [signal("tool-failure", { suspect: null })], { loaded: [], used: [] }),
      scan("s2", [signal("tool-failure", { suspect: null })], { loaded: [], used: [] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.ok(report.portfolio.some((item) => item.action === "create"));
  });

  it("does not auto-emit split from a skill spanning many friction kinds", () => {
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
    assert.ok(!report.portfolio.some((item) => item.action === "split"), "split is a manual observation, not a mechanical one");
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

describe("x-autoreflection analyze report writing", async () => {
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

describe("x-autoreflection check-analysis", async () => {
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
