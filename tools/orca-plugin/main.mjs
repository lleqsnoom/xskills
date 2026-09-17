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

const DAYS_PATH = "/api/days";
const OPEN_PATH = "/api/open";
const NAME = "x-skills report";
const TIMEOUT_NAMES = new Set(["AbortError", "TimeoutError"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

/** The shape `GET /api/days` has, and the only shape the worker accepts as the report. */
const DAYS_SHAPE = [
  (payload) => Array.isArray(payload.dates),
  (payload) => payload.dates.every((day) => typeof day === "string" && DATE.test(day)),
  (payload) =>
    Boolean(payload.calendar) && typeof payload.calendar === "object" && !Array.isArray(payload.calendar),
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

/** The one place a request leaves the worker: JSON, and never without a deadline. */
function makeRequest({ origin, fetchImpl, timeoutMs }) {
  return (path, options = {}) =>
    fetchImpl(`${origin}${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
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
  return { up: true, origin, day: days.day };
}

/** What to tell the reader when the report is not there, in the words each cause deserves. */
function notFoundMessage({ kind, origin }) {
  if (kind === "wrong-service") {
    return `${origin} answered, but not the report — something else is using that port`;
  }
  return `not answering at ${origin} — run: npm run report`;
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
function bindReport({ orca, fetchImpl, url, timeoutMs }) {
  const allowed = loopbackOrigin(url);
  return {
    origin: allowed.ok ? allowed.origin : null,
    request: allowed.ok ? makeRequest({ origin: allowed.origin, fetchImpl, timeoutMs }) : null,
    refused: allowed.ok ? null : { up: false, kind: "bad-origin", origin: String(url), reason: allowed.reason },
    timeoutMs,
    log: (message) => orca.log(`${NAME}: ${message}`),
    notify: (body) => orca.host.call("notifications.show", { title: NAME, body }),
  };
}

export function createPlugin({
  orca,
  fetch: fetchImpl = fetch,
  url = DEFAULT_URL,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const report = bindReport({ orca, fetchImpl, url, timeoutMs });
  const open = () => openReport(report);

  return {
    origin: report.origin,
    probe: async () => report.refused ?? probeReport(report),
    open,
    register: () => orca.commands.register("report-open", open),
  };
}

/** Orca's worker entry. The second argument is ours: tests inject a fetch and a timeout. */
export default function activate(orca, deps = {}) {
  const plugin = createPlugin({ orca, ...deps });
  plugin.register();
  orca.log(`${NAME}: worker cwd ${process.cwd()}`);
  return plugin;
}
