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

  const snapshot = {
    bakedAt: "2026-09-17T21:40:12.000Z",
    newest: "2026-09-17",
    data: { "/api/movement": { days: 2 }, "/api/day/2026-09-17": { date: "2026-09-17" } },
  };

  /** A daily root with one pack, which is all a bake needs to have something to bake. */
  function dailyRoot() {
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
      JSON.stringify({ pack: ".x-skills/daily/2026-09-17", generatedAt: "2026-09-17 05:00", hosts: [], counts: { scanned: 1 }, skills: { touched: [], idle: [] }, sessions: [session], signals: [signal], runFolders: [], artifacts: [], warnings: [], notes: [] })
    );
    fs.writeFileSync(
      path.join(dir, "history.jsonl"),
      `${JSON.stringify(line("2026-09-17", [scored("x-plan", 70, { trigger: 0.6 })], { sessions: 4 }))}\n`
    );
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

  it("answers a path the snapshot holds, query or not", () => {
    assert.deepEqual(baked.bakedAt(snapshot, "/api/movement"), { days: 2 });
    assert.deepEqual(baked.bakedAt(snapshot, "/api/movement?days=14"), { days: 2 }, "the query is a knob");
    assert.deepEqual(baked.bakedAt(snapshot, "/api/day/2026-09-17"), { date: "2026-09-17" });
  });

  it("says which day the snapshot holds when it holds no such path", () => {
    assert.equal(baked.bakedAt(snapshot, "/api/day/2026-09-16"), null);
    assert.match(baked.missingSentence(snapshot, "/api/day/2026-09-16"), /2026-09-17/);
    assert.match(baked.missingSentence(snapshot, "/api/day/2026-09-16"), /live report/);
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
