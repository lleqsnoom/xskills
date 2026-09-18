#!/usr/bin/env node
/**
 * The Orca plugin's worker: it puts the x-skills report in front of the reader.
 *
 * Orca loads this as a plain Node process (no Electron) when a command runs. Three things happen here, and
 * each of them is a *client* of the report rather than a copy of it:
 *   - the report is opened through the server's own `POST /api/open`, so the tab logic lives in one place;
 *   - the panel's snapshot is baked by the repository's own baker (`scripts/report-panel.mjs`), so the panel
 *     and the served app are the same build rather than two implementations, and it is re-baked as the record
 *     moves — a panel cannot read anything, so this is where its liveness comes from;
 *   - the day the reader has not seen is announced once, from the server's own answers.
 *
 * The worker runs with no working directory of its own (Orca forks it without one), so where the report lives
 * is *asked for* — Orca knows the focused branch, and its CLI maps a branch to a path.
 */

import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_URL = "http://127.0.0.1:8787";
export const PROBE_TIMEOUT_MS = 1500;
export const EVENT_CHECK_INTERVAL_MS = 60_000;
/** How often the worker asks whether the record moved, while it is alive to hold the panel current. */
export const RECORD_POLL_MS = 2_000;

/** The events Orca offers, all three of them: a worktree coming or going, and an agent changing state. */
export const PLUGIN_EVENTS = ["worktree.created", "worktree.removed", "agent.status.changed"];

const ORCA_CLI = process.env.ORCA_CLI ?? "orca";
const ROOT_KEY = "reportRoot";

const DAYS_PATH = "/api/days";
const REFRESH_PATH = "/api/refresh";
const MOVEMENT_PATH = "/api/movement";
const OPEN_PATH = "/api/open";
const NAME = "x-skills report";
const NOTIFY_BODY_LIMIT = 1000;
const TIMEOUT_NAMES = new Set(["AbortError", "TimeoutError"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ADDRESS_KEY = "url";
const RECORD_DIR = [".x-skills", "daily"];
const CONSOLE_TITLE = "x-skills report";
const CONSOLE_KEY = "consoleTerminal";
const CONSOLE_SCRIPT = ["scripts", "report-console.mjs"];
const SERVER_SCRIPT = ["scripts", "report-server.mjs"];
const SERVER_WAIT_MS = 15_000;
const SERVER_POLL_MS = 250;
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
  orca.host
    .call("notifications.show", { title: NAME, body: trimBody(body) })
    .catch((error) => {
      orca.log(`${NAME}: could not notify: ${error?.message ?? error}`);
      return null;
    });

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
    const settings = answer?.settings;
    return settings && typeof settings === "object" ? settings : {};
  } catch (error) {
    log(`could not read the settings: ${error?.message ?? error}`);
    return {};
  }
}

/** One of the plugin's own storage keys, or undefined. */
async function readOwnStorage({ orca, key, log }) {
  try {
    return (await orca.host.call("storage.get", { key }))?.value;
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

/**
 * Bring the report up, the reader's way: the plugin starts it, and says what happened.
 *
 * This is the one command whose whole job is the server, so it does not wait for a quiet port to notice — it
 * asks the ensurer directly, which resolves the record root, starts the process at most once, and answers
 * either the pid or the sentence explaining why there is nothing to serve.
 */
async function reportStart({ origin, notify, ensure, log }) {
  if (!ensure) {
    const reason = "this report's address was refused, so there is nothing to start at it";
    await notify(reason);
    return { started: false, reason };
  }
  const outcome = await ensure();
  if (!outcome.ok) {
    await notify(outcome.reason);
    return { started: false, reason: outcome.reason };
  }
  const said = outcome.started
    ? `started the report at ${origin} (pid ${outcome.pid})`
    : `the report was already answering at ${origin}`;
  log(said);
  await notify(said);
  return { started: true, pid: outcome.pid ?? null, origin };
}

/** The focused worktree's terminals, or null when nothing is focused. */
async function readContext(orca, log) {
  try {
    const answer = await orca.host.call("workspace.readContext", {});
    return answer ?? null;
  } catch (error) {
    log(`could not read the workspace context: ${error?.message ?? error}`);
    return null;
  }
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

/**
 * The report, up — or the sentence explaining why it is not.
 *
 * A refused address has nothing at it; a port answering as something else is never adopted; a quiet port is the
 * one case that starts a process (through `ensure`, once per activation). What to *do* about a report that is up
 * is the caller's business, which is why this returns rather than opens.
 */
async function reportUp({ origin, request, timeoutMs, refused, ensure = null }) {
  if (refused) return { up: false, reason: refused.reason };

  let found = await probeReport({ origin, request, timeoutMs });
  if (!found.up) found = await bringUpIfQuiet({ origin, request, timeoutMs, found, ensure });
  if (found.up) return { up: true, found };
  return { up: false, reason: found.ensureReason ?? notFoundMessage(found) };
}

/**
 * A quiet port is the one thing that starts a report; anything else is left exactly as it was found.
 *
 * The ensurer's own reason travels with the probe it failed for, because "there is nothing to serve" is a more
 * useful sentence than "it is not answering" when that is why nothing answered.
 */
async function bringUpIfQuiet({ origin, request, timeoutMs, found, ensure }) {
  if (found.kind !== "unreachable" || !ensure) return found;
  const outcome = await ensure();
  if (!outcome.ok) return { ...found, ensureReason: `${outcome.reason} — or run: npm run report` };
  return probeReport({ origin, request, timeoutMs });
}

/** Ask the server to show the report, and say why when it cannot. */
async function openReport({ origin, request, timeoutMs, notify, log, refused, ensure }) {
  const report = await reportUp({ origin, request, timeoutMs, refused, ensure });
  if (!report.up) {
    await notify(report.reason);
    return { opened: false, reason: report.reason };
  }
  const outcome = await requestOpen({ origin, request });
  if (!outcome.ok) {
    await notify(outcome.reason);
    return { opened: false, reason: outcome.reason };
  }
  log(`opened the report in an ${outcome.surface} tab (${outcome.how})`);
  return { opened: true, how: outcome.how };
}

/**
 * The record a checkout would serve, or the sentence explaining there is none.
 *
 * A reader asked for "the JSONs in the current project", so the root is the focused worktree's `.x-skills/daily`
 * and never a path latched at install time: work in another checkout and the report follows.
 */
function recordRootOf(repo, { exists = fs.existsSync } = {}) {
  const root = path.join(repo, ...RECORD_DIR);
  return exists(root)
    ? { root }
    : { root: null, reason: `${repo} has no ${RECORD_DIR.join("/")}, so there is nothing to serve` };
}

/** Which record to serve: the focused worktree's, resolved through Orca rather than guessed. */
export async function resolveRecordRoot({ orca, own = {}, log = () => {}, run: runCommand = run } = {}) {
  const repo = await findReportRoot({ orca, own, log, run: runCommand });
  if (!repo) return { root: null, reason: "no worktree is focused in Orca, so there is no record to read" };
  return recordRootOf(repo);
}

/**
 * The one process this plugin starts: the repository's own report server, detached, on a loopback port.
 *
 * The argv is built here and never from a string, so nothing a reader or a record contains can become a command;
 * the script is resolved out of the record root, so the server that runs is the checkout the record belongs to.
 */
export function startReportServer({
  origin,
  root,
  log = () => {},
  exec = process.execPath,
  spawnImpl = spawn,
  exists = fs.existsSync,
} = {}) {
  const script = path.resolve(root, "..", "..", ...SERVER_SCRIPT);
  if (!exists(script)) return { started: false, reason: `${script} is not there, so ${root} cannot be served` };
  const port = new URL(origin).port || DEFAULT_PORT;
  const child = spawnImpl(exec, [script, "--port", port, "--root", root], { detached: true, stdio: "ignore" });
  child.unref();
  log(`started the report at ${origin} (pid ${child.pid})`);
  return { started: true, pid: child.pid ?? null };
}

/**
 * Bring the report up, or say why it cannot be.
 *
 * One attempt per activation, and only when the probe found the port quiet: an address that answers as
 * something else is never adopted, and a reader who presses Open twice gets one server, not two.
 */
export function makeEnsurer({
  orca,
  origin,
  request,
  timeoutMs,
  own = {},
  log = () => {},
  run: runCommand = run,
  startServer = startReportServer,
  waitMs = SERVER_WAIT_MS,
  pollMs = SERVER_POLL_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let attempt = null;
  return async () => {
    if (attempt) return attempt;
    attempt = ensureOnce({ orca, origin, request, timeoutMs, own, log, runCommand, startServer, waitMs, pollMs, sleep });
    return attempt;
  };
}

async function ensureOnce({ orca, origin, request, timeoutMs, own, log, runCommand, startServer, waitMs, pollMs, sleep }) {
  const record = await resolveRecordRoot({ orca, own, log, run: runCommand });
  if (!record.root) {
    log(record.reason);
    return { ok: false, started: false, reason: record.reason };
  }
  const started = startServer({ origin, root: record.root, log });
  if (!started.started) return { ok: false, started: false, reason: started.reason };

  for (const deadline = Date.now() + waitMs; Date.now() < deadline; await sleep(pollMs)) {
    const found = await probeReport({ origin, request, timeoutMs });
    if (found.up) return { ok: true, started: true, pid: started.pid, day: found.day, root: record.root };
  }
  const reason = `started the report at ${origin} (pid ${started.pid}), but it did not answer within ${Math.round(waitMs / 1000)}s`;
  log(reason);
  return { ok: false, started: true, pid: started.pid, reason };
}

/** The terminals Orca has, as its CLI reports them: a handle, its title, and the checkout it belongs to. */
export function parseTerminals(stdout) {
  try {
    const payload = JSON.parse(stdout);
    const list = payload?.result?.terminals ?? payload?.terminals ?? [];
    return list
      .map((entry) => ({
        handle: entry.handle ?? entry.id ?? null,
        title: entry.title ?? "",
        worktreePath: entry.worktreePath ?? null,
      }))
      .filter((entry) => entry.handle);
  } catch {
    return [];
  }
}

/** The pane this plugin opened: the handle it remembers, or a terminal of ours in this checkout. */
function consoleTerminal(terminals, { remembered = null, worktreePath = null } = {}) {
  const mine = (entry) => entry.title === CONSOLE_TITLE && (!worktreePath || entry.worktreePath === worktreePath);
  return terminals.find((entry) => remembered && entry.handle === remembered && mine(entry)) ?? terminals.find(mine) ?? null;
}

/**
 * The console, in a terminal of its own: created once, then focused.
 *
 * The pane is identified by its title *and* its checkout, because a reader with two worktrees would otherwise
 * get the other one's numbers. The command is built here from absolute paths, so the terminal's own working
 * directory cannot matter.
 */
export function openConsole({ repo, origin, log = () => {}, run: runCommand = run, remembered = null, exists = fs.existsSync } = {}) {
  const script = path.join(repo, ...CONSOLE_SCRIPT);
  if (!exists(script)) return { ok: false, how: "no-console", reason: `${script} is not in ${repo}` };

  const existing = findConsoleTerminal({ repo, remembered, run: runCommand });
  if (existing) return focusConsole({ handle: existing.handle, run: runCommand, log });
  return createConsole({ script, origin, run: runCommand, log });
}

/** The console this plugin already has here, if any: the remembered handle, else one of ours in this checkout. */
function findConsoleTerminal({ repo, remembered, run: runCommand }) {
  const listed = runCommand(ORCA_CLI, ["terminal", "list", "--json"]);
  const terminals = listed.code === 0 ? parseTerminals(listed.stdout) : [];
  return consoleTerminal(terminals, { remembered, worktreePath: repo });
}

/** Bring the pane forward, or say what the CLI said when it would not. */
function focusConsole({ handle, run: runCommand, log }) {
  const focused = runCommand(ORCA_CLI, ["terminal", "switch", "--terminal", handle]);
  if (focused.code !== 0) {
    return { ok: false, how: "focus-failed", handle, reason: firstLine(focused.stderr || focused.stdout) };
  }
  log(`focused the console in ${handle}`);
  return { ok: true, how: "focused", handle };
}

/** A terminal of its own, running the console against this report. */
function createConsole({ script, origin, run: runCommand, log }) {
  const created = runCommand(ORCA_CLI, [
    "terminal",
    "create",
    "--worktree",
    "active",
    "--title",
    CONSOLE_TITLE,
    "--command",
    `node ${script} --url ${origin}`,
    "--json",
  ]);
  if (created.code !== 0) return { ok: false, how: "create-failed", reason: firstLine(created.stderr || created.stdout) };

  const handle = parseCreatedTerminal(created.stdout);
  if (!handle) return { ok: false, how: "create-failed", reason: "Orca created a terminal but did not name it" };
  log(`opened the console in ${handle}`);
  return { ok: true, how: "created", handle };
}

/** The handle of a terminal Orca just created, or null when the answer is not the shape it documents. */
function parseCreatedTerminal(stdout) {
  try {
    const payload = JSON.parse(stdout);
    const terminal = payload?.result?.terminal ?? payload?.result?.terminals?.[0] ?? payload?.terminal ?? null;
    return terminal?.handle ?? null;
  } catch {
    return null;
  }
}

/**
 * The console pane: the report first, then a terminal to read it in.
 *
 * The order matters and is not a preference: the console exits at once when nothing answers, so a pane opened
 * before the server is a pane that shows an error and stays open.
 */
async function reportConsole({ orca, own, origin, ensure, notify, log, run: runCommand, refused, open = openConsole }) {
  if (refused) {
    await notify(refused.reason);
    return { opened: false, reason: refused.reason };
  }
  const up = await ensure();
  if (!up.ok) {
    await notify(up.reason);
    return { opened: false, reason: up.reason };
  }
  const repo = path.resolve(up.root, "..", "..");
  const opened = await openConsolePane({ orca, repo, origin, log, run: runCommand, open });
  if (!opened.ok) {
    await notify(opened.reason);
    return { opened: false, reason: opened.reason };
  }
  await notify(consoleSentence(opened));
  return { opened: true, how: opened.how, handle: opened.handle };
}

/** Open the pane, remembering the terminal so the next press focuses it rather than opening a second. */
async function openConsolePane({ orca, repo, origin, log, run: runCommand, open }) {
  const remembered = await readOwnStorage({ orca, key: CONSOLE_KEY, log });
  const opened = open({
    repo,
    origin,
    log,
    run: runCommand,
    remembered: typeof remembered === "string" ? remembered : null,
  });
  if (opened.ok && opened.how === "created") {
    await writeStored({ orca, key: CONSOLE_KEY, value: opened.handle, log });
  }
  return opened;
}

/** What to tell the reader about the pane that is now in front of them. */
function consoleSentence({ how, handle }) {
  return how === "focused"
    ? `focused the console pane “${CONSOLE_TITLE}” (${handle})`
    : `the console is open as “${CONSOLE_TITLE}” (${handle}) — the keys are in the pane`;
}

/** Everything a command needs, resolved once per activation. */
async function bindReport({ orca, fetchImpl, url, timeoutMs, ensure, open = openConsole, run: runCommand = run }) {
  const log = logTo(orca);
  const own = await readOwnSettings({ orca, log });
  const address = url === undefined ? await resolveUrl({ orca, own, log }) : explicitAddress(url);
  const request = address.origin ? makeRequest({ origin: address.origin, fetchImpl, timeoutMs }) : null;
  return {
    own,
    source: address.source,
    origin: address.origin,
    request,
    // A refused address has nothing to start at it, whatever a caller passed in.
    ensure: address.origin ? (ensure ?? makeEnsurer({ orca, origin: address.origin, request, timeoutMs, own, log, run: runCommand })) : null,
    run: runCommand,
    open,
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
function commandTable({ binding, orca, bake }) {
  const afterChecking = async (work) => {
    const bound = await binding();
    await checkNewDay({ orca, ...bound });
    await bake(bound);
    return work(bound);
  };

  return {
    "report-open": () => afterChecking(openReport),
    "report-status": () => afterChecking(reportStatus),
    "report-refresh": () => afterChecking(reportRefresh),
    "report-start": () => afterChecking(reportStart),
    "report-console": () => afterChecking(reportConsole),
  };
}

/** Run a command and hand back what it printed: the seam a test replaces. */
export function run(command, args, { cwd = process.cwd(), timeout = 5000 } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

const firstLine = (text) => (text ?? "").trim().split("\n")[0] ?? "";

/** The focused worktree Orca names, as its CLI reports it. */
export function parseActiveWorktree(stdout) {
  try {
    const payload = JSON.parse(stdout);
    const worktree = payload?.result?.worktree ?? payload?.worktree ?? null;
    return worktree?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * The checkout the report lives in.
 *
 * A reader-set `reportRoot` wins, then what the plugin remembered, and only then does it ask: the worker's
 * own working directory is Orca's, not a checkout's, so the path comes from Orca itself — the worktree it has
 * focused, asked for by that name. A branch could not answer it: `refs/heads/main` is the branch of every
 * repository on main, so matching one named whichever came first in the list. The answer is remembered, so
 * this costs one CLI call per checkout rather than one per wake.
 */
export async function findReportRoot({ orca, own = {}, log = () => {}, run: runCommand = run } = {}) {
  const known = await readOwn({ orca, own, key: ROOT_KEY, log });
  if (typeof known === "string" && known) return known;

  const context = await readContext(orca, log);
  if (!context?.branch) return null;

  const found = focusedWorktree({ log, run: runCommand });
  if (found) await writeStored({ orca, key: ROOT_KEY, value: found, log });
  return found;
}

/** The path of the worktree Orca has focused, or null: the one question the worker cannot answer itself. */
function focusedWorktree({ log, run: runCommand }) {
  const shown = runCommand(ORCA_CLI, ["worktree", "show", "--worktree", "active", "--json"]);
  if (shown.code !== 0) {
    log(`could not ask Orca for the focused worktree: ${firstLine(shown.stderr || shown.stdout)}`);
    return null;
  }
  const found = parseActiveWorktree(shown.stdout);
  if (!found) log("Orca named no focused worktree");
  return found;
}

const loadBakerFrom = (root) => import(pathToFileURL(path.join(root, "scripts", "report-panel.mjs")).href);
const loadFollowerFrom = (root) => import(pathToFileURL(path.join(root, "scripts", "report-server.mjs")).href);

/**
 * Keep the panel current for as long as this worker is alive.
 *
 * The panel cannot read anything (a sandboxed document with no network), so liveness comes from here: the
 * record is polled with the checkout's own rule (`followPacks`, the one the running server uses), and a bake
 * runs whenever it moved. The bake is the shared one too, and it only writes when the panel would show
 * something else — so a change the app does not read is not a repaint, and a reader keeps their place.
 */
export async function followRecord({
  orca,
  own = {},
  log = () => {},
  run: runCommand = run,
  bake,
  loadFollower = loadFollowerFrom,
  loadBaker = loadBakerFrom,
  intervalMs = RECORD_POLL_MS,
} = {}) {
  const record = await resolveRecordRoot({ orca, own, log, run: runCommand });
  if (!record.root) {
    log(`nothing to follow: ${record.reason}`);
    return null;
  }
  const checkout = path.resolve(record.root, "..", "..");
  try {
    const [{ followPacks }, { recordFingerprint }] = await Promise.all([loadFollower(checkout), loadBaker(checkout)]);
    const follower = followPacks({
      root: record.root,
      intervalMs,
      rebake: () => bake({ own, log }),
      fingerprint: async (dir) => recordFingerprint(dir),
    });
    log(`following ${record.root} for changes`);
    return follower;
  } catch (error) {
    log(`could not follow ${record.root}: ${error?.message ?? error}`);
    return null;
  }
}

/**
 * Bake the panel, wherever the report lives.
 *
 * The baker is the repository's own module, imported from the checkout: one implementation of "what the panel
 * holds" serves the server and the plugin, and a panel that cannot be baked is a log line, never a failed
 * command.
 */
export async function bakePanel({ orca, own = {}, log = () => {}, run: runCommand = run, loadBaker = loadBakerFrom } = {}) {
  const root = await findReportRoot({ orca, own, log, run: runCommand });
  if (!root) {
    log("no report checkout yet: open a workspace in Orca, or set the plugin's reportRoot");
    return { baked: false, reason: "no checkout" };
  }
  try {
    const { bakeIfStale } = await loadBaker(root);
    const result = bakeIfStale({
      root: path.join(root, ".x-skills", "daily"),
      dist: path.join(root, "tools", "report-app", "dist-panel"),
      out: path.join(root, "tools", "orca-plugin", "panel.html"),
    });
    log(result.baked ? `baked the panel for ${result.stamp}` : `panel is current (${result.stamp})`);
    return result;
  } catch (error) {
    log(`could not bake the panel: ${error?.message ?? error}`);
    return { baked: false, reason: String(error?.message ?? error) };
  }
}

/**
 * One check per interval, whatever the event volume.
 *
 * The newest day changes about once a day and an agent fleet changes state constantly, so the interval is what
 * keeps a busy workspace from becoming a busy plugin. There is no timer *here*: `now` is read when an event
 * arrives, so a worker that slept cannot drift. The one timer the worker holds is `followRecord`'s, which is
 * what keeps the panel current between events.
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

/** What an Orca event does: look for a new day, then make the next panel open current. */
function checkThenBake({ orca, binding, bake, noteFailure }) {
  return async () => {
    const bound = await binding();
    const result = await checkNewDay({ orca, ...bound });
    if (!result.checked) noteFailure(result.reason);
    await bake(bound);
    return result;
  };
}

/** Orca's events: the plugin looks when something happens, and stays quiet when nothing is there. */
function subscribeToEvents({ orca, binding, log, now, intervalMs, bake }) {
  const notePath = makePathNote({ log });
  const onEvent = makeEventCheck({
    now,
    intervalMs,
    log,
    check: checkThenBake({ orca, binding, bake, noteFailure: makeFailureLog({ log }) }),
  });

  for (const name of PLUGIN_EVENTS) {
    orca.events.on(name, async (payload) => {
      notePath(payload);
      await onEvent();
    });
  }
}

/** The object a caller drives: one function per decision, without the palette in the way. */
function pluginSurface({ orca, binding, commands, now, intervalMs, bake }) {
  return {
    probe: async () => {
      const report = await binding();
      return report.refused ?? probeReport(report);
    },
    check: async () => checkNewDay({ orca, ...(await binding()) }),
    open: commands["report-open"],
    register: () => {
      for (const [id, handler] of Object.entries(commands)) orca.commands.register(id, handler);
      subscribeToEvents({ orca, binding, log: logTo(orca), now, intervalMs, bake });
    },
  };
}


export function createPlugin({
  orca,
  fetch: fetchImpl = fetch,
  url,
  timeoutMs = PROBE_TIMEOUT_MS,
  now = Date.now,
  intervalMs = EVENT_CHECK_INTERVAL_MS,
  bake = null,
  ensure = null,
  run = null,
  open = null,
} = {}) {
  let pending = null;
  const binding = () =>
    (pending ??= bindReport({ orca, fetchImpl, url, timeoutMs, ensure, open: open ?? openConsole, run: run ?? undefined }));
  const rebake = bake ?? ((bound) => bakePanel({ orca, own: bound.own, log: bound.log, run: bound.run }));
  const commands = commandTable({ binding, orca, bake: rebake });
  return pluginSurface({ orca, binding, commands, now, intervalMs, bake: rebake });
}

/** Orca's worker entry. The second argument is ours: tests inject a fetch and a timeout. */
export default function activate(orca, deps = {}) {
  const plugin = createPlugin({ orca, ...deps });
  plugin.register();
  orca.log(`${NAME}: worker cwd ${process.cwd()}`);
  const log = (line) => orca.log(`${NAME}: ${line}`);
  const bake = deps.bakePanel ?? (({ own, log: say }) => bakePanel({ orca, own, log: say }));
  void bake({ own: {}, log });
  if (deps.follow !== false) {
    void followRecord({ orca, own: {}, log, bake, loadFollower: deps.loadFollower, loadBaker: deps.loadBaker });
  }
  return plugin;
}
