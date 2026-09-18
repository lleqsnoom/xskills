#!/usr/bin/env node
/**
 * The report as a pane you can type into.
 *
 * A plugin panel is a sandboxed document with no network (`tools/orca-plugin/PANE-REQUEST.md`), so the only
 * surface that can be *live and writable* inside Orca today is a process: this one, running in a terminal the
 * plugin's worker opens. It is a **client of the server's API**, never a second reader of the files — the server
 * owns the record and is the only writer of `todos.json`.
 *
 * Keys: `j`/`k` move, `t` keep, `d` drop, `r` refresh, `q` quit. Everything below the loop is pure, so the
 * picture and the keystrokes are testable without a terminal.
 */

import { pathToFileURL } from "node:url";

export const DEFAULT_URL = "http://127.0.0.1:8787";
export const DEFAULT_INTERVAL_MS = 30_000;
export const DEFAULT_WIDTH = 80;
const MOVEMENT_PATH = (days) => `/api/movement?days=${days}`;
const DAY_PATH = (date) => `/api/day/${date}`;
const TODOS_PATH = "/api/todos";
const MAX_DAYS = 14;
const LEGEND = "j/k move · t keep · d drop · r refresh · q quit";
const QUIT_KEYS = new Set(["q", "\u0003", "\u0004"]);

/** Cut a line to the width it is given, in code points, with an ellipsis that says it was cut. */
export function fit(text, width) {
  const characters = [...String(text)];
  if (characters.length <= width) return characters.join("");
  return `${characters.slice(0, Math.max(0, width - 1)).join("")}…`;
}

/**
 * A skill's headline: its latest measured day, as the record states it.
 *
 * A day under the sample floor has a raw mean and no score (the scanner's rule), and the mean is marked with a
 * `*` here for the same reason the app draws it that way: the number is real, its meaning is not the same.
 */
export function skillValue(row) {
  const measured = (row?.series ?? []).filter((point) => (point.raw ?? point.score) !== null);
  const latest = measured.at(-1);
  if (!latest) return { text: "—", n: null };
  const value = latest.score ?? latest.raw;
  const marked = latest.score === null && latest.raw !== null ? `${latest.raw.toFixed(1)}*` : value.toFixed(1);
  return { text: marked, n: latest.n ?? null };
}

const arrow = (change) => (change === null || Math.abs(change) <= 0.5 ? "·" : change > 0 ? "▲" : "▼");

/** One skill, on one line: its name, its number, its band, the sample behind it, and where it is going. */
export function skillLine(row, width) {
  const { text, n } = skillValue(row);
  const change = row.change === null || row.change === undefined ? "" : ` ${arrow(row.change)}${Math.abs(row.change).toFixed(1)}`;
  const band = row.band?.label ?? "not measured";
  return fit(`${row.name.padEnd(16)} ${text.padStart(6)}  ${band.padEnd(12)} n=${n ?? "—"}${change}`, width);
}

/**
 * One proposal, on one line, and whether the reader has already kept it.
 *
 * `inTodo` is the server's own answer (it compares the work, not the digest's label), so this never re-derives
 * it — the console would drift from the app within a release.
 */
export function proposalLine(proposal, { selected = false, width = DEFAULT_WIDTH } = {}) {
  const marker = proposal.inTodo ? "•" : "·";
  const pointer = selected ? ">" : " ";
  const head = `${pointer} ${marker} ${proposal.id} ${proposal.skill ?? "unknown"} — `;
  return fit(`${head}${proposal.change ?? "no change stated"}`, width);
}

/** One block per thing a reader looks at: the skills, then the day's proposals. */
function skillBlock(rows, width) {
  return [...rows]
    .sort((a, b) => (b.latestScore ?? -Infinity) - (a.latestScore ?? -Infinity))
    .map((row) => skillLine(row, width));
}

function proposalBlock(proposals, selected, width) {
  if (!proposals.length) return [fit("no proposal was written for this day", width)];
  const index = Math.min(Math.max(selected, 0), proposals.length - 1);
  return proposals.map((proposal, position) => proposalLine(proposal, { selected: position === index, width }));
}

/**
 * The whole picture: what the record holds, and the keys that change it.
 *
 * `ids` is the list the selection indexes into, in the order drawn, so the keys act on what the reader sees.
 */
export function renderConsole({ movement, day, width = DEFAULT_WIDTH, selected = 0, origin = null, status = null } = {}) {
  const days = movement?.days ?? 0;
  const newest = movement?.newest ?? null;
  if (!days || !newest) return { lines: [fit("x-skills report · no day is recorded yet", width)], ids: [], count: 0 };

  const proposals = day?.proposals ?? [];
  const lines = [
    fit(`x-skills report · ${newest} · ${days} ${days === 1 ? "day" : "days"} recorded`, width),
    ...skillBlock(movement.movement ?? [], width),
    fit("", width),
    ...proposalBlock(proposals, selected, width),
    fit("", width),
    ...(status ? [fit(status, width)] : []),
    fit(`${LEGEND}${origin ? ` · ${origin}` : ""}`, width),
  ];

  return { lines, ids: proposals.map((proposal) => proposal.id), count: proposals.length };
}

/** The one line a terminal that cannot redraw gets — a pipe, a log, CI. */
export function summaryLine({ movement, day } = {}) {
  const days = movement?.days ?? 0;
  const newest = movement?.newest ?? null;
  if (!days || !newest) return "x-skills report · no day is recorded yet";
  const skills = (movement.movement ?? []).length;
  const proposals = (day?.proposals ?? []).length;
  return `x-skills report · ${newest} · ${days} days · ${skills} skills · ${proposals} proposals`;
}

/** The record the app would store for a proposal it keeps — the same shape, because it is the same list. */
export function todoItemFor(proposal) {
  return {
    id: proposal.id,
    day: proposal.day ?? null,
    skill: proposal.skill ?? null,
    change: proposal.change ?? null,
    reason: proposal.reason ?? null,
    expected: proposal.expected ?? null,
    target: proposal.target ?? null,
    route: proposal.route ?? null,
    signal: proposal.signal ?? null,
    note: proposal.note ?? null,
  };
}

const sameWork = (item, other) => item.id === other.id && (item.day ?? null) === (other.day ?? null);

/** The list with this proposal on it: one entry per id and day, whatever a stale read said. */
export function withKept(items, item) {
  return [...(items ?? []).filter((entry) => !sameWork(entry, item)), item];
}

/** The list without it. */
export function without(items, item) {
  return (items ?? []).filter((entry) => !sameWork(entry, item));
}

const VALUED_FLAGS = new Set(["--url", "--interval", "--day"]);

/** Each flag, and what it does to the arguments. A new flag is a line here, not a branch in a loop. */
const ARG_SETTERS = {
  "--url": (args, value) => {
    if (value) args.url = value;
  },
  "--interval": (args, value) => {
    args.interval = Number(value) || args.interval;
  },
  "--day": (args, value) => {
    args.day = value ?? null;
  },
  "--no-color": (args) => {
    args.color = false;
  },
  "--help": (args) => {
    args.help = true;
  },
  "-h": (args) => {
    args.help = true;
  },
};

export function parseArgs(argv) {
  const args = { url: DEFAULT_URL, interval: DEFAULT_INTERVAL_MS, day: null, color: true, help: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    ARG_SETTERS[flag]?.(args, VALUED_FLAGS.has(flag) ? argv[index + 1] : undefined);
    if (VALUED_FLAGS.has(flag)) index += 1;
  }
  return args;
}

export function usage() {
  return [
    "xskills report console — the record, live, in a terminal pane.",
    "",
    "Usage:",
    "  node scripts/report-console.mjs [--url http://127.0.0.1:8787] [--interval 30000] [--day YYYY-MM-DD]",
    "",
    "Flags:",
    "  --url <origin>     The report to read (default http://127.0.0.1:8787)",
    "  --interval <ms>    How often to re-read while the pane is open (default 30000)",
    "  --day <date>       Open on a day other than the newest",
    "  --no-color         Plain text, for a log or a pipe",
    "  --help             Show this help",
    "",
    `Keys: ${LEGEND}`,
    "",
  ].join("\n");
}

/** A console API over the server: one place a request leaves this process, and never without a deadline. */
export function httpApi({ url = DEFAULT_URL, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  return {
    origin: url,
    get: async (route) => {
      const response = await fetchImpl(`${url}${route}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`${route} answered ${response.status}`);
      return response.json();
    },
    post: async (route, body) => {
      const response = await fetchImpl(`${url}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`${route} answered ${response.status}`);
      return response.json();
    },
  };
}

/** Read the record: the movement page, then the day it names (or the one the reader asked for). */
async function readRecord({ api, state, day = null }) {
  try {
    state.movement = await api.get(MOVEMENT_PATH(MAX_DAYS));
    const date = day ?? state.movement.newest;
    state.payload = date ? await api.get(DAY_PATH(date)) : null;
    state.status = null;
  } catch (error) {
    state.status = error?.message ?? String(error);
  }
}

/** What the pane holds while it is open: the record it read, the proposal it is on, and the last word. */
function consoleData({ api, day = null }) {
  const state = { movement: null, payload: null, selected: 0, status: null };
  const proposals = () => state.payload?.proposals ?? [];

  const clamp = () => {
    state.selected = proposals().length ? Math.min(Math.max(state.selected, 0), proposals().length - 1) : 0;
  };

  return {
    state,
    proposals,
    chosen: () => proposals()[state.selected] ?? null,
    move: (by) => {
      state.selected += by;
      clamp();
    },
    read: async () => {
      await readRecord({ api, state, day });
      clamp();
    },
  };
}

/**
 * The writes, and the one thing they share: read the list, change it, post the whole thing back.
 *
 * `todos.json` has exactly one writer — the server's `POST /api/todos` — so this is a client of the same call
 * the app makes, with the day re-read afterwards rather than guessed at.
 */
function consoleWrites({ api, data }) {
  const change = async (edit) => {
    try {
      const current = await api.get(TODOS_PATH);
      const item = todoItemFor(data.chosen());
      if (!item.id) return;
      data.state.status = await edit(current.items ?? [], item);
    } catch (error) {
      data.state.status = error?.message ?? String(error);
    }
  };

  return {
    keep: () =>
      change(async (items, item) => {
        await api.post(TODOS_PATH, { items: withKept(items, item) });
        await data.read();
        return `kept ${item.id} — it is on the to-do list now`;
      }),
    drop: () =>
      change(async (items, item) => {
        if (!items.some((entry) => sameWork(entry, item))) return `${item.id} is not on the list`;
        await api.post(TODOS_PATH, { items: without(items, item) });
        await data.read();
        return `dropped ${item.id}`;
      }),
  };
}

/** What the pane is, to the loop: how it reads, draws, and what a key does to it. */
export function consoleState({ api, day = null, width = DEFAULT_WIDTH, draw = () => {} }) {
  const data = consoleData({ api, day });
  const writes = consoleWrites({ api, data });

  const redraw = () =>
    draw(
      renderConsole({
        movement: data.state.movement,
        day: data.state.payload,
        width,
        selected: data.state.selected,
        origin: api.origin,
        status: data.state.status,
      }).lines.join("\n")
    );

  const actions = {
    j: () => data.move(1),
    k: () => data.move(-1),
    down: () => data.move(1),
    up: () => data.move(-1),
    r: data.read,
    t: writes.keep,
    d: writes.drop,
  };

  return {
    read: data.read,
    redraw,
    press: async (key) => actions[key]?.(),
    quitting: (key) => QUIT_KEYS.has(key),
  };
}

/**
 * The loop: draw, act on a key, draw again.
 *
 * The last good picture is never thrown away by a failed read — a report that stopped answering leaves the
 * numbers it had on screen and says so in one line, because a pane that blanks itself is a pane the reader
 * cannot tell from a crash.
 */
export async function runConsole({
  input,
  out = () => {},
  api,
  intervalMs = DEFAULT_INTERVAL_MS,
  width = DEFAULT_WIDTH,
  day = null,
  timer = setInterval,
  clear = clearInterval,
} = {}) {
  const console_ = consoleState({ api, day, width, draw: out });
  const handle = timer(() => void console_.read().then(console_.redraw), intervalMs);
  await console_.read();
  console_.redraw();

  try {
    for await (const key of input) {
      if (console_.quitting(key)) break;
      await console_.press(key);
      console_.redraw();
    }
  } finally {
    clear(handle);
  }
  return 0;
}

async function* stdinKeys(stream) {
  const queue = [];
  let wake = () => {};
  stream.setEncoding("utf8");
  stream.setRawMode?.(true);
  stream.resume();
  stream.on("data", (chunk) => {
    for (const character of chunk) queue.push(character);
    wake();
  });
  stream.on("end", () => wake());
  while (true) {
    if (!queue.length) await new Promise((resolve) => (wake = resolve));
    if (!queue.length) return;
    yield queue.shift();
  }
}

/** A terminal that cannot redraw gets one line: a pipe, a log, CI. */
async function oneLine({ api, day = null }) {
  try {
    const movement = await api.get(MOVEMENT_PATH(MAX_DAYS));
    const date = day ?? movement.newest;
    process.stdout.write(`${summaryLine({ movement, day: date ? await api.get(DAY_PATH(date)) : null })}\n`);
  } catch (error) {
    process.stdout.write(`x-skills report · ${error?.message ?? error}\n`);
  }
  return 0;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }

  const api = httpApi({ url: args.url });
  if (!process.stdout.isTTY) return oneLine({ api, day: args.day });

  return runConsole({
    input: stdinKeys(process.stdin),
    out: (frame) => process.stdout.write(`${frame}\n\x1b[K`),
    api,
    intervalMs: args.interval,
    day: args.day,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
