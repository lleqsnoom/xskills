#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HISTORY_FILE, historyLine, readHistory, readProposals, scoresForSources, writeHistory } from "../skills/x-autoreflection/scripts/metrics.mjs";
import { band, loadHistory, movementPage, movement, recentDays, calendar, days as allDays } from "../skills/x-autoreflection/scripts/derive.mjs";
import { openReport, safePath } from "./report-open.mjs";


/**
 * `npm run report` — the local app: the JSON packs as a database, with the UI built from
 * `tools/report-app/`.
 *
 * The packs are the storage. This process reads them and answers questions about them; there is no
 * database engine, and nothing here writes except the to-do selection, which lands beside the packs so it
 * survives a restart.
 *
 * Routes are one of three kinds:
 *   - `/api/*` — the data the app renders. Pure reads, plus `POST /api/todos`.
 *   - the built app at `/` — `tools/report-app/dist`, or a page saying how to build it.
 *   - `/history.jsonl` — the raw record, so anything can read it without an API.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAILY_ROOT = path.join(REPO_ROOT, ".x-skills", "daily");

/** How often the server looks at the packs while it is running, to keep the panel's snapshot current. */
const PACK_POLL_MS = 5000;
const APP_DIST = path.join(REPO_ROOT, "tools", "report-app", "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** The newest pack on disk, or null when nothing has been collected yet. */
export function newestPack(root = DAILY_ROOT) {
  if (!fs.existsSync(root)) return null;
  const found = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return found.length ? found[found.length - 1] : null;
}

export function packFile(root, date) {
  return path.join(root, date, "summary.json");
}

/**
 * Re-bake whenever the record changes under us, so the panel a reader opens next is never older than the packs.
 *
 * Polling rather than `fs.watch`: recursive watching is not available on every platform Node 18 supports, a
 * pack arrives as several files, and one stat a few seconds apart costs less than chasing events. The interval,
 * the timer and the fingerprint are injectable so a test can drive the whole thing.
 *
 * The fingerprint is injected rather than owned: the same rule serves the plugin's worker, and it lives beside
 * the baker in `report-panel.mjs`. The first tick only learns what the record looks like.
 */
export function followPacks({
  root = DAILY_ROOT,
  rebake,
  fingerprint,
  intervalMs = PACK_POLL_MS,
  timer = setInterval,
  clear = clearInterval,
} = {}) {
  let seen = null;

  const tick = async () => {
    const current = await fingerprint(root);
    const changed = seen !== null && current !== seen;
    seen = current;
    if (!changed) return false;
    try {
      await rebake();
      return true;
    } catch (error) {
      process.stderr.write(`panel not baked: ${error?.message ?? error}\n`);
      return false;
    }
  };

  const handle = timer(tick, intervalMs);
  return { tick, stop: () => clear(handle) };
}

/** One day's pack, or null. Trimmed to what a UI reads: transcript paths are machine-local noise. */
export function readPack(root, date) {
  const file = packFile(root, date);
  if (!fs.existsSync(file)) return null;
  const pack = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    date,
    pack: pack.pack ?? null,
    generatedAt: pack.generatedAt ?? null,
    window: pack.window ?? null,
    hosts: pack.hosts ?? [],
    counts: pack.counts ?? {},
    skills: pack.skills ?? { touched: [], idle: [] },
    warnings: pack.warnings ?? [],
    notes: pack.notes ?? [],
    sessions: (pack.sessions ?? []).map((session) => ({
      id: session.id,
      host: session.host,
      uuid: session.uuid,
      title: session.title,
      project: session.project,
      modified: session.modified,
      stats: session.stats,
      skills: session.skills,
      checks: session.checks ?? [],
      graphs: session.graphs ?? [],
      runFolders: session.runFolders ?? [],
      artifacts: session.artifacts ?? [],
      high: (pack.signals ?? []).filter((signal) => signal.session === session.id && signal.severity === "high").length,
    })),
    signals: pack.signals ?? [],
    runFolders: pack.runFolders ?? [],
    artifacts: pack.artifacts ?? [],
    pruned: pack.pruned ?? [],
  };
}

/** The proposals a day's digest asks for, with the skill each one targets. */
export function readDayProposals(root, date) {
  return readProposals(path.join(root, date, "DIGEST.md"));
}

/** The selection a reader has made, and where it is kept. */
export function readTodos(root = DAILY_ROOT) {
  const file = path.join(root, "todos.json");
  if (!fs.existsSync(file)) return { updatedAt: null, items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { updatedAt: parsed.updatedAt ?? null, items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { updatedAt: null, items: [] };
  }
}

/**
 * Write the selection. This is the only write the server does, and it is deliberately a file beside the
 * packs: the to-do list is data, not server state, so nothing depends on this process staying alive.
 *
 * `day` is the storage discriminator, not a label: two days can each propose a `P1`, and the reader may keep
 * both, so the day is what tells them apart when one of them is dropped again.
 */
export function writeTodos(items, root = DAILY_ROOT) {
  if (!Array.isArray(items)) throw new Error("items must be an array");
  const clean = items
    .filter((item) => item && typeof item.id === "string")
    .map((item) => ({
      id: item.id,
      day: typeof item.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.day) ? item.day : null,
      skill: item.skill ?? null,
      change: item.change ?? null,
      reason: item.reason ?? null,
      expected: item.expected ?? null,
      target: item.target ?? null,
      route: item.route ?? null,
      signal: item.signal ?? null,
      note: item.note ?? null,
    }));
  const payload = { updatedAt: new Date().toISOString(), items: clean };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "todos.json"), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * Record the newest day in the history file, so the JSON on disk is current before the app reads it. The
 * daily line is that day's own pack, never a rolling window: a trend over aggregates would record the same
 * number under several dates.
 */
export function refresh({ root = DAILY_ROOT, days = 14 } = {}) {
  const day = newestPack(root);
  if (!day) return { ok: false, reason: `no pack under ${root}; run the collector first` };
  const dayScores = scoresForSources({ summaries: [packFile(root, day)] });
  const windowScores = scoresForSources({ days, root });
  writeHistory(historyLine(dayScores, day), { file: path.join(root, "history.jsonl") });
  return {
    ok: true,
    day,
    packs: windowScores.window?.packs ?? [],
    skills: windowScores.skills.length,
    inUse: windowScores.skills.filter((row) => row.status === "scored" && row.n > 0).length,
  };
}

/** Everything the default screen needs, in one payload. */
export function apiMovement({ root = DAILY_ROOT, maxDays = 14, recent = 5 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const newest = newestPack(root);
  return {
    ...movementPage(history, { maxDays, recent }),
    newest,
    hasPack: newest ? fs.existsSync(packFile(root, newest)) : false,
    todos: readTodos(root),
  };
}

export function apiDays({ root = DAILY_ROOT, maxDays = 14 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  return {
    dates: allDays(history).slice(-maxDays),
    recent: recentDays(history),
    calendar: calendar(history),
  };
}

/**
 * Is this proposal already kept?
 *
 * The work is the identity, not the digest's label: a proposal is named `P3` inside *every* digest, so the
 * same label means a different task on each day, while the same change text means the same task whenever it
 * was proposed. Comparing the text is what lets a proposal the reader already put on the list stop offering
 * itself again — and it is also what makes the two entries that predate this rule still count, because they
 * carry the text they were saved with.
 *
 * Only when neither side has text to compare does the label decide, and then it is scoped to its day.
 */
export function sameWork(item, proposal) {
  if (item.change && proposal.change && item.change === proposal.change) return true;
  return item.id === proposal.id && (item.day ?? null) === (proposal.day ?? null);
}

export function apiDay({ root = DAILY_ROOT, date } = {}) {
  const pack = readPack(root, date);
  if (!pack) return null;
  const { proposals, source } = readDayProposals(root, date);
  const history = loadHistory(path.join(root, "history.jsonl"));
  const line = history.get(date) ?? null;
  // The band travels with the score, so a UI never re-derives the rule and drifts from it.
  const scores = (line?.skills ?? []).map((skill) => ({ ...skill, band: band(skill.score) }));
  // Whether each proposal is already kept travels with it, for the same reason: one rule, decided once.
  const kept = readTodos(root).items;
  return {
    pack,
    proposals: proposals.map((proposal) => {
      const day = proposal.day ?? date;
      return { ...proposal, day, inTodo: kept.some((item) => sameWork(item, { ...proposal, day })) };
    }),
    digest: source,
    history: line,
    scores,
  };
}

export function apiSkill({ root = DAILY_ROOT, name, maxDays = 14 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const row = movement(history, { maxDays }).find((entry) => entry.name === name);
  if (!row) return null;
  const dates = allDays(history).slice(-maxDays);
  const perDay = dates.map((date) => {
    const skill = (history.get(date).skills ?? []).find((entry) => entry.name === name);
    const pack = readPack(root, date);
    const session = pack?.sessions?.find((entry) => (entry.skills?.loaded ?? []).includes(name)) ?? null;
    return {
      date,
      score: skill?.score ?? null,
      raw: skill?.raw ?? null,
      n: skill?.n ?? null,
      named: skill?.named ?? null,
      dimensions: skill?.dimensions ?? null,
      // The band travels with each day's score, not only the latest one: the screen draws a day's gauge from
      // this, and a UI that banded a score itself would drift from the rule the server already decided.
      band: band(skill?.score ?? null),
      sample: session ? { id: session.id, host: session.host, title: session.title } : null,
    };
  });
  // Why it moved: the signals that blamed this skill and the proposals that target it, either of which is
  // the next thing a reader wants after seeing the line go up or down. A proposal carries its day and whether
  // it is already kept, by the same rule the day screen uses — one rule, decided once, so the `+ to-do` on
  // this screen writes exactly the entry that screen would and reads back as kept on both.
  const kept = readTodos(root).items;
  const signals = [];
  const proposals = [];
  for (const date of dates) {
    const pack = readPack(root, date);
    if (pack) {
      for (const signal of pack.signals ?? []) {
        if ((signal.suspects ?? []).includes(name)) signals.push({ ...signal, date });
      }
    }
    for (const proposal of readDayProposals(root, date).proposals) {
      if (proposal.skill !== name) continue;
      const day = proposal.day ?? date;
      proposals.push({ ...proposal, day, date, inTodo: kept.some((item) => sameWork(item, { ...proposal, day })) });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  signals.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || (b.count ?? 0) - (a.count ?? 0));
  proposals.reverse(); // newest day first
  return { ...row, perDay, dimensions: row.series[row.series.length - 1]?.dimensions ?? null, signals, proposals };
}

export function apiTodos({ root = DAILY_ROOT } = {}) {
  return readTodos(root);
}

/**
 * Which bundle the built app is serving, as the file name its `index.html` asks for.
 *
 * A reader's tab is not reloaded when it is focused (`scripts/report-open.mjs`), so it can run yesterday's
 * bundle for days — every fix in the repository and nothing of it on screen. The app knows its own name (the
 * module it is running from), so the server only has to say what the current one is, and the two differ exactly
 * when the page is older than the app. Null when the app is not built, or built in dev, where there is no
 * hashed bundle to compare against.
 */
export function buildId({ appDist = APP_DIST } = {}) {
  try {
    const html = fs.readFileSync(path.join(appDist, "index.html"), "utf8");
    return html.match(/\/assets\/(index-[\w-]+\.js)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** One session's own page: the session, and the signals blamed on it. Null when the pack does not hold it. */
export function apiSession({ root = DAILY_ROOT, date, id } = {}) {
  const pack = readPack(root, date);
  const session = pack?.sessions?.find((entry) => String(entry.id) === String(id));
  if (!session) return null;
  return { date, session, signals: (pack.signals ?? []).filter((signal) => signal.session === session.id) };
}

/**
 * Resolve a request path inside a root, refusing anything that climbs out. The server is loopback-only, but
 * a path that escapes the directory is a bug even on a trusted machine.
 */
export function resolveWithin(urlPath, root) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.resolve(root, `.${decoded}`);
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null;
  return target;
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, `${JSON.stringify(value)}\n`, TYPES[".json"]);
}

function serveFile(res, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(fs.readFileSync(file));
  return true;
}

/** Shown when the app has not been built, so the failure says what to do instead of returning nothing. */
const NOT_BUILT = `<!doctype html>
<meta charset="utf-8"><title>Report app not built</title>
<style>body{font:15px/1.6 ui-sans-serif,system-ui;max-width:44rem;margin:4rem auto;padding:0 1.5rem}
code{background:#eef0f3;padding:.1em .35em;border-radius:4px}</style>
<h1>The app is not built yet</h1>
<p>Install and build it once:</p>
<pre><code>npm run report:build</code></pre>
<p>Then reload. The API is already answering — try
<a href="/api/movement"><code>/api/movement</code></a>.</p>
`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export function createServer({ root = DAILY_ROOT, maxDays = 14, appDist = APP_DIST, open = openReport, rebake = null } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const query = url.searchParams;
    const days = Number(query.get("days") ?? maxDays) || maxDays;

    try {
      if (url.pathname === "/api/movement") {
        return sendJson(res, 200, apiMovement({ root, maxDays, recent: Number(query.get("recent") ?? 5) || 5 }));
      }
      if (url.pathname === "/api/days") return sendJson(res, 200, apiDays({ root, maxDays }));
      if (url.pathname === "/api/version") return sendJson(res, 200, { build: buildId({ appDist }) });
      if (url.pathname === "/api/todos") {
        if (req.method === "POST") {
          const body = await readBody(req);
          return sendJson(res, 200, writeTodos(JSON.parse(body || "{}").items ?? [], root));
        }
        return sendJson(res, 200, apiTodos({ root }));
      }
      if (url.pathname === "/api/refresh") {
        const result = refresh({ root, days });
        if (rebake) {
          // The panel the Orca plugin shows is a snapshot of this record, so a recording re-bakes it. A bake
          // that fails is a log line, never a failed refresh: the record is written either way.
          try {
            await rebake();
          } catch (error) {
            process.stderr.write(`panel not baked: ${error?.message ?? error}\n`);
          }
        }
        return sendJson(res, 200, result);
      }

      // `Run`: the page says which surface it wants and where it is, and the machine decides how to oblige.
      // The path is the only part a client contributes, and it is re-anchored to this server's own origin, so
      // a body can never point the opener at another host.
      if (url.pathname === "/api/open" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const port = req.socket.localPort;
        const result = open({ url: `http://127.0.0.1:${port}${safePath(body.path)}`, surface: body.surface });
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      const dayMatch = url.pathname.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})\/?$/);
      if (dayMatch) {
        const payload = apiDay({ root, date: dayMatch[1] });
        return payload ? sendJson(res, 200, payload) : sendJson(res, 404, { error: `no pack for ${dayMatch[1]}` });
      }

      const sessionMatch = url.pathname.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})\/session\/([^/]+)\/?$/);
      if (sessionMatch) {
        const payload = apiSession({ root, date: sessionMatch[1], id: decodeURIComponent(sessionMatch[2]) });
        if (!payload) {
          return sendJson(res, 404, { error: `no session ${decodeURIComponent(sessionMatch[2])} in ${sessionMatch[1]}` });
        }
        return sendJson(res, 200, payload);
      }

      const skillMatch = url.pathname.match(/^\/api\/skill\/([a-z0-9-]+)\/?$/);
      if (skillMatch) {
        const payload = apiSkill({ root, name: skillMatch[1], maxDays });
        return payload ? sendJson(res, 200, payload) : sendJson(res, 404, { error: `no movement for ${skillMatch[1]}` });
      }

      if (url.pathname === "/history.jsonl") {
        if (serveFile(res, path.join(root, "history.jsonl"))) return;
        return send(res, 404, "no history yet\n");
      }

      // The built app; any extension-less path is the shell, because the app routes client-side.
      if (url.pathname === "/" || !path.extname(url.pathname)) {
        if (serveFile(res, path.join(appDist, "index.html"))) return;
        return send(res, 200, NOT_BUILT, TYPES[".html"]);
      }
      const asset = resolveWithin(url.pathname, appDist);
      if (!asset) return send(res, 403, "path escapes the served directory\n");
      if (serveFile(res, asset)) return;

      const raw = resolveWithin(url.pathname, root);
      if (raw && serveFile(res, raw)) return;
      send(res, 404, `nothing at ${url.pathname}\n`);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}

function usage() {
  return [
    "xskills report — the local app over the JSON packs.",
    "",
    "Usage:",
    "  npm run report [-- --port 8787 --root .x-skills/daily --days 14]",
    "",
    "Flags:",
    "  --port <n>       Port to listen on (default 8787, or $PORT)",
    "  --days <n>       How many days of history the API reads (default 14)",
    "  --root <dir>     The daily root to serve (default .x-skills/daily)",
    "  --no-refresh     Answer from disk without recording the newest day first",
    "  --no-panel       Do not bake the Orca plugin's panel (default: bake it, and after every refresh)",
    "  --panel-out <p>  Where the panel is baked (default tools/orca-plugin/panel.html)",
    "  --help           Show this help",
    "",
    "API:",
    "  GET  /api/movement                    the default screen: movement, recent days, calendar, todos",
    "  GET  /api/days                        dates, recent days and the calendar",
    "  GET  /api/day/<date>                  one pack, its digest's proposals and its scores",
    "  GET  /api/day/<date>/session/<id>     one session and the signals blamed on it",
    "  GET  /api/skill/<name>                one skill's series, change and per-day detail",
    "  GET  /api/refresh                     record the newest day, and report what changed",
    "  GET  /api/todos  POST /api/todos      the selection, and the one thing this server writes",
    "  GET  /api/version                     the bundle the app is serving, so a stale tab reloads itself",
    "  POST /api/open                        open the report in an Orca tab, or in a window without browser controls",
    "  GET  /history.jsonl                   the raw day-by-day record",
    "",
    "Bound to 127.0.0.1: it serves this repository's own data to this machine.",
    "",
  ].join("\n");
}

function parseArgs(args) {
  const out = { _: [], unknown: [] };
  // `--no-panel` and `--panel-out` are in the usage text and in `main`, so they are flags here too: a server
  // that refuses its own documented flags is a server whose help page lies.
  const known = ["port", "days", "root", "no-refresh", "no-panel", "panel-out", "help"];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (!known.includes(key)) {
      out.unknown.push(key);
      continue;
    }
    out[key] = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
  return out;
}

/**
 * The panel baker, when the Orca plugin is here to bake for.
 *
 * Imported late on purpose: the baker imports this module's API functions, so a static import would be a
 * cycle — and a server that cannot bake a panel is still a working server. The baker carries the staleness
 * rule too, because the plugin's worker bakes by the same one.
 */
function loadPanelBake({ root, out, maxDays }) {
  const target = typeof out === "string" ? path.resolve(out) : path.join(REPO_ROOT, "tools", "orca-plugin", "panel.html");
  if (!fs.existsSync(path.dirname(target))) return null;
  const baker = () => import("./report-panel.mjs");
  return {
    target,
    rebake: async () => (await baker()).bake({ root, out: target, maxDays }),
    fingerprint: async () => (await baker()).packFingerprint(root),
  };
}

async function bakeQuietly(rebake, onDone = () => {}) {
  try {
    onDone(await rebake());
  } catch (error) {
    process.stderr.write(`panel not baked: ${error?.message ?? error}\n`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (args.unknown.length) {
    process.stderr.write(`Unknown argument "${args.unknown[0]}"\n\n${usage()}`);
    return 2;
  }
  const root = typeof args.root === "string" ? path.resolve(args.root) : DAILY_ROOT;
  const maxDays = Number(typeof args.days === "string" ? args.days : 14) || 14;
  const port = Number(typeof args.port === "string" ? args.port : process.env.PORT ?? 8787);
  const panel = args["no-panel"] === true ? null : loadPanelBake({ root, out: args["panel-out"], maxDays });
  const rebake = panel ? panel.rebake : null;

  if (args["no-refresh"] !== true) {
    const result = refresh({ root, days: maxDays });
    process.stdout.write(result.ok ? `recorded ${result.day} (${result.inUse} skills in use over ${result.packs.length} packs)\n` : `${result.reason}\n`);
  }

  const server = createServer({ root, maxDays, rebake });
  server.listen(port, "127.0.0.1", () => {
    const { port: actual } = server.address();
    const built = fs.existsSync(path.join(APP_DIST, "index.html"));
    process.stdout.write(
      [
        `xskills report on http://127.0.0.1:${actual}/`,
        built ? "  app built — open the URL above" : "  app not built yet: npm run report:build (the API answers now)",
        `  api       http://127.0.0.1:${actual}/api/movement`,
        `  raw data  http://127.0.0.1:${actual}/history.jsonl`,
        rebake ? "  panel     baked now, after every refresh, and when the packs change" : "  panel     not baked (--no-panel)",
        `  ctrl-c to stop`,
        "",
      ].join("\n")
    );
    if (panel) {
      void bakeQuietly(panel.rebake);
      followPacks({ root, rebake: panel.rebake, fingerprint: panel.fingerprint });
    }
  });
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exitCode = main();
}

export { APP_DIST, DAILY_ROOT, HISTORY_FILE, REPO_ROOT };
