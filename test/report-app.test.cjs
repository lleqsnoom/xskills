"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DERIVE = path.join(ROOT, "skills", "x-autoreflection", "scripts", "derive.mjs");
const SERVER = path.join(ROOT, "scripts", "report-server.mjs");
const OPEN = path.join(ROOT, "scripts", "report-open.mjs");
const SCALE = path.join(ROOT, "tools", "report-app", "src", "chart-scale.mjs");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xskills-report-"));
}

/** A history line as `metrics.historyLine` writes it. */
function line(date, skills, extra = {}) {
  return { date, weights: "v1", floor: 5, sessions: 3, skills, ...extra };
}

const scored = (name, score, dimensions = {}, n = 6) => ({
  name,
  n,
  named: n + 2,
  score,
  raw: score,
  status: "scored",
  coverage: 1,
  dimensions,
});

const thin = (name, raw, dimensions = {}) => ({
  name,
  n: 1,
  named: 4,
  score: null,
  raw,
  status: "insufficient data",
  coverage: 0.5,
  dimensions,
});

describe("derive — the rules the app renders", async () => {
  const d = await import(DERIVE);

  it("bands a score, and says when nothing was scored", () => {
    assert.equal(d.band(90).key, "good");
    assert.equal(d.band(72).key, "fair");
    assert.equal(d.band(50).key, "weak");
    assert.equal(d.band(null).key, "unknown");
    assert.equal(d.band(85).key, "good", "the boundary counts as healthy");
    assert.equal(d.band(70).key, "fair");
  });

  it("treats an axis with no denominator as unmeasured, not as zero", () => {
    assert.deepEqual(d.measuredOf({ trigger: 0, rework: null, protocol: undefined, adherence: 0.5 }), ["adherence", "trigger"]);
    assert.deepEqual(d.measuredAxes([{ dimensions: { trigger: 1, rework: null } }, { dimensions: { rework: 0.5 } }]), ["trigger", "rework"]);
  });

  it("names the axes that moved, biggest first and capped at three", () => {
    const moved = d.movedAxes(
      { conformance: 0.9, trigger: 0.2, rework: 0.5, protocol: 0.7, adherence: 0.4 },
      { conformance: 0.92, trigger: 0.5, rework: 0.55, protocol: 0.6, adherence: 0.9 }
    );
    assert.deepEqual(moved.map((m) => m.name), ["adherence", "trigger", "protocol"], "largest move first");
    assert.equal(moved[0].points, 50);
    assert.equal(moved[1].points, 30);
    assert.equal(moved.find((m) => m.name === "conformance"), undefined, "a 2-point move is noise");
    assert.equal(moved.find((m) => m.name === "rework"), undefined, "only the three largest are kept");
  });

  it("leaves out an axis one of the two days did not measure", () => {
    assert.deepEqual(d.movedAxes({ trigger: 0.2, rework: null }, { trigger: 0.4, rework: 0.9 }).map((m) => m.name), ["trigger"]);
  });

  it("lists one row per skill in use, ordered by how far it moved", () => {
    const history = new Map([
      ["2026-09-16", line("2026-09-16", [scored("x-up", 60, { trigger: 0.4 }), scored("x-down", 80, { trigger: 0.9 }), { name: "x-idle", n: 0, named: 11, score: null, raw: null, status: "insufficient data", dimensions: {} }])],
      ["2026-09-17", line("2026-09-17", [scored("x-up", 70, { trigger: 0.6 }), scored("x-down", 74, { trigger: 0.7 }), { name: "x-idle", n: 0, named: 12, score: null, raw: null, status: "insufficient data", dimensions: {} }])],
    ]);
    const rows = d.movement(history);
    assert.deepEqual(rows.map((r) => r.name), ["x-up", "x-down"], "a skill never loaded is not a row");
    assert.equal(rows[0].change, 10);
    assert.equal(rows[0].direction, "up");
    assert.equal(rows[0].moved[0].name, "trigger");
    assert.equal(rows[1].direction, "down");
    assert.equal(rows[1].change, -6);
  });

  it("refuses to call one day a change", () => {
    const rows = d.movement(new Map([["2026-09-16", line("2026-09-16", [scored("x-one", 70)])]]));
    assert.equal(rows[0].change, null);
    assert.equal(rows[0].direction, "flat");
    assert.equal(rows[0].measured, 1);
  });

  it("measures a thin day from its raw mean, and marks it", () => {
    const rows = d.movement(new Map([
      ["2026-09-16", line("2026-09-16", [thin("x-one", 61)])],
      ["2026-09-17", line("2026-09-17", [scored("x-one", 70)])],
    ]));
    assert.equal(rows[0].series[0].score, null);
    assert.equal(rows[0].series[0].raw, 61);
    assert.equal(rows[0].change, 9, "61 → 70, so a thin day still contributes");
  });

  it("summarises the newest days for the list", () => {
    const history = new Map([
      ["2026-09-16", line("2026-09-16", [scored("x-one", 60), thin("x-two", 80)], { sessions: 4 })],
      ["2026-09-17", line("2026-09-17", [scored("x-one", 70)], { sessions: 9 })],
    ]);
    const recent = d.recentDays(history);
    assert.deepEqual(recent.map((r) => r.date), ["2026-09-17", "2026-09-16"], "newest first");
    assert.equal(recent[0].sessions, 9);
    assert.equal(recent[0].mean, 70);
    assert.equal(recent[1].measured, 2, "a thin day still counts as measured");
    assert.equal(recent[1].scored, 1);
    assert.equal(recent[1].mean, 70, "its raw is what a thin day contributes");
    assert.equal(recent[1].band.key, "fair", "the day is banded once, from the mean of what was measured");
  });

  it("lays a month out Monday first, with only recorded days clickable", () => {
    const history = new Map([
      ["2026-09-16", line("2026-09-16", [])],
      ["2026-09-17", line("2026-09-17", [])],
      ["2026-08-02", line("2026-08-02", [])],
    ]);
    const months = d.calendar(history);
    assert.deepEqual(months.map((m) => m.month), ["2026-09", "2026-08"], "newest month first");
    const september = months[0];
    assert.equal(september.cells.filter((c) => c.recorded).length, 2);
    assert.equal(september.cells[0].day, null, "the leading blanks are cells too");
    const first = september.cells.find((c) => c.day === 1);
    assert.equal(first.date, "2026-09-01");
    assert.equal(first.recorded, false);
    assert.equal(september.cells.at(-1).day, 30, "September has 30 days");
  });

  it("resolves the raw numerator behind an axis", () => {
    const row = {
      n: 4,
      named: 9,
      counters: { toolCalls: 100, repeats: 5, panels: 3, proseQuestions: 1, checks: { passes: 7, fails: 1, refusals: 2 }, graphs: { calls: 11 } },
    };
    assert.equal(d.axisMath(row, "conformance"), "7/8 +2 refused");
    assert.equal(d.axisMath(row, "adherence"), "11 graph calls");
    assert.equal(d.axisMath(row, "trigger"), "4 of 9");
    assert.equal(d.axisMath(row, "rework"), "95/100");
    assert.equal(d.axisMath(row, "protocol"), "3 panels + 1 prose");
  });

  it("survives a row with no counters at all", () => {
    assert.equal(d.axisMath({ n: 0, named: 0 }, "conformance"), "0/0");
    assert.equal(d.axisMath({ n: 0, named: 0 }, "rework"), "0/0");
  });
});

describe("report server — the JSON packs as a database", async () => {
  const srv = await import(SERVER);

  /** A daily root with two history lines and one pack, which is what the API reads. */
  function root() {
    const dir = tmp();
    const pack = path.join(dir, "2026-09-17");
    fs.mkdirSync(pack, { recursive: true });
    const session = {
      id: "s1",
      host: "crush",
      uuid: "s1",
      title: "One session",
      project: "/tmp/p",
      modified: "2026-09-17T10:00:00Z",
      stats: { messages: 10, userMessages: 3, assistantMessages: 6, toolCalls: 4, toolResults: 4, panels: 1, toolFailures: 1, expectedExits: 0, repeats: 0, corrections: 1, reprompts: 0, proseQuestions: 0 },
      skills: { loaded: ["x-plan"], used: ["x-plan"], unused: [] },
      checks: [{ skill: "x-plan", script: "scenario.mjs", calls: 3, passes: 2, refusals: 1, fails: 0 }],
      graphs: [{ skill: "x-plan", calls: 5, illegalMoves: 1, prematureTransitions: 0 }],
      runFolders: [],
      artifacts: [],
    };
    const signal = { id: "S1", kind: "tool-failure", severity: "high", summary: "bash failed", count: 2, suspects: ["x-plan"], session: "s1", sessionTitle: "One session", evidence: [] };
    fs.writeFileSync(
      path.join(pack, "summary.json"),
      JSON.stringify({ pack: `.x-skills/daily/2026-09-17`, generatedAt: "2026-09-17 05:00", window: { hours: 24 }, hosts: [], counts: { scanned: 1 }, skills: { touched: [], idle: [] }, sessions: [session], signals: [signal], runFolders: [], artifacts: [], warnings: [], notes: [] })
    );
    fs.writeFileSync(path.join(pack, "DIGEST.md"), "# Daily\n\n## Proposals\n\n### P1 — a fix (from `s1`)\n**Signal:** S1 (high, kept)\n**Target:** `skills/x-plan/SKILL.md:9`\n**Change:** do the thing\n**Check:** `npm test` exits 0\n**Route:** `x-fix`\n");
    fs.writeFileSync(
      path.join(dir, "history.jsonl"),
      `${JSON.stringify(line("2026-09-16", [thin("x-plan", 60, { trigger: 0.4 })], { sessions: 2 }))}\n${JSON.stringify(line("2026-09-17", [scored("x-plan", 70, { trigger: 0.6 })], { sessions: 4 }))}\n`
    );
    return dir;
  }

  it("reads the movement screen in one payload", () => {
    const dir = root();
    const page = srv.apiMovement({ root: dir });
    assert.equal(page.days, 2);
    assert.equal(page.newest, "2026-09-17");
    assert.equal(page.hasPack, true);
    assert.equal(page.movement.length, 1);
    assert.equal(page.movement[0].name, "x-plan");
    assert.equal(page.recent.length, 2);
    assert.equal(page.calendar.length, 1);
    assert.deepEqual(page.todos, { updatedAt: null, items: [] });
  });

  it("reads one day, its proposals and its scores — with the band decided once", () => {
    const dir = root();
    const day = srv.apiDay({ root: dir, date: "2026-09-17" });
    assert.equal(day.pack.sessions.length, 1);
    assert.equal(day.pack.sessions[0].high, 1, "the session carries its own high count");
    assert.equal(day.proposals.length, 1);
    assert.equal(day.proposals[0].skill, "x-plan");
    assert.match(day.digest, /DIGEST\.md$/);
    assert.equal(day.scores.length, 1);
    assert.equal(day.scores[0].band.key, "fair", "the band travels with the score");
    assert.equal(srv.apiDay({ root: dir, date: "1999-01-01" }), null);
  });

  it("names the bundle it is serving, so a tab from before the last build can notice", () => {
    const built = tmp();
    fs.mkdirSync(path.join(built, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(built, "index.html"),
      '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-Bh3wPIp8.js"></script></head><body></body></html>'
    );
    assert.equal(srv.buildId({ appDist: built }), "index-Bh3wPIp8.js", "the name the page asks for is the name the server reports");
    assert.equal(srv.buildId({ appDist: tmp() }), null, "an unbuilt tree names nothing, rather than guessing");
  });

  it("reads one skill's series across the days", () => {
    const dir = root();
    const skill = srv.apiSkill({ root: dir, name: "x-plan" });
    assert.equal(skill.name, "x-plan");
    assert.equal(skill.change, 10);
    assert.equal(skill.perDay.length, 2);
    assert.deepEqual(skill.perDay.map((d) => d.date), ["2026-09-16", "2026-09-17"]);
    assert.equal(skill.perDay[1].sample.id, "s1", "the day points at a session the skill was loaded in");
    assert.equal(srv.apiSkill({ root: dir, name: "nope" }), null);
  });

  it("splits a skill's shortfall by model, so a regression can be read as a model change", () => {
    const dir = tmp();
    const daySession = (id, model) => ({
      id,
      host: "crush",
      uuid: id,
      title: id,
      project: "/tmp/p",
      modified: "2026-09-17T10:00:00Z",
      model,
      stats: { messages: 6, userMessages: 2, assistantMessages: 4, toolCalls: 2, toolResults: 2, panels: 0, toolFailures: 0, expectedExits: 0, repeats: 0, corrections: 0, reprompts: 0, proseQuestions: 0 },
      skills: { loaded: ["x-plan"], used: ["x-plan"], unused: [] },
      runFolders: [],
      artifacts: [],
    });
    const mkPack = (date, sessions, signals) => {
      fs.mkdirSync(path.join(dir, date), { recursive: true });
      fs.writeFileSync(
        path.join(dir, date, "summary.json"),
        JSON.stringify({ pack: `.x-skills/daily/${date}`, generatedAt: `${date} 05:00`, window: { hours: 24 }, hosts: [], counts: { scanned: sessions.length }, skills: { touched: [], idle: [] }, sessions, signals, retries: [], runFolders: [], artifacts: [], warnings: [], notes: [] })
      );
    };
    mkPack("2026-09-16", [daySession("s-old", "deepseek-v4-pro")], []);
    mkPack(
      "2026-09-17",
      [daySession("s-new", "claude-opus-5")],
      [{ id: "S1", kind: "user-redo", severity: "high", summary: "asked again", count: 1, suspects: ["x-plan"], session: "s-new", sessionTitle: "s-new", evidence: [] }]
    );
    fs.writeFileSync(
      path.join(dir, "history.jsonl"),
      `${JSON.stringify(line("2026-09-16", [scored("x-plan", 80, {})], { sessions: 1 }))}\n${JSON.stringify(line("2026-09-17", [scored("x-plan", 70, {})], { sessions: 1 }))}\n`
    );
    const skill = srv.apiSkill({ root: dir, name: "x-plan" });
    assert.deepEqual(skill.models["deepseek-v4-pro"], { sessions: 1, shortfall: 0, rate: 0, kinds: {} });
    assert.deepEqual(skill.models["claude-opus-5"], { sessions: 1, shortfall: 1, rate: 1, kinds: { "user-redo": 1 } });
    assert.equal(srv.apiSkill({ root: dir, name: "x-plan" }).models !== null, true);
  });

  it("says why a skill moved: the signals that blamed it and the proposals that target it", () => {
    const dir = root();
    const skill = srv.apiSkill({ root: dir, name: "x-plan" });
    assert.equal(skill.signals.length, 1, "the pack's signal blames x-plan");
    assert.equal(skill.signals[0].id, "S1");
    assert.equal(skill.signals[0].date, "2026-09-17", "a matched signal carries the day it came from");
    assert.equal(skill.proposals.length, 1, "the digest's proposal targets x-plan");
    assert.equal(skill.proposals[0].id, "P1");
    assert.equal(skill.proposals[0].date, "2026-09-17");

    const other = srv.apiSkill({ root: dir, name: "x-review" });
    assert.equal(other, null, "a skill with no movement row is still null, evidence or not");
  });

  it("marks a skill's proposals kept by the day screen's own rule", () => {
    const dir = root();
    assert.equal(srv.apiSkill({ root: dir, name: "x-plan" }).proposals[0].day, "2026-09-17", "a proposal found on a skill's screen knows its day");
    assert.equal(srv.apiSkill({ root: dir, name: "x-plan" }).proposals[0].inTodo, false, "and starts unkept");

    // Saved with the text it was proposed with, from either screen: one rule decides, so a reader who keeps it
    // on the skill's screen finds the day's row already offering `in to-do` too.
    srv.writeTodos([{ id: "P1", day: "2026-09-17", change: "do the thing" }], dir);
    assert.equal(srv.apiSkill({ root: dir, name: "x-plan" }).proposals[0].inTodo, true, "kept from the skill's screen, and read back as kept");
    assert.equal(srv.apiDay({ root: dir, date: "2026-09-17" }).proposals[0].inTodo, true, "the day agrees, because the rule is one rule");
  });

  it("blames only the skill a signal names, and orders signals worst first", () => {
    const dir = root();
    const pack = path.join(dir, "2026-09-17");
    const summary = JSON.parse(fs.readFileSync(path.join(pack, "summary.json"), "utf8"));
    summary.signals.push(
      { id: "S2", kind: "repeat-call", severity: "medium", summary: "again", count: 1, suspects: ["x-plan"], session: "s1", evidence: [] },
      { id: "S3", kind: "tool-failure", severity: "high", summary: "worse", count: 9, suspects: ["x-plan"], session: "s1", evidence: [] },
      { id: "S4", kind: "tool-failure", severity: "high", summary: "someone else", count: 4, suspects: ["x-review"], session: "s1", evidence: [] }
    );
    fs.writeFileSync(path.join(pack, "summary.json"), JSON.stringify(summary));

    const skill = srv.apiSkill({ root: dir, name: "x-plan" });
    assert.deepEqual(skill.signals.map((s) => s.id), ["S3", "S1", "S2"], "high first, then by count");
    assert.equal(skill.signals.some((s) => s.id === "S4"), false, "a signal that blames another skill is not x-plan's");
  });

  it("keeps the selection in a file beside the packs, and replaces an item rather than duplicating it", () => {
    const dir = root();
    srv.writeTodos([{ id: "P1", skill: "x-plan", change: "do the thing" }], dir);
    srv.writeTodos([{ id: "P1", skill: "x-plan", change: "do the thing, better" }, { id: "P2", skill: null }], dir);
    const stored = srv.readTodos(dir);
    assert.equal(stored.items.length, 2);
    assert.equal(stored.items[0].change, "do the thing, better");
    assert.ok(stored.updatedAt);
    assert.deepEqual(Object.keys(stored.items[0]), ["id", "day", "skill", "change", "reason", "expected", "target", "route", "signal", "note"], "only known fields are kept");
    assert.throws(() => srv.writeTodos("nope", dir), /must be an array/);
  });

  it("reads an empty selection rather than throwing on a broken file", () => {
    const dir = tmp();
    assert.deepEqual(srv.readTodos(dir), { updatedAt: null, items: [] });
    fs.writeFileSync(path.join(dir, "todos.json"), "not json");
    assert.deepEqual(srv.readTodos(dir), { updatedAt: null, items: [] });
  });

  it("decides what is already kept by the work, then by the label scoped to its day", () => {
    const same = (item, proposal) => srv.sameWork(item, proposal);
    assert.equal(same({ id: "P1", change: "x" }, { id: "P9", change: "x", day: "2026-09-17" }), true, "the same change is the same task, under any label");
    assert.equal(same({ id: "P1", change: "x" }, { id: "P1", change: "y", day: "2026-09-17" }), false, "a label every digest reuses is not an identity");
    assert.equal(same({ id: "P1", day: "2026-09-17" }, { id: "P1", change: null, day: "2026-09-17" }), true, "with no text to compare, the label decides — within its own day");
    assert.equal(same({ id: "P1", day: "2026-09-16" }, { id: "P1", change: null, day: "2026-09-17" }), false);
  });

  it("keeps a proposal's own day beside it, and marks the ones already kept", () => {
    const dir = root();
    const yesterday = path.join(dir, "2026-09-16");
    fs.mkdirSync(yesterday, { recursive: true });
    fs.copyFileSync(path.join(dir, "2026-09-17", "summary.json"), path.join(yesterday, "summary.json"));
    fs.writeFileSync(path.join(yesterday, "DIGEST.md"), "# Daily\n\n### P1 — yesterday's own fix\n**Change:** another thing entirely\n");

    // The reader kept today's P1 — and had saved it before the list recorded days, so it carries no `day`.
    srv.writeTodos([{ id: "P1", change: "do the thing" }], dir);

    const today = srv.apiDay({ root: dir, date: "2026-09-17" });
    assert.equal(today.proposals[0].day, "2026-09-17");
    assert.equal(today.proposals[0].inTodo, true, "the text it was saved with is the same work");

    const other = srv.apiDay({ root: dir, date: "2026-09-16" });
    assert.equal(other.proposals[0].id, "P1", "the same label...");
    assert.equal(other.proposals[0].inTodo, false, "...on another day is another task");
  });

  it("records which day a kept proposal came from, and refuses anything that is not a day", () => {
    const written = srv.writeTodos([{ id: "P1", day: "2026-09-17" }, { id: "P2", day: "yesterday" }], tmp());
    assert.equal(written.items[0].day, "2026-09-17");
    assert.equal(written.items[1].day, null, "a day that is not a date cannot tell two P1s apart");
  });

  it("records the newest day without touching the others", () => {
    const dir = root();
    const before = fs.readFileSync(path.join(dir, "history.jsonl"), "utf8").trim().split("\n").length;
    const result = srv.refresh({ root: dir });
    assert.equal(result.ok, true);
    assert.equal(result.day, "2026-09-17");
    const after = fs.readFileSync(path.join(dir, "history.jsonl"), "utf8").trim().split("\n");
    assert.equal(after.length, before, "the day is replaced, not appended twice");
  });

  it("reports no packs instead of recording nothing", () => {
    const result = srv.refresh({ root: tmp() });
    assert.equal(result.ok, false);
    assert.match(result.reason, /no pack under/);
  });

  it("confines a path to its root", () => {
    const dir = tmp();
    assert.equal(srv.resolveWithin("/index.html", dir), path.join(dir, "index.html"));
    assert.equal(srv.resolveWithin("/../secrets", dir), null);
    assert.equal(srv.resolveWithin("/%2e%2e/secrets", dir), null);
  });

  it("finds the newest pack and says when there is none", () => {
    const dir = tmp();
    assert.equal(srv.newestPack(dir), null);
    for (const day of ["2026-09-16", "2026-09-17", "not-a-day"]) fs.mkdirSync(path.join(dir, day), { recursive: true });
    assert.equal(srv.newestPack(dir), "2026-09-17");
  });
});

describe("report:open — the surfaces the report can be read in", async () => {
  const open = await import(OPEN);
  const tabList = (tabs) => ({ code: 0, stdout: JSON.stringify({ ok: true, result: { tabs } }), stderr: "" });

  it("focuses the Orca tab that already shows the report instead of opening a second one", () => {
    const calls = [];
    const exec = (command, args) => {
      calls.push(args.join(" "));
      if (args[1] === "list") return tabList([{ pageId: "page_1", url: "http://127.0.0.1:8787/skill/x-anal", title: "x-skills" }]);
      return { code: 0, stdout: "{}", stderr: "" };
    };
    const result = open.openInOrca({ url: "http://127.0.0.1:8787/day/2026-09-17", exec });
    assert.equal(result.ok, true);
    assert.equal(result.how, "focused");
    assert.deepEqual(calls, ["tab list --json", "tab switch --page page_1 --focus"]);
  });

  it("matches a tab by origin, so another port is not this report", () => {
    const calls = [];
    const exec = (command, args) => {
      calls.push(args.join(" "));
      return args[1] === "list" ? tabList([{ pageId: "page_9", url: "http://127.0.0.1:9999/" }]) : { code: 0, stdout: "", stderr: "" };
    };
    assert.equal(open.openInOrca({ url: "http://127.0.0.1:8787/", exec }).how, "created");
    assert.deepEqual(calls, ["tab list --json", "tab create --url http://127.0.0.1:8787/"]);
  });

  it("reads the tabs Orca prints, and refuses a tab it could not focus", () => {
    assert.deepEqual(open.parseTabs(tabList([{ id: "page_1", url: "http://a" }]).stdout), [{ pageId: "page_1", url: "http://a", title: "" }]);
    assert.deepEqual(open.parseTabs("not json"), []);
    assert.deepEqual(open.parseTabs(tabList([{ title: "no id" }]).stdout), []);
  });

  it("says why an Orca tab could not be opened rather than pretending it worked", () => {
    const exec = () => ({ code: 1, stdout: "", stderr: "Orca runtime is not running\nmore" });
    const result = open.openInOrca({ url: "http://127.0.0.1:8787/", exec });
    assert.equal(result.ok, false);
    assert.match(result.message, /Orca runtime is not running/);
    assert.doesNotMatch(result.message, /more/, "only the first line of a tool's complaint is quoted");
  });

  it("still names a reason when the CLI fails without a word", () => {
    const result = open.openInOrca({ url: "http://127.0.0.1:8787/", exec: () => ({ code: 1, stdout: "", stderr: "" }) });
    assert.equal(result.ok, false);
    assert.match(result.message, /it exited 1 without saying why/);
  });

  it("carries the reason a command that never started has to give", () => {
    const result = open.run("xskills-no-such-command-here", []);
    assert.notEqual(result.code, 0);
    assert.ok(result.stderr.trim().length > 0, "a command that could not be started still says something");
  });

  it("falls back to a window when Orca cannot answer, and says what it skipped", () => {
    const launched = [];
    const result = open.openReport({
      url: "http://127.0.0.1:8787/",
      surface: "orca",
      exec: () => ({ code: 1, stdout: "", stderr: "no orca here" }),
      browser: "/usr/bin/chromium",
      launch: (command, args) => {
        launched.push([command, ...args]);
        return { unref() {} };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.surface, "window");
    assert.deepEqual(launched, [["/usr/bin/chromium", "--app=http://127.0.0.1:8787/", "--class=x-skills-report"]]);
    assert.match(result.tried[0], /no orca here/);
  });

  it("opens a window with no browser controls when that is what was asked for", () => {
    const launched = [];
    const result = open.openInWindow({
      url: "http://127.0.0.1:8787/day/2026-09-17",
      browser: "/usr/bin/google-chrome-stable",
      launch: (command, args) => {
        launched.push([command, ...args]);
        return { unref() {} };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.how, "app-window");
    assert.deepEqual(launched, [["/usr/bin/google-chrome-stable", "--app=http://127.0.0.1:8787/day/2026-09-17", "--class=x-skills-report"]]);
  });

  it("says so when there is no browser to open a window with", () => {
    const result = open.openInWindow({ url: "http://127.0.0.1:8787/", browser: null });
    assert.equal(result.ok, false);
    assert.equal(result.how, "no-browser");
  });

  it("finds a Chromium on the PATH, and reports none when there is not one", () => {
    const exists = (candidate) => candidate === "/usr/bin/chromium";
    assert.equal(open.findBrowser({ env: { PATH: "/usr/bin:/bin" }, exists }), "/usr/bin/chromium");
    assert.equal(open.findBrowser({ env: { PATH: "/bin" }, exists }), null);
  });

  it("keeps a page path a path — a body cannot point the opener at another origin", () => {
    assert.equal(open.safePath("/skill/x-anal?shape=a"), "/skill/x-anal?shape=a");
    assert.equal(open.safePath("//evil.example/x"), "/");
    assert.equal(open.safePath("http://evil.example/"), "/");
    assert.equal(open.safePath("/a:b"), "/");
    assert.equal(open.safePath("/a\\b"), "/");
    assert.equal(open.safePath(null), "/");
  });

  it("reuses a server that is already answering and starts one when it is not", async () => {
    const started = [];
    const spawnFn = (command, args) => {
      started.push([command, ...args]);
      return { pid: 4242, unref() {} };
    };
    const up = await open.ensureServer({ port: 8788, probe: async () => true, spawnFn });
    assert.deepEqual(up, { started: false, url: "http://127.0.0.1:8788/" });
    assert.equal(started.length, 0);

    const answers = (() => {
      let calls = 0;
      return async () => ++calls > 2; // the first two probes come back "not yet"
    })();
    const cold = await open.ensureServer({ port: 8788, probe: answers, spawnFn, sleep: async () => {} });
    assert.equal(cold.started, true);
    assert.equal(cold.pid, 4242);
    assert.equal(started.length, 1);
    assert.match(started[0][1], /report-server\.mjs$/);
    assert.deepEqual(started[0].slice(2), ["--port", "8788"]);
  });

  it("gives up, loudly, on a server that never answers", async () => {
    const result = await open.ensureServer({ port: 8788, probe: async () => false, spawnFn: () => ({ pid: 1, unref() {} }), sleep: async () => {} });
    assert.equal(result.ready, false);
  });

  it("describes the run without running it", () => {
    const plan = { surface: "orca", url: "http://127.0.0.1:8787/", port: 8787 };
    assert.match(open.reportUrl({ port: plan.port }), /^http:\/\/127\.0\.0\.1:8787\/$/);
    assert.equal(open.reportUrl({ port: 9, path: "/day/x" }), "http://127.0.0.1:9/day/x");
  });
});

describe("report server — over http", async () => {
  const srv = await import(SERVER);

  it("answers the API, writes the selection, and serves the app shell for a deep link", async () => {
    const dir = tmp();
    const pack = path.join(dir, "2026-09-17");
    fs.mkdirSync(pack, { recursive: true });
    fs.writeFileSync(
      path.join(pack, "summary.json"),
      JSON.stringify({ pack: "2026-09-17", window: { hours: 24 }, counts: {}, sessions: [], signals: [], skills: { touched: [], idle: [] } })
    );
    fs.writeFileSync(path.join(dir, "history.jsonl"), `${JSON.stringify(line("2026-09-17", [scored("x-plan", 70)]))}\n`);

    const server = srv.createServer({ root: dir, appDist: path.join(dir, "no-app") });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const movement = await fetch(`${base}/api/movement`);
      assert.equal(movement.status, 200);
      assert.equal((await movement.json()).movement.length, 1);

      const days = await fetch(`${base}/api/days`);
      assert.equal(days.status, 200);
      assert.equal((await days.json()).calendar.length, 1);

      const day = await fetch(`${base}/api/day/2026-09-17`);
      assert.equal(day.status, 200);
      assert.equal((await day.json()).pack.date, "2026-09-17");
      assert.equal((await fetch(`${base}/api/day/1999-01-01`)).status, 404);

      const missing = await fetch(`${base}/api/day/2026-09-17/session/nope`);
      assert.equal(missing.status, 404, "a session that is not in the pack is a 404");
      const session = await fetch(`${base}/api/day/2026-09-17/session/s1`);
      assert.equal(session.status, 404, "and so is one that never existed");

      const skill = await fetch(`${base}/api/skill/x-plan`);
      assert.equal(skill.status, 200);
      assert.equal((await skill.json()).name, "x-plan");
      assert.equal((await fetch(`${base}/api/skill/nope`)).status, 404);

      // The bundle the app is serving, so a tab opened before the last build can notice and reload itself.
      const version = await fetch(`${base}/api/version`);
      assert.equal(version.status, 200);
      assert.deepEqual(await version.json(), { build: null }, "a tree with no built app has no bundle to name");

      const written = await fetch(`${base}/api/todos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ id: "P1", skill: "x-plan", change: "x" }] }),
      });
      assert.equal(written.status, 200);
      assert.equal((await written.json()).items.length, 1);
      assert.equal((await (await fetch(`${base}/api/todos`)).json()).items[0].id, "P1");

      const raw = await fetch(`${base}/history.jsonl`);
      assert.equal(raw.status, 200);
      assert.match(raw.headers.get("content-type"), /ndjson/);

      // Nothing is built in a test tree, so the shell is the "how to build" page.
      const shell = await fetch(`${base}/day/2026-09-17`);
      assert.equal(shell.status, 200);
      assert.match(await shell.text(), /report:build/);

      assert.equal((await fetch(`${base}/nope.txt`)).status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops offering a proposal the reader already kept, over http", async () => {
    const dir = tmp();
    const pack = path.join(dir, "2026-09-17");
    fs.mkdirSync(pack, { recursive: true });
    fs.writeFileSync(
      path.join(pack, "summary.json"),
      JSON.stringify({ pack: "2026-09-17", window: { hours: 24 }, counts: {}, sessions: [], signals: [], skills: { touched: [], idle: [] } })
    );
    fs.writeFileSync(path.join(pack, "DIGEST.md"), "# Daily\n\n### P1 — a fix\n**Change:** do the thing\n");
    fs.writeFileSync(path.join(dir, "history.jsonl"), `${JSON.stringify(line("2026-09-17", [scored("x-plan", 70)]))}\n`);

    const server = srv.createServer({ root: dir, appDist: path.join(dir, "no-app") });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const before = await (await fetch(`${base}/api/day/2026-09-17`)).json();
      assert.equal(before.proposals[0].inTodo, false, "nothing is kept yet");

      const written = await fetch(`${base}/api/todos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ id: "P1", day: "2026-09-17", change: "do the thing" }] }),
      });
      assert.equal(written.status, 200);

      const after = await (await fetch(`${base}/api/day/2026-09-17`)).json();
      assert.equal(after.proposals[0].inTodo, true, "the row stops offering itself the moment it is kept");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("opens the report where it was asked to, and only ever at its own origin", async () => {
    const dir = tmp();
    const asked = [];
    const server = srv.createServer({
      root: dir,
      appDist: path.join(dir, "no-app"),
      open: (request) => {
        asked.push(request);
        return { ok: true, surface: request.surface, how: "created", url: request.url, message: "opened" };
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body) => fetch(`${base}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      const opened = await post({ surface: "orca", path: "/skill/x-plan?shape=a" });
      assert.equal(opened.status, 200);
      assert.equal((await opened.json()).message, "opened");
      assert.deepEqual(asked[0], { url: `${base}/skill/x-plan?shape=a`, surface: "orca" }, "the screen the reader was on is the screen that opens");

      await post({ surface: "window", path: "http://evil.example/steal" });
      assert.equal(asked[1].url, `${base}/`, "a body cannot address another origin");

      const refused = srv.createServer({ root: dir, appDist: path.join(dir, "no-app"), open: () => ({ ok: false, surface: "orca", how: "create-failed", url: base, message: "Orca would not open a tab" }) });
      await new Promise((resolve) => refused.listen(0, "127.0.0.1", resolve));
      try {
        const failed = await fetch(`http://127.0.0.1:${refused.address().port}/api/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ surface: "orca" }) });
        assert.equal(failed.status, 502, "a machine that cannot oblige is an error, not a silent success");
        assert.match((await failed.json()).message, /would not open/);
      } finally {
        await new Promise((resolve) => refused.close(resolve));
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves the built app for a deep link and its assets beside it", async () => {    const dir = tmp();
    const dist = path.join(dir, "dist");
    fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><div id=\"root\"></div>");
    fs.writeFileSync(path.join(dist, "assets", "app.js"), "export const x = 1;");

    const server = srv.createServer({ root: dir, appDist: dist });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const shell = await fetch(`${base}/skill/x-plan`);
      assert.equal(shell.status, 200);
      assert.equal(await shell.text(), "<!doctype html><div id=\"root\"></div>", "a client-side route gets the shell");

      const asset = await fetch(`${base}/assets/app.js`);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get("content-type"), /javascript/);
      assert.equal(await asset.text(), "export const x = 1;");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the chart's geometry — what a hundred days do to the axis", async () => {
  const chart = await import(SCALE);
  /** A run of days ending today, oldest first, as `series` arrives from the API. */
  const days = (count) =>
    Array.from({ length: count }, (_, index) => {
      const date = new Date(Date.UTC(2026, 8, 17) - (count - 1 - index) * 86_400_000);
      return date.toISOString().slice(0, 10);
    });
  const xs = (count, scale, width = 560) => chart.placeX({ ages: chart.daysAgo(days(count)), width, scale });

  it("puts the newest day at the right edge and the oldest at the left, at any length", () => {
    for (const count of [2, 3, 14, 30, 90, 365]) {
      const placed = xs(count, "log");
      assert.equal(placed.length, count);
      assert.equal(placed[placed.length - 1], 557, `${count} days: the newest sits at the right pad`);
      assert.equal(placed[0], 3, `${count} days: the oldest sits at the left pad`);
    }
  });

  it("counts a day's age, and treats a repeated date as the same day", () => {
    assert.deepEqual(chart.daysAgo(["2026-09-15", "2026-09-16", "2026-09-17"]), [2, 1, 0]);
    assert.deepEqual(chart.daysAgo(["2026-09-17", "2026-09-17"]), [0, 0]);
    assert.deepEqual(chart.daysAgo(["nonsense"]), [0], "a date it cannot read is not a crash");
    assert.deepEqual(chart.daysAgo([]), []);
  });

  it("gives the recent days the room, and never less than a linear axis would", () => {
    const linear = xs(90, "linear");
    const log = xs(90, "log");
    const step = (list, index) => list[index + 1] - list[index];
    // the newest gap is the widest on the axis, and the oldest is the narrowest
    const gaps = log.slice(1).map((x, index) => x - log[index]);
    assert.equal(Math.max(...gaps), gaps[gaps.length - 1], "the last day has the widest gap");
    assert.equal(Math.min(...gaps), gaps[0], "the first day has the narrowest");
    assert.ok(step(log, 88) > step(linear, 88) * 3, `the newest gap is stretched: ${(step(log, 88) / step(linear, 88)).toFixed(1)}x`);
    // and the recent week holds a real share of the width, which is the whole point
    const week = log[log.length - 1] - log[log.length - 8];
    assert.ok(week > 0.3 * 560, `the last week holds ${(week / 560 * 100).toFixed(0)}% of the frame`);
    // while a year of history still fits, with every day in order and none on top of another
    const year = xs(365, "log");
    assert.ok(year.every((x, index) => index === 0 || x > year[index - 1]), "strictly increasing, oldest to newest");
  });

  it("keeps three months of days apart by at least a pixel", () => {
    const log = xs(90, "log");
    const gaps = log.slice(1).map((x, index) => x - log[index]);
    assert.ok(Math.min(...gaps) > 1, `closest gap ${Math.min(...gaps).toFixed(2)}px`);
  });

  it("bends by the bias it documents: a day old sits a sixth of the way along a 90-day history", () => {
    const log = xs(90, "log");
    const dayOne = log[log.length - 2]; // one day before the newest
    const along = (560 - 3 - dayOne) / 554;
    assert.ok(along > 0.05 && along < 0.2, `a day old sits ${(along * 100).toFixed(0)}% along`);
  });

  it("tiles the plot with hover columns: no gap, no overlap, the outer two at the frame's edges", () => {
    for (const count of [2, 9, 90]) {
      const placed = xs(count, "log");
      const areas = chart.columns(placed, 560);
      assert.equal(areas.length, count);
      assert.equal(areas[0].left, 0, "the first column starts at the frame");
      assert.equal(areas[areas.length - 1].right, 560, "the last column ends at the frame");
      for (let index = 1; index < count; index++) {
        assert.equal(areas[index].left, areas[index - 1].right, `column ${index} meets the one before it`);
      }
      // and the point itself is inside its own column
      placed.forEach((x, index) => {
        assert.ok(x >= areas[index].left - 1e-9 && x <= areas[index].right + 1e-9, `point ${index} is inside its column`);
      });
    }
  });

  it("labels what fits, newest first, and always the newest", () => {
    const placed = xs(90, "log");
    const items = placed.map((x, index) => ({ x, index }));

    const dates = chart.labelSet(items, 56);
    assert.equal(dates[0].index, 89, "the newest keeps its date");
    assert.ok(dates.length < 90, "not every day gets one at 56px apart");
    assert.ok(dates.length >= 3, `only ${dates.length} dates fit`);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i - 1].x - dates[i].x >= 56, "no two dates closer than the gap");
    }
    // The labels are spread evenly on screen, and that is what makes them dense in *days* at the recent end: a
    // label there stands for a couple of days, one at the old end for weeks. It is the axis that gives the
    // recent days room, not the labelling.
    const between = (a, b) => Math.abs(a.index - b.index);
    const recent = between(dates[0], dates[1]);
    const old = between(dates[dates.length - 2], dates[dates.length - 1]);
    assert.ok(old > recent * 2, `a label at the old end stands for ${old} days, one at the recent end for ${recent}`);

    const scores = chart.labelSet(items, 38);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1].x - scores[i].x >= 38, "no two scores closer than the gap");
    }
    assert.ok(scores.length >= dates.length, "a tighter gap fits more scores than dates");

    // two days: both, in both layers
    const two = chart.labelSet(xs(2, "log").map((x, index) => ({ x, index })), 56);
    assert.deepEqual(two.map((item) => item.index), [1, 0], "newest first");
  });

  it("labels a chart with a single point rather than nothing", () => {
    const one = chart.labelSet([{ x: 3, index: 0 }], 56);
    assert.deepEqual(one.map((item) => item.index), [0]);
    assert.deepEqual(chart.labelSet([], 56), []);
  });

  it("says a chart has one point instead of drawing a line through it", () => {
    assert.equal(chart.placeX({ ages: [0], width: 560, scale: "log" }).length, 1);
    assert.deepEqual(chart.columns([3], 560), [{ left: 0, right: 560 }], "one point owns the whole frame");
  });
});

describe("the served app's backend — one request per route, shared", async () => {
  const { httpBackend } = await import(path.join(ROOT, "tools", "report-app", "src", "backend.mjs"));

  /** A fetch that answers the routes it was given and counts what it was asked for. */
  function server(routes, { fail = false } = {}) {
    const stub = async (url, options = {}) => {
      stub.calls.push({ url: String(url), method: options.method ?? "GET", body: options.body });
      if (fail) return { ok: false, status: 503, json: async () => ({ error: "the report is not answering" }) };
      const route = routes[String(url)];
      if (!route) return { ok: false, status: 404, json: async () => ({ error: "no route" }) };
      return { ok: true, status: 200, json: async () => route };
    };
    stub.calls = [];
    return stub;
  }

  it("reads a route over http, asks once for the same route, and surfaces the server's own error", async () => {
    const fetchImpl = server({ "/api/movement?days=14": { days: 3 }, "/api/todos": { items: [] } });
    const backend = httpBackend({ fetchImpl });

    assert.deepEqual(await backend.read("/api/movement?days=14"), { days: 3 });
    assert.deepEqual(await backend.read("/api/movement?days=14"), { days: 3 });
    assert.equal(fetchImpl.calls.length, 1, "two screens asking for the same payload is one request");

    const failing = httpBackend({ fetchImpl: server({}, { fail: true }) });
    await assert.rejects(() => failing.read("/api/movement?days=14"), /the report is not answering/);
  });

  it("writes over http, and forgets what it read because a write makes it stale", async () => {
    const fetchImpl = server({ "/api/todos": { updatedAt: null, items: [] }, "/api/version": { build: "index-a.js" } });
    const backend = httpBackend({ fetchImpl });

    await backend.read("/api/todos");
    const written = await backend.write("/api/todos", { items: [{ id: "P1" }] });
    assert.deepEqual(written, { updatedAt: null, items: [] });
    assert.equal(fetchImpl.calls[1].method, "POST");
    assert.equal(fetchImpl.calls[1].url, "/api/todos");
    assert.equal(JSON.parse(fetchImpl.calls[1].body).items[0].id, "P1");

    await backend.read("/api/todos");
    assert.equal(fetchImpl.calls.length, 3, "the read after the write is a fresh request");

    assert.equal(await backend.bundleName(), "index-a.js", "the served bundle names itself");
  });
});

describe("a report that is current when it is looked at", async () => {
  const { due, watchFreshness } = await import(path.join(ROOT, "tools", "report-app", "src", "revalidate.mjs"));

  /**
   * A document and a window that only do what the watcher asks of them: a listener registry, a visibility flag,
   * and a timer the test drives by hand. No jsdom, no sleeping.
   */
  function fakeDom({ visibility = "visible" } = {}) {
    const listeners = new Map();
    let tick = null;
    const target = {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (name, handler) => listeners.set(`doc:${name}`, handler),
      removeEventListener: (name) => listeners.delete(`doc:${name}`),
    };
    const win = {
      addEventListener: (name, handler) => listeners.set(`win:${name}`, handler),
      removeEventListener: (name) => listeners.delete(`win:${name}`),
    };
    return {
      target,
      win,
      setVisibility: (value) => {
        visibility = value;
      },
      fire: (key) => listeners.get(key)?.({}),
      timer: (fn) => {
        tick = fn;
        return "handle";
      },
      cleared: [],
      tick: () => tick?.(),
      listeners,
    };
  }

  function watcher(options = {}) {
    const calls = [];
    const dom = fakeDom(options);
    const clear = (handle) => dom.cleared.push(handle);
    const stop = watchFreshness({
      target: dom.target,
      win: dom.win,
      timer: dom.timer,
      clear,
      gapMs: 5000,
      intervalMs: 30_000,
      onDue: () => calls.push(options.now?.() ?? 0),
      ...options,
    });
    return { calls, dom, stop };
  }

  it("says when a check is due, on the gap alone", () => {
    assert.equal(due({ now: 0, last: -Infinity, gapMs: 5000 }), true, "nothing has been checked yet");
    assert.equal(due({ now: 1000, last: 0, gapMs: 5000 }), false, "a thousandth of a second later is the same look");
    assert.equal(due({ now: 5000, last: 0, gapMs: 5000 }), true);
    assert.equal(due({ now: 9000, last: 5000, gapMs: 5000 }), false);
  });

  it("checks when the tab is focused or becomes visible, and not while hidden", () => {
    const clock = { at: 0 };
    const { calls, dom } = watcher({ now: () => clock.at });

    dom.fire("win:focus");
    assert.equal(calls.length, 1, "coming back to the tab is the moment to re-read");

    clock.at = 1000;
    dom.fire("win:focus");
    assert.equal(calls.length, 1, "a second focus inside the gap is the same look");

    clock.at = 6000;
    dom.fire("doc:visibilitychange");
    assert.equal(calls.length, 2, "becoming visible again is a fresh look");

    dom.setVisibility("hidden");
    clock.at = 20_000;
    dom.fire("win:focus");
    dom.tick();
    assert.equal(calls.length, 2, "a hidden tab asks nothing of the server");
  });

  it("checks on its own timer, and stops when told to", () => {
    const clock = { at: 0 };
    const { calls, dom, stop } = watcher({ now: () => clock.at });
    const handle = "handle";

    clock.at = 30_000;
    dom.tick();
    assert.equal(calls.length, 1, "the interval keeps a page left open honest");

    clock.at = 60_000;
    dom.tick();
    assert.equal(calls.length, 2);

    stop();
    assert.deepEqual(dom.cleared, [handle], "the timer is cleared");
    assert.equal(dom.listeners.size, 0, "and every listener is removed");
    clock.at = 90_000;
    dom.tick();
    assert.equal(calls.length, 2, "a stopped watcher is silent");
  });

  it("is inert without a document, and survives a check that throws", () => {
    const nothing = watchFreshness({ target: null, win: null });
    assert.equal(typeof nothing, "function");
    assert.doesNotThrow(() => nothing());

    const dom = fakeDom();
    let calls = 0;
    watchFreshness({
      target: dom.target,
      win: dom.win,
      timer: dom.timer,
      clear: () => {},
      gapMs: 0,
      onDue: () => {
        calls += 1;
        throw new Error("the check exploded");
      },
    });
    assert.throws(() => dom.fire("win:focus"), /the check exploded/);
    assert.throws(() => dom.fire("win:focus"), /the check exploded/);
    assert.equal(calls, 2, "a failing check does not unhook the watcher");
  });
});

describe("the app re-reads the screen it is showing", async () => {
  const app = () => fs.readFileSync(path.join(ROOT, "tools", "report-app", "src", "App.tsx"), "utf8");
  const router = () => fs.readFileSync(path.join(ROOT, "tools", "report-app", "src", "router.ts"), "utf8");

  it("arms the freshness watcher, and disarms it on cleanup", () => {
    const source = app();
    assert.match(source, /import \{ watchFreshness \} from "\.\/revalidate\.mjs"/);
    assert.match(source, /onMount\(\(\) => \{\s*onCleanup\(\s*watchFreshness\(/);
    assert.match(source, /onCleanup\(\s*watchFreshness\(/, "what it arms, it hands to a cleanup");
    assert.match(source, /onCleanup\(watchBuild\(/, "including the bundle check, which used to leak its listeners");
  });

  it("re-reads by remounting the screen, not by navigating", () => {
    const source = router();
    assert.match(source, /export function refreshRoute\(\): void \{/, "the seam exists");
    assert.match(source, /setRoute\(\(current\) => \(\{ \.\.\.current \}\)\)/, "a new object, same values, is what a keyed view remounts on");
    assert.doesNotMatch(
      source.slice(source.indexOf("export function refreshRoute"), source.indexOf("export function navigate")),
      /history\.|scrollTo/,
      "a refresh leaves the address bar and the scroll position alone"
    );
  });

  it("calls the watcher's due once the write clears the cache, in that order", () => {
    const source = app();
    const handler = source.slice(source.indexOf("onDue: () =>"), source.indexOf("onDue: () =>") + 160);
    assert.ok(handler.indexOf("api.invalidate()") < handler.indexOf("refreshRoute()"), "clear first, then re-read");
  });
});

describe("a resource that failed is a state the view can draw", async () => {
  const { errorMessage, settled, viewState } = await import(path.join(ROOT, "tools", "report-app", "src", "resource.mjs"));

  /** A resource as Solid hands it over. `thrown` makes the accessor shout, for a value nobody may read. */
  const resource = ({ error = undefined, loading = false, value = undefined, thrown = null } = {}) =>
    Object.assign(
      () => {
        if (thrown) throw new Error(thrown);
        return value;
      },
      { error, loading, latest: value }
    );

  it("says a failure is a failure, without reading the accessor", () => {
    const failed = resource({ error: new Error("no pack for 2026-09-16"), thrown: "the accessor was read" });

    assert.equal(viewState(failed), "error");
    assert.equal(settled(failed), undefined, "a failed resource is never read");
    assert.equal(errorMessage(failed), "no pack for 2026-09-16");
  });

  it("says what was thrown even when it was not an Error", () => {
    assert.equal(errorMessage(resource({ error: "no pack for 2026-09-16" })), "no pack for 2026-09-16");
    assert.equal(errorMessage(resource()), undefined);
  });

  it("tells a fetch in flight apart from an answer with nothing in it", () => {
    const pending = resource({ loading: true });
    assert.equal(viewState(pending), "loading");
    assert.equal(settled(pending), undefined, "a resource in flight has no value yet, and reading one is safe");

    assert.equal(viewState(resource({ value: null })), "empty", "settled, and holding nothing");
    assert.equal(viewState(resource({ value: { days: 2 } })), "ready");
    assert.deepEqual(settled(resource({ value: { days: 2 } })), { days: 2 });
  });
});

describe("no view reads a resource where it cannot survive the read", async () => {
  const SRC = path.join(ROOT, "tools", "report-app", "src");

  function viewSources() {
    const found = [];
    for (const dir of [SRC, path.join(SRC, "components")]) {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.endsWith(".tsx")) found.push(path.join(dir, entry));
      }
    }
    return found;
  }

  /**
   * Every `when=` prop that calls one of the file's own resources.
   *
   * Reading a resource's accessor inside a `when` prop throws the failure out of the update that recorded it,
   * which aborts the rest of that update and leaves the view on the spinner it drew a moment earlier — the
   * bug that made a day that failed to load look like a day that was still loading. `settled` is the read a
   * view is allowed to make; a `when` prop is never the place for it.
   *
   * Only a `when` prop on one line is seen, which every one of them in this app is.
   */
  function readsInWhen(source) {
    const resources = [...source.matchAll(/const \[(\w+)[^\]]*\] = createResource/g)].map((match) => match[1]);
    const found = [];
    for (const name of resources) {
      for (const match of source.matchAll(new RegExp(`when=\\{[^}]*\\b${name}\\(`, "g"))) found.push(`${name}: ${match[0]}`);
    }
    return found;
  }

  it("leaves a resource's value to `settled`, and its three sentences to `Loader`", () => {
    const offenders = viewSources().flatMap((file) => readsInWhen(fs.readFileSync(file, "utf8")).map((hit) => `${path.basename(file)} — ${hit}`));
    assert.deepEqual(offenders, [], "a failed read here is a spinner that never becomes a message");
  });

  it("would catch the shape that was there before", () => {
    const was = `
      const [day] = createResource(() => api.day(props.date));
      <Show when={day() ? day()! : undefined}>{(loaded) => <p>{loaded().date}</p>}</Show>;
      <Show when={day.error}><p class="failed">{(day.error as Error).message}</p></Show>`;
    assert.equal(readsInWhen(was).length, 1, "the day that never loaded, in one line");
  });

  it("draws every sentence a resource can mean in one place", () => {
    const loader = fs.readFileSync(path.join(SRC, "components", "Loader.tsx"), "utf8");
    assert.match(loader, /errorMessage\(props\.resource\)/, "the reason a fetch failed");
    assert.match(loader, /class="loading"/, "what it is waiting for");
    assert.match(loader, /class="empty"/, "an answer with nothing in it");
    assert.match(loader, /settled\(props\.resource\)/, "and the value, through the guard");
  });
});

describe("the narrow pane — the tabs stay off the report", async () => {
  const css = fs.readFileSync(path.join(ROOT, "tools", "report-app", "src", "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "tools", "report-app", "src", "App.tsx"), "utf8");
  /** The rules inside the narrow-pane media query, which is where a phone's layout lives. */
  const narrow = css.slice(css.indexOf("@media (max-width: 860px)"), css.indexOf("@media (max-width: 1000px)", css.indexOf("@media (max-width: 860px)")));

  it("gives the rail three tabs and no lists", () => {
    const nav = app.slice(app.indexOf('<nav aria-label="the screens">'), app.indexOf("</nav>"));
    assert.equal([...nav.matchAll(/<Nav /g)].length, 3, "three tabs, and that is the whole navigation");
    for (const label of ["Skills", "Days", "To-do"]) {
      assert.match(nav, new RegExp(`label="${label}"`), `${label} is one of them`);
    }
    assert.doesNotMatch(app, /rail-days/, "the day list is a screen now, not a rail section");
  });

  it("moves that rail to the top of a narrow pane, as one row of three", () => {
    assert.match(narrow, /\.rail \{[^}]*position: sticky; top: 0/, "a bar that stays put while the report scrolls");
    assert.match(narrow, /\.rail nav \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/, "three equal segments in one row");
    assert.match(narrow, /\.rail nav a \{ justify-content: center/, "the same control, laid out across the top");
    assert.match(narrow, /\.rail \.brand, \.rail > \.dim, \.rail \.dim \{ display: none/, "the wordmark and the caption go");
    assert.match(narrow, /\.main \{ grid-column: 1; grid-row: 2/, "the view follows the bar, with nothing between them");
    assert.doesNotMatch(css, /\.topbar/, "there is no action bar above the view");
  });

  it("draws the three tabs as one segmented control — Orca's Explorer switch", () => {
    assert.match(css, /\.rail nav \{ display: grid; gap: 2px; padding: 2px; border-radius: var\(--radius-md\)/, "one track, with 2px of air in and between");
    assert.match(css, /\.rail nav \{[^}]*background: color-mix\(in srgb, var\(--input\) 40%, transparent\)/, "the track is `--input` at 40%, the way Orca's is `bg-input/40`");
    assert.match(css, /\.rail nav a \{ display: flex; align-items: center; min-height: 28px[^}]*font-size: 11px; font-weight: 400/, "28px segments, 11px labels, regular weight");
    assert.match(css, /\.rail nav a\.active \{ background: var\(--background\); color: var\(--foreground\); font-weight: 500/, "the chosen segment is the raised one, not a coloured one");
    assert.doesNotMatch(css, /\.rail nav a\.active::after/, "nothing underlines it");
    assert.doesNotMatch(css, /\.rail nav a[^{]*\{[^}]*text-transform: uppercase/, "and nothing shouts it: sentence case");
  });

  it("sizes a phone's controls for a thumb, and its inputs against the zoom", () => {
    assert.match(narrow, /button, \.button \{ min-height: 44px/, "44px controls");
    assert.match(narrow, /input\[type="search"\], input\[type="text"\] \{ min-height: 44px; font-size: 16px/, "16px stops iOS zooming on focus");
  });

  it("keeps the wide pane a rail down the side, with the same control in it", () => {
    const wide = css.slice(0, css.indexOf("@media (max-width: 860px)"));
    assert.match(wide, /\.app \{ display: grid; grid-template-columns: 15rem minmax\(0, 1fr\)/, "the two-column shell");
    assert.match(wide, /\.rail \{[^}]*position: sticky; top: 0; height: 100vh/, "a sticky full-height rail");
    assert.match(wide, /\.rail nav \{ display: grid; gap: 2px; padding: 2px/, "the same track, standing up");
  });
});

describe("one card is the whole component language, over Tailwind and this app's tokens", async () => {
  const src = path.join(ROOT, "tools", "report-app", "src");
  const css = fs.readFileSync(path.join(src, "styles.css"), "utf8");
  const theme = fs.readFileSync(path.join(src, "tailwind.css"), "utf8");
  const card = fs.readFileSync(path.join(src, "components", "Card.tsx"), "utf8");

  it("wires Tailwind to the app's own values, so a utility and a rule cannot drift", () => {
    assert.match(theme, /@import "tailwindcss\/theme\.css" layer\(theme\);/, "Tailwind's theme is imported as a layer");
    assert.match(theme, /@import "tailwindcss\/utilities\.css" layer\(utilities\);/, "and its utilities");
    assert.match(theme, /@import "\.\/styles\.css" layer\(components\);/, "with the app's own stylesheet between them");
    assert.doesNotMatch(theme, /@import "tailwindcss";\s*$/m, "preflight is not imported: it would reset a base this app was designed against");
    for (const token of ["--color-card: var(--card);", "--color-muted-foreground: var(--muted-foreground);", "--color-primary: var(--primary);", "--radius-lg: var(--radius);", "--text-chrome: var(--t-chrome);"]) {
      assert.ok(theme.includes(token), `the theme points at ${token}`);
    }
  });

  it("sizes a card by the pane, not by a column that cannot shrink", () => {
    assert.match(css, /\.cards \{ display: grid; gap: \.6rem; grid-template-columns: repeat\(auto-fill, minmax\(min\(22rem, 100%\), 1fr\)\)/, "a track never wider than the pane it is in");
    assert.match(card, /"grid content-start gap-1\.5 rounded-lg border border-border bg-card p-2\.5 text-foreground no-underline"/, "the panel is utilities on this app's tokens");
  });

  it("has no row, table or fixed-track list left to learn", () => {
    for (const dead of [/\.mrow/, /\.movement/, /\.tasks\b/, /\.task-lines/, /\.task-cards/, /\.day-panels/, /\.shapes/, /\.pill\b/, /\.twisty/]) {
      assert.doesNotMatch(css, dead, `${dead} is gone from the stylesheet: a component replaced it`);
    }
    const screens = ["Skills.tsx", "DayView.tsx", "SkillView.tsx", "TodosView.tsx", "TaskList.tsx"];
    for (const file of screens) {
      const source = fs.readFileSync(path.join(src, "components", file), "utf8");
      assert.doesNotMatch(source, /class="mrow|class="movement|class="task-cards|class="day-panels|class="pill/, `${file} draws cards, not rows`);
    }
  });

  it("uses the ready-made controls rather than hand-rolled ones", () => {
    const ui = fs.readdirSync(path.join(src, "ui")).sort();
    assert.deepEqual(ui, ["Badge.tsx", "Button.tsx", "Input.tsx", "ToggleGroup.tsx", "cn.ts"], "one file a control");
    assert.match(fs.readFileSync(path.join(src, "ui", "ToggleGroup.tsx"), "utf8"), /import \{ ToggleGroup as Kobalte \} from "@kobalte\/core\/toggle-group";/, "the filter is Kobalte's segmented control");
    assert.match(fs.readFileSync(path.join(src, "ui", "Button.tsx"), "utf8"), /max-\[860px\]:min-h-11/, "a button grows to a thumb's height in a phone-sized pane");
    // Every control that used to be hand-rolled now comes from `ui/`.
    for (const [file, imports] of [
      ["TaskList.tsx", [/from "\.\.\/ui\/Button"/, /from "\.\.\/ui\/Badge"/]],
      ["DayView.tsx", [/from "\.\.\/ui\/Button"/, /from "\.\.\/ui\/Badge"/]],
      ["Skills.tsx", [/from "\.\.\/ui\/Input"/, /from "\.\.\/ui\/ToggleGroup"/, /from "\.\.\/ui\/Badge"/]],
      ["TodosView.tsx", [/from "\.\.\/ui\/Button"/]],
    ]) {
      const source = fs.readFileSync(path.join(src, "components", file), "utf8");
      for (const pattern of imports) assert.match(source, pattern, `${file} takes its controls from ui/`);
      assert.doesNotMatch(source, /<button/, `${file} writes no button of its own`);
    }
  });

  it("marks the card a reader is on, and makes it the target for pointer and keyboard alike", () => {
    assert.match(card, /component=\{props\.as \?\? "article"\}/, "a card is an article, or the link it is on /skills");
    assert.match(card, /tabindex=\{interactive\(\) \? 0 : props\.tabindex\}/, "a card that reports a hold is reachable by keyboard");
    assert.match(card, /onFocusIn=\{props\.onHold\}/);
    assert.match(card, /props\.held === true && "border-\[color-mix\(in_srgb,var\(--primary\)_55%,var\(--border\)\)\]"/, "the mark is the border, and it is a utility like everything else");
  });

  it("paints every line at the width the card gives it", () => {
    const charts = fs.readFileSync(path.join(src, "components", "charts.tsx"), "utf8");
    const skills = fs.readFileSync(path.join(src, "components", "Skills.tsx"), "utf8");
    assert.match(skills, /<Sparkline points=\{props\.row\.series\} \/>/, "a skill's line is the Sparkline, painted at the width it is given");
    assert.doesNotMatch(charts, /<svg class="chart-plot"/, "and no fixed-size renderer is left: 190x26 was 190px of a 688px column");
    assert.match(css, /\.chart > canvas \{ display: block; width: 100%; height: var\(--chart-plot/, "the canvas fills its card");
  });

  it("leaves the space between controls to the layout, never to a margin", () => {
    // The complaints this answers: a `+ to-do` against the label beside it, and three filter buttons flush
    // against each other and against the list under them.
    assert.match(card, /flex flex-wrap items-center gap-x-2 gap-y-1/, "a head keeps its own gap and wraps");
    assert.match(card, /ml-auto inline-flex flex-wrap items-center justify-end gap-1\.5/, "the actions share one gap behind a slot");
    const button = fs.readFileSync(path.join(src, "ui", "Button.tsx"), "utf8");
    assert.doesNotMatch(button, /className=\{?[^}]*\bm[trblxy]?-/, "a button carries no margin of its own");
    assert.match(css, /\.cards \{[^}]*margin-top: \.6rem/, "and a list stands off whatever it follows");
  });

  it("keeps the filter inside the pane it filters, with its switch under it", () => {
    assert.match(fs.readFileSync(path.join(src, "ui", "Input.tsx"), "utf8"), /"h-7 w-full min-w-0 max-w-96/, "a field fills its place instead of being 236px wide by default");
    const skills = fs.readFileSync(path.join(src, "components", "Skills.tsx"), "utf8");
    assert.match(skills, /<div class="mt-3 flex flex-col items-start gap-2">/, "the field takes the line, the switch the next");
    assert.match(skills, /<ToggleGroup/, "and the three filters are one control");
  });
});

describe("no screen is wider than the pane it is in", async () => {
  const css = fs.readFileSync(path.join(ROOT, "tools", "report-app", "src", "styles.css"), "utf8");

  it("lets a heading's control wrap under it instead of pushing the page", () => {
    // The shape picker is 146px and a heading beside it will not give way: the page was 64px wider than a
    // 200px pane on the day screen and on the to-do list.
    assert.match(css, /\.section-head \{[^}]*flex-wrap: wrap/, "the picker takes the next line when there is no room beside the heading");
  });

  it("keeps a month inside a pane narrower than a month", () => {
    assert.match(css, /\.calendars \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(200px, 100%\), 1fr\)\)/, "200px is the month's preference, not a floor");
    assert.match(css, /\.cal-grid \{ display: grid; grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/, "and its 7 columns shrink, where 7 `1fr` have a min-content floor of their own");
    assert.match(css, /\.cal \{[^}]*min-width: 0/, "the card does not refuse to be narrower than its contents");
  });

  it("sizes no table by a column that cannot shrink", () => {
    // A header that cannot wrap is what sets a table's width: "A session it was loaded in" is 163px on its own.
    assert.match(css, /@container \(max-width: 34rem\) \{\s*\.table-wrap th \{ white-space: normal; \}/, "heads wrap under 34rem");
    // And a cell breaks a long token rather than pushing its table wider — a session id is one word.
    assert.match(css, /^th, td \{[^}]*overflow-wrap: anywhere/m, "cells wrap anywhere, not only at spaces");
    assert.match(css, /\.table-wrap \{ overflow-x: auto; max-width: 100%; container-type: inline-size; \}/, "the wrapper is the container its table asks about");
  });

  it("stacks a record row when its columns cannot fit, and labels every cell", () => {
    const src = path.join(ROOT, "tools", "report-app", "src", "components");
    assert.match(css, /@container \(max-width: 27\.5rem\) \{\s*\.table-wrap\.records thead \{ display: none; \}/, "under 440px the head goes and the cells carry their labels");
    assert.match(css, /\.table-wrap\.records td::before \{ content: attr\(data-label\)/, "the label comes from the cell itself");
    // A skill's days are panels now, so the record tables left are the day's sessions, a session's checks,
    // and a skill's per-model split.
    for (const [file, labels] of [
      ["DayView.tsx", ["Session", "Host", "Tools", "Failures", "Corrected", "Loaded", "High"]],
      ["SessionView.tsx", ["Skill", "Script", "Calls", "Pass", "Refused", "Fail"]],
      ["SkillView.tsx", ["Model", "Sessions", "Shortfall", "What"]],
    ]) {
      const source = fs.readFileSync(path.join(src, file), "utf8");
      assert.match(source, /class="table-wrap records"/, `${file} marks its table as a record`);
      for (const label of labels) {
        assert.match(source, new RegExp(`data-label="${label}"`), `${file} labels its ${label} cell`);
      }
    }
  });
});

describe("a skill's screen describes one day at a time", async () => {
  const src = path.join(ROOT, "tools", "report-app", "src");
  const css = fs.readFileSync(path.join(src, "styles.css"), "utf8");
  const view = fs.readFileSync(path.join(src, "components", "SkillView.tsx"), "utf8");
  const charts = fs.readFileSync(path.join(src, "components", "charts.tsx"), "utf8");

  it("leaves the header to the skill's name, and puts the day's caveat beside the day's number", () => {
    assert.match(view, /<header>\s*<h1 class="mono">\{loaded\(\)!\.name\}<\/h1>\s*<\/header>/, "no prose above the panel");
    assert.doesNotMatch(view, /class="facts"/, "the facts line is gone from the top");
    assert.doesNotMatch(view, /floorNote/, "and so is the paragraph that explained the floor, which the day note now says");
    assert.match(view, /below the sample floor: a mean of a handful of calls, not a score/, "where the number is");
    assert.match(view, /function dayScore\(day: MeasuredDay\): string \{/, "the number is one helper, so nothing narrows across a call");
    assert.match(view, /return day\.raw === null \? "—" : `\$\{day\.raw\.toFixed\(1\)\}\*`/, "a day under the floor shows its mean with the marker, not a dash");
  });

  it("rolls a day over into the gauge and the radar instead of a popup", () => {
    assert.doesNotMatch(charts, /chart-tip|ChartTip/, "the popup is gone from the chart");
    assert.match(charts, /onMouseEnter=\{\(\) => hold\(dots\(\)\[index\(\)\]\?\.date \?\? null\)\}/, "a column reports the day it is");
    assert.match(charts, /onHold\?\.\(date\)/, "and the page that owns the day hears about it");
    assert.match(view, /held=\{heldDay\(\)\}/, "the skill's chart is driven by the screen");
    assert.match(view, /onHold=\{setHeldDay\}/);
    assert.match(view, /const day = \(\) => shownDay\(loaded\(\)!, heldDay\(\)\)/, "one selected day feeds the gauge, the radar, the note and the marked panel");
    assert.match(view, /function dayNote\(day: MeasuredDay, held: boolean\): string/, "the note under it is the other, and says which day it is describing");
  });

  it("draws every day as a card of the same kind the rest of the app uses", () => {
    assert.match(view, /<div class="cards">\s*<For each=\{\[...loaded\(\)!\.perDay\]\.reverse\(\)\}>/, "a grid of cards, newest first");
    assert.match(view, /held=\{heldDay\(\) === day\.date\}/, "each card knows whether it is the day on top");
    assert.match(view, /onHold=\{\(\) => setHeldDay\(day\.date\)\}/, "hovering one selects it, as a chart column does");
    assert.match(view, /onRelease=\{\(\) => setHeldDay\(null\)\}/, "and leaving it lets go");
    assert.equal(view.match(/table-wrap records/g)?.length ?? 0, 1, "the day table is gone; the one record table left is the per-model split");
    assert.match(view, /<h2 class="section-head">Every day —/, "with the count in the heading, where the picker used to be");
  });

  it("bands each day on the server, not in the screen", () => {
    const server = fs.readFileSync(path.join(ROOT, "scripts", "report-server.mjs"), "utf8");
    assert.match(server, /band: band\(skill\?\.score \?\? null\)/, "the per-day band travels with the per-day score");
    assert.match(view, /day\(\)\.band\.key/, "and the screen only reads it");
  });
});

describe("one list of tasks, one card", async () => {
  const src = path.join(ROOT, "tools", "report-app", "src");
  const components = path.join(src, "components");
  const list = fs.readFileSync(path.join(components, "TaskList.tsx"), "utf8");
  const tasks = fs.readFileSync(path.join(src, "tasks.ts"), "utf8");

  it("has no shape to choose, and nothing left to choose it with", () => {
    assert.match(list, /<div class="cards">/, "the list is a grid of cards");
    assert.doesNotMatch(list, /taskShape|ShapePicker|props\.shape/, "with no second or third way to draw it");
    assert.doesNotMatch(tasks, /SHAPES|taskShape|setTaskShape|type Shape/, "and nothing in the tasks module offers one");
    for (const file of ["DayView.tsx", "SkillView.tsx", "TodosView.tsx"]) {
      const source = fs.readFileSync(path.join(components, file), "utf8");
      assert.doesNotMatch(source, /ShapePicker|shape=/, `${file} asks for no shape`);
    }
    assert.doesNotMatch(fs.readFileSync(path.join(src, "router.ts"), "utf8"), /withShape|shape=/, "and no link carries one");
  });

  it("opens one card at a time for the whole task, as the rows did", () => {
    assert.match(list, /aria-expanded=\{open\(\) === task\.id\}/, "the head's control says whether it is open");
    assert.match(list, /onClick=\{\(\) => setOpen\(open\(\) === task\.id \? null : task\.id\)\}/, "one open card at a time");
    assert.match(list, /<TaskDetail task=\{task\} \/>/, "and the detail behind it is the same block of fields");
    assert.match(list, /border-t border-\[color-mix\(in_srgb,var\(--border\)_70%,transparent\)\]/, "drawn inside the card, under a hairline");
  });

  it("keeps the action, the skill and the day a screen threads in", () => {
    const day = fs.readFileSync(path.join(components, "DayView.tsx"), "utf8");
    const skill = fs.readFileSync(path.join(components, "SkillView.tsx"), "utf8");
    assert.match(day, /<TaskList[\s\S]*?action=\{\(task\) => <TodoButton task=\{task\} \/>\}/, "a day's proposals keep their `+ to-do`");
    assert.match(skill, /<TaskList[\s\S]*?empty="No proposal targets this skill\."/, "a skill's proposals too");
    assert.match(skill, /<a class="mono text-chrome" \{\.\.\.linkProps\(\{ name: "day", date: task\.from! \}\)\}/, "with the day each was proposed on");
  });
});

describe("the to-do list can be handed over as a brief", async () => {
  const brief = await import(path.join(ROOT, "tools", "report-app", "src", "brief.mjs"));
  const components = path.join(ROOT, "tools", "report-app", "src", "components");
  const items = [
    {
      id: "P3",
      day: "2026-09-17",
      skill: "x-review",
      change: "document the two output shapes",
      reason: "one agent guessed the key names",
      expected: "`node --test test/x-review-analyzer.test.cjs` exits 0",
      target: "skills/x-review/SKILL.md:36",
      route: "`x-fix`, then `x-skill-lint`",
      signal: "S36 in 109444fc8722edf6 (high, kept)",
      note: null,
    },
    {
      id: "P1",
      day: null,
      skill: "x-anal",
      change: "resolve the report path against the run dir",
      reason: null,
      expected: "`node --test test/x-anal-scenario.test.cjs` exits 0",
      target: "skills/x-anal/scripts/scenario.mjs:154",
      route: null,
      signal: "S21 (high, kept)",
      note: "the reader's own words",
    },
  ];
  const text = brief.improvementBrief(items, { generatedAt: "2026-09-18 09:55", savedAt: "2026-09-18 09:41" });

  it("names every source of evidence, with the path for each", () => {
    for (const source of [
      ".x-skills/daily/history.jsonl",
      ".x-skills/daily/<date>/summary.json",
      ".x-skills/daily/<date>/DIGEST.md",
      ".x-skills/daily/todos.json",
      ".x-skills/runs/",
      "/api/day/<date>",
      "/api/skill/<name>",
      "automation/daily-reflection/collect-sessions.mjs",
      "skills/x-autoreflection/scripts/metrics.mjs",
    ]) {
      assert.ok(text.includes(source), `the brief names ${source}`);
    }
    assert.match(text, /Generated 2026-09-18 09:55/, "and when it was taken");
    assert.match(text, /last written 2026-09-18 09:41/, "and when the reader last changed the list");
  });

  it("carries the loop, and the skill that owns each step", () => {
    assert.match(text, /## The loop, once per task/);
    for (let step = 1; step <= 10; step++) assert.match(text, new RegExp(`^${step}\\. \\*\\*`, "m"), `step ${step} is written down`);
    for (const skill of ["x-anal", "x-investigate", "x-reproduce", "x-plan", "x-decompose", "x-fix", "x-implement", "x-review", "x-roast", "x-skill-lint", "x-rollback", "x-commit", "x-autoreflection"]) {
      assert.ok(text.includes(`\`${skill}\``), `${skill} is named`);
    }
    // The commands it tells the reader to run are the ones this repository has.
    for (const command of ["npm test", "npm run check:run-folders", "node skills/x-skill-lint/scripts/lint.mjs", "npm run report"]) {
      assert.ok(text.includes(command), `${command} is offered`);
    }
  });

  it("gives each task its change, its evidence, its file and its check", () => {
    assert.match(text, /^# Improving the skills: 2 tasks from the daily record$/m);
    assert.match(text, /^### 1\. x-review \(P3, proposed 2026-09-17\)$/m);
    assert.ok(text.includes("skills/x-review/SKILL.md:36"), "where it lives");
    assert.ok(text.includes("`node --test test/x-review-analyzer.test.cjs` exits 0"), "the check that proves it");
    assert.ok(text.includes("`x-fix`, then `x-skill-lint`"), "how the repository would do it");
    assert.ok(text.includes("S36 in 109444fc8722edf6 (high, kept)"), "the signal it rests on");
    assert.ok(text.includes(".x-skills/daily/2026-09-17/summary.json"), "the pack behind it");
  });

  it("says where to look when an item predates the days it records", () => {
    assert.match(text, /^### 2\. x-anal \(P1\)$/m, "no day in the heading, because the item carries none");
    assert.match(text, /this item carries no day/);
    assert.match(text, /grep -l 109444fc8722edf6|The signal names no session/, "the session is named when the signal names one");
    assert.match(text, /The signal names no session, so ask the reader/, "and the reader is asked when it does not");
    assert.ok(text.includes("the reader's own words"), "a note is carried through");
    assert.match(text, /no day is recorded|carries no day/);
  });

  it("ends with the rules of the loop, not with the tasks", () => {
    assert.match(text, /## What not to do/);
    assert.match(text, /Do not widen a test to make it pass/);
    assert.match(text, /## When the work lands/);
    assert.ok(text.endsWith("\n"), "and it is a file: one trailing newline");
    assert.doesNotMatch(text, /\n\n\n/, "with no paragraph of blank lines in it");
  });

  it("is what the screen's button copies", () => {
    const view = fs.readFileSync(path.join(components, "TodosView.tsx"), "utf8");
    assert.match(view, /improvementBrief\(current\(\), \{/, "the button hands over the brief, not a list of lines");
    assert.match(view, /copy the brief/);
    assert.doesNotMatch(view, /todoLine/, "the one-line-per-task export is gone");
  });
});

describe("a page that is older than the app reloads itself", async () => {
  const build = await import(path.join(ROOT, "tools", "report-app", "src", "build.mjs"));

  it("recognises a built bundle, and only a built bundle", () => {
    assert.equal(build.bundleName("http://127.0.0.1:8787/assets/index-Bh3wPIp8.js"), "index-Bh3wPIp8.js");
    assert.equal(build.bundleName("http://127.0.0.1:5173/src/main.tsx"), null, "a dev module is not a build");
    assert.equal(build.bundleName("file:///tmp/report.html"), null, "nor is a plain page");
    assert.equal(build.bundleName("not a url"), null, "nor is nonsense");
  });

  it("calls two names one app only when they match", () => {
    assert.equal(build.isStale("index-a.js", "index-b.js"), true, "another bundle is a page from before the last build");
    assert.equal(build.isStale("index-a.js", "index-a.js"), false);
    assert.equal(build.isStale(null, "index-a.js"), false, "nothing to compare is not a reason to reload");
    assert.equal(build.isStale("index-a.js", null), false, "nor is a server that cannot say");
  });

  it("reloads once when the server has moved on, and not for an answer it already had", async () => {
    const listeners = {};
    const reloaded = [];
    const realDocument = globalThis.document;
    const realWindow = globalThis.window;
    globalThis.document = {
      visibilityState: "visible",
      addEventListener: (type, fn) => (listeners[type] = fn),
      removeEventListener: () => {},
    };
    globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, location: { reload: () => reloaded.push(1) } };
    let asked = 0;
    const stop = build.watchBuild({
      own: "index-old.js",
      check: async () => (asked++, "index-new.js"),
      gapMs: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(reloaded.length, 1, "one reload for one stale page");
    const first = asked;
    listeners.visibilitychange();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(asked > first, "coming back to the page asks again");

    // An answer that matches is not a reason to reload, and a check that fails is not either.
    reloaded.length = 0;
    stop();
    const clean = build.watchBuild({ own: "index-new.js", check: async () => "index-new.js", gapMs: 0 });
    const broken = build.watchBuild({ own: "index-new.js", check: async () => { throw new Error("offline"); }, gapMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(reloaded.length, 0, "the app it is running is the app being served");
    clean();
    broken();
    globalThis.document = realDocument;
    globalThis.window = realWindow;
  });

  it("starts nothing where there is nothing to compare", () => {
    assert.equal(typeof build.watchBuild({ own: null, check: async () => "index-new.js" }), "function");
    const stop = build.watchBuild({ own: null, check: async () => "index-new.js" });
    assert.equal(typeof stop, "function", "a no-op still hands back the stopper, so a caller cannot tell the difference");
  });
});

describe("report:install, the app's dependencies without the parent's allow-scripts", async () => {
  const install = await import(path.join(ROOT, "scripts", "report-install.mjs"));

  it("installs in the app, so the install is the one the app's lockfile describes", () => {
    const calls = [];
    const spawnImpl = (...args) => (calls.push(args), { on: () => {} });
    install.installApp({ env: {}, spawnImpl });
    assert.equal(calls.length, 1, "one command");
    assert.equal(calls[0][0], "npm");
    assert.deepEqual(calls[0][1], ["install"], "and it is the install");
    assert.equal(calls[0][2].cwd, install.APP_DIR, "run in the app's own directory");
    assert.equal(calls[0][2].stdio, "inherit", "with npm's output where the reader can see it");
  });

  it("drops the setting npm refuses from the environment, and only that one", () => {
    const env = install.installEnv({
      PATH: "/bin",
      npm_config_registry: "https://example.com",
      npm_config_allow_scripts: "tree-sitter,tree-sitter-javascript",
      npm_config_allow_scripts_pending: "false",
    });
    assert.equal(env.npm_config_allow_scripts, undefined, "npm reads this as a command-line flag, which it rejects here");
    assert.equal(env.npm_config_registry, "https://example.com", "the rest of the reader's config still reaches npm");
    assert.equal(env.npm_config_allow_scripts_pending, "false", "its neighbour is a different setting, and is not what npm refuses");
    assert.equal(env.PATH, "/bin");
  });

  it("is what `npm run report:install` runs", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts["report:install"], "node scripts/report-install.mjs", "a bare nested `npm install` is the bug this replaces");
  });
});
