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

const DAYS = { dates: ["2026-09-16", "2026-09-17"], recent: [], calendar: {} };
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
      { url: `${ORIGIN}/api/days`, body: { dates: [], recent: [], calendar: {} } },
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
    assert.deepEqual(worker.readDays({ dates: ["2026-09-16"], calendar: {} }), {
      day: "2026-09-16",
      dates: ["2026-09-16"],
    });
    assert.equal(worker.readDays({ dates: [], calendar: {} }).day, null);
    assert.equal(worker.readDays({ dates: ["2026-9-7"], calendar: {} }), null);
    assert.equal(worker.readDays({ dates: ["2026-09-17"] }), null);
    assert.equal(worker.readDays({ calendar: {} }), null);
    assert.equal(worker.readDays({ dates: [], calendar: [] }), null);
    assert.equal(worker.readDays({ dates: "2026-09-17", calendar: {} }), null);
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

    const body = host.notifications[0].body;
    assert.match(body, /up at http:\/\/127\.0\.0\.1:9000/);
    assert.match(body, /from settings/);
    assert.match(body, /2026-09-17/);
    assert.match(body, /2 days/);
  });

  it("says no day is recorded rather than showing an empty count", async () => {
    const { host, run } = plugin({
      routes: [{ url: `${ORIGIN}/api/days`, body: { dates: [], recent: [], calendar: {} } }],
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

    const body = host.notifications[0].body;
    assert.match(body, /recorded 2026-09-17/);
    assert.match(body, /1 pack\b/);
    assert.match(body, /4 in use/);
  });

  it("repeats the server's own reason verbatim, once", async () => {
    const reason = "no pack under .x-skills/daily; run the collector first";
    const { host, fetchStub, run } = plugin({
      routes: [{ url: `${ORIGIN}/api/refresh`, body: { ok: false, reason } }],
    });

    await run("report-refresh");

    assert.equal(host.notifications[0].body, reason);
    assert.equal(fetchStub.calls.length, 1, "a recording is never retried");
  });

  it("says what to run when refresh finds nothing answering", async () => {
    const { host, fetchStub, run } = plugin({ fetch: refusing() });

    await run("report-refresh");

    assert.match(host.notifications[0].body, /npm run report/);
    assert.equal(fetchStub.calls.length, 1);
  });

  it("truncates a body the host would refuse", async () => {
    const reason = "x".repeat(1500);
    const { host, run } = plugin({
      routes: [{ url: `${ORIGIN}/api/refresh`, body: { ok: false, reason } }],
    });

    await run("report-refresh");

    const body = host.notifications[0].body;
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
