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

/**
 * The report's own payload, or null.
 *
 * `GET /api/days` is how the worker tells the report from a stranger that happens to hold the port: a 200 is
 * not evidence on its own.
 */
export function readDays(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.dates)) return null;
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
    return { up: false, origin, reason };
  }
  if (!response.ok) return { up: false, origin, reason: `${origin} answered ${response.status}` };
  const days = readDays(await readJson(response));
  if (!days) return { up: false, origin, reason: `${origin} answered, but not the report` };
  return { up: true, origin, day: days.day };
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
async function openReport({ origin, request, timeoutMs, notify, log }) {
  const found = await probeReport({ origin, request, timeoutMs });
  if (!found.up) {
    await notify(`not answering at ${origin} — run: npm run report`);
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

export function createPlugin({
  orca,
  fetch: fetchImpl = fetch,
  url = DEFAULT_URL,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const origin = url;
  const request = makeRequest({ origin, fetchImpl, timeoutMs });
  const log = (message) => orca.log(`${NAME}: ${message}`);
  const notify = (body) => orca.host.call("notifications.show", { title: NAME, body });
  const report = { origin, request, timeoutMs, notify, log };
  const open = () => openReport(report);

  return {
    origin,
    probe: () => probeReport(report),
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
