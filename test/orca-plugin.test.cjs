"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLUGIN = path.join(ROOT, "tools", "orca-plugin");
const WORKER = path.join(PLUGIN, "main.mjs");
const MANIFEST = path.join(PLUGIN, "orca-plugin.json");
const ORIGIN = "http://127.0.0.1:8787";

/** What a plugin gets instead of the real bake: the baker has its own tests, and no test runs the CLI. */
const noBake = async () => ({ baked: false, reason: "test" });

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

/** A port nobody is listening on: fetch rejects the way Node does. */
function refusing() {
  const stub = async (url) => {
    stub.calls.push({ href: String(url) });
    throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { code: "ECONNREFUSED" });
  };
  stub.calls = [];
  return stub;
}

/**
 * The method table `orca.host.call` answers from, with every call recorded.
 *
 * The fixtures are the wire replies the host sends (`{ ok, value }`, or `{ ok: false, code, error }`), and
 * this hands them over the way Orca's worker SDK does: the reply's `value`, or a rejection. A plugin that
 * reads the reply as an envelope instead never sees an answer, which is how the panel went un-baked.
 */
function hostCaller(answers, calls, notifications) {
  return async (method, params) => {
    calls.push({ method, params });
    if (method === "notifications.show") {
      notifications.push(params);
      return { delivered: true };
    }
    const reply = answers[method];
    if (reply === undefined) {
      const error = new Error(method);
      error.code = "unknown_method";
      throw error;
    }
    const answer = typeof reply === "function" ? await reply(params) : reply;
    if (answer?.ok === true) return answer.value;
    const error = new Error(answer?.error ?? `${method} failed`);
    error.code = answer?.code;
    throw error;
  };
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
    host: { call: hostCaller(answers, calls, notifications) },
  };

  return { orca, calls, notifications, logs, commands, events };
}

/** A payload in the shape `GET /api/days` really sends, captured from a running report. */
const REAL_DAYS = {
  dates: ["2026-09-16", "2026-09-17"],
  recent: [{ date: "2026-09-17", mean: 68.3, band: { key: "weak", label: "needs work" }, sessions: 21, scored: 4, skills: 28 }],
  calendar: [
    {
      month: "2026-09",
      cells: [{ day: null, date: null, recorded: false }, { day: 1, date: "2026-09-01", recorded: false }],
    },
  ],
};
const DAYS = { dates: ["2026-09-16", "2026-09-17"], recent: [], calendar: [] };
const OPENED = { ok: true, surface: "orca", how: "created", url: `${ORIGIN}/`, message: "opened" };

describe("orca plugin — the report in an Orca tab", async () => {
  const worker = await import(WORKER);

  it("registers the open command and records where the worker runs", () => {
    const host = makeHost();
    worker.default(host.orca, { fetch: makeFetch([]), bakePanel: noBake, follow: false });

    assert.ok(host.commands.has("report-open"), "the palette entry this layer promised");
    assert.match(host.logs.join("\n"), new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("probes the report and reads its newest day", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([{ url: `${ORIGIN}/api/days`, body: DAYS }]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

    assert.deepEqual(await plugin.probe(), {
      up: true,
      origin: ORIGIN,
      day: "2026-09-17",
      dates: DAYS.dates,
    });
  });

  it("opens through the server's own opener, not its own tab", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([
      { url: `${ORIGIN}/api/days`, body: DAYS },
      { url: `${ORIGIN}/api/open`, method: "POST", body: OPENED },
    ]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

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
      { url: `${ORIGIN}/api/days`, body: { dates: [], recent: [], calendar: [] } },
      { url: `${ORIGIN}/api/open`, method: "POST", body: OPENED },
    ]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

    assert.deepEqual(await plugin.probe(), { up: true, origin: ORIGIN, day: null, dates: [] });
    await plugin.open();
    assert.equal(fetchStub.calls.filter((call) => call.method === "POST").length, 1);
  });

  it("says what to run when nothing answers", async () => {
    const host = makeHost();
    const fetchStub = refusing();
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

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
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

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
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

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
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

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
    const plugin = worker.createPlugin({ orca: host.orca, fetch: hung, timeoutMs: 20, bake: noBake });

    const probe = await plugin.probe();

    assert.equal(probe.up, false);
    assert.equal(probe.kind, "unreachable");
    assert.match(probe.reason, /time|abort/i);
  });
});

describe("orca plugin — the probe proves identity, and the plugin stays on this machine", async () => {
  const worker = await import(WORKER);

  it("accepts the two loopback spellings, and normalises the trailing slash", () => {
    assert.equal(worker.loopbackOrigin("http://127.0.0.1:8787").origin, "http://127.0.0.1:8787");
    assert.equal(worker.loopbackOrigin("http://127.0.0.1:8787/").origin, "http://127.0.0.1:8787");
    assert.equal(worker.loopbackOrigin("http://localhost:9000").origin, "http://localhost:9000");
  });

  it("refuses every way out of this machine, each with its own reason", () => {
    const cases = [
      ["https://127.0.0.1:8787", /http/i, "the report is plain http on loopback"],
      ["http://127.0.0.1.example.com:8787", /loopback/i, "a hostname that starts with the right text is elsewhere"],
      ["http://user:pass@127.0.0.1:8787", /credential|user|password/i, "credentials in a URL are never ours"],
      ["http://[::1]:8787", /loopback/i, "the server binds 127.0.0.1, so this cannot be it"],
      ["file:///etc/passwd", /http/i, "not a URL the report could answer on"],
      ["http://192.168.1.5:8787", /loopback/i, "another machine"],
      ["http://127.0.0.1:8787/skill/x-anal", /origin|path/i, "an origin, not a route"],
      [undefined, /url|string/i, "no value at all"],
      [42, /url|string/i, "not a string"],
      ["not a url", /url/i, "not a URL"],
    ];
    for (const [value, pattern, why] of cases) {
      const result = worker.loopbackOrigin(value);
      assert.equal(result.ok, false, `${String(value)} must be refused (${why})`);
      assert.match(result.reason, pattern, `${String(value)}: ${why}`);
    }
  });

  it("never makes a request when the address is refused", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([{ url: "http://192.168.1.5:8787/api/days", body: DAYS }]);
    const plugin = worker.createPlugin({
      orca: host.orca,
      fetch: fetchStub,
      url: "http://192.168.1.5:8787",
      bake: noBake,
    });

    const probe = await plugin.probe();
    await plugin.open();

    assert.equal(probe.up, false);
    assert.equal(probe.kind, "bad-origin");
    assert.equal(fetchStub.calls.length, 0, "a refused address is never requested");
    assert.equal(host.notifications.length, 1);
    assert.match(host.notifications[0].body, /loopback/i);
  });

  it("tells a stranger on the port apart from a server that is not running", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([{ url: `${ORIGIN}/api/days`, body: "<h1>hello</h1>", contentType: "text/html" }]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

    const probe = await plugin.probe();
    await plugin.open();

    assert.equal(probe.kind, "wrong-service");
    assert.match(host.notifications[0].body, /not the report/i);
    assert.doesNotMatch(host.notifications[0].body, /npm run report/);
    assert.equal(fetchStub.calls.filter((call) => call.method === "POST").length, 0);
  });

  it("reads a payload only when it is the report's own shape", () => {
    assert.deepEqual(worker.readDays({ dates: ["2026-09-16"], recent: [], calendar: [] }), {
      day: "2026-09-16",
      dates: ["2026-09-16"],
    });
    assert.equal(worker.readDays({ dates: [], recent: [], calendar: [] }).day, null);
    assert.equal(worker.readDays(REAL_DAYS).day, "2026-09-17", "the shape a running report actually sends");
    assert.equal(worker.readDays({ dates: ["2026-9-7"], recent: [], calendar: [] }), null);
    assert.equal(worker.readDays({ dates: ["2026-09-17"], recent: [] }), null);
    assert.equal(worker.readDays({ recent: [], calendar: [] }), null);
    assert.equal(worker.readDays({ dates: [], calendar: [] }), null);
    assert.equal(worker.readDays({ dates: "2026-09-17", recent: [], calendar: [] }), null);
    assert.equal(worker.readDays({ dates: [], recent: [], calendar: {} }), null, "the server sends months, not an object");
    assert.equal(worker.readDays(null), null);
    assert.equal(worker.readDays("<h1>hello</h1>"), null);
  });
});

describe("orca plugin — the record root is the focused worktree's", async () => {
  const worker = await import(WORKER);
  const os = require("node:os");
  const log = () => {};

  /** A checkout that really has a record, so the resolution is exercised end to end. */
  function checkout() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-record-"));
    fs.mkdirSync(path.join(dir, ".x-skills", "daily"), { recursive: true });
    return dir;
  }

  const bare = () => fs.mkdtempSync(path.join(os.tmpdir(), "xskills-empty-"));
  const focused = (path) => ({ code: 0, stdout: JSON.stringify({ result: { worktree: path ? { path } : null } }), stderr: "" });
  const context = (branch) => ({
    "workspace.readContext": { ok: true, value: { branch, displayName: "xskills", terminals: [] } },
  });

  it("takes a root the reader set without asking Orca's CLI", async () => {
    const repo = checkout();
    const host = makeHost(context("refs/heads/main"));
    let asked = 0;

    const found = await worker.resolveRecordRoot({
      orca: host.orca,
      own: { reportRoot: repo },
      log,
      run: () => {
        asked += 1;
        return focused(repo);
      },
    });

    assert.equal(found.root, path.join(repo, ".x-skills", "daily"));
    assert.equal(asked, 0, "a reader-set root is the answer, not a question");
  });

  it("falls back to what the plugin remembered", async () => {
    const repo = checkout();
    const host = makeHost({ ...context("refs/heads/main"), "storage.get": { ok: true, value: { value: repo } } });
    let asked = 0;

    const found = await worker.resolveRecordRoot({
      orca: host.orca,
      own: {},
      log,
      run: () => {
        asked += 1;
        return focused(repo);
      },
    });

    assert.equal(found.root, path.join(repo, ".x-skills", "daily"));
    assert.equal(asked, 0);
  });

  it("asks Orca's CLI which worktree is focused", async () => {
    const repo = checkout();
    const host = makeHost(context("refs/heads/main"));

    const found = await worker.resolveRecordRoot({
      orca: host.orca,
      own: {},
      log,
      run: () => focused(repo),
    });

    assert.equal(found.root, path.join(repo, ".x-skills", "daily"));
    assert.equal(
      host.calls.find((call) => call.method === "storage.set").params.value,
      repo,
      "so the next activation costs one storage read"
    );
  });

  it("says which directory it looked for when the checkout has no record", async () => {
    const empty = bare();
    const host = makeHost(context("refs/heads/main"));

    const found = await worker.resolveRecordRoot({
      orca: host.orca,
      own: {},
      log,
      run: () => focused(empty),
    });

    assert.equal(found.root, null);
    assert.match(found.reason, /has no \.x-skills\/daily/);
    assert.match(found.reason, new RegExp(empty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("says so when no worktree is focused, and when the CLI cannot answer", async () => {
    const unfocused = makeHost({ "workspace.readContext": { ok: true, value: null } });
    assert.match(
      (await worker.resolveRecordRoot({ orca: unfocused.orca, own: {}, log, run: () => focused(null) })).reason,
      /no worktree is focused/
    );

    const host = makeHost(context("refs/heads/main"));
    const said = [];
    const found = await worker.resolveRecordRoot({
      orca: host.orca,
      own: {},
      log: (line) => said.push(line),
      run: () => ({ code: 1, stdout: "", stderr: "orca: not running\n" }),
    });

    assert.equal(found.root, null);
    assert.match(said.join("\n"), /could not ask Orca for the focused worktree/);
  });

  it("follows the record it serves, with the checkout's own rule", async () => {
    const repo = checkout();
    const host = makeHost(context("refs/heads/main"));
    const record = path.join(repo, ".x-skills", "daily");
    const baked = [];
    let wired = null;

    const follower = await worker.followRecord({
      orca: host.orca,
      own: {},
      log,
      run: () => focused(repo),
      bake: (args) => baked.push(args?.own ?? null),
      loadFollower: async () => ({
        followPacks: (args) => {
          wired = args;
          return { stop() {} };
        },
      }),
      loadBaker: async () => ({ recordFingerprint: (dir) => `fingerprint of ${dir}` }),
    });

    assert.ok(follower, "the follower is handed back, so a worker can stop it");
    assert.equal(wired.root, record, "the record this checkout serves");
    assert.equal(wired.intervalMs, worker.RECORD_POLL_MS);
    assert.equal(await wired.fingerprint(record), `fingerprint of ${record}`, "the baker's rule, not a second one");
    await wired.rebake();
    assert.equal(baked.length, 1, "a change in the record is a bake");
  });

  it("follows nothing when no worktree is focused", async () => {
    const host = makeHost({ "workspace.readContext": { ok: true, value: null } });
    const said = [];

    const follower = await worker.followRecord({
      orca: host.orca,
      own: {},
      log: (line) => said.push(line),
      run: () => focused(null),
      bake: () => {},
    });

    assert.equal(follower, null);
    assert.match(said.join("\n"), /nothing to follow: no worktree is focused/);
  });

  it("says so when the checkout cannot be followed, rather than throwing", async () => {
    const repo = checkout();
    const host = makeHost(context("refs/heads/main"));
    const said = [];

    const follower = await worker.followRecord({
      orca: host.orca,
      own: {},
      log: (line) => said.push(line),
      run: () => focused(repo),
      bake: () => {},
      loadFollower: async () => {
        throw new Error("no follower here");
      },
      loadBaker: async () => ({ recordFingerprint: () => "x" }),
    });

    assert.equal(follower, null);
    assert.match(said.join("\n"), /could not follow .*no follower here/);
  });
});

describe("orca plugin — the report's address comes from the plugin's own settings", async () => {
  const worker = await import(WORKER);

  const resolve = async (answers) => {
    const host = makeHost(answers);
    const logs = [];
    const resolved = await worker.resolveUrl({ orca: host.orca, log: (line) => logs.push(line) });
    return { resolved, logs, host };
  };

  const settings = (value) => ({
    "settings.get": { ok: true, value: { settings: value === undefined ? {} : { url: value } } },
  });
  const storage = (value) => ({ "storage.get": { ok: true, value: { value } } });

  it("takes the address from the plugin's own settings", async () => {
    const { resolved } = await resolve(settings("http://127.0.0.1:9000"));
    assert.deepEqual(resolved, { origin: "http://127.0.0.1:9000", source: "settings" });
  });

  it("normalises the trailing slash, so two spellings are one address", async () => {
    const { resolved } = await resolve(settings("http://127.0.0.1:9000/"));
    assert.equal(resolved.origin, "http://127.0.0.1:9000");
  });

  it("falls back to its own storage, then to the default", async () => {
    const stored = await resolve({ ...settings(undefined), ...storage("http://127.0.0.1:9001") });
    assert.deepEqual(stored.resolved, { origin: "http://127.0.0.1:9001", source: "storage" });

    const empty = await resolve({ ...settings(undefined), "storage.get": { ok: true, value: { value: null } } });
    assert.deepEqual(empty.resolved, { origin: "http://127.0.0.1:8787", source: "default" });
  });

  it("prefers the reader's own setting over the plugin's storage", async () => {
    const { resolved } = await resolve({ ...settings("http://127.0.0.1:9000"), ...storage("http://127.0.0.1:9001") });
    assert.equal(resolved.source, "settings");
    assert.equal(resolved.origin, "http://127.0.0.1:9000");
  });

  it("refuses a non-loopback setting instead of using it", async () => {
    const { resolved, logs } = await resolve(settings("http://192.168.1.5:8787"));
    assert.deepEqual(resolved, { origin: "http://127.0.0.1:8787", source: "default" });
    assert.match(logs.join("\n"), /not loopback/);
  });

  it("names the type of a value that is not a URL at all", async () => {
    const { resolved, logs } = await resolve(settings(9000));
    assert.equal(resolved.source, "default");
    assert.match(logs.join("\n"), /number/);
  });

  it("survives a host that cannot answer the settings call", async () => {
    const rejecting = async () => {
      throw new Error("settings store is unavailable");
    };
    const { resolved, logs } = await resolve({ "settings.get": rejecting, "storage.get": rejecting });
    assert.equal(resolved.source, "default");
    assert.match(logs.join("\n"), /settings store is unavailable/);
  });

  it("uses the resolved address for every command, and asks for it once", async () => {
    const host = makeHost(settings("http://127.0.0.1:9000"));
    const fetchStub = makeFetch([
      { url: "http://127.0.0.1:9000/api/days", body: DAYS },
      { url: "http://127.0.0.1:9000/api/open", method: "POST", body: OPENED },
    ]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

    await plugin.open();
    await plugin.probe();

    assert.equal(host.calls.filter((call) => call.method === "settings.get").length, 1);
    assert.ok(fetchStub.calls.length > 0);
    assert.ok(
      fetchStub.calls.every((call) => call.href.startsWith("http://127.0.0.1:9000")),
      "every request went to the resolved address, not the default"
    );
  });
});

describe("orca plugin — status, refresh and start", async () => {
  const worker = await import(WORKER);

  const settings = (value) => ({
    "settings.get": { ok: true, value: { settings: value === undefined ? {} : { url: value } } },
  });
  const REPORT = [
    { url: `${ORIGIN}/api/days`, body: DAYS },
    {
      url: `${ORIGIN}/api/refresh`,
      body: { ok: true, day: "2026-09-17", packs: ["2026-09-17"], skills: 11, inUse: 4 },
    },
  ];

  /** A registered plugin whose commands are invoked the way Orca invokes them. */
  function plugin({ answers = {}, routes = [], fetch: fetchImpl, url, ensure = null } = {}) {
    const host = makeHost(answers);
    const fetchStub = fetchImpl ?? makeFetch(routes);
    const instance = worker.createPlugin({ orca: host.orca, fetch: fetchStub, url, bake: noBake, ensure });
    instance.register();
    return { host, fetchStub, run: (id) => host.commands.get(id)() };
  }

  it("registers every command the manifest contributes", () => {
    const { host } = plugin();
    const manifest = JSON.parse(require("node:fs").readFileSync(MANIFEST, "utf8"));
    assert.deepEqual(
      [...host.commands.keys()],
      manifest.contributes.commands.map((command) => command.id)
    );
    assert.deepEqual([...host.commands.keys()], [
      "report-open",
      "report-status",
      "report-refresh",
      "report-start",
      "report-console",
    ]);
  });

  it("describes the report, and says where its address came from", async () => {
    const { host, run } = plugin({
      answers: settings("http://127.0.0.1:9000"),
      routes: [{ url: "http://127.0.0.1:9000/api/days", body: DAYS }],
    });

    await run("report-status");

    const body = host.notifications.at(-1).body;
    assert.match(body, /up at http:\/\/127\.0\.0\.1:9000/);
    assert.match(body, /from settings/);
    assert.match(body, /2026-09-17/);
    assert.match(body, /2 days/);
  });

  it("says no day is recorded rather than showing an empty count", async () => {
    const { host, run } = plugin({
      routes: [{ url: `${ORIGIN}/api/days`, body: { dates: [], recent: [], calendar: [] } }],
    });

    await run("report-status");

    assert.match(host.notifications[0].body, /no day recorded yet/);
    assert.doesNotMatch(host.notifications[0].body, /undefined|NaN/);
  });

  it("says what to run when status finds nothing answering", async () => {
    const { host, run } = plugin({ fetch: refusing() });

    await run("report-status");

    assert.match(host.notifications[0].body, /not answering at/);
    assert.match(host.notifications[0].body, /npm run report/);
  });

  it("repeats what the server recorded", async () => {
    const { host, run } = plugin({ routes: REPORT });

    await run("report-refresh");

    const body = host.notifications.at(-1).body;
    assert.match(body, /recorded 2026-09-17/);
    assert.match(body, /1 pack\b/);
    assert.match(body, /4 in use/);
  });

  it("repeats the server's own reason verbatim, once", async () => {
    const reason = "no pack under .x-skills/daily; run the collector first";
    const { host, fetchStub, run } = plugin({
      routes: [
        { url: `${ORIGIN}/api/days`, body: DAYS },
        { url: `${ORIGIN}/api/refresh`, body: { ok: false, reason } },
      ],
    });

    await run("report-refresh");

    assert.equal(host.notifications.at(-1).body, reason);
    assert.equal(
      fetchStub.calls.filter((call) => call.href.endsWith("/api/refresh")).length,
      1,
      "a recording is never retried"
    );
  });

  it("says what to run when refresh finds nothing answering", async () => {
    const { host, fetchStub, run } = plugin({ fetch: refusing() });

    await run("report-refresh");

    assert.match(host.notifications.at(-1).body, /npm run report/);
    assert.equal(fetchStub.calls.filter((call) => call.href.endsWith("/api/refresh")).length, 1);
  });

  it("truncates a body the host would refuse", async () => {
    const reason = "x".repeat(1500);
    const { host, run } = plugin({
      routes: [{ url: `${ORIGIN}/api/refresh`, body: { ok: false, reason } }],
    });

    await run("report-refresh");

    const body = host.notifications.at(-1).body;
    assert.ok(body.length <= 1000, `body was ${body.length} characters`);
    assert.ok(body.endsWith("…"));
  });

  it("starts the report itself, and names the pid", async () => {
    const { host, run } = plugin({ routes: REPORT, ensure: async () => ({ ok: true, started: true, pid: 5150 }) });

    await run("report-start");

    assert.match(host.notifications[0].body, /started the report at http:\/\/127\.0\.0\.1:8787 \(pid 5150\)/);
    assert.equal(host.calls.filter((call) => call.method === "terminal.sendText").length, 0, "nothing is typed anywhere");
  });

  it("says it was already answering rather than claiming a start", async () => {
    const { host, run } = plugin({ routes: REPORT, ensure: async () => ({ ok: true, started: false, pid: null }) });

    await run("report-start");

    assert.match(host.notifications[0].body, /already answering at http:\/\/127\.0\.0\.1:8787/);
  });

  it("repeats the reason when there is nothing to serve", async () => {
    const { host, run } = plugin({
      routes: REPORT,
      ensure: async () => ({ ok: false, started: false, reason: "/repo has no .x-skills/daily, so there is nothing to serve" }),
    });

    const result = await run("report-start");

    assert.equal(result.started, false);
    assert.match(host.notifications[0].body, /has no \.x-skills\/daily/);
  });

  it("starts nothing when the address itself was refused", async () => {
    const { host, run } = plugin({ url: "http://not-this-machine:8787", ensure: async () => ({ ok: true, started: true }) });

    const result = await run("report-start");

    assert.equal(result.started, false);
    assert.match(host.notifications[0].body, /nothing to start at it/);
  });

  it("starts the report itself when nothing is answering, and only once", async () => {
    const host = makeHost();
    let up = false;
    const fetchStub = async (url, options = {}) => {
      const href = String(url);
      fetchStub.calls.push({ href, method: options.method ?? "GET", body: options.body });
      if (!up) throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { code: "ECONNREFUSED" });
      if (href.endsWith("/api/open")) return respond(OPENED);
      return respond(DAYS);
    };
    fetchStub.calls = [];
    const started = [];
    const ensure = async () => {
      started.push(1);
      up = true;
      return { ok: true, started: true, pid: 4242 };
    };

    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake, ensure });

    await plugin.open();
    assert.equal(started.length, 1, "a quiet port starts the report");
    assert.equal(fetchStub.calls.filter((call) => call.href.endsWith("/api/open")).length, 1, "then the tab is asked for");

    await plugin.open();
    assert.equal(started.length, 1, "once it answers, a second Open starts nothing");
  });

  it("never adopts a port that something else is holding", async () => {
    const host = makeHost();
    const started = [];
    const plugin = worker.createPlugin({
      orca: host.orca,
      fetch: makeFetch([{ url: `${ORIGIN}/api/days`, body: { stranger: true } }]),
      bake: noBake,
      ensure: async () => {
        started.push(1);
        return { ok: true, started: true };
      },
    });

    const result = await plugin.open();

    assert.equal(started.length, 0, "a stranger on the port is never adopted");
    assert.equal(result.opened, false);
    assert.match(host.notifications[0].body, /but not the report/);
  });

  it("says why when the focused worktree has no record to serve", async () => {
    const host = makeHost();
    const plugin = worker.createPlugin({
      orca: host.orca,
      fetch: refusing(),
      bake: noBake,
      ensure: async () => ({ ok: false, reason: "/repo has no .x-skills/daily, so there is nothing to serve" }),
    });

    const result = await plugin.open();

    assert.equal(result.opened, false);
    assert.match(host.notifications[0].body, /has no \.x-skills\/daily/);
  });

  it("starts the report and nothing else", () => {
    const source = fs.readFileSync(WORKER, "utf8");
    for (const call of ["exec", "execSync", "execFile", "fork"]) {
      assert.doesNotMatch(source, new RegExp(`\\b${call}\\s*\\(`), "a command string is where injection lives");
    }
    assert.doesNotMatch(source, /\bcreateServer\s*\(/, "it asks the repository for a server; it is not one");
    assert.doesNotMatch(source, /\.listen\s*\(/, "it never binds a port itself");
    assert.doesNotMatch(source, /\bspawn\s*\(/, "the process goes through the seam, never straight to spawn");
    assert.equal([...source.matchAll(/spawnImpl\s*\(/g)].length, 1, "exactly one place starts a process");
    assert.match(source, /report-server\.mjs/, "and the process it starts is this repository's own server");
  });
});

describe("orca plugin — the console, opened in a labelled pane", async () => {
  const worker = await import(WORKER);
  const REPO = "/repo";
  const RECORD = "/repo/.x-skills/daily";

  /** Orca's CLI, as the worker calls it: one stub that answers by subcommand and records every argv. */
  function cli({ terminals = [], create = null, failing = null } = {}) {
    const calls = [];
    const run = (command, args) => {
      calls.push([command, ...args]);
      const joined = args.join(" ");
      if (failing && joined.startsWith(failing)) return { code: 1, stdout: "", stderr: "orca: not running\n" };
      if (joined.startsWith("terminal list")) {
        return { code: 0, stdout: JSON.stringify({ result: { terminals } }), stderr: "" };
      }
      if (joined.startsWith("terminal create")) {
        const terminal = create ?? { handle: "term_new", title: "x-skills report", surface: "visible" };
        return { code: 0, stdout: JSON.stringify({ result: { terminal } }), stderr: "" };
      }
      if (joined.startsWith("terminal switch")) return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
      return { code: 0, stdout: "{}", stderr: "" };
    };
    run.calls = calls;
    return run;
  }

  const our = (handle, worktreePath = REPO) => ({ handle, title: "x-skills report", worktreePath });

  it("creates the console once, in a terminal of its own, and remembers the handle", async () => {
    const host = makeHost();
    const run = cli();

    const result = await worker.openConsole({ repo: REPO, origin: ORIGIN, run, log: () => {}, exists: () => true });

    assert.equal(result.ok, true);
    assert.equal(result.how, "created");
    const created = run.calls.find((argv) => argv[1] === "terminal" && argv[2] === "create");
    assert.ok(created, "one terminal was created");
    assert.deepEqual(created.slice(0, 5), ["orca", "terminal", "create", "--worktree", "active"]);
    assert.ok(created.includes("x-skills report"), "titled as ours, so the next press can find it");
    const command = created[created.indexOf("--command") + 1];
    assert.match(command, /^node \/repo\/scripts\/report-console\.mjs --url http:\/\/127\.0\.0\.1:8787$/, "an absolute script and the report's address");
    assert.equal(result.handle, "term_new");
  });

  it("focuses the pane it opened before instead of opening another", async () => {
    const host = makeHost();
    const run = cli({ terminals: [our("term_ours")] });

    const result = await worker.openConsole({
      repo: REPO,
      origin: ORIGIN,
      run,
      log: () => {},
      remembered: "term_ours",
      exists: () => true,
    });

    assert.equal(result.how, "focused");
    assert.equal(run.calls.filter((argv) => argv[1] === "terminal" && argv[2] === "create").length, 0, "no second pane");
    assert.ok(run.calls.some((argv) => argv.join(" ") === "orca terminal switch --terminal term_ours"));
  });

  it("never adopts a terminal of the same name in another worktree", async () => {
    const run = cli({ terminals: [our("term_elsewhere", "/other/repo")] });

    const result = await worker.openConsole({ repo: REPO, origin: ORIGIN, run, log: () => {}, exists: () => true });

    assert.equal(result.how, "created", "a pane in another checkout is not this checkout's pane");
    assert.equal(run.calls.filter((argv) => argv[1] === "terminal" && argv[2] === "create").length, 1);
  });

  it("refuses to open a pane whose command would not exist", async () => {
    const run = cli();

    const result = await worker.openConsole({ repo: REPO, origin: ORIGIN, run, log: () => {}, exists: () => false });

    assert.equal(result.ok, false);
    assert.equal(result.how, "no-console");
    assert.equal(run.calls.length, 0, "nothing is even listed");
  });

  it("says what the CLI said when it will not open a terminal", async () => {
    const run = cli({ failing: "terminal create" });

    const result = await worker.openConsole({ repo: REPO, origin: ORIGIN, run, log: () => {}, exists: () => true });

    assert.equal(result.ok, false);
    assert.equal(result.how, "create-failed");
    assert.match(result.reason, /orca: not running/);
  });

  it("is registered as a command, and opens the report before the pane", async () => {
    const host = makeHost({
      "workspace.readContext": { ok: true, value: { branch: "refs/heads/main", displayName: "xskills", terminals: [] } },
    });
    const order = [];
    const run = (command, args) => {
      order.push(args.join(" "));
      return cli().call(null, command, args);
    };
    const ensure = async () => {
      order.push("ensure");
      return { ok: true, started: true, pid: 7, root: RECORD };
    };

    const plugin = worker.createPlugin({
      orca: host.orca,
      fetch: makeFetch([]),
      bake: noBake,
      ensure,
      run,
      open: (options) => worker.openConsole({ ...options, exists: () => true }),
    });
    plugin.register();
    const result = await host.commands.get("report-console")();

    assert.equal(result.opened, true);
    assert.equal(order[0], "ensure", "the console exits at once when nothing answers, so the report comes first");
    assert.ok(order.some((line) => line.startsWith("terminal create")), "and then the pane");
    assert.match(host.notifications[0].body, /x-skills report/);
  });

  it("opens no pane when there is no record to serve", async () => {
    const host = makeHost();
    const run = cli();
    const plugin = worker.createPlugin({
      orca: host.orca,
      fetch: makeFetch([]),
      bake: noBake,
      ensure: async () => ({ ok: false, started: false, reason: "/repo has no .x-skills/daily" }),
      run,
    });

    plugin.register();
    const result = await host.commands.get("report-console")();

    assert.equal(result.opened, false);
    assert.equal(run.calls.length, 0, "nothing is listed, created or focused");
    assert.match(host.notifications[0].body, /has no \.x-skills\/daily/);
  });
});

describe("orca plugin — the manifest and the approval it answers to", async () => {
  const CONTRIBUTIONS = new Set([
    "panels",
    "commands",
    "events",
    "languagePacks",
    "keybindings",
    "vmRecipes",
    "agents",
  ]);
  const CAPABILITIES = new Set([
    "workspace:read",
    "terminal:send",
    "notifications:show",
    "storage",
    "secrets",
    "events:subscribe",
    "settings:own",
  ]);
  const EVENTS = new Set(["worktree.created", "worktree.removed", "agent.status.changed"]);
  const SLUG = /^[a-z0-9][a-z0-9.-]*$/;
  const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
  const bindingKey = (binding) =>
    typeof binding.key === "string"
      ? binding.key
      : [binding.key?.darwin, binding.key?.linux, binding.key?.win32].join("|");

  /** The rules Orca's schema enforces, checked here so a typo fails a test instead of a plugin load. */
  function manifestIssues(manifest, { exists = fs.existsSync } = {}) {
    const issues = [];
    const contributes = manifest.contributes ?? {};
    if (manifest.manifestVersion !== 1) issues.push("manifestVersion must be 1");
    if (!SLUG.test(manifest.id ?? "")) issues.push("id must be a slug");
    if (!SLUG.test(manifest.publisher ?? "")) issues.push("publisher must be a slug");
    if (!SEMVER.test(manifest.version ?? "")) issues.push("version must be semver");
    if (typeof manifest.engines?.orca !== "string") issues.push("engines.orca must be a range");
    if (manifest.pluginApi !== 1) issues.push("pluginApi must be 1");

    for (const key of Object.keys(contributes)) {
      if (!CONTRIBUTIONS.has(key)) issues.push(`contributes.${key} is not a contribution`);
    }
    for (const capability of manifest.capabilities ?? []) {
      if (!CAPABILITIES.has(capability?.kind)) issues.push(`unknown capability ${capability?.kind}`);
    }
    for (const event of contributes.events ?? []) {
      if (!EVENTS.has(event?.on)) issues.push(`unknown event ${event?.on}`);
    }

    const files = [manifest.main, ...(contributes.panels ?? []).map((panel) => panel.entry)];
    for (const file of files.filter(Boolean)) {
      // Orca realpaths every declared artifact when it loads the plugin, so a panel that is not on disk is not an
      // empty pane: it is "A declared worker or panel file is missing or unsafe" and the plugin does not load.
      if (!exists(path.join(PLUGIN, file))) issues.push(`missing file ${file}`);
    }

    const commands = new Set((contributes.commands ?? []).map((command) => command.id));
    const keys = new Map();
    for (const binding of contributes.keybindings ?? []) {
      if (!commands.has(binding.command)) {
        issues.push(`keybinding ${binding.command} is not a contributed command`);
      }
      const key = bindingKey(binding);
      if (keys.has(key)) issues.push(`duplicate keybinding ${key}: ${keys.get(key)} and ${binding.command}`);
      keys.set(key, binding.command);
    }
    return issues;
  }

  /** The shipped manifest, as a fresh object each time so a test can mutate it safely. */
  const shipped = () => JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  it("passes every rule, with every declared file on disk", () => {
    assert.deepEqual(manifestIssues(shipped()), []);
  });

  it("contributes no instructional content, so a re-rendered panel is not a re-approval", () => {
    // Orca's consent fingerprint is sha256(capabilities + trusted-worker + instructional-content:treeHash), and
    // "instructional" means keybindings, vmRecipes and agents (plugin-consent-fingerprint.ts). This plugin's
    // panel is *rendered from the record* and re-written whenever the record changes, so a keybinding here would
    // make every new day a plugin that has to be approved again — which is exactly the reinstall this avoids.
    // The shortcut this gave up is the palette: Ctrl+J, then "x-skills report: Open".
    const contributes = shipped().contributes;
    for (const instructional of ["keybindings", "vmRecipes", "agents"]) {
      assert.equal(contributes[instructional], undefined, `${instructional} would bind approval to the panel's bytes`);
    }
  });

  it("catches a pluginApi the host would reject", () => {
    const manifest = shipped();
    manifest.pluginApi = 2;
    assert.deepEqual(manifestIssues(manifest), ["pluginApi must be 1"]);
  });

  it("catches a main file that is not there", () => {
    const manifest = shipped();
    manifest.main = "renamed.mjs";
    assert.ok(manifestIssues(manifest).includes("missing file renamed.mjs"));
  });

  it("catches a capability the host does not have", () => {
    const manifest = shipped();
    manifest.capabilities = [...manifest.capabilities, { kind: "net:fetch" }];
    assert.ok(manifestIssues(manifest).includes("unknown capability net:fetch"));
  });

  it("catches a contribution the host does not have", () => {
    const manifest = shipped();
    manifest.contributes.views = [];
    assert.ok(manifestIssues(manifest).includes("contributes.views is not a contribution"));
  });

  it("catches a keybinding on a command that does not exist", () => {
    const manifest = shipped();
    manifest.contributes.keybindings = [{ command: "report-open", key: "Mod+Alt+X" }];
    manifest.contributes.commands = manifest.contributes.commands.filter((c) => c.id !== "report-open");
    assert.ok(manifestIssues(manifest).includes("keybinding report-open is not a contributed command"));
  });

  it("catches two commands on one key", () => {
    const manifest = shipped();
    manifest.contributes.keybindings = [
      { command: "report-open", key: "Mod+Alt+X" },
      { command: "report-status", key: "Mod+Alt+X" },
    ];
    assert.ok(manifestIssues(manifest).includes("duplicate keybinding Mod+Alt+X: report-open and report-status"));
  });

  it("says nothing about a manifest that ships no panels and no capabilities", () => {
    const manifest = shipped();
    delete manifest.contributes.panels;
    delete manifest.capabilities;
    assert.deepEqual(manifestIssues(manifest), []);
  });
});

describe("orca plugin — it speaks once when a day lands", async () => {
  const worker = await import(WORKER);

  const DAYS_TODAY = { dates: ["2026-09-16", "2026-09-17"], recent: [], calendar: [] };
  const MOVEMENT = { days: 3, movement: [{ latestScore: 80 }, { latestScore: null }], todos: [] };
  const stored = (value) => ({ "storage.get": { ok: true, value: { value } } });
  const quiet = { "settings.get": { ok: true, value: { settings: { notifyOnNewDay: false } } } };

  const setDay = (host) =>
    host.calls.find((call) => call.method === "storage.set" && call.params.key === "lastSeenDay");

  /** The report answering with today, and nothing else. */
  const reportRoutes = () => [
    { url: `${ORIGIN}/api/days`, body: DAYS_TODAY },
    { url: `${ORIGIN}/api/movement`, body: MOVEMENT },
  ];

  /** A plugin whose store already holds yesterday, so today is news. */
  function armed({ answers = {}, routes = [] } = {}) {
    const host = makeHost({ ...stored("2026-09-16"), ...answers });
    const fetchStub = makeFetch([
      ...reportRoutes(),
      { url: `${ORIGIN}/api/open`, method: "POST", body: OPENED },
      ...routes,
    ]);
    const instance = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });
    instance.register();
    return { host, fetchStub, run: (id) => host.commands.get(id)(), check: () => instance.check() };
  }

  it("names the day, the record length and what was scored", () => {
    const notice = worker.newDayNotice({ previous: "2026-09-16", newest: "2026-09-17", movement: MOVEMENT });
    assert.equal(notice.body, "2026-09-17 is in · 3 days recorded · 1 skill scored");
  });

  it("says nothing when the day is the one already announced", () => {
    assert.equal(worker.newDayNotice({ previous: "2026-09-17", newest: "2026-09-17", movement: MOVEMENT }), null);
  });

  it("says nothing when the report holds no day", () => {
    assert.equal(worker.newDayNotice({ previous: "2026-09-16", newest: null, movement: MOVEMENT }), null);
  });

  it("still names the day when the movement could not be read", () => {
    const notice = worker.newDayNotice({ previous: "2026-09-16", newest: "2026-09-17", movement: null });
    assert.match(notice.body, /2026-09-17 is in/);
    assert.doesNotMatch(notice.body, /undefined|NaN/);
  });

  it("announces once, and only once", async () => {
    const { host, run } = armed();

    await run("report-status");
    assert.equal(host.notifications.length, 2, "the new day, then the status");
    assert.match(host.notifications[0].body, /2026-09-17 is in/);

    const second = armed();
    await second.run("report-status");
    assert.equal(second.host.notifications.length, 2, "yesterday's store is untouched in this fixture");
  });

  it("says nothing on a first look, and remembers the day it saw", async () => {
    const host = makeHost({});
    const instance = worker.createPlugin({ orca: host.orca, fetch: makeFetch(reportRoutes()) });

    const result = await instance.check();

    assert.equal(result.checked, true);
    assert.deepEqual(host.notifications, [], "nothing has landed for this reader yet");
    assert.equal(setDay(host).params.value, "2026-09-17");
  });

  it("remembers the day even when the reader has turned notifications off", async () => {
    const { host, run } = armed({ answers: quiet });

    await run("report-status");

    assert.equal(host.notifications.length, 1, "only the status was shown");
    assert.match(host.notifications[0].body, /up at/);
    assert.equal(setDay(host).params.value, "2026-09-17");
  });

  it("announces a leap of several days once, naming the newest", async () => {
    const { host, run } = armed({ answers: stored("2026-09-14") });

    await run("report-status");

    const announced = host.notifications.filter((entry) => /is in/.test(entry.body));
    assert.equal(announced.length, 1);
    assert.match(announced[0].body, /2026-09-17 is in/);
    assert.doesNotMatch(announced[0].body, /2026-09-15/);
  });

  it("stays silent when the report is not answering, and remembers nothing", async () => {
    const host = makeHost({ ...stored("2026-09-16") });
    const instance = worker.createPlugin({ orca: host.orca, fetch: refusing() });

    const result = await instance.check();

    assert.equal(result.checked, false);
    assert.equal(host.notifications.length, 0);
    assert.equal(setDay(host), undefined);
  });

  it("runs before open and before refresh, not only before status", async () => {
    const opened = armed();
    await opened.run("report-open");
    assert.match(opened.host.notifications[0].body, /2026-09-17 is in/);

    const refreshed = armed({
      routes: [
        {
          url: `${ORIGIN}/api/refresh`,
          body: { ok: true, day: "2026-09-17", packs: ["2026-09-17"], skills: 11, inUse: 4 },
        },
      ],
    });
    await refreshed.run("report-refresh");
    assert.match(refreshed.host.notifications[0].body, /2026-09-17 is in/);
    assert.match(refreshed.host.notifications[1].body, /recorded/);
  });

  it("shows the new day even when the store refuses to be written", async () => {
    const host = makeHost({
      ...stored("2026-09-16"),
      "storage.set": { ok: false, code: "capability_denied", error: "storage was not granted" },
    });
    const fetchStub = makeFetch(reportRoutes());
    const instance = worker.createPlugin({ orca: host.orca, fetch: fetchStub, bake: noBake });

    const result = await instance.check();

    assert.equal(result.checked, true);
    assert.equal(host.notifications.length, 1);
    assert.match(host.logs.join("\n"), /storage was not granted/);
  });
});

describe("orca plugin — Orca's events wake the check, and a down server is silence", async () => {
  const worker = await import(WORKER);

  const DAYS_TODAY = { dates: ["2026-09-16", "2026-09-17"], recent: [], calendar: [] };
  const MOVEMENT = { days: 3, movement: [{ latestScore: 80 }], todos: [] };
  const stored = (value) => ({ "storage.get": { ok: true, value: { value } } });
  const manifest = () => JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  /** A plugin wired into Orca, with a clock the test owns. */
  function wired({ answers = {}, fetch: fetchImpl, clock = { at: 0 } } = {}) {
    const host = makeHost({ ...stored("2026-09-16"), ...answers });
    const fetchStub =
      fetchImpl ??
      makeFetch([
        { url: `${ORIGIN}/api/days`, body: DAYS_TODAY },
        { url: `${ORIGIN}/api/movement`, body: MOVEMENT },
      ]);
    const instance = worker.createPlugin({
      orca: host.orca,
      fetch: fetchStub,
      now: () => clock.at,
      intervalMs: 1000,
    });
    instance.register();
    return {
      host,
      clock,
      fetchStub,
      emit: (name, payload) => host.events.get(name)(payload),
      probes: () => fetchStub.calls.filter((call) => call.href.endsWith("/api/days")).length,
      logs: () => host.logs.join("\n"),
    };
  }

  it("contributes all three events, and the capability to hear them", () => {
    assert.deepEqual(manifest().contributes.events, [
      { on: "worktree.created" },
      { on: "worktree.removed" },
      { on: "agent.status.changed" },
    ]);
    assert.ok(manifest().capabilities.some((entry) => entry.kind === "events:subscribe"));
  });

  it("checks once when events arrive, and not again inside the interval", async () => {
    const { emit, probes } = wired();

    await emit("worktree.created", { worktreeId: "w1", path: "/repo/one", branch: "main" });
    await emit("agent.status.changed", { worktreeId: "w1", paneKey: "p1", state: "running" });
    await emit("agent.status.changed", { worktreeId: "w1", paneKey: "p1", state: "idle" });

    assert.equal(probes(), 1);
  });

  it("reports how many events it coalesced when the window closes", async () => {
    const { emit, probes, logs, clock } = wired();

    await emit("worktree.created", { worktreeId: "w1", path: "/repo/one", branch: "main" });
    await emit("agent.status.changed", { worktreeId: "w1", paneKey: "p1", state: "running" });
    await emit("agent.status.changed", { worktreeId: "w1", paneKey: "p1", state: "idle" });

    clock.at = 2000;
    await emit("agent.status.changed", { worktreeId: "w1", paneKey: "p1", state: "running" });

    assert.equal(probes(), 2);
    assert.match(logs(), /2 events coalesced/);
  });

  it("notes a worktree path once, however many times it hears about it", async () => {
    const { emit, logs } = wired();

    await emit("worktree.created", { worktreeId: "w1", path: "/repo/one", branch: "main" });
    await emit("worktree.removed", { worktreeId: "w1", path: "/repo/one" });

    assert.equal(logs().split("/repo/one").length - 1, 1);
  });

  it("stays silent when the report is not answering, and logs one line per distinct reason", async () => {
    const refusingStub = async (url) => {
      refusingStub.calls.push({ href: String(url) });
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { code: "ECONNREFUSED" });
    };
    refusingStub.calls = [];
    const { emit, host } = wired({ fetch: refusingStub });

    await emit("worktree.created", { worktreeId: "w1", path: "/repo/one", branch: "main" });
    await emit("agent.status.changed", { worktreeId: "w1", paneKey: "p1", state: "idle" });

    assert.equal(host.notifications.length, 0);
    const failures = host.logs.filter((line) => /not answering|could not be reached/.test(line));
    assert.equal(failures.length, 1);

    const stranger = wired({
      fetch: makeFetch([{ url: `${ORIGIN}/api/days`, body: "hello", contentType: "text/html" }]),
    });
    await stranger.emit("worktree.created", { worktreeId: "w2", path: "/repo/two", branch: "main" });
    assert.equal(stranger.host.notifications.length, 0, "an event never notifies");
  });

  it("does not start a second check while one is in flight", async () => {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const slow = async (url) => {
      slow.calls.push({ href: String(url) });
      await held;
      return respond({ dates: DAYS_TODAY.dates, recent: [], calendar: [] });
    };
    slow.calls = [];
    const { emit, probes } = wired({ fetch: slow });

    const first = emit("worktree.created", { worktreeId: "w1", path: "/repo/one", branch: "main" });
    await emit("agent.status.changed", { worktreeId: "w1", paneKey: "p1", state: "idle" });
    release();
    await first;

    assert.equal(probes(), 1);
  });

  it("says nothing at all when no event arrives", async () => {
    const { fetchStub, host } = wired();

    assert.equal(fetchStub.calls.length, 0);
    assert.deepEqual(host.notifications, []);
    const source = fs.readFileSync(WORKER, "utf8");
    assert.doesNotMatch(source, /\bsetInterval\s*\(/, "an interval outlives the command that opened it");
    assert.equal(
      [...source.matchAll(/\bsetTimeout\s*\(/g)].length,
      1,
      "the only wait is the bounded one that waits for a server this worker just started"
    );
  });

  it("keeps checking after a check that threw", async () => {
    const clock = { at: 0 };
    let calls = 0;
    const check = worker.makeEventCheck({
      now: () => clock.at,
      log: () => {},
      intervalMs: 1000,
      check: async () => {
        calls += 1;
        if (calls === 1) throw new Error("the movement read exploded");
      },
    });

    await assert.rejects(check(), /exploded/);
    clock.at = 2000;
    await check();

    assert.equal(calls, 2, "one bad check must not wedge the plugin");
  });
});

describe("orca plugin — the panel tab", async () => {
  const PANEL = path.join(PLUGIN, "panel.html");
  const SIGNPOST = path.join(PLUGIN, "panel-fallback.html");
  const manifest = () => JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const gitignore = () => fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");

  /** The panel a reader sees: the app once a bake has rendered the record in, null while it is the signpost. */
  function bakedPanel() {
    if (!fs.existsSync(PANEL)) return null;
    const html = fs.readFileSync(PANEL, "utf8");
    return html.includes("window.__REPORT__") ? html : null;
  }

  it("is contributed as a panel named after the plugin", () => {
    assert.deepEqual(manifest().contributes.panels, [
      { id: "report", title: "x-skills report", icon: "activity", entry: "panel.html" },
    ]);
  });

  it("is committed, because a declared artifact Orca cannot resolve is a plugin that does not load", () => {
    assert.doesNotMatch(gitignore(), /^\/tools\/orca-plugin\/panel\.html$/m, "the panel entry is tracked");
    assert.ok(fs.existsSync(PANEL), "so every checkout has the file the manifest declares, baked or not");
    assert.equal(manifest().contributes.panels[0].entry, "panel.html");
  });

  it("is the signpost until the record has been rendered into it", () => {
    assert.ok(fs.existsSync(SIGNPOST), "the not-yet-baked panel is a committed document");

    const html = fs.readFileSync(SIGNPOST, "utf8");
    assert.match(html, /127\.0\.0\.1:8787/, "it names the live report");
    assert.match(html, /x-skills report: Open/, "and how to open it without a keybinding");
    assert.match(html, /x-skills report: Console/, "and that a pane can be live and writable");
    assert.doesNotMatch(html, /Mod\+Alt\+X|⌘⌥X/, "there is no keybinding to advertise any more");
    assert.doesNotMatch(html, /window\.__REPORT__/, "the signpost carries no record");
    for (const external of [
      /<script[^>]+\bsrc=/i,
      /<link[^>]+\bhref="(?!data:)/i,
      /@import/i,
      /url\(\s*["']?(https?:|\/\/)/i,
    ]) {
      assert.doesNotMatch(html, external, "the panel policy is default-src 'none'");
    }
    assert.deepEqual([...new Set([...html.matchAll(/call\(\s*"([^"]+)"/g)].map((m) => m[1]))], ["workspace.readContext"]);

    // The committed panel starts as this document, so a clone that has not baked still shows a reader where the
    // report is. A checkout that has baked carries the app instead, and the baker's tests cover that.
    if (bakedPanel() === null) {
      assert.equal(fs.readFileSync(PANEL, "utf8"), html, "an unbaked panel is the signpost, byte for byte");
    }
  });

  it("is the app on a snapshot once it is baked: one file, no external reference", () => {
    const html = bakedPanel();
    if (html === null) return; // the baker, and its tests, live in test/report-app.test.cjs

    assert.match(html, /window\.__REPORT__ = \{/, "the snapshot the app answers from");
    assert.match(html, /"\/api\/movement"/);
    for (const external of [
      /<script[^>]+\bsrc=/i,
      /<link[^>]+\bhref="(?!data:)/i,
      /@import/i,
      /url\(\s*["']?(https?:|\/\/)/i,
    ]) {
      assert.doesNotMatch(html, external, "the panel policy is default-src 'none'");
    }
  });

  it("hands a link that lost its href the pointer its role promises", () => {
    const html = bakedPanel();
    if (html === null) return;
    // The host swallows clicks on `<a href>`, so the panel's links carry a role instead — and a browser gives
    // an anchor without an href the text cursor, which is what "every button shows an I-beam" was.
    assert.match(html, /a\[role=["']?link["']?\]\s*\{[^}]*cursor:\s*pointer/);
  });
});

describe("orca plugin — the worker bakes the panel too", async () => {
  const worker = await import(WORKER);
  const log = () => {};

  const focused = (path) => ({ code: 0, stdout: JSON.stringify({ result: { worktree: path ? { path } : null } }), stderr: "" });
  const context = (branch) => ({ "workspace.readContext": { ok: true, value: { branch, displayName: "x", terminals: [] } } });

  it("asks Orca which worktree is focused, never which one shares the branch", async () => {
    const host = makeHost(context("refs/heads/main"));
    const commands = [];

    const root = await worker.findReportRoot({
      orca: host.orca,
      own: {},
      log,
      run: (command, args) => {
        commands.push([command, ...args].join(" "));
        return focused("/wanted");
      },
    });

    assert.equal(root, "/wanted");
    assert.match(commands.join("\n"), /worktree show --worktree active --json/);
    assert.doesNotMatch(commands.join("\n"), /worktree list/);
    assert.equal(
      host.calls.find((call) => call.method === "storage.set").params.value,
      "/wanted",
      "so the next wake does not ask again"
    );
  });

  it("takes a root the reader set without asking the CLI at all", async () => {
    const host = makeHost(context("refs/heads/main"));
    let asked = 0;

    const root = await worker.findReportRoot({
      orca: host.orca,
      own: { reportRoot: "/configured" },
      log,
      run: () => {
        asked += 1;
        return focused("/repo");
      },
    });

    assert.equal(root, "/configured");
    assert.equal(asked, 0);
  });

  it("remembers what it found, so a later wake is one storage read", async () => {
    const host = makeHost({
      ...context("refs/heads/main"),
      "storage.get": { ok: true, value: { value: "/remembered" } },
    });
    let asked = 0;

    const root = await worker.findReportRoot({
      orca: host.orca,
      own: {},
      log,
      run: () => {
        asked += 1;
        return focused("/repo");
      },
    });

    assert.equal(root, "/remembered");
    assert.equal(asked, 0);
  });

  it("says so, and bakes nothing, when Orca has no focused worktree to name", async () => {
    const host = makeHost(context("refs/heads/main"));
    const said = [];

    const root = await worker.findReportRoot({
      orca: host.orca,
      own: {},
      log: (line) => said.push(line),
      run: () => ({ code: 1, stdout: "", stderr: "no active worktree" }),
    });

    assert.equal(root, null);
    assert.match(said.join("\n"), /could not ask Orca for the focused worktree: no active worktree/);
  });

  it("bakes through the repository's own baker, at the paths the report lives at", async () => {
    const host = makeHost(context("refs/heads/main"));
    const calls = [];

    const result = await worker.bakePanel({
      orca: host.orca,
      own: { reportRoot: "/repo" },
      log,
      loadBaker: async (root) => {
        calls.push(root);
        return {
          bakeIfStale: (args) => {
            calls.push(args);
            return { baked: true, stamp: "2026-09-17:1:2" };
          },
        };
      },
    });

    assert.deepEqual(calls, [
      "/repo",
      {
        root: path.join("/repo", ".x-skills", "daily"),
        dist: path.join("/repo", "tools", "report-app", "dist-panel"),
        out: path.join("/repo", "tools", "orca-plugin", "panel.html"),
      },
    ]);
    assert.equal(result.baked, true);
  });

  it("survives a baker that throws, and says why", async () => {
    const host = makeHost(context("refs/heads/main"));
    const said = [];

    const result = await worker.bakePanel({
      orca: host.orca,
      own: { reportRoot: "/repo" },
      log: (line) => said.push(line),
      loadBaker: async () => ({
        bakeIfStale: () => {
          throw new Error("no built panel in dist-panel");
        },
      }),
    });

    assert.equal(result.baked, false);
    assert.match(said.join("\n"), /could not bake the panel: no built panel in dist-panel/);
  });

  it("runs the Orca CLI, and never a server of its own", () => {
    const source = fs.readFileSync(WORKER, "utf8");
    for (const own of [/(?<!Sync)\bspawn\s*\(/, /\bexec\s*\(/, /\bexecFile\s*\(/, /\bfork\s*\(/, /\bcreateServer\s*\(/, /\.listen\s*\(/]) {
      assert.doesNotMatch(source, own, "the plugin asks Orca; it does not become a server");
    }
  });
});
