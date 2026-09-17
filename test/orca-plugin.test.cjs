"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const WORKER = path.join(ROOT, "tools", "orca-plugin", "main.mjs");
const ORIGIN = "http://127.0.0.1:8787";

/** A Response good enough for the worker: `ok`, `status`, `json()` and `text()`. */
function respond(body, status = 200, contentType = "application/json") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? contentType : null) },
    async json() {
      if (!String(contentType).includes("json")) throw new SyntaxError("Unexpected token < in JSON");
      return typeof body === "string" ? JSON.parse(body) : body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

/** A fetch that answers only the routes it was given, and records every call. */
function makeFetch(routes) {
  const stub = async (url, options = {}) => {
    const href = String(url);
    stub.calls.push({ href, method: options.method ?? "GET", body: options.body });
    const route = routes.find(
      (entry) => href === entry.url && (entry.method ?? "GET") === (options.method ?? "GET")
    );
    if (!route) return respond({ error: "no route" }, 404);
    if (route.handler) return route.handler(options);
    return respond(route.body ?? {}, route.status ?? 200, route.contentType);
  };
  stub.calls = [];
  return stub;
}

/** The orca host API the worker uses, with every call recorded. */
function makeHost(answers = {}) {
  const calls = [];
  const notifications = [];
  const logs = [];
  const commands = new Map();
  const events = new Map();

  const orca = {
    log: (message) => logs.push(String(message)),
    commands: { register: (id, handler) => commands.set(id, handler) },
    events: { on: (name, handler) => events.set(name, handler) },
    host: {
      call: async (method, params) => {
        calls.push({ method, params });
        if (method === "notifications.show") {
          notifications.push(params);
          return { ok: true, value: { delivered: true } };
        }
        const answer = answers[method];
        if (answer === undefined) return { ok: false, code: "unknown_method", error: method };
        return typeof answer === "function" ? answer(params) : answer;
      },
    },
  };

  return { orca, calls, notifications, logs, commands, events };
}

const DAYS = { dates: ["2026-09-16", "2026-09-17"], recent: [], calendar: {} };
const OPENED = { ok: true, surface: "orca", how: "created", url: `${ORIGIN}/`, message: "opened" };

describe("orca plugin — the report in an Orca tab", async () => {
  const worker = await import(WORKER);

  it("registers the open command and records where the worker runs", () => {
    const host = makeHost();
    worker.default(host.orca, { fetch: makeFetch([]) });

    assert.deepEqual([...host.commands.keys()], ["report-open"]);
    assert.match(host.logs.join("\n"), new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("probes the report and reads its newest day", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([{ url: `${ORIGIN}/api/days`, body: DAYS }]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

    assert.deepEqual(await plugin.probe(), { up: true, origin: ORIGIN, day: "2026-09-17" });
  });

  it("opens through the server's own opener, not its own tab", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([
      { url: `${ORIGIN}/api/days`, body: DAYS },
      { url: `${ORIGIN}/api/open`, method: "POST", body: OPENED },
    ]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

    await plugin.open();

    const posts = fetchStub.calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].href, `${ORIGIN}/api/open`);
    assert.deepEqual(JSON.parse(posts[0].body), { surface: "orca", path: "/" });
    assert.deepEqual(host.notifications, [], "the tab appearing is the feedback, not a notification");
    assert.match(host.logs.join("\n"), /orca/);
  });

  it("still asks the server to open when no day is recorded yet", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([
      { url: `${ORIGIN}/api/days`, body: { dates: [], recent: [], calendar: {} } },
      { url: `${ORIGIN}/api/open`, method: "POST", body: OPENED },
    ]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

    assert.deepEqual(await plugin.probe(), { up: true, origin: ORIGIN, day: null });
    await plugin.open();
    assert.equal(fetchStub.calls.filter((call) => call.method === "POST").length, 1);
  });

  it("says what to run when nothing answers", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

    await plugin.open();

    assert.equal(host.notifications.length, 1);
    assert.match(host.notifications[0].body, /npm run report/);
    assert.doesNotMatch(host.notifications[0].body, /at .*:\d+:\d+|stack/i);
    assert.equal(fetchStub.calls.filter((call) => call.method === "POST").length, 0);
  });

  it("does not open when the payload is not the report", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([
      { url: `${ORIGIN}/api/days`, body: { hello: "world" } },
      { url: `${ORIGIN}/api/open`, method: "POST", body: OPENED },
    ]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

    const probe = await plugin.probe();
    assert.equal(probe.up, false);
    assert.match(probe.reason, /not the report/i);

    await plugin.open();
    assert.equal(fetchStub.calls.filter((call) => call.method === "POST").length, 0);
    assert.equal(host.notifications.length, 1);
  });

  it("survives a body that is not JSON", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([
      { url: `${ORIGIN}/api/days`, body: "<!doctype html><h1>hello</h1>", contentType: "text/html" },
    ]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

    const probe = await plugin.probe();
    assert.equal(probe.up, false);
    assert.equal(typeof probe.reason, "string");
  });

  it("repeats the server's own reason when opening fails", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([
      { url: `${ORIGIN}/api/days`, body: DAYS },
      {
        url: `${ORIGIN}/api/open`,
        method: "POST",
        status: 502,
        body: { ok: false, surface: "orca", how: "create-failed", url: ORIGIN, message: "Orca would not open a tab: no runtime" },
      },
    ]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

    await plugin.open();

    assert.equal(host.notifications.length, 1);
    assert.match(host.notifications[0].body, /Orca would not open a tab: no runtime/);
  });

  it("gives up on a hung port instead of hanging", async () => {
    const host = makeHost();
    const hung = (url, options = {}) =>
      new Promise((resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
        });
      });
    const plugin = worker.createPlugin({ orca: host.orca, fetch: hung, timeoutMs: 20 });

    const probe = await plugin.probe();

    assert.equal(probe.up, false);
    assert.match(probe.reason, /time|abort/i);
  });
});
