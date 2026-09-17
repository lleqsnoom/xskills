#!/usr/bin/env node
/**
 * The Orca plugin's worker: it puts the x-skills report in front of the reader.
 *
 * Orca loads this as a plain Node process (no Electron) when a command runs. Everything Orca-specific about
 * opening the report already lives in `scripts/report-open.mjs`, which the server reaches through
 * `POST /api/open`, so the worker has no tab logic of its own: it asks the server, and the server knows the
 * directory the tab belongs to.
 */

export const DEFAULT_URL = "http://127.0.0.1:8787";
export const PROBE_TIMEOUT_MS = 1500;
export const EVENT_CHECK_INTERVAL_MS = 60_000;

/** The events Orca offers, all three of them: a worktree coming or going, and an agent changing state. */
export const PLUGIN_EVENTS = ["worktree.created", "worktree.removed", "agent.status.changed"];

const DAYS_PATH = "/api/days";
const REFRESH_PATH = "/api/refresh";
const MOVEMENT_PATH = "/api/movement";
const OPEN_PATH = "/api/open";
const NAME = "x-skills report";
const START_TEXT = "npm run report";
const NOTIFY_BODY_LIMIT = 1000;
const TIMEOUT_NAMES = new Set(["AbortError", "TimeoutError"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ADDRESS_KEY = "url";
const LAST_SEEN_KEY = "lastSeenDay";
const NOTIFY_KEY = "notifyOnNewDay";

/** The only hosts the report can live on: the server binds 127.0.0.1, and `localhost` is its other name. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** Each way an address can be wrong, and the sentence that says which one it was. */
const ORIGIN_RULES = [
  {
    broken: (url) => url.protocol !== "http:",
    reason: (url) => `${url.href} is ${url.protocol} — the report is plain http`,
  },
  {
    broken: (url) => Boolean(url.username || url.password),
    reason: (url) => `${url.href} carries credentials`,
  },
  {
    broken: (url) => !LOOPBACK_HOSTS.has(url.hostname),
    reason: (url) => `${url.hostname} is not loopback`,
  },
  {
    broken: (url) => url.pathname !== "/",
    reason: (url) => `${url.href} is an origin plus a path; the route is not ours`,
  },
];

/**
 * The address this plugin is allowed to talk to, or the reason it is not.
 *
 * The check is on the parsed URL and happens before any request, so a mistyped address can never become a call
 * to another machine: everything outside loopback, and everything that is not plain http, is refused here.
 */
export function loopbackOrigin(value) {
  if (typeof value !== "string") return { ok: false, reason: `a url is required, got ${typeof value}` };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: `not a url: ${value}` };
  }
  const violated = ORIGIN_RULES.find((rule) => rule.broken(url));
  return violated ? { ok: false, reason: violated.reason(url) } : { ok: true, origin: url.origin };
}

/**
 * The shape `GET /api/days` has, and the only shape the worker accepts as the report: `dates` as the recorded
 * days, `recent` as their summaries, `calendar` as the months they span. All three are arrays — `calendar` is
 * a list of month objects, not one object — because that is what the server sends.
 */
const DAYS_SHAPE = [
  (payload) => Array.isArray(payload.dates),
  (payload) => payload.dates.every((day) => typeof day === "string" && DATE.test(day)),
  (payload) => Array.isArray(payload.recent),
  (payload) => Array.isArray(payload.calendar),
];

/**
 * The report's own payload, or null.
 *
 * `GET /api/days` is how the worker tells the report from a stranger that happens to hold the port: a 200 is
 * not evidence on its own, and neither is a body that merely parses.
 */
export function readDays(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (!DAYS_SHAPE.every((holds) => holds(payload))) return null;
  return { day: payload.dates.at(-1) ?? null, dates: payload.dates };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** A notification body the host will take: its own limit, honoured here rather than discovered by refusal. */
function trimBody(text) {
  return text.length <= NOTIFY_BODY_LIMIT ? text : `${text.slice(0, NOTIFY_BODY_LIMIT - 1)}…`;
}

const logTo = (orca) => (message) => orca.log(`${NAME}: ${message}`);
const notifyVia = (orca) => (body) =>
  orca.host.call("notifications.show", { title: NAME, body: trimBody(body) });

/** The one place a request leaves the worker: JSON, and never without a deadline. */
function makeRequest({ origin, fetchImpl, timeoutMs }) {
  return (path, options = {}) =>
    fetchImpl(`${origin}${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
}

/**
 * The plugin's own settings, read once per activation: one call serves every key the plugin keeps there.
 * A store that cannot answer is an empty record, so a denied capability costs a default, not a command.
 */
async function readOwnSettings({ orca, log }) {
  try {
    const answer = await orca.host.call("settings.get", {});
    const settings = answer?.ok === true ? answer.value?.settings : null;
    return settings && typeof settings === "object" ? settings : {};
  } catch (error) {
    log(`could not read the settings: ${error?.message ?? error}`);
    return {};
  }
}

/** One of the plugin's own storage keys, or undefined. */
async function readOwnStorage({ orca, key, log }) {
  try {
    return (await orca.host.call("storage.get", { key }))?.value?.value;
  } catch (error) {
    log(`could not read the storage: ${error?.message ?? error}`);
    return undefined;
  }
}

/** A value the reader left for the plugin: their own setting wins, then the plugin's storage. */
async function readOwn({ orca, own, key, log }) {
  const fromSettings = own[key];
  if (fromSettings !== undefined && fromSettings !== null) return fromSettings;
  return readOwnStorage({ orca, key, log });
}

/** Remember a value in the plugin's own storage. A store that refuses is logged, never thrown. */
async function writeStored({ orca, key, value, log }) {
  try {
    const answer = await orca.host.call("storage.set", { key, value });
    if (answer?.ok !== true) log(`could not remember ${key}: ${answer?.error ?? answer?.code ?? "refused"}`);
    return answer?.ok === true;
  } catch (error) {
    log(`could not remember ${key}: ${error?.message ?? error}`);
    return false;
  }
}

/** A boolean the reader can set, read the same way as the address. */
async function resolveFlag({ orca, own, key, fallback, log }) {
  const value = await readOwn({ orca, own, key, log });
  return typeof value === "boolean" ? value : fallback;
}

/**
 * The address to use and which store it came from; a refused candidate is skipped, with its reason logged.
 * An activation passes the settings record it already read; a lone caller lets this read its own.
 */
export async function resolveUrl({ orca, own, log = () => {} }) {
  const settings = own ?? (await readOwnSettings({ orca, log }));
  const sources = [
    { name: "settings", value: settings[ADDRESS_KEY] },
    { name: "storage", value: await readOwnStorage({ orca, key: ADDRESS_KEY, log }) },
  ];
  for (const source of sources) {
    if (source.value === undefined || source.value === null) continue;
    const allowed = loopbackOrigin(source.value);
    if (allowed.ok) return { origin: allowed.origin, source: source.name };
    log(`the ${source.name} holds ${String(source.value)}, refused: ${allowed.reason}`);
  }
  return { origin: DEFAULT_URL, source: "default" };
}

/** Is the report there, and which day is newest? */
async function probeReport({ origin, request, timeoutMs }) {
  let response;
  try {
    response = await request(DAYS_PATH);
  } catch (error) {
    const reason = TIMEOUT_NAMES.has(error?.name)
      ? `timed out after ${timeoutMs}ms waiting for ${origin}`
      : `${origin} could not be reached`;
    return { up: false, kind: "unreachable", origin, reason };
  }
  if (!response.ok) {
    return { up: false, kind: "wrong-service", origin, reason: `${origin} answered ${response.status}` };
  }
  const days = readDays(await readJson(response));
  if (!days) {
    return { up: false, kind: "wrong-service", origin, reason: `${origin} answered, but not the report` };
  }
  return { up: true, origin, day: days.day, dates: days.dates };
}

/** What to tell the reader when the report is not there, in the words each cause deserves. */
function notFoundMessage({ kind, origin }) {
  if (kind === "wrong-service") {
    return `${origin} answered, but not the report — something else is using that port`;
  }
  return `not answering at ${origin} — run: npm run report`;
}

/** One line saying what the report holds, and which of the plugin's stores pointed at it. */
async function reportStatus({ origin, request, timeoutMs, source, notify, refused }) {
  if (refused) {
    await notify(refused.reason);
    return { status: "refused", reason: refused.reason };
  }
  const found = await probeReport({ origin, request, timeoutMs });
  if (!found.up) {
    await notify(notFoundMessage(found));
    return { status: "down", reason: found.reason };
  }
  const held = found.dates.length
    ? `newest day ${found.day} · ${found.dates.length} days recorded`
    : "no day recorded yet";
  await notify(`up at ${origin} (from ${source})\n${held}`);
  return { status: "up", day: found.day };
}

/** The server's answer to a recording request, as either the result or the reason there is none. */
async function refreshAnswer({ origin, request }) {
  let response;
  try {
    response = await request(REFRESH_PATH);
  } catch {
    return { ok: false, kind: "unreachable" };
  }
  const answer = (await readJson(response)) ?? {};
  if (!response.ok || typeof answer.ok !== "boolean") return { ok: false, kind: "wrong-service" };
  return answer.ok ? { ok: true, ...answer } : { ok: false, reason: String(answer.reason ?? "the server did not say why") };
}

/** The sentence a recording deserves, from what the server said. */
function recordedMessage(answer) {
  const packs = Array.isArray(answer.packs) ? answer.packs.length : 0;
  return `recorded ${answer.day} · ${packs} ${packs === 1 ? "pack" : "packs"} · ${answer.inUse} in use`;
}

/** Record the newest day, and repeat what the server said about it. */
async function reportRefresh({ origin, request, notify }) {
  const answer = await refreshAnswer({ origin, request });
  await notify(answer.ok ? recordedMessage(answer) : answer.reason ?? notFoundMessage({ ...answer, origin }));
  return answer.ok ? { recorded: true, day: answer.day } : { recorded: false, reason: answer.reason };
}

/** Where the start command should be typed, or the sentence explaining there is nowhere. */
async function startTarget(orca, log) {
  const context = await readContext(orca, log);
  if (!context) return { reason: "no worktree is focused in Orca, so there is no terminal to start the report in" };
  const terminal = (context.terminals ?? [])[0];
  return terminal ? { terminal } : { reason: "this worktree has no terminal to start the report in" };
}

/** The focused worktree's terminals, or null when nothing is focused. */
async function readContext(orca, log) {
  try {
    const answer = await orca.host.call("workspace.readContext", {});
    return answer?.ok === true ? answer.value : null;
  } catch (error) {
    log(`could not read the workspace context: ${error?.message ?? error}`);
    return null;
  }
}

/**
 * Start the report the reader's way: type the command into a terminal they can see.
 *
 * The plugin has no process of its own to start, so this is the whole of "start" — the server exists because
 * someone ran that command, not because this plugin did.
 */
async function reportStart({ orca, notify, log }) {
  const target = await startTarget(orca, log);
  if (!target.terminal) {
    await notify(target.reason);
    return { sent: false, reason: target.reason };
  }
  const answer = await orca.host.call("terminal.sendText", {
    terminalId: target.terminal.id,
    text: START_TEXT,
    enter: true,
  });
  if (answer?.ok !== true) {
    const reason = answer?.error ?? "the terminal refused the text";
    await notify(reason);
    return { sent: false, reason };
  }
  log(`typed ${START_TEXT} into ${target.terminal.id}`);
  await notify(`sent ${START_TEXT} to ${target.terminal.id} — watch it there`);
  return { sent: true, terminalId: target.terminal.id };
}

/** The server's answer to an open request, as either an opener or a reason to show. */
async function requestOpen({ origin, request }) {
  let response;
  try {
    response = await request(OPEN_PATH, {
      method: "POST",
      body: JSON.stringify({ surface: "orca", path: "/" }),
    });
  } catch (error) {
    return { ok: false, reason: `could not reach ${origin}: ${error?.message ?? error}` };
  }
  const answer = (await readJson(response)) ?? {};
  if (response.ok && answer.ok === true) return { ok: true, surface: answer.surface, how: answer.how };
  return { ok: false, reason: answer.message ?? `${origin} would not open a tab (${response.status})` };
}

/** Ask the server to show the report, and say why when it cannot. */
async function openReport({ origin, request, timeoutMs, notify, log, refused }) {
  if (refused) {
    await notify(refused.reason);
    return { opened: false, reason: refused.reason };
  }
  const found = await probeReport({ origin, request, timeoutMs });
  if (!found.up) {
    await notify(notFoundMessage(found));
    return { opened: false, reason: found.reason };
  }
  const outcome = await requestOpen({ origin, request });
  if (!outcome.ok) {
    await notify(outcome.reason);
    return { opened: false, reason: outcome.reason };
  }
  log(`opened the report in an ${outcome.surface} tab (${outcome.how})`);
  return { opened: true, how: outcome.how };
}

/** Everything a command needs, resolved once per activation. */
async function bindReport({ orca, fetchImpl, url, timeoutMs }) {
  const log = logTo(orca);
  const own = await readOwnSettings({ orca, log });
  const address = url === undefined ? await resolveUrl({ orca, own, log }) : explicitAddress(url);
  return {
    source: address.source,
    origin: address.origin,
    request: address.origin ? makeRequest({ origin: address.origin, fetchImpl, timeoutMs }) : null,
    refused: address.refused ?? null,
    announce: await resolveFlag({ orca, own, key: NOTIFY_KEY, fallback: true, log }),
    timeoutMs,
    log,
    notify: notifyVia(orca),
  };
}

/** An address given to the plugin rather than resolved: the manifest's default, or a test's. */
function explicitAddress(url) {
  const allowed = loopbackOrigin(url);
  return allowed.ok
    ? { origin: allowed.origin, source: "explicit" }
    : { origin: null, refused: { up: false, kind: "bad-origin", origin: String(url), reason: allowed.reason } };
}

/** The movement payload, or null when it could not be read: the notice is worth more than its numbers. */
async function movementFor({ origin, request }) {
  try {
    const response = await request(MOVEMENT_PATH);
    if (!response.ok) return null;
    const payload = await readJson(response);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

/**
 * The sentence a new day deserves, or null when there is nothing to say.
 *
 * A first look is not news: with no day already seen, the reader has just arrived, and the plugin tells them
 * about what lands from then on rather than about the day that was already there.
 */
export function newDayNotice({ previous, newest, movement }) {
  if (typeof previous !== "string" || !newest || newest === previous) return null;
  if (!movement) return { title: NAME, body: `${newest} is in · what it holds is here when you open it` };
  const days = Number(movement.days ?? 0);
  const scored = (movement.movement ?? []).filter((row) => (row?.latestScore ?? null) !== null).length;
  return {
    title: NAME,
    body: `${newest} is in · ${days} ${days === 1 ? "day" : "days"} recorded · ${scored} ${scored === 1 ? "skill" : "skills"} scored`,
  };
}

/** The day worth announcing, if any: what the plugin remembers against what is there now. */
async function pendingNotice({ orca, found, movement, announce, log }) {
  if (!announce) return null;
  const previous = await readOwnStorage({ orca, key: LAST_SEEN_KEY, log });
  return newDayNotice({ previous, newest: found.day, movement });
}

/**
 * Look once, say once. The day is remembered whenever it is seen, announced or not, so turning notifications
 * off does not build a queue that arrives the moment they are turned back on.
 */
export async function checkNewDay({ orca, origin, request, timeoutMs, notify, log, refused, announce = true }) {
  if (refused) return { checked: false, reason: refused.reason };
  const found = await probeReport({ origin, request, timeoutMs });
  if (!found.up) return { checked: false, reason: found.reason };

  const movement = await movementFor({ origin, request });
  const notice = await pendingNotice({ orca, found, movement, announce, log });
  if (notice) await notify(notice.body);
  if (found.day) await writeStored({ orca, key: LAST_SEEN_KEY, value: found.day, log });
  return { checked: true, day: found.day, announced: Boolean(notice) };
}

/** The palette, as Orca sees it: one entry per contributed command. */
function commandTable({ binding, startDeps, orca }) {
  const afterChecking = async (work) => {
    const bound = await binding();
    await checkNewDay({ orca, ...bound });
    return work(bound);
  };

  return {
    "report-open": () => afterChecking(openReport),
    "report-status": () => afterChecking(reportStatus),
    "report-refresh": () => afterChecking(reportRefresh),
    "report-start": async () => reportStart(startDeps),
  };
}

/**
 * One check per interval, whatever the event volume.
 *
 * The newest day changes about once a day and an agent fleet changes state constantly, so the interval is what
 * keeps a busy workspace from becoming a busy plugin. There is no timer here: `now` is read when an event
 * arrives, so a worker that slept cannot drift and nothing keeps its process alive.
 */
/** The window a check opens: one run, then a wait, and a count of what arrived while it waited. */
class CheckWindow {
  constructor({ now, intervalMs }) {
    this.now = now;
    this.intervalMs = intervalMs;
    this.lastRun = -Infinity;
    this.coalesced = 0;
    this.inFlight = false;
  }

  due() {
    return !this.inFlight && this.now() - this.lastRun >= this.intervalMs;
  }

  skip() {
    this.coalesced += 1;
  }

  /** Opens the window, and hands back how many events it swallowed since the last run. */
  open() {
    this.lastRun = this.now();
    this.inFlight = true;
    const swallowed = this.coalesced;
    this.coalesced = 0;
    return swallowed;
  }

  close() {
    this.inFlight = false;
  }
}

export function makeEventCheck({ check, now = Date.now, log, intervalMs = EVENT_CHECK_INTERVAL_MS }) {
  const gate = new CheckWindow({ now, intervalMs });

  return async () => {
    if (!gate.due()) {
      gate.skip();
      return { ran: false };
    }
    const swallowed = gate.open();
    if (swallowed > 0) log(`${swallowed} events coalesced`);
    try {
      await check();
    } finally {
      gate.close();
    }
    return { ran: true };
  };
}

/** A failure that keeps failing is one line, not one per event; a different failure is its own line. */
export function makeFailureLog({ log }) {
  let previous = null;
  return (reason) => {
    if (reason === previous) return false;
    previous = reason;
    log(reason);
    return true;
  };
}

/** The first time a worktree is heard about is the useful time: after that, the path is noise. */
export function makePathNote({ log }) {
  const seen = new Set();
  return ({ path } = {}) => {
    if (!path || seen.has(path)) return false;
    seen.add(path);
    log(`worktree at ${path}`);
    return true;
  };
}

/** Orca's events: the plugin looks when something happens, and stays quiet when nothing is there. */
function subscribeToEvents({ orca, binding, log, now, intervalMs }) {
  const notePath = makePathNote({ log });
  const noteFailure = makeFailureLog({ log });
  const onEvent = makeEventCheck({
    now,
    intervalMs,
    log,
    check: async () => {
      const result = await checkNewDay({ orca, ...(await binding()) });
      if (!result.checked) noteFailure(result.reason);
      return result;
    },
  });

  const handle = async (payload) => {
    notePath(payload);
    await onEvent();
  };
  for (const name of PLUGIN_EVENTS) orca.events.on(name, handle);
}

/** The object a caller drives: one function per decision, without the palette in the way. */
function pluginSurface({ orca, binding, commands, now, intervalMs }) {
  return {
    probe: async () => {
      const report = await binding();
      return report.refused ?? probeReport(report);
    },
    check: async () => checkNewDay({ orca, ...(await binding()) }),
    open: commands["report-open"],
    register: () => {
      for (const [id, handler] of Object.entries(commands)) orca.commands.register(id, handler);
      subscribeToEvents({ orca, binding, log: logTo(orca), now, intervalMs });
    },
  };
}

const startDepsFor = (orca) => ({ orca, notify: notifyVia(orca), log: logTo(orca) });

export function createPlugin({
  orca,
  fetch: fetchImpl = fetch,
  url,
  timeoutMs = PROBE_TIMEOUT_MS,
  now = Date.now,
  intervalMs = EVENT_CHECK_INTERVAL_MS,
} = {}) {
  let pending = null;
  const binding = () => (pending ??= bindReport({ orca, fetchImpl, url, timeoutMs }));
  const commands = commandTable({ binding, orca, startDeps: startDepsFor(orca) });
  return pluginSurface({ orca, binding, commands, now, intervalMs });
}

/** Orca's worker entry. The second argument is ours: tests inject a fetch and a timeout. */
export default function activate(orca, deps = {}) {
  const plugin = createPlugin({ orca, ...deps });
  plugin.register();
  orca.log(`${NAME}: worker cwd ${process.cwd()}`);
  return plugin;
}
