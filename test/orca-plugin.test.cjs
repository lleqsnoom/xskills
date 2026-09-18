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

/** The method table `orca.host.call` answers from, with every call recorded. */
function hostCaller(answers, calls, notifications) {
  return async (method, params) => {
    calls.push({ method, params });
    if (method === "notifications.show") {
      notifications.push(params);
      return { ok: true, value: { delivered: true } };
    }
    const answer = answers[method];
    if (answer === undefined) return { ok: false, code: "unknown_method", error: method };
    return typeof answer === "function" ? answer(params) : answer;
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
    worker.default(host.orca, { fetch: makeFetch([]) });

    assert.ok(host.commands.has("report-open"), "the palette entry this layer promised");
    assert.match(host.logs.join("\n"), new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("probes the report and reads its newest day", async () => {
    const host = makeHost();
    const fetchStub = makeFetch([{ url: `${ORIGIN}/api/days`, body: DAYS }]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

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
      { url: `${ORIGIN}/api/days`, body: { dates: [], recent: [], calendar: [] } },
      { url: `${ORIGIN}/api/open`, method: "POST", body: OPENED },
    ]);
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

    assert.deepEqual(await plugin.probe(), { up: true, origin: ORIGIN, day: null, dates: [] });
    await plugin.open();
    assert.equal(fetchStub.calls.filter((call) => call.method === "POST").length, 1);
  });

  it("says what to run when nothing answers", async () => {
    const host = makeHost();
    const fetchStub = refusing();
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
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

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
    const plugin = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

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
  function plugin({ answers = {}, routes = [], fetch: fetchImpl, url } = {}) {
    const host = makeHost(answers);
    const fetchStub = fetchImpl ?? makeFetch(routes);
    const instance = worker.createPlugin({ orca: host.orca, fetch: fetchStub, url });
    instance.register();
    return { host, fetchStub, run: (id) => host.commands.get(id)() };
  }

  it("registers all four commands", () => {
    const { host } = plugin();
    assert.deepEqual([...host.commands.keys()], [
      "report-open",
      "report-status",
      "report-refresh",
      "report-start",
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

  it("starts the server in a terminal, and says which one", async () => {
    const { host, run } = plugin({
      answers: {
        "workspace.readContext": { ok: true, value: { branch: "main", displayName: "xskills", terminals: [{ id: "term_1" }] } },
        "terminal.sendText": { ok: true, value: { accepted: true } },
      },
    });

    await run("report-start");

    const sent = host.calls.find((call) => call.method === "terminal.sendText");
    assert.deepEqual(sent.params, { terminalId: "term_1", text: "npm run report", enter: true });
    assert.match(host.notifications[0].body, /term_1/);
  });

  it("sends to exactly one terminal when there are several", async () => {
    const terminals = [{ id: "term_1" }, { id: "term_2" }, { id: "term_3" }];
    const { host, run } = plugin({
      answers: {
        "workspace.readContext": { ok: true, value: { branch: "main", displayName: "x", terminals } },
        "terminal.sendText": { ok: true, value: { accepted: true } },
      },
    });

    await run("report-start");

    const sent = host.calls.filter((call) => call.method === "terminal.sendText");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].params.terminalId, "term_1");
    assert.match(host.notifications[0].body, /term_1/);
  });

  it("sends nothing when there is no worktree to send to", async () => {
    for (const answer of [
      { ok: false, code: "capability_denied", error: "workspace:read was not granted" },
      { ok: true, value: null },
    ]) {
      const { host, run } = plugin({ answers: { "workspace.readContext": answer } });

      await run("report-start");

      assert.equal(host.calls.some((call) => call.method === "terminal.sendText"), false);
      assert.match(host.notifications[0].body, /no worktree is focused/i);
    }
  });

  it("sends nothing when the worktree has no terminal", async () => {
    const { host, run } = plugin({
      answers: { "workspace.readContext": { ok: true, value: { branch: "main", displayName: "x", terminals: [] } } },
    });

    await run("report-start");

    assert.equal(host.calls.some((call) => call.method === "terminal.sendText"), false);
    assert.match(host.notifications[0].body, /no terminal/i);
  });

  it("repeats the host's own reason when the terminal refuses the text", async () => {
    const { host, run } = plugin({
      answers: {
        "workspace.readContext": { ok: true, value: { branch: "main", displayName: "x", terminals: [{ id: "term_1" }] } },
        "terminal.sendText": { ok: false, code: "invalid_params", error: "text: too long" },
      },
    });

    await run("report-start");

    assert.equal(host.calls.filter((call) => call.method === "terminal.sendText").length, 1);
    assert.match(host.notifications[0].body, /text: too long/);
  });

  it("never spawns a process", () => {
    const source = require("node:fs").readFileSync(WORKER, "utf8");
    for (const call of ["spawn", "exec", "execSync", "execFile", "fork"]) {
      assert.doesNotMatch(source, new RegExp(`\\b${call}\\s*\\(`), `main.mjs must not call ${call}()`);
    }
  });
});

describe("orca plugin — the manifest and the key it answers to", async () => {
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

  it("puts the report on Mod+Alt+X", () => {
    assert.deepEqual(shipped().contributes.keybindings, [
      { command: "report-open", key: "Mod+Alt+X", when: "global" },
    ]);
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
    const instance = worker.createPlugin({ orca: host.orca, fetch: fetchStub });
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
    const instance = worker.createPlugin({ orca: host.orca, fetch: fetchStub });

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
    for (const timer of ["setTimeout", "setInterval"]) {
      assert.doesNotMatch(source, new RegExp(`\\b${timer}\\s*\\(`), `the worker must not keep a ${timer}`);
    }
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

describe("orca plugin — the panel is a document, and the plugin is a tree nobody writes to", async () => {
  const PANEL = path.join(PLUGIN, "panel.html");
  const manifest = () => JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const gitignore = () => fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  const panel = () => fs.readFileSync(PANEL, "utf8");
  const worker = () => fs.readFileSync(WORKER, "utf8");
  const posted = () => [...panel().matchAll(/call\(\s*"([^"]+)"/g)].map((match) => match[1]);

  it("is contributed as a panel named after the plugin", () => {
    assert.deepEqual(manifest().contributes.panels, [
      { id: "report", title: "x-skills report", icon: "plug", entry: "panel.html" },
    ]);
  });

  it("is committed, so the panel a reader runs is the panel that was reviewed", () => {
    assert.ok(fs.existsSync(PANEL), "the panel ships with the plugin");
    assert.doesNotMatch(gitignore(), /panel\.html/, "nothing in this plugin is generated at install time");
  });

  it("is never written by a run: a plugin is a content-hashed tree", () => {
    // Orca's consent fingerprint covers the hash of every file in a plugin tree that contributes instructional
    // content (this one has a keybinding), so a run that rewrote one of them would ask the reader to approve
    // the plugin again — "reinstall on a data change". Nothing here may write, and nothing bakes.
    const writes = [/writeFile/, /mkdirSync/, /\brm\s*\(/, /report-panel/, /dist-panel/, /node:fs/, /node:path/];
    for (const write of writes) {
      assert.doesNotMatch(worker(), write, "the worker may not touch a file");
    }
    // The server writes — that is the to-do selection — but not into the plugin, and it has no baker to run.
    const server = fs.readFileSync(path.join(ROOT, "scripts", "report-server.mjs"), "utf8");
    for (const bake of [/orca-plugin/, /panel\.html/, /report-panel/, /dist-panel/]) {
      assert.doesNotMatch(server, bake, "nothing generates the prompt's panel");
    }
    const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
    assert.equal(scripts["report:panel"], undefined, "there is no baker to run");
  });

  it("carries no copy of the record, and no way to fetch one", () => {
    const html = panel();
    assert.doesNotMatch(html, /window\.__REPORT__/, "a snapshot in here would be stale the moment it was written");
    assert.doesNotMatch(html, /["'`]\/api\//, "a panel has connect-src 'none', so it cannot ask for data");
    for (const external of [
      /<script[^>]+\bsrc=/i,
      /<link[^>]+\bhref="(?!data:)/i,
      /@import/i,
      /url\(\s*["']?(https?:|\/\/)/i,
    ]) {
      assert.doesNotMatch(html, external, "the panel policy is default-src 'none'");
    }
  });

  it("posts only the one action a panel may safely post", () => {
    assert.deepEqual([...new Set(posted())], ["workspace.readContext"]);
    assert.match(panel(), /orca-panel-action-result/);
  });

  it("says where the report is, and that the pane is not it", () => {
    const html = panel();
    assert.match(html, /127\.0\.0\.1:8787/, "the address the report is served at");
    assert.match(html, /cannot write/, "a pane cannot write, and the panel says so rather than offering a button");
    assert.doesNotMatch(html, /<button\b/, "the host cannot tell a shell from an agent session, so it types into nothing");
  });

  it("names the two ways to open the report for real", () => {
    const html = panel();
    assert.match(html, /x-skills report: Open/);
    assert.match(html, /Ctrl\+J/);
    assert.match(html, /Ctrl\+Alt\+X/);
    assert.match(html, /“J|⌘J/);
  });

  it("has words for every state it can be in", () => {
    const html = panel();
    for (const state of ["Reading the focused worktree", "No worktree is focused"]) {
      assert.ok(html.includes(state), `the panel needs the state: ${state}`);
    }
    assert.match(html, /displayName/);
    assert.match(html, /branch/);
  });

  it("keeps the panel's type and spacing scales", () => {
    const html = panel();
    for (const size of [...html.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]))) {
      assert.ok([12, 14, 16].includes(size), `${size}px is off the panel's type scale`);
    }
  });
});

describe("orca plugin — the worker asks, and writes nothing", async () => {
  const worker = await import(WORKER);
  const source = () => fs.readFileSync(WORKER, "utf8");

  it("runs no process, and never becomes a server of its own", () => {
    for (const own of [/(?<!Sync)\bspawn\s*\(/, /\bexec\s*\(/, /\bexecFile\s*\(/, /\bfork\s*\(/, /\bcreateServer\s*\(/, /\.listen\s*\(/]) {
      assert.doesNotMatch(source(), own, "the plugin asks Orca; it does not become a server");
    }
  });

  it("imports nothing that could touch a file", () => {
    assert.doesNotMatch(source(), /node:child_process/);
    assert.doesNotMatch(source(), /node:fs/);
    assert.doesNotMatch(source(), /node:path/);
  });

  it("is a client of the live report, at the one address it may talk to", () => {
    assert.match(source(), /DEFAULT_URL = "http:\/\/127\.0\.0\.1:8787"/);
    assert.equal(typeof worker.loopbackOrigin, "function");
    assert.equal(typeof worker.createPlugin, "function");
  });
});
