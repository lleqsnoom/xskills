"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const METRICS = path.join(__dirname, "..", "skills", "x-autoreflection", "scripts", "metrics.mjs");

function withTmpDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("x-autoreflection metrics — definition version", async () => {
  const metrics = await import(METRICS);

  it("names the definition its numbers follow, so a history line says which 'used' it counted", () => {
    const scores = metrics.buildScores({ sessions: [] });
    assert.equal(metrics.METRICS_DEFINITION, "v2");
    assert.equal(scores.definition, "v2");
    assert.equal(metrics.historyLine(scores, "2026-09-19").definition, "v2");
  });
});

describe("x-autoreflection metrics — verdicts written in the digest", async () => {
  const metrics = await import(METRICS);
  const anchor = { session: "908228ee", host: "crush", anchor: "user-redo msg 119", owner: "x-research", model: "deepseek-v4-pro" };

  it("renders one verdict line per anchor, and one marked audit line", () => {
    assert.equal(
      metrics.renderVerdictLine(anchor),
      "- [ ] `908228ee` · user-redo msg 119 · x-research · deepseek-v4-pro — good / below / not-a-skill-problem — note:"
    );
    assert.match(metrics.renderVerdictLine({ ...anchor, anchor: null, audit: true }), /^- \[ \] audit `908228ee` · no anchor · x-research/);
  });

  it("reads the word the user kept, and the note after it", () => {
    const line = metrics.renderVerdictLine(anchor).replace("[ ]", "[x]").replace("good / below / not-a-skill-problem", "below").replace("note:", "note: read abstracts only");
    assert.deepEqual(metrics.parseVerdictLine(line), {
      session: "908228ee",
      anchor: "user-redo msg 119",
      owner: "x-research",
      model: "deepseek-v4-pro",
      audit: false,
      verdict: "below",
      note: "read abstracts only",
    });
  });

  it("accepts a bolded choice, and refuses a line that still offers all three", () => {
    const bold = metrics.renderVerdictLine(anchor).replace("[ ]", "[x]").replace("good / below", "good / **below**");
    assert.equal(metrics.parseVerdictLine(bold).verdict, "below");
    const undecided = metrics.renderVerdictLine(anchor).replace("[ ]", "[x]");
    assert.equal(metrics.parseVerdictLine(undecided).verdict, null, "ticked without choosing is not a label");
    assert.equal(metrics.parseVerdictLine(metrics.renderVerdictLine(anchor)), null, "an unticked line is not read");
  });

  it("reads the Verdicts section of a digest, and reports the lines it could not decide", () => {
    withTmpDir("verdicts", (dir) => {
      const digest = path.join(dir, "DIGEST.md");
      fs.writeFileSync(
        digest,
        [
          "# Daily reflection — 2026-09-18",
          "",
          "## Verdicts",
          "",
          metrics.renderVerdictLine(anchor).replace("[ ]", "[x]").replace("good / below / not-a-skill-problem", "good"),
          metrics.renderVerdictLine({ ...anchor, session: "be09bb81" }).replace("[ ]", "[x]"),
          metrics.renderVerdictLine({ ...anchor, session: "aaaa1111" }),
          "",
          "## Reviewed",
          "",
          "- [x] P1 — accept",
        ].join("\n")
      );
      const read = metrics.readVerdicts(digest);
      assert.deepEqual(read.verdicts.map((v) => [v.session, v.verdict]), [["908228ee", "good"]]);
      assert.deepEqual(read.undecided.map((v) => v.session), ["be09bb81"]);
    });
  });

  it("keeps every label in labels.jsonl after its pack is pruned, and lets a later edit win", () => {
    withTmpDir("labels", (dir) => {
      const day = (date, verdict) => {
        fs.mkdirSync(path.join(dir, date), { recursive: true });
        fs.writeFileSync(
          path.join(dir, date, "DIGEST.md"),
          `## Verdicts\n\n${metrics.renderVerdictLine(anchor).replace("[ ]", "[x]").replace("good / below / not-a-skill-problem", verdict)}\n`
        );
      };
      const file = path.join(dir, "labels.jsonl");
      day("2026-09-18", "good");
      metrics.writeLabels(metrics.labelsFromDigests(dir), { file });
      fs.rmSync(path.join(dir, "2026-09-18"), { recursive: true });
      day("2026-09-19", "below");
      const written = metrics.writeLabels(metrics.labelsFromDigests(dir), { file });
      assert.equal(written.labels, 2, "the pruned day's label survives");
      const lines = () => fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.deepEqual(lines().map((line) => [line.date, line.verdict]), [["2026-09-18", "good"], ["2026-09-19", "below"]]);
      day("2026-09-19", "not-a-skill-problem");
      metrics.writeLabels(metrics.labelsFromDigests(dir), { file });
      assert.deepEqual(lines().map((line) => [line.date, line.verdict]), [["2026-09-18", "good"], ["2026-09-19", "not-a-skill-problem"]]);
    });
  });
});

describe("x-autoreflection metrics — a detector earns a place in the reading order", async () => {
  const metrics = await import(METRICS);
  const label = (anchor, verdict, audit = false) => ({ date: "2026-09-19", session: "s", anchor, verdict, audit });

  it("scores each anchor kind by the reviewer's verdicts, and validates it only with enough of them", () => {
    const labels = [
      ...Array.from({ length: 55 }, () => label("user-pushback msg 3", "below")),
      ...Array.from({ length: 5 }, () => label("user-pushback msg 9", "good")),
      label("user-redo msg 2", "below"),
      label("no anchor", "good", true),
    ];
    const table = metrics.detectorPrecision(labels);
    assert.deepEqual(table["user-pushback"], { labelled: 60, below: 55, precision: 0.917, validated: true });
    assert.deepEqual(table["user-redo"], { labelled: 1, below: 1, precision: 1, validated: false }, "one label is not evidence");
    assert.equal(table.audit, undefined, "an audit line scores no detector");
    assert.deepEqual([...metrics.validatedKinds(labels)], ["user-pushback"]);
  });

  it("keeps a precise-looking detector out when the verdicts say it is noisy", () => {
    const labels = [...Array.from({ length: 40 }, () => label("user-pushback msg 3", "below")), ...Array.from({ length: 20 }, () => label("user-pushback msg 3", "not-a-skill-problem"))];
    assert.equal(metrics.detectorPrecision(labels)["user-pushback"].validated, false, "0.67 is below the 0.8 bar");
  });
});

describe("x-autoreflection metrics — shortfalls per skill and model, beside the score", async () => {
  const metrics = await import(METRICS);
  const pack = {
    sessions: [
      { id: "a", host: "crush", model: "deepseek-v4-flash", skills: { loaded: ["x-plan"], used: ["x-plan"] } },
      { id: "b", host: "crush", model: "deepseek-v4-flash", skills: { loaded: ["x-plan"], used: ["x-plan"] } },
      { id: "c", host: "claude", model: "claude-sonnet-5", skills: { loaded: ["x-plan"], used: ["x-plan"] } },
    ],
    signals: [
      { kind: "user-redo", session: "a", suspects: ["x-plan"] },
      { kind: "user-handoff", session: "a", suspects: ["x-plan"] },
      { kind: "user-pushback", session: "c", suspects: ["x-plan"] },
      { kind: "tool-failure", session: "b", suspects: ["x-plan"] },
    ],
  };

  it("counts, per skill and model, the sessions it was used in and the ones that fell short", () => {
    const rates = metrics.shortfallRates([pack]);
    assert.deepEqual(rates["x-plan"]["deepseek-v4-flash"], { sessions: 2, shortfall: 1, rate: 0.5, kinds: { "user-redo": 1, "user-handoff": 1 } });
    assert.deepEqual(rates["x-plan"]["claude-sonnet-5"], { sessions: 1, shortfall: 1, rate: 1, kinds: { "user-pushback": 1 } });
  });

  it("counts a request asked again elsewhere against the earlier session's owner", () => {
    const retried = {
      sessions: [{ id: "e", host: "crush", uuid: "uuid-e", model: "deepseek-v4-pro", lastOwner: "x-research", skills: { loaded: ["x-research"], used: ["x-research"] } }],
      signals: [],
      retries: [{ earlier: "crush:uuid-e", later: "claude:uuid-f" }],
    };
    assert.deepEqual(metrics.shortfallRates([retried])["x-research"]["deepseek-v4-pro"], { sessions: 1, shortfall: 1, rate: 1, kinds: { "cross-session-retry": 1 } });
  });

  it("keeps the rates out of the weighted score", () => {
    const scores = metrics.buildScores(pack);
    assert.ok(scores.shortfall["x-plan"], "reported beside the composite");
    assert.equal(scores.skills.find((row) => row.name === "x-plan").dimensions.shortfall, undefined, "and never inside it");
  });
});
