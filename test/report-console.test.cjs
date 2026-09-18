"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CONSOLE = path.join(ROOT, "scripts", "report-console.mjs");

/** The movement payload `GET /api/movement` answers with, trimmed to what the console reads. */
const MOVEMENT = {
  days: 3,
  newest: "2026-09-17",
  movement: [
    {
      name: "x-implement",
      measured: 2,
      latest: "2026-09-17",
      latestScore: 78,
      change: 12.4,
      band: { key: "fair", label: "fair" },
      series: [
        { date: "2026-09-16", score: null, raw: 65.6, n: 1 },
        { date: "2026-09-17", score: 78, raw: 78, n: 3 },
      ],
    },
    {
      name: "x-ui",
      measured: 1,
      latest: "2026-09-16",
      latestScore: 62.5,
      change: null,
      band: { key: "unknown", label: "not measured" },
      series: [{ date: "2026-09-16", score: null, raw: 62.5, n: 1 }],
    },
  ],
  recent: [{ date: "2026-09-17", mean: 71.2, sessions: 12, skills: 9, scored: 3, measured: 5 }],
  calendar: [],
  todos: { updatedAt: null, items: [] },
};

/** The day payload `GET /api/day/<date>` answers with, trimmed the same way. */
const DAY = {
  pack: { date: "2026-09-17", counts: { sessions: 12 } },
  proposals: [
    { id: "P1", day: "2026-09-17", skill: "x-ui", change: "name the two ways in", inTodo: false },
    { id: "P2", day: "2026-09-17", skill: "x-plan", change: "ask before writing the spec at all", inTodo: true },
  ],
  scores: [],
  digest: null,
  history: null,
};

/** A console API that answers from fixtures and records every write. */
function fakeApi({ movement = MOVEMENT, day = DAY, todos = { updatedAt: null, items: [] }, fail } = {}) {
  const calls = [];
  const api = {
    origin: "http://127.0.0.1:8787",
    calls,
    async get(route) {
      calls.push({ method: "GET", route });
      if (fail && route.startsWith("/api/movement")) throw new Error(fail);
      if (route.startsWith("/api/movement")) return movement;
      if (route.startsWith("/api/day/")) return day;
      if (route === "/api/todos") return todos;
      throw new Error(`no route ${route}`);
    },
    async post(route, body) {
      calls.push({ method: "POST", route, body });
      todos = { updatedAt: "2026-09-17T10:00:00.000Z", items: body.items };
      day = {
        ...day,
        proposals: day.proposals.map((proposal) => ({
          ...proposal,
          inTodo: body.items.some((item) => item.id === proposal.id && (item.day ?? null) === (proposal.day ?? null)),
        })),
      };
      return todos;
    },
  };
  return api;
}

/** Keys as an async iterable, which is how the real console reads a raw-mode stdin. */
async function* keys(...list) {
  for (const key of list) yield key;
}

const frames = (out) => out.frames;

describe("report console — the picture of a day", async () => {
  const { renderConsole, summaryLine, fit, parseArgs } = await import(CONSOLE);

  it("names the newest day, the skills in order, the day's proposals and the keys", () => {
    const { lines, ids, count } = renderConsole({ movement: MOVEMENT, day: DAY, origin: "http://127.0.0.1:8787" });

    assert.match(lines[0], /x-skills report · 2026-09-17 · 3 days recorded/);
    assert.ok(lines[1].includes("x-implement"), "the skills follow");
    assert.ok(lines[1].includes("78"), "with their score");
    assert.equal(ids.length, 2);
    assert.equal(count, 2, "the count is the proposals the keys can act on");
    assert.ok(lines.some((line) => line.includes("· P1") && line.includes("x-ui")), "a proposal that is not kept");
    assert.ok(lines.some((line) => line.includes("• P2")), "and one that is");
    assert.match(lines.at(-1), /j\/k move · t keep · d drop · r refresh · q quit/);
    assert.match(lines.at(-1), /127\.0\.0\.1:8787/, "and where it is talking to");
  });

  it("prints a raw mean with a star where a day is below the sample floor", () => {
    const { lines } = renderConsole({ movement: MOVEMENT, day: DAY });
    const row = lines.find((line) => line.includes("x-ui"));
    assert.ok(row.includes("*"), `the raw mean is marked as one: ${row}`);
    assert.doesNotMatch(row, /null/);
  });

  it("keeps every line inside the width it was given", () => {
    const { lines } = renderConsole({
      movement: MOVEMENT,
      day: DAY,
      width: 40,
      origin: "http://127.0.0.1:8787",
    });
    for (const line of lines) {
      assert.ok([...line].length <= 40, `${[...line].length} columns: ${line}`);
    }
    assert.ok(lines.some((line) => line.includes("x-implement")), "and still says which skill it is");
    assert.equal(fit("abcdef", 4), "abc…");
    assert.equal(fit("abc", 6), "abc", "a line that fits is left alone");
  });

  it("says the record is empty rather than drawing an empty screen", () => {
    const { lines, ids } = renderConsole({ movement: { days: 0, newest: null, movement: [] }, day: null });
    assert.equal(ids.length, 0);
    assert.match(lines.join("\n"), /no day is recorded yet/);
  });

  it("has one line for a terminal that cannot redraw", () => {
    assert.match(summaryLine({ movement: MOVEMENT, day: DAY }), /x-skills report · 2026-09-17 · 3 days · 2 skills · 2 proposals/);
    assert.match(summaryLine({ movement: { days: 0, newest: null, movement: [] }, day: null }), /no day is recorded yet/);
  });

  it("reads its own flags, and defaults to the report on this machine", () => {
    assert.deepEqual(parseArgs([]), { url: "http://127.0.0.1:8787", interval: 30_000, day: null, color: true, help: false });
    assert.equal(parseArgs(["--url", "http://localhost:9000"]).url, "http://localhost:9000");
    assert.equal(parseArgs(["--interval", "5000"]).interval, 5000);
    assert.equal(parseArgs(["--day", "2026-09-16"]).day, "2026-09-16");
    assert.equal(parseArgs(["--no-color"]).color, false);
    assert.equal(parseArgs(["--help"]).help, true);
  });
});

describe("report console — the keys, and the one write it makes", async () => {
  const { runConsole, todoItemFor, withKept, without } = await import(CONSOLE);

  const run = async (keysList, options = {}) => {
    const out = { frames: [] };
    const api = options.api ?? fakeApi();
    const handle = { tick: null, cleared: [] };
    const code = await runConsole({
      input: keys(...keysList),
      out: (frame) => out.frames.push(frame),
      api,
      intervalMs: 30_000,
      timer: (fn) => {
        handle.tick = fn;
        return "timer";
      },
      clear: (t) => handle.cleared.push(t),
      ...options.extra,
    });
    return { code, out, api, handle };
  };

  it("draws on start, and keeps the selection on the proposals it can act on", async () => {
    const { out, api } = await run(["q"]);

    assert.equal(out.frames.length, 1, "one frame to begin with");
    assert.match(out.frames[0], /x-skills report · 2026-09-17/);
    assert.deepEqual(
      api.calls.filter((call) => call.method === "GET").map((call) => call.route),
      ["/api/movement?days=14", "/api/day/2026-09-17"]
    );
  });

  it("keeps the selected proposal with exactly one POST, and marks it kept", async () => {
    const { api, out } = await run(["j", "t", "q"]);
    const posts = api.calls.filter((call) => call.method === "POST");

    assert.equal(posts.length, 1);
    assert.equal(posts[0].route, "/api/todos");
    assert.deepEqual(posts[0].body.items, [todoItemFor(DAY.proposals[1])]);
    assert.match(out.frames.at(-1), /• P2/, "the day is re-read, so the marker is the server's answer");
  });

  it("keeps a proposal that is already on the list without duplicating it", async () => {
    const api = fakeApi({
      todos: { updatedAt: null, items: [{ ...todoItemFor(DAY.proposals[1]), note: "the reader's own note" }] },
    });
    const { api: used } = await run(["j", "t", "q"], { api });

    const posts = used.calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.items.length, 1, "one line on the list, not two");
  });

  it("drops a kept proposal, and says so when it was not on the list", async () => {
    const api = fakeApi({ todos: { updatedAt: null, items: [todoItemFor(DAY.proposals[1])] } });
    const dropped = await run(["j", "d", "q"], { api });

    const posts = dropped.api.calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body.items, []);
    assert.match(dropped.out.frames.at(-1), /dropped P2/);

    const fresh = await run(["d", "q"]);
    assert.equal(fresh.api.calls.filter((call) => call.method === "POST").length, 0, "nothing to drop is not a write");
    assert.match(fresh.out.frames.at(-1), /P1 is not on the list/);
  });

  it("re-reads on r, and on its own timer", async () => {
    const { api, handle } = await run(["r", "q"]);
    assert.equal(api.calls.filter((call) => call.route.startsWith("/api/movement")).length, 2, "r is a fresh read");

    const ticking = await run(["q"]);
    ticking.handle.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      ticking.api.calls.filter((call) => call.route.startsWith("/api/movement")).length,
      2,
      "the interval keeps a pane that nobody touches honest"
    );
    assert.deepEqual(ticking.handle.cleared, ["timer"], "and the timer is cleared on the way out");
  });

  it("keeps the last picture and explains itself when the report stops answering", async () => {
    const api = fakeApi();
    const out = { frames: [] };
    await runConsole({
      input: keys("r", "q"),
      out: (frame) => out.frames.push(frame),
      api: {
        origin: api.origin,
        get: async (route) => {
          if (route.startsWith("/api/movement") && out.frames.length) throw new Error("the report stopped answering");
          return api.get(route);
        },
        post: api.post,
      },
      timer: () => "timer",
      clear: () => {},
    });

    assert.match(out.frames.at(-1), /x-skills report · 2026-09-17/, "the numbers it had are still there");
    assert.match(out.frames.at(-1), /the report stopped answering/);
  });

  it("writes a selection the app would recognise", () => {
    const item = todoItemFor(DAY.proposals[0]);
    assert.deepEqual(item, {
      id: "P1",
      day: "2026-09-17",
      skill: "x-ui",
      change: "name the two ways in",
      reason: null,
      expected: null,
      target: null,
      route: null,
      signal: null,
      note: null,
    });
    assert.deepEqual(withKept([], item), [item]);
    assert.deepEqual(without([item], item), []);
    assert.deepEqual(without([{ ...item, note: "kept" }], item), [], "identity is id + day, not the whole record");
  });
});
