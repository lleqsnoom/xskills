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

describe("report:panel — the app running on a snapshot", async () => {
  const baked = await import(path.join(ROOT, "tools", "report-app", "src", "baked.mjs"));
  const baker = await import(path.join(ROOT, "scripts", "report-panel.mjs"));
  const SERVER_MODULE = await import(SERVER);

  const snapshot = {
    bakedAt: "2026-09-17T21:40:12.000Z",
    newest: "2026-09-17",
    days: ["2026-09-17"],
    data: { "/api/movement": { days: 2 }, "/api/day/2026-09-17": { date: "2026-09-17" } },
  };

  /** A daily root with a pack per date, which is all a bake needs to have something to bake. */
  function dailyRoot(dates = ["2026-09-17"]) {
    const dir = tmp();
    const lines = [];
    for (const date of dates) {
      const pack = path.join(dir, date);
      fs.mkdirSync(pack, { recursive: true });
      const session = {
        id: "s1",
        host: "crush",
        uuid: "s1",
        title: "One session",
        project: "/tmp/p",
        modified: `${date}T10:00:00Z`,
        stats: { messages: 4, userMessages: 1, assistantMessages: 3, toolCalls: 2, toolResults: 2, panels: 1, toolFailures: 0, expectedExits: 0, repeats: 0, corrections: 0, reprompts: 0, proseQuestions: 0 },
        skills: { loaded: ["x-plan"], used: ["x-plan"], unused: [] },
        checks: [],
        graphs: [],
        runFolders: [],
        artifacts: [],
      };
      const signal = { id: "S1", kind: "tool-failure", severity: "medium", summary: "bash failed", count: 1, suspects: ["x-plan"], session: "s1", sessionTitle: "One session", evidence: [] };
      fs.writeFileSync(
        path.join(pack, "summary.json"),
        JSON.stringify({ pack: `.x-skills/daily/${date}`, generatedAt: `${date} 05:00`, hosts: [], counts: { scanned: 1 }, skills: { touched: [], idle: [] }, sessions: [session], signals: [signal], runFolders: [], artifacts: [], warnings: [], notes: [] })
      );
      lines.push(`${JSON.stringify(line(date, [scored("x-plan", 70, { trigger: 0.6 })], { sessions: 4 }))}\n`);
    }
    fs.writeFileSync(path.join(dir, "history.jsonl"), lines.join(""));
    return dir;
  }

  /** A built panel: one HTML file that points at a script and a stylesheet, as Vite emits it. */
  function panelBundle() {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "assets", "app.js"), "console.log('the app');");
    fs.writeFileSync(path.join(dir, "assets", "app.css"), "body{color:#18181b}");
    fs.writeFileSync(
      path.join(dir, "index.html"),
      '<!doctype html>\n<html lang="en">\n<head>\n<link rel="stylesheet" href="/assets/app.css">\n</head>\n<body>\n<div id="root"></div>\n<script type="module" src="/assets/app.js"></script>\n</body>\n</html>\n'
    );
    return dir;
  }

  it("answers a path the snapshot holds, query or not", () => {    assert.deepEqual(baked.bakedAt(snapshot, "/api/movement"), { days: 2 });
    assert.deepEqual(baked.bakedAt(snapshot, "/api/movement?days=14"), { days: 2 }, "the query is a knob");
    assert.deepEqual(baked.bakedAt(snapshot, "/api/day/2026-09-17"), { date: "2026-09-17" });
  });

  it("says which days the snapshot holds when it holds no such path", () => {
    assert.equal(baked.bakedAt(snapshot, "/api/day/2026-09-16"), null);
    assert.match(baked.missingSentence(snapshot, "/api/day/2026-09-16"), /2026-09-17 only/);
    assert.match(baked.missingSentence(snapshot, "/api/day/2026-09-16"), /live report/);

    const window = { ...snapshot, days: ["2026-09-17", "2026-09-16"] };
    assert.match(baked.missingSentence(window, "/api/day/2026-09-15"), /2 days, up to 2026-09-17/);
    assert.match(baked.missingSentence({ data: {} }, "/api/movement"), /holds no day/);
  });

  it("knows whether it is running on a snapshot at all", () => {
    assert.equal(baked.isBaked(null), false);
    assert.equal(baked.isBaked(snapshot), true);
    assert.equal(baked.bakedAt(null, "/api/movement"), null, "no snapshot is not a crash");
    assert.equal(baked.bakedReport(), null, "in Node there is no window to carry one");
  });

  it("says a write is unavailable rather than leaving a button looking broken", () => {
    assert.match(baked.writeRefused(snapshot, "/api/todos"), /cannot write/);
    assert.match(baked.writeRefused(snapshot, "/api/todos"), /live report/);
  });

  it("keeps the href out of a snapshot, because the host swallows those clicks", () => {
    const served = baked.navProps({ baked: false, href: "/day/2026-09-17" });
    assert.deepEqual(served, { href: "/day/2026-09-17" });

    const panel = baked.navProps({ baked: true, href: "/day/2026-09-17" });
    assert.equal("href" in panel, false, "an <a href> is a click the host cancels before the app sees it");
    assert.deepEqual(panel, { role: "link", tabindex: 0 }, "so the anchor keeps a role and a tab stop instead");
  });

  it("keeps the pointer on a link that carries no href", () => {
    const css = fs.readFileSync(path.join(ROOT, "tools", "report-app", "src", "styles.css"), "utf8");
    assert.match(css, /a\[role="link"\]\s*\{[^}]*cursor:\s*pointer/, "an href-less anchor is still a link");
    assert.match(css, /\.chart-point[^{]*\{[^}]*cursor:\s*crosshair/, "which must not make the chart's hover columns a hand");
  });

  it("inlines the entry and the stylesheet, leaving no external reference", () => {
    const assets = { "/assets/app.js": "console.log('the app');", "/assets/app.css": "body{color:#18181b}" };
    const html = baker.inlineAssets(fs.readFileSync(path.join(panelBundle(), "index.html"), "utf8"), assets);

    assert.doesNotMatch(html, /<script[^>]+src=/);
    assert.doesNotMatch(html, /<link[^>]+href=/);
    assert.match(html, /console\.log\('the app'\)/);
    assert.match(html, /body\{color:#18181b\}/);
  });

  it("splices the snapshot in before the document ends", () => {
    const html = baker.withSnapshot("<html><body><div id=\"root\"></div></body></html>", snapshot);
    assert.ok(html.indexOf("window.__REPORT__") < html.indexOf("</body>"));
    assert.match(html, /"\/api\/movement":\{"days":2\}/);
  });

  it("builds the payload table out of what the app asks for", () => {
    const table = baker.payloadTable({ root: dailyRoot() });

    assert.ok(table["/api/movement"], "the default screen");
    assert.ok(table["/api/days"], "the calendar");
    assert.ok(table["/api/todos"], "the selection");
    assert.ok(table["/api/day/2026-09-17"], "the newest day");
    assert.ok(table["/api/day/2026-09-17/session/s1"], "its sessions");
    assert.ok(table["/api/skill/x-plan"], "the skills its movement rows name");
  });

  it("bakes every day a reader can reach, not only the newest", () => {
    const table = baker.payloadTable({ root: dailyRoot(["2026-09-16", "2026-09-17"]) });

    assert.ok(table["/api/day/2026-09-16"], "a day the rail offers is a day that opens");
    assert.ok(table["/api/day/2026-09-16/session/s1"], "and its sessions open too");
    assert.ok(table["/api/day/2026-09-17"], "the newest day is still there");
    assert.deepEqual(baker.bakedDays(table), ["2026-09-17", "2026-09-16"], "newest first, read off the table");
  });

  it("stops at the byte budget, and keeps the newest day whatever it holds", () => {
    const root = dailyRoot(["2026-09-16", "2026-09-17"]);
    const kept = baker.payloadTable({ root, budget: 1 });

    assert.deepEqual(baker.bakedDays(kept), ["2026-09-17"], "the day the reader lands on is never the one dropped");
    assert.ok(kept["/api/day/2026-09-17/session/s1"], "and its drill-downs come with it");
    assert.equal(kept["/api/day/2026-09-16"], undefined, "a day past the budget is left out, and says so");
    assert.ok(kept["/api/movement"] && kept["/api/skill/x-plan"], "the record's own screens are not the budget's problem");
  });

  it("records the days it baked, so a snapshot can name them", () => {
    const out = path.join(tmp(), "panel.html");
    baker.bake({ root: dailyRoot(["2026-09-16", "2026-09-17"]), dist: panelBundle(), out });

    const written = fs.readFileSync(out, "utf8");
    assert.match(written, /"days":\["2026-09-17","2026-09-16"\]/);
  });

  it("writes one file with the app and the snapshot in it", () => {
    const out = path.join(tmp(), "nested", "panel.html");
    const written = baker.bake({ root: dailyRoot(), dist: panelBundle(), out });

    assert.equal(written, out);
    const html = fs.readFileSync(out, "utf8");
    assert.match(html, /window\.__REPORT__/);
    assert.match(html, /"\/api\/movement"/);
    assert.match(html, /console\.log\('the app'\)/, "the app, inlined");
    assert.doesNotMatch(html, /<script[^>]+src=/);
    assert.doesNotMatch(html, /<link[^>]+href=/);
  });

  it("refuses to bake without a built panel, and names the command", () => {
    assert.throws(() => baker.readPanelBundle(path.join(tmp(), "missing")), /report:panel/);
  });

  it("re-bakes on a refresh, and leaves the panel alone when there is no baker", async () => {
    const srv = await import(SERVER);
    const root = dailyRoot();
    const baked = [];

    const server = srv.createServer({
      root,
      appDist: path.join(root, "no-app"),
      rebake: async () => {
        baked.push(1);
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const refreshed = await fetch(`${base}/api/refresh`);
      assert.equal(refreshed.status, 200);
      assert.equal(baked.length, 1, "recording the day re-bakes what the panel shows");
    } finally {
      server.close();
    }

    const plain = srv.createServer({ root, appDist: path.join(root, "no-app") });
    await new Promise((resolve) => plain.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${plain.address().port}`;
      assert.equal((await fetch(`${base}/api/refresh`)).status, 200);
      assert.equal(baked.length, 1, "no baker is no bake");
    } finally {
      plain.close();
    }
  });

  /** Move a pack on disk the way the collector does: same shape, new content. */
  function touchPack(root) {
    const file = path.join(root, "2026-09-17", "summary.json");
    const pack = JSON.parse(fs.readFileSync(file, "utf8"));
    pack.generatedAt = `${pack.generatedAt} (again)`;
    fs.writeFileSync(file, JSON.stringify(pack));
  }

  it("fingerprints the newest pack, so a change under it is visible", () => {
    const root = dailyRoot();
    const first = baker.packFingerprint(root);
    assert.match(first, /^2026-09-17:/, "the newest pack and what it holds");

    touchPack(root);
    assert.notEqual(baker.packFingerprint(root), first, "a rewritten pack is a new fingerprint");
    assert.equal(baker.packFingerprint(path.join(root, "nowhere")), "none", "no packs is a fingerprint too");
  });

  it("bakes only when the record is newer than the panel", () => {
    const root = dailyRoot();
    const dist = panelBundle();
    const out = path.join(tmp(), "panel.html");

    assert.equal(baker.bakeIfStale({ root, dist, out }).baked, true, "nothing baked yet");
    assert.equal(baker.bakeIfStale({ root, dist, out }).baked, false, "the same record is not baked twice");
    assert.equal(baker.bakeIfStale({ root, dist, out, force: true }).baked, true, "unless it is forced");

    touchPack(root);
    assert.equal(baker.bakeIfStale({ root, dist, out }).baked, true, "a rewritten pack bakes again");
    assert.equal(fs.existsSync(`${out}.fingerprint`), true, "the marker keeps two callers from fighting");
  });

  it("re-bakes when the packs change, once per change", async () => {
    const srv = SERVER_MODULE;
    const root = dailyRoot();
    let tick = null;
    const baked = [];
    const follower = srv.followPacks({
      root,
      rebake: async () => {
        baked.push(baker.packFingerprint(root));
      },
      fingerprint: async (dir) => baker.packFingerprint(dir),
      timer: (fn) => {
        tick = fn;
        return 1;
      },
      clear: () => {},
    });

    await tick();
    assert.equal(baked.length, 0, "nothing has changed yet");

    touchPack(root);
    await tick();
    assert.equal(baked.length, 1, "a new pack re-bakes the panel the reader will open next");

    await tick();
    assert.equal(baked.length, 1, "an unchanged record is not a bake");

    follower.stop();
  });

  it("answers the refresh even when the bake fails", async () => {
    const srv = await import(SERVER);
    const root = dailyRoot();
    const server = srv.createServer({
      root,
      appDist: path.join(root, "no-app"),
      rebake: async () => {
        throw new Error("no built panel in dist-panel");
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const refreshed = await fetch(`${base}/api/refresh`);
      assert.equal(refreshed.status, 200, "the record is written either way");
      assert.equal((await refreshed.json()).ok, true);
    } finally {
      server.close();
    }
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

describe("report views — what a change to a skill did", async () => {
  const v = await import(path.join(ROOT, "scripts", "report-views.mjs"));

  it("reads the improvement class out of a title, and the file out of a target", () => {
    assert.equal(v.classOf("script-hardening: resolve the report path"), "script-hardening");
    assert.equal(v.classOf("doc-command-drift: document the JSON shape"), "doc-command-drift");
    assert.equal(v.classOf("`x-decompose` / `x-epic`: delete the pipeline file"), "manual", "an older wording is not a class");
    assert.equal(v.classOf(null), "manual");

    assert.equal(v.pathOf("`skills/x-plan/SKILL.md:9`"), "skills/x-plan/SKILL.md");
    assert.equal(
      v.pathOf("`skills/x-anal/scripts/scenario.mjs:154-155` and `skills/x-plan/scripts/scenario.mjs:67-68`"),
      "skills/x-anal/scripts/scenario.mjs",
      "the first file named is the one the finding is about"
    );
    assert.equal(v.pathOf("no path at all"), null);
    assert.equal(v.pathOf(null), null);
  });

  it("moves a day, and counts the days between two", () => {
    assert.equal(v.shiftDays("2026-09-15", 1), "2026-09-16");
    assert.equal(v.shiftDays("2026-09-15", -3), "2026-09-12");
    assert.equal(v.shiftDays("2026-03-01", -1), "2026-02-28");
    assert.equal(v.daysBetween("2026-09-15", "2026-09-17"), 2);
    assert.equal(v.daysBetween("2026-09-15", "2026-09-10"), -5);
  });

  it("keeps only the session ids the day's own pack knows", () => {
    const known = new Set(["109444fc8722edf6"]);
    assert.deepEqual(v.sessionsIn("S36 in `109444fc8722edf6` (high, kept)", known), ["109444fc8722edf6"]);
    assert.deepEqual(v.sessionsIn("S21 (high, kept)", known), [], "a signal id is not a session id");
    assert.deepEqual(v.sessionsIn(null), []);
  });

  it("measures a window from the days that were measured, and says how many", () => {
    const series = [
      { date: "2026-09-13", score: 60, raw: 60, n: 6 },
      { date: "2026-09-14", score: null, raw: 55, n: 2 },
      { date: "2026-09-15", score: 70, raw: 70, n: 6 },
      { date: "2026-09-16", score: null, raw: null, n: 0 },
    ];
    const window = v.windowMean(series, "2026-09-13", "2026-09-15");
    assert.equal(window.days, 3);
    assert.equal(window.mean, 61.7);
    assert.equal(window.calls, 14);
    assert.equal(window.thin, 1, "one of the three days was below the floor");
    assert.deepEqual(v.windowMean(series, "2026-09-17", "2026-09-18"), { mean: null, days: 0, calls: 0, thin: 0, dates: [] });
  });

  it("waits for the whole window before calling a fix held or flat", () => {
    const before = { mean: 60, days: 2 };
    const at = { landed: "2026-09-15", needDays: 2 };
    assert.equal(v.verdictFor({ ...at, before, after: { mean: 70, days: 1 } }), "measuring");
    assert.equal(v.verdictFor({ ...at, before, after: { mean: 70, days: 2 } }), "held");
    assert.equal(v.verdictFor({ ...at, before, after: { mean: 61, days: 2 } }), "flat", "a point of movement is noise");
    assert.equal(v.verdictFor({ ...at, before, after: { mean: 50, days: 2 } }), "regressed");
    assert.equal(v.verdictFor({ ...at, before: { mean: null, days: 0 }, after: { mean: 70, days: 2 } }), "unmeasured");
    assert.equal(v.verdictFor({ ...at, landed: null, before, after: null }), "no-commit");
  });

  it("builds a floor from a run of days, never from one lucky one", () => {
    const series = (values) =>
      values.map((value, index) => ({ date: `2026-09-${String(10 + index).padStart(2, "0")}`, score: value, raw: value, n: 6 }));
    const best = v.sustainedBest(series([70, 80, 90, 60]));
    assert.equal(best.value, 80, "the best three-day run is 70, 80, 90");
    assert.equal(best.basis, 3);
    assert.equal(v.sustainedBest(series([90, 60])).value, 75, "two days are a run when the record only has two");
    assert.equal(v.sustainedBest(series([90])), null, "one day is not a floor");
    assert.equal(
      v.sustainedBest([...series([80]), { date: "2026-09-11", score: null, raw: 95, n: 6 }, ...series([85])]),
      null,
      "a day below the floor breaks the run, so there is nothing to hold"
    );
    assert.equal(
      v.sustainedBest([{ date: "2026-09-10", score: 90, raw: 90, n: 2 }, { date: "2026-09-11", score: 91, raw: 91, n: 2 }]),
      null,
      "two calls cannot hold a floor"
    );
  });

  it("says how far below a floor a skill is, and refuses to let a thin day break it", () => {
    const rows = [
      { name: "x-a", band: { key: "fair" }, series: [{ date: "2026-09-16", score: 80, raw: 80, n: 6 }, { date: "2026-09-17", score: 70, raw: 70, n: 6 }] },
      {
        name: "x-b",
        band: { key: "fair" },
        series: [
          { date: "2026-09-15", score: 80, raw: 80, n: 6 },
          { date: "2026-09-16", score: 80, raw: 80, n: 6 },
          { date: "2026-09-17", score: null, raw: 40, n: 2 },
        ],
      },
      { name: "x-c", band: { key: "fair" }, series: [{ date: "2026-09-17", score: null, raw: 60, n: 1 }] },
    ];
    const ratchet = v.ratchetRows({ rows, window: 3 });
    const [a, b, c] = ratchet.skills;
    assert.equal(a.status, "below");
    assert.equal(a.belowBy, 5, "80 held, 70 today");
    assert.equal(b.floor.value, 80, "the run of two days is what it held");
    assert.equal(b.belowBy, null, "a day below the sample floor cannot break a floor");
    assert.equal(b.status, "held");
    assert.equal(c.status, "thin", "a skill with no floor to hold is last, under the rows a reader can act on");
    assert.equal(ratchet.below, 1, "and the one that is below is the one that is loud");
  });

  it("falls back to the whole window when the record is too short to hold a run", () => {
    const rows = [{ name: "x-a", band: { key: "fair" }, latest: "2026-09-17", series: [{ date: "2026-09-17", score: 70, raw: 70, n: 6 }] }];
    const auto = v.ratchetRows({ rows, windowScores: new Map([["x-a", { score: 78.3, n: 21, days: 14 }]]) });
    assert.equal(auto.skills[0].floor.value, 78.3);
    assert.equal(auto.skills[0].floor.source, "window");
    assert.equal(auto.skills[0].floor.basis, 14);
    assert.equal(auto.skills[0].belowBy, 8.3);

    const reader = v.ratchetRows({
      rows,
      floors: { "x-a": { floor: 85, since: "2026-09-10", reason: "held after the parser fix" } },
      windowScores: new Map([["x-a", { score: 78.3, n: 21, days: 14 }]]),
    });
    assert.equal(reader.skills[0].floor.value, 85, "a commitment beats an automatic floor");
    assert.equal(reader.skills[0].floor.source, "reader");
    assert.equal(reader.skills[0].floors, undefined);
    assert.equal(reader.skills[0].regressions, 1, "the one day after the commitment was measured below it");

    const none = v.ratchetRows({ rows: [{ ...rows[0], series: [{ date: "2026-09-17", score: null, raw: 70, n: 6 }] }] });
    assert.equal(none.skills[0].floor, null);
    assert.equal(none.skills[0].status, "thin");
  });

  it("turns a count of regressions into a decision", () => {
    assert.equal(v.budgetState(2, 2).key, "at");
    assert.equal(v.budgetState(3, 2).key, "over");
    assert.equal(v.budgetState(1, 2).key, "under");
  });

  it("picks the next fix by severity, how often it was seen, and how cheap its check is", () => {
    const ranked = v.rankCandidates([
      { id: "P1", severity: "medium", recurrence: 1, expected: "npm test" },
      { id: "P2", severity: "high", recurrence: 3, expected: "node lint.mjs" },
      { id: "P3", severity: "high", recurrence: 1, expected: null },
      { id: "P4", severity: "low", recurrence: 1, expected: "npm test" },
    ]);
    assert.deepEqual(ranked.map((c) => c.id), ["P2", "P1", "P3", "P4"], "a fix with no check costs three times as much to prove");
    assert.match(ranked[0].why, /^picked because it is high, seen on 3 days, its check is one command\.$/);
    assert.match(ranked[2].why, /states no check/);
  });

  const sighting = (date, over = {}) => ({
    date,
    id: "P1",
    klass: "doc-command-drift",
    path: "skills/x-plan/SKILL.md",
    target: "skills/x-plan/SKILL.md:9",
    skill: "x-plan",
    severity: "high",
    sessions: [],
    ...over,
  });

  it("marks a finding that came back after a fix", () => {
    const found = v.recurrenceFindings({
      sightings: [sighting("2026-09-15"), sighting("2026-09-17")],
      commits: () => ["2026-09-16T09:00:00Z", "2026-09-16T10:00:00Z"],
      today: "2026-09-17",
    });
    assert.equal(found.findings.length, 1);
    assert.equal(found.findings[0].status, "came-back");
    assert.deepEqual(found.findings[0].attempts, ["2026-09-16"], "two commits on one day is one fix attempt, on that day");
    assert.equal(found.findings[0].lastFix, "2026-09-16");
    assert.equal(found.findings[0].sinceFix, 1, "one sighting since the fix attempt");
    assert.equal(found.summary.cameBack, 1);
  });

  it("keeps a file's history when the class it is filed under is renamed", () => {
    const found = v.recurrenceFindings({
      sightings: [sighting("2026-09-16", { klass: "manual" }), sighting("2026-09-17", { klass: "doc-command-drift" })],
      commits: () => [],
      today: "2026-09-17",
    });
    assert.equal(found.findings.length, 1, "one file, one finding");
    assert.equal(found.findings[0].klass, "doc-command-drift", "the newest name is the one it is shown under");
    assert.deepEqual(found.findings[0].klasses, ["manual", "doc-command-drift"]);
    assert.equal(found.findings[0].relabelled, true);
    assert.equal(found.findings[0].status, "chronic");
  });

  it("closes a finding by evidence, and says how long the quiet has lasted", () => {
    const found = v.recurrenceFindings({ sightings: [sighting("2026-09-15")], commits: () => ["2026-09-16T10:00:00Z"], today: "2026-09-24" });
    assert.equal(found.findings[0].status, "closed");
    assert.equal(found.findings[0].quietDays, 8);
  });

  it("orders what to look at: what came back, then what is chronic", () => {
    const found = v.recurrenceFindings({
      sightings: [
        sighting("2026-09-16", { path: "skills/a/SKILL.md" }),
        sighting("2026-09-17", { path: "skills/a/SKILL.md" }),
        sighting("2026-09-15", { path: "skills/z/SKILL.md" }),
        sighting("2026-09-17", { path: "skills/z/SKILL.md" }),
      ],
      commits: (file) => (file === "skills/z/SKILL.md" ? ["2026-09-16T10:00:00Z"] : []),
      today: "2026-09-17",
    });
    assert.deepEqual(found.findings.map((f) => f.status), ["came-back", "chronic"]);
    assert.equal(found.summary.open, 2);
  });
});

describe("report views — over the record", async () => {
  const srv = await import(SERVER);

  /** Five days of one skill climbing, one pack, and one kept fix that landed on the 15th. */
  function viewRoot({ digestOn = "2026-09-15" } = {}) {
    const dir = tmp();
    const values = [
      ["2026-09-13", 60],
      ["2026-09-14", 65],
      ["2026-09-15", 70],
      ["2026-09-16", 75],
      ["2026-09-17", 80],
    ];
    fs.writeFileSync(
      path.join(dir, "history.jsonl"),
      values.map(([date, score]) => `${JSON.stringify(line(date, [scored("x-plan", score)], { sessions: 4 }))}\n`).join("")
    );
    writeDigest(dir, digestOn, "P1", "doc-command-drift", "skills/x-plan/SKILL.md:9", "do the thing");
    return dir;
  }

  function writeDigest(dir, date, id, klass, target, change) {
    const pack = path.join(dir, date);
    fs.mkdirSync(pack, { recursive: true });
    fs.writeFileSync(
      path.join(pack, "summary.json"),
      JSON.stringify({ pack: `.x-skills/daily/${date}`, counts: {}, skills: { touched: [], idle: [] }, sessions: [], signals: [], warnings: [], notes: [] })
    );
    fs.writeFileSync(
      path.join(pack, "DIGEST.md"),
      `# Daily\n\n## Proposals\n\n### ${id} — ${klass}: fix it\n**Signal:** S1 (high, kept)\n**Target:** \`${target}\`\n**Change:** ${change}\n**Check:** \`npm test\` exits 0\n`
    );
  }

  const commits = (files) => (file) => files[file] ?? [];

  const kept = (dir, over = {}) =>
    srv.writeTodos(
      [
        {
          id: "P1",
          day: "2026-09-15",
          skill: "x-plan",
          change: "do the thing",
          target: "skills/x-plan/SKILL.md:9",
          expected: "`npm test` exits 0",
          signal: "S1 (high, kept)",
          ...over,
        },
      ],
      dir
    );

  it("says a fix held, from the window either side of the day it landed", () => {
    const dir = viewRoot();
    kept(dir);
    const ledger = srv.apiLedger({ root: dir, maxDays: 30, window: 2, commits: commits({ "skills/x-plan/SKILL.md": ["2026-09-15T10:00:00Z"] }) });
    const item = ledger.items[0];
    assert.equal(ledger.items.length, 1);
    assert.equal(item.klass, "doc-command-drift", "the class comes from the proposal the item was kept from");
    assert.equal(item.path, "skills/x-plan/SKILL.md");
    assert.equal(item.landed, "2026-09-15");
    assert.equal(item.before.mean, 62.5, "the two days before it landed");
    assert.equal(item.after.mean, 77.5, "and the two after");
    assert.equal(item.verdict, "held");
    assert.deepEqual(ledger.summary, { shipped: 1, held: 1, flat: 0, regressed: 0, measuring: 0, notLanded: 0, cameBack: 0 });
  });

  it("waits for the measurement rather than calling it", () => {
    const dir = viewRoot();
    kept(dir);
    const git = commits({ "skills/x-plan/SKILL.md": ["2026-09-17T10:00:00Z"] });
    const ledger = srv.apiLedger({ root: dir, maxDays: 30, window: 2, commits: git });
    assert.equal(ledger.items[0].verdict, "measuring", "landed today, so no day has been measured after it");
    assert.equal(ledger.summary.measuring, 1);
  });

  it("will not credit a fix with a commit that predates it", () => {
    const dir = viewRoot();
    kept(dir, { day: "2026-09-16" });
    const ledger = srv.apiLedger({ root: dir, maxDays: 30, commits: commits({ "skills/x-plan/SKILL.md": ["2026-09-15T10:00:00Z"] }) });
    assert.equal(ledger.items[0].day, "2026-09-16");
    assert.equal(ledger.items[0].landed, null);
    assert.equal(ledger.items[0].verdict, "no-commit");
    assert.equal(ledger.items[0].lastCommit, "2026-09-15", "the commit that is there is context, not a landing");
    assert.equal(ledger.summary.notLanded, 1);
  });

  it("joins a finding that came back to the fix it came back from", () => {
    const dir = viewRoot();
    writeDigest(dir, "2026-09-17", "P1", "doc-command-drift", "skills/x-plan/SKILL.md:9", "do the thing");
    const git = commits({ "skills/x-plan/SKILL.md": ["2026-09-15T10:00:00Z", "2026-09-16T09:00:00Z"] });

    const found = srv.apiRecurrence({ root: dir, maxDays: 30, commits: git });
    assert.equal(found.findings.length, 1, "one file, proposed on two days");
    assert.equal(found.findings[0].days, 2);
    assert.equal(found.findings[0].lastFix, "2026-09-16");
    assert.equal(found.findings[0].status, "came-back");

    kept(dir);
    const ledger = srv.apiLedger({ root: dir, maxDays: 30, commits: git });
    assert.equal(ledger.items[0].cameBack, true, "the ledger says the fix did not hold");
    assert.equal(ledger.summary.cameBack, 1);
  });

  it("holds a floor in, and refuses to lower one in silence", () => {
    const dir = viewRoot();
    assert.equal(srv.holdFloor({ root: dir, skill: "x-nope" }).ok, false, "a skill with no movement has no floor to hold");

    const held = srv.holdFloor({ root: dir, skill: "x-plan", reason: "the three days after the lint rule" });
    assert.equal(held.ok, true);
    assert.equal(held.floor.floor, 75, "the best sustained run: 70, 75, 80");
    assert.equal(held.floor.basis, 3);

    const view = srv.apiRatchet({ root: dir });
    assert.equal(view.skills[0].floor.source, "reader");
    assert.equal(view.skills[0].belowBy, null, "80 is above the floor it committed to");
    assert.equal(view.skills[0].status, "held");

    const silent = srv.lowerFloor({ root: dir, skill: "x-plan", value: 60, reason: "  " });
    assert.equal(silent.ok, false);
    assert.match(silent.reason, /with a reason/);

    const lowered = srv.lowerFloor({ root: dir, skill: "x-plan", value: 60, reason: "the scoring weights changed" });
    assert.equal(lowered.ok, true);
    assert.equal(srv.readFloors(dir).skills["x-plan"].floor, 60);
    assert.equal(srv.readFloors(dir).skills["x-plan"].reason, "the scoring weights changed", "the move is on the record");
    assert.ok(fs.existsSync(path.join(dir, "ratchet.json")), "and it survives a restart, beside the packs");
  });

  it("reads a broken or absent floor file as no floors rather than throwing", () => {
    const dir = tmp();
    assert.deepEqual(srv.readFloors(dir), { updatedAt: null, skills: {} });
    fs.writeFileSync(path.join(dir, "ratchet.json"), "not json");
    assert.deepEqual(srv.readFloors(dir), { updatedAt: null, skills: {} });
    fs.writeFileSync(path.join(dir, "ratchet.json"), JSON.stringify({ skills: { "x-plan": { floor: "nope" } } }));
    assert.deepEqual(srv.readFloors(dir).skills, {}, "a floor that is not a number is not a floor");
  });

  it("puts the next fix on the bench and keeps the work in flight to one card", () => {
    const dir = viewRoot();
    writeDigest(dir, "2026-09-17", "P2", "panel-rule", "skills/x-fix/SKILL.md:20", "ask through a panel");
    kept(dir);

    const bench = srv.apiBench({ root: dir, maxDays: 14, commits: () => [] });
    assert.equal(bench.now.id, "P2", "the kept proposal is not offered again");
    assert.equal(bench.now.klass, "panel-rule");
    assert.equal(bench.now.severity, "high");
    assert.match(bench.now.why, /^picked because /);
    assert.equal(bench.candidates, 1);
    assert.equal(bench.doing.id, "P1", "the kept fix has no commit, so it is the work in flight");
    assert.equal(bench.queued.length, 0);
    assert.equal(bench.waiting.length, 0);

    const landed = srv.apiBench({ root: dir, maxDays: 14, window: 3, commits: commits({ "skills/x-plan/SKILL.md": ["2026-09-15T10:00:00Z"] }) });
    assert.equal(landed.doing, null, "nothing is in flight once it lands");
    assert.equal(landed.waiting.length, 1, "and it is waiting on the scan instead");
    assert.equal(landed.waiting[0].landed, "2026-09-15");
    assert.equal(landed.waiting[0].left, 1, "two of the three days measured");
  });

  it("answers the four views over http, and takes a floor only with a reason", async () => {
    const dir = viewRoot();
    const server = srv.createServer({ root: dir, appDist: path.join(dir, "no-app") });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body) =>
      fetch(`${base}/api/ratchet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      const ledger = await fetch(`${base}/api/ledger?days=30`);
      assert.equal(ledger.status, 200);
      assert.equal((await ledger.json()).windowDays, 2);
      assert.equal((await fetch(`${base}/api/bench`)).status, 200);
      assert.equal((await fetch(`${base}/api/recurrence`)).status, 200);
      const ratchet = await fetch(`${base}/api/ratchet?budget=0`);
      assert.equal(ratchet.status, 200);
      assert.equal((await ratchet.json()).budget, 0, "a budget of zero is a budget, not a missing one");

      const held = await post({ skill: "x-plan", action: "hold", reason: "after the lint rule" });
      assert.equal(held.status, 200);
      assert.equal((await held.json()).floor.basis, 3, "the best sustained run the record holds");

      const silent = await post({ skill: "x-plan", action: "lower", value: 60 });
      assert.equal(silent.status, 400);
      assert.match((await silent.json()).reason, /with a reason/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("report views — the five borrowed rules", async () => {
  const v = await import(path.join(ROOT, "scripts", "report-views.mjs"));

  it("fires Westgard's rules, and only on the shape each one describes", () => {
    const flat = [80, 80, 80, 80, 80, 80, 80, 80];
    assert.deepEqual(v.rulesFired(flat, 80, 5), [], "a flat run fires nothing");
    assert.deepEqual(v.rulesFired([...flat.slice(0, 7), 96], 80, 5), ["1_3s"], "3.2 sigma is a rejection");
    assert.deepEqual(v.rulesFired([...flat.slice(0, 7), 91], 80, 5), ["1_2s"], "2.2 sigma is a warning, not a rejection");
    assert.deepEqual(
      v.rulesFired([...flat.slice(0, 6), 91, 92], 80, 5),
      ["1_2s", "2_2s"],
      "two in a row past 2s: the warning fires first, and the run rule confirms it — which is the multirule procedure working"
    );
    assert.deepEqual(v.rulesFired([...flat.slice(0, 4), 86, 87, 88, 89], 80, 5), ["4_1s"], "four past 1s");
    assert.deepEqual(v.rulesFired([81, 82, 83, 84, 85, 86, 87], 80, 5), ["7T"], "seven climbing");
    assert.deepEqual(v.rulesFired([81, 81, 81, 81, 81, 81, 81, 81, 81, 81], 80, 5), ["10x"], "ten on one side");
    assert.deepEqual(v.rulesFired([80, 80], 80, 0), [], "no spread is no yardstick");
  });

  it("prices every rule in the false alarms it costs", () => {
    const at = (key) => v.CONTROL_RULES.find((rule) => rule.key === key).falseAlarm;
    assert.ok(Math.abs(at("1_3s") - 0.0027) < 0.0001, `1_3s is 2 x P(|Z| > 3), got ${at("1_3s")}`);
    assert.ok(at("1_2s") > 0.04 && at("1_2s") < 0.05, "2 sigma rings on about 4.6% of good days");
    assert.ok(at("2_2s") < at("1_2s") / 10, "which is why the run rules exist");
    assert.ok(at("7T") < 0.001);
    assert.equal(v.ruleOf("1_2s").kind, "warn");
    assert.equal(v.ruleOf("1_3s").kind, "reject");
  });

  it("measures the noise floor from the record, and ignores a day nobody used", () => {
    const rows = [
      { name: "x-a", series: [{ date: "2026-09-16", score: 60, raw: 60, n: 6 }, { date: "2026-09-17", score: 70, raw: 70, n: 6 }] },
      { name: "x-b", series: [{ date: "2026-09-16", score: 40, raw: 40, n: 6 }, { date: "2026-09-17", score: 60, raw: 60, n: 6 }] },
      { name: "x-prior", series: [{ date: "2026-09-16", score: null, raw: 59.8, n: 0 }, { date: "2026-09-17", score: null, raw: 59.4, n: 0 }] },
    ];
    const pooled = v.pooledDaySigma(rows);
    assert.equal(pooled.pairs, 2, "a day with no loaded session is a baseline, not a measurement");
    assert.equal(pooled.spread, 7.1, "the two deltas are 10 and 20");
    assert.equal(pooled.sigma, 5, "SEM: the spread of differences over sqrt(2)");
    assert.equal(pooled.mdc, 13.9, "1.96 x the spread is the change that is real");
    assert.equal(v.pooledDaySigma([{ name: "one", series: [{ date: "d", score: 1, raw: 1, n: 1 }] }]).sigma, null);
  });

  it("judges the last day against the days before it, not against itself", () => {
    const rows = [
      { name: "jump", series: [{ date: "d1", score: 60, raw: 60, n: 6 }, { date: "d2", score: 78, raw: 78, n: 6 }] },
      { name: "steady", series: [{ date: "d1", score: 70, raw: 70, n: 6 }, { date: "d2", score: 71, raw: 71, n: 6 }] },
    ];
    const chart = v.controlChart({ rows, sigma: 5 });
    const jump = chart.skills.find((skill) => skill.name === "jump");
    assert.equal(jump.center, 60, "the baseline is the day before, so the jump is judged against it");
    assert.equal(jump.baselineDays, 1);
    assert.equal(jump.judgedDays, 1);
    assert.equal(jump.z, 3.6);
    assert.deepEqual(jump.fired, ["1_3s"]);
    assert.equal(jump.source, "pooled", "two days cannot give a skill its own sigma");
    assert.equal(chart.skills[0].name, "jump", "the alarm sorts first");
    assert.equal(chart.skills.find((skill) => skill.name === "steady").alarming, false);
    assert.equal(chart.alarming, 1);
    assert.ok(chart.expectedAt3s < 0.1, "two skills of noise produce almost no 3s alarms");
  });

  it("gives a skill its own limits once its baseline is long enough", () => {
    const values = [70, 72, 68, 71, 69, 70, 72, 68, 71, 70, 69];
    const rows = [{ name: "x-a", series: values.map((score, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, score, raw: score, n: 6 })) }];
    const chart = v.controlChart({ rows, sigma: 5, minDays: 6 });
    assert.equal(chart.skills[0].source, "own");
    assert.equal(chart.skills[0].sigma, 1.4, "the skill's own spread, not the fleet's");
    assert.equal(chart.skills[0].baselineDays, 6, "the baseline holds at least minDays");
    assert.equal(chart.skills[0].judgedDays, 5, "and the days after it are the ones under judgement");
  });

  it("puts an interval on a score, from the denominators its axes were measured over", () => {
    const weights = { conformance: 0.3, adherence: 0.2, trigger: 0.2, rework: 0.15, protocol: 0.15 };
    const dimensions = { trigger: 0.5, rework: 0.9, protocol: 0.8 };
    const big = v.scoreInterval({ dimensions, denominators: { trigger: 100, rework: 10000, protocol: 100 }, weights });
    const small = v.scoreInterval({ dimensions, denominators: { trigger: 2, rework: 200, protocol: 2 }, weights });
    assert.ok(small.se > big.se * 5, `a rate over two sessions says far less than the same rate over a hundred (${small.se.toFixed(1)} vs ${big.se.toFixed(1)})`);
    assert.equal(big.used.length, 3, "an axis with no denominator is not part of the interval");
    assert.equal(v.scoreInterval({ dimensions: {}, denominators: {}, weights }).se, null, "no axes, no interval");
  });

  it("halves an interval at four times the sessions, and says how many that is", () => {
    const weights = { trigger: 1 };
    const rows = [{ name: "x-a", latestScore: 70 }];
    const once = v.intervalRows({ rows, latest: new Map([["x-a", { dimensions: { trigger: 0.5 }, denominators: { trigger: 10 }, score: 70, n: 10, named: 20 }]]), weights });
    const four = v.intervalRows({ rows, latest: new Map([["x-a", { dimensions: { trigger: 0.5 }, denominators: { trigger: 40 }, score: 70, n: 40, named: 80 }]]), weights });
    assert.equal(once.skills[0].se, 15.8);
    assert.ok(Math.abs(once.skills[0].se / 2 - four.skills[0].se) < 0.001, "SE = sigma/sqrt(n): four times the evidence, half the interval");
    assert.equal(once.skills[0].needsSessions, 40, "the sessions that would halve it");
    assert.equal(once.skills[0].conservative, 22.6, "the score the evidence alone supports");
    assert.equal(once.skills[0].low, 39, "and the range it sits in");
    const unknown = v.intervalRows({ rows, latest: new Map(), weights, fallbackSigma: 4 });
    assert.equal(unknown.skills[0].se, 4, "a day with no tally falls back to the record's own noise");
  });

  it("prices a reason code in points, and the codes add up to the gap", () => {
    const weights = { conformance: 0.3, trigger: 0.2, rework: 0.15 };
    const found = v.factorCodes({
      name: "x-a",
      dimensions: { conformance: 0.9, trigger: 0.5, rework: 0.5 },
      denominators: { conformance: 10, trigger: 10, rework: 100 },
      tally: { loaded: 5, named: 10, checks: { passes: 9, fails: 1 }, toolCalls: 100, repeats: 50, panels: 3, proseQuestions: 1 },
      weights,
    });
    assert.equal(found.score, 68.5);
    assert.equal(found.gap, 31.5);
    const sum = found.codes.reduce((total, code) => total + code.costs, 0);
    assert.ok(Math.abs(sum - found.gap) < 0.2, `the codes add up to the gap (${sum} vs ${found.gap})`);
    assert.equal(found.top.axis, "trigger");
    assert.match(found.top.evidence, /5 of 10 sessions loaded it; 5 named it and never did/);
    assert.equal(found.codes.find((code) => code.axis === "rework").evidence, "50 repeated calls out of 100");
    assert.equal(v.simulate({ dimensions: { trigger: 0.5 }, weights: { trigger: 1 }, axis: "trigger", target: 1 }), 100);
    assert.equal(v.simulate({ dimensions: { trigger: 0.5 }, weights: { trigger: 1 }, axis: "nope", target: 1 }), null);
  });

  it("cross-checks a reason code's score against the scorer it decomposes", async () => {
    const m = await import(path.join(ROOT, "skills", "x-autoreflection", "scripts", "metrics.mjs"));
    const dimensions = { conformance: 0.97, adherence: null, trigger: 0.583, rework: 0.98, protocol: 0.847 };
    const found = v.factorCodes({ name: "x-review", dimensions, denominators: {}, tally: {}, weights: m.WEIGHTS_V1 });
    assert.ok(Math.abs(found.score - m.compose(dimensions, m.WEIGHTS_V1).score) < 0.05, "one rule for the score, not two");
  });

  it("prices the fleet's rates by the evidence behind them", () => {
    const tallies = [{ loaded: 5, named: 10 }, { loaded: 9, named: 90 }];
    const pooled = v.pooledRates(tallies, {
      dimensionsOf: (tally) => ({ trigger: tally.loaded / tally.named }),
      denominatorsOf: (tally) => ({ trigger: tally.named }),
    });
    assert.equal(pooled.trigger, 0.14, "weighted by sessions, not by skills");
    assert.deepEqual(v.pooledRates([]), {});
  });

  it("reads the fixing process as a pipeline, and names where the work has stopped", () => {
    const flow = v.flowOf({
      dates: ["2026-09-16", "2026-09-17"],
      arrivals: { "2026-09-16": 6, "2026-09-17": 7 },
      kept: { "2026-09-16": 2, "2026-09-17": 3 },
      landed: { "2026-09-17": 2 },
      closed: {},
      open: [{ first: "2026-09-16", path: "a" }, { first: "2026-09-17", path: "b" }],
      today: "2026-09-17",
    });
    assert.deepEqual(flow.stages.map((stage) => [stage.key, stage.count]), [["proposed", 13], ["kept", 5], ["landed", 2], ["closed", 0]]);
    assert.deepEqual(flow.perDay.map((day) => day.cumulative.proposed), [6, 13], "the bands are cumulative");
    assert.equal(flow.arrivalsPerDay, 6.5);
    assert.equal(flow.waitAtArrivals, 0.3, "Little's law: two open, 6.5 arriving a day");
    assert.equal(flow.waitAtClosures, null, "no closures is no throughput to divide by");
    assert.equal(flow.constraint, "landed", "the deepest stage work has reached and not left");
    assert.deepEqual(flow.reached, ["proposed", "kept", "landed"]);
    assert.equal(flow.oldestDays, 1);
    assert.equal(v.flowOf({ dates: [], open: [] }).arrivalsPerDay, null);
  });

  it("widens a review interval, and resets it when a finding comes back", () => {
    assert.equal(v.intervalOf({ step: 0 }), 1);
    assert.equal(v.intervalOf({ step: 1 }), 6);
    assert.equal(v.intervalOf({ step: 2, ef: 2.5 }), 15);
    assert.equal(v.intervalOf({ step: 3, ef: 2.5 }), 38, "SM-2: 1, 6, then the easiness factor");
    const held = v.applyOutcome(null, "held", "2026-09-17T06:00:00Z");
    assert.equal(held.step, 1);
    assert.equal(held.ef, 2.5);
    assert.equal(held.reformulated, false);
    const lapsed = v.applyOutcome(held, "came-back", "2026-09-20T06:00:00Z");
    assert.equal(lapsed.step, 0, "a lapse goes back to a one-day interval");
    assert.equal(lapsed.lapses, 1);
    assert.equal(lapsed.ef, 2.3);
    const twice = v.applyOutcome(lapsed, "came-back", "2026-09-21T06:00:00Z");
    assert.equal(twice.reformulated, true, "a finding that keeps coming back needs rewriting, not re-fixing");
    const floored = v.applyOutcome({ step: 6, ef: 1.3, lapses: 9 }, "held", "x");
    assert.equal(floored.ef, 1.3, "the easiness factor has a floor");
    assert.equal(floored.step, 6, "and the step has a ceiling");
  });

  it("asks for what the scanner cannot see, and answers the rest itself", () => {
    const findings = [
      { path: "a.js", klass: "k", severity: "high", status: "came-back", first: "2026-09-16", last: "2026-09-17", days: 2, sessions: [] },
      { path: "b.md", klass: "k", severity: "medium", status: "new", first: "2026-09-16", last: "2026-09-17", days: 1, sessions: [] },
      { path: "c.js", klass: "k", severity: "low", status: "closed", first: "2026-09-10", last: "2026-09-12", days: 3, sessions: [] },
    ];
    const due = v.dueRows({ findings, reviews: {}, today: "2026-09-17" });
    assert.deepEqual(due.due.map((row) => row.path), ["a.js", "b.md"], "a closed finding is not re-checked");
    assert.equal(due.dueCount, 2);
    assert.equal(due.due[0].auto, "came-back", "the scan already answered this one");
    assert.equal(due.due[0].interval, 1, "a finding with no review is due a day after it was first seen");
    assert.equal(due.due[0].overdueBy, 0);
    assert.equal(due.autoAnswered, 1);

    const reviewed = v.dueRows({ findings, reviews: { "a.js": { step: 1, at: "2026-09-17T06:00:00Z", ef: 2.5, lapses: 0 } }, today: "2026-09-17" });
    const a = [...reviewed.due, ...reviewed.next].find((row) => row.path === "a.js");
    assert.equal(a.interval, 6, "a check that held widens the wait");
    assert.equal(a.overdueBy, -6, "so it is not due for six days");

    const hidden = v.dueRows({ findings, reviews: { "a.js": { reformulated: true } }, today: "2026-09-17" });
    assert.equal(hidden.due.some((row) => row.path === "a.js"), false, "a reformulated finding leaves the schedule");
    assert.equal(v.dueRows({ findings, reviews: {}, today: "2026-09-17", limit: 1 }).due.length, 1, "the list is capped");
  });
});

describe("report views — the five over the record", async () => {
  const srv = await import(SERVER);

  /**
   * Five days of one skill climbing, and one pack whose three sessions agree with the line.
   *
   * x-plan is loaded by all three sessions and passes two of three checks in each, so its axes have real
   * denominators; x-fix is named by all three and loaded by none, which is the shape the reason codes are for.
   */
  function fiveDayRoot({ digestOn = "2026-09-17" } = {}) {
    const dir = tmp();
    const values = [["2026-09-13", 60], ["2026-09-14", 65], ["2026-09-15", 70], ["2026-09-16", 75], ["2026-09-17", 80]];
    fs.writeFileSync(
      path.join(dir, "history.jsonl"),
      values.map(([date, score]) => `${JSON.stringify(line(date, [scored("x-plan", score)], { sessions: 3 }))}\n`).join("")
    );
    const pack = path.join(dir, digestOn);
    fs.mkdirSync(pack, { recursive: true });
    const session = (id) => ({
      id,
      host: "crush",
      uuid: id,
      title: id,
      project: "/tmp/p",
      modified: `${digestOn}T10:00:00Z`,
      stats: { messages: 6, userMessages: 2, assistantMessages: 4, toolCalls: 100, toolResults: 100, panels: 5, toolFailures: 0, expectedExits: 0, repeats: 10, corrections: 0, reprompts: 0, proseQuestions: 1 },
      skills: { loaded: ["x-plan"], used: ["x-plan", "x-fix"], unused: [] },
      checks: [{ skill: "x-plan", script: "s.mjs", calls: 3, passes: 2, refusals: 0, fails: 1 }],
      graphs: [{ skill: "x-plan", calls: 10, illegalMoves: 1, prematureTransitions: 0 }],
      runFolders: [],
      artifacts: [],
    });
    fs.writeFileSync(
      path.join(pack, "summary.json"),
      JSON.stringify({ pack: digestOn, counts: {}, skills: { touched: [], idle: [] }, sessions: [session("s1"), session("s2"), session("s3")], signals: [], warnings: [], notes: [], runFolders: [], artifacts: [] })
    );
    fs.writeFileSync(
      path.join(pack, "DIGEST.md"),
      "# Daily\n\n## Proposals\n\n### P1 — doc-command-drift: fix it\n**Signal:** S1 (high, kept)\n**Target:** `skills/x-plan/SKILL.md:9`\n**Change:** do the thing\n**Check:** `npm test` exits 0\n"
    );
    return dir;
  }

  it("judges the newest day against the record's own noise, not an invented threshold", () => {
    const dir = fiveDayRoot();
    const chart = srv.apiControl({ root: dir, sigma: 4 });
    const plan = chart.skills.find((skill) => skill.name === "x-plan");
    assert.equal(plan.center, 67.5, "the baseline is the four days before the one under judgement");
    assert.equal(plan.latest, 80);
    assert.equal(plan.z, 3.1);
    assert.deepEqual(plan.fired, ["1_3s"]);
    assert.equal(plan.source, "pooled");
    assert.equal(chart.sigma, 4);
    assert.equal(chart.alarming, 1);
    assert.equal(chart.rules.length, 6, "the rule table travels with the chart");
    assert.ok(chart.expectedAt3s < 0.05, "and so does what it costs in false alarms");
  });

  it("puts an interval on a score from the pack's own counters", () => {
    const dir = fiveDayRoot();
    const view = srv.apiInterval({ root: dir });
    const plan = view.skills.find((skill) => skill.name === "x-plan");
    assert.equal(plan.score, 84, "the score the day's counters produce");
    assert.equal(plan.n, 3, "and the sessions behind it");
    assert.ok(Math.abs(plan.se - 5) < 0.1, `the interval the axes earn: ${plan.se}`);
    assert.equal(plan.needsSessions, 12, "four times the evidence to halve it");
    assert.equal(view.tallied, 2, "the pack's tallies are what the interval reads");
    assert.equal(view.fallbackSigma, 0, "a record that climbs in equal steps has no spread: zero, which the chart reads as no yardstick");
  });

  it("prices the reason codes in points, with the counters behind each one", () => {
    const dir = fiveDayRoot();
    const view = srv.apiFactors({ root: dir });
    const fix = view.skills.find((skill) => skill.name === "x-fix");
    assert.equal(fix.score, 52);
    assert.equal(fix.gap, 48);
    assert.equal(fix.top.axis, "trigger");
    assert.equal(fix.top.costs, 40, "the axis carries 20 of the weights and 40 of these points");
    assert.equal(fix.top.evidence, "0 of 3 sessions loaded it; 3 named it and never did");
    const plan = view.skills.find((skill) => skill.name === "x-plan");
    assert.equal(plan.score, 84);
    assert.equal(plan.top.axis, "conformance");
    assert.equal(plan.top.evidence, "6 of 9 checks passed");
    assert.deepEqual(view.skills.map((skill) => skill.name), ["x-fix", "x-plan"], "the widest gap leads");
    assert.equal(view.pooled.trigger, 0.5, "three of six named sessions loaded, which is context and not a target");
  });

  it("reads the flow of the fixing, from proposals to closures", () => {
    const dir = fiveDayRoot();
    srv.writeTodos([{ id: "P1", day: "2026-09-15", skill: "x-plan", change: "do the thing", target: "skills/x-plan/SKILL.md:9" }], dir);
    const view = srv.apiFlow({ root: dir, commits: (file) => (file === "skills/x-plan/SKILL.md" ? ["2026-09-15T10:00:00Z"] : []) });
    assert.deepEqual(view.stages.map((stage) => stage.count), [1, 1, 1, 0], "one proposed, one kept, one landed, none closed");
    assert.equal(view.constraint, "landed", "work has reached landing and stopped");
    assert.equal(view.wip, 1);
    assert.equal(view.arrivalsPerDay, 0.2, "one proposal over five days");
    assert.equal(view.waitAtArrivals, 5, "Little's law: one open, a fifth of an arrival a day");
    assert.equal(view.waitAtClosures, null, "with nothing closed there is no throughput to divide by");
    assert.equal(view.kept, 1);
  });

  it("schedules a re-check, and records what the check found", () => {
    const dir = fiveDayRoot();
    const before = srv.apiSchedule({ root: dir, commits: () => [] });
    assert.equal(before.dueCount, 0, "a finding first seen today is due tomorrow");
    assert.equal(before.next[0].path, "skills/x-plan/SKILL.md");
    assert.equal(before.next[0].due, "2026-09-18");
    assert.equal(before.load, 0.8, "a fifth of an arrival a day, times the four checks a widening schedule asks");

    const held = srv.recordReview({ root: dir, path: "skills/x-plan/SKILL.md", outcome: "held", at: "2026-09-18T06:00:00Z" });
    assert.equal(held.ok, true);
    assert.equal(held.review.step, 1);
    const after = srv.apiSchedule({ root: dir });
    const row = [...after.due, ...after.next].find((entry) => entry.path === "skills/x-plan/SKILL.md");
    assert.equal(row.interval, 6, "a check that held widens the wait");
    assert.equal(row.due, "2026-09-24");

    const back = srv.recordReview({ root: dir, path: "skills/x-plan/SKILL.md", outcome: "came-back", at: "2026-09-25T06:00:00Z" });
    assert.equal(back.review.step, 0, "a finding that came back goes to a one-day interval");
    assert.equal(back.review.lapses, 1);
    assert.equal(srv.recordReview({ root: dir, path: "skills/x-plan/SKILL.md", outcome: "nonsense" }).ok, false);
    assert.match(srv.recordReview({ root: dir, outcome: "held" }).reason, /needs the path/);
    assert.ok(fs.existsSync(path.join(dir, "reviews.json")), "the reviews live beside the packs");
  });

  it("reads a broken or absent review file as no reviews rather than throwing", () => {
    const dir = tmp();
    assert.deepEqual(srv.readReviews(dir), { updatedAt: null, items: {} });
    fs.writeFileSync(path.join(dir, "reviews.json"), "not json");
    assert.deepEqual(srv.readReviews(dir), { updatedAt: null, items: {} });
    fs.writeFileSync(path.join(dir, "reviews.json"), JSON.stringify({ items: { "a.js": { step: 99, ef: 9, lapses: -1 } } }));
    const stored = srv.readReviews(dir).items["a.js"];
    assert.equal(stored.step, 6, "a step beyond the schedule is capped");
    assert.equal(stored.ef, 2.5, "an easiness factor above the ceiling is the ceiling");
    assert.equal(stored.lapses, 0);
  });

  it("answers the five views over http, and takes a review verdict", async () => {
    const dir = fiveDayRoot();
    const server = srv.createServer({ root: dir, appDist: path.join(dir, "no-app") });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body) =>
      fetch(`${base}/api/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      for (const route of ["control", "interval", "factors", "flow", "schedule"]) {
        const response = await fetch(`${base}/api/${route}`);
        assert.equal(response.status, 200, `${route} answers`);
        assert.match(response.headers.get("content-type") ?? "", /json/);
      }
      const written = await post({ path: "skills/x-plan/SKILL.md", outcome: "held" });
      assert.equal(written.status, 200);
      assert.equal((await written.json()).review.step, 1);
      assert.equal((await (await fetch(`${base}/api/reviews`)).json()).items["skills/x-plan/SKILL.md"].step, 1);

      const refused = await post({ path: "skills/x-plan/SKILL.md", outcome: "maybe" });
      assert.equal(refused.status, 400);
      assert.match((await refused.json()).reason, /unknown outcome/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
