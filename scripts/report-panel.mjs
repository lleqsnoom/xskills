#!/usr/bin/env node
/**
 * Bake the report's UI into the Orca plugin's panel.
 *
 * A panel is a document with no network, and Orca re-reads its entry file from disk on every open. So the app
 * is built to a single HTML file (no external reference survives the policy) and the payloads it would have
 * fetched are written into that same file.
 *
 * This module is the one place that knows how to build a snapshot, and two callers share it: the report server,
 * which owns the packs and keeps the panel current while it runs, and the Orca plugin's worker, which bakes
 * whenever Orca wakes it so the panel is current even with no server running.
 *
 * Usage: node scripts/report-panel.mjs [--root <dir>] [--dist <dir>] [--out <file>]
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { apiDay, apiDays, apiMovement, apiSession, apiSkill, apiTodos, newestPack } from "./report-server.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_ROOT = path.join(REPO_ROOT, ".x-skills", "daily");
export const DEFAULT_DIST = path.join(REPO_ROOT, "tools", "report-app", "dist-panel");
/** The manifest's panel entry. Committed, because Orca validates every declared artifact when it loads the
 *  plugin: a panel the file system cannot resolve is a plugin that does not load at all. */
export const DEFAULT_OUT = path.join(REPO_ROOT, "tools", "orca-plugin", "panel.html");
/** The signpost, kept beside the panel it is committed as: what a reader sees before the record is rendered in. */
export const DEFAULT_FALLBACK = path.join(REPO_ROOT, "tools", "orca-plugin", "panel-fallback.html");
const MAX_DAYS = 14;
/**
 * How much snapshot the panel may carry.
 *
 * Orca caps a panel entry at 10 MB and the app shell is a little under 200 kB, so this is the payload's
 * share of that with room to spare. A day costs somewhere between a quarter and half a megabyte, so the whole
 * window fits in practice; the cap is what keeps a repository whose days are far heavier than this one's from
 * baking a panel Orca would refuse.
 */
export const MAX_SNAPSHOT_BYTES = 6_000_000;

/** One day: its pack, its scores, its digest's proposals — and a drill-down per session it holds. */
function dayPayloads({ root, date }) {
  const day = apiDay({ root, date });
  if (!day) return null;
  const payloads = { [`/api/day/${date}`]: day };
  for (const session of day.pack?.sessions ?? []) {
    payloads[`/api/day/${date}/session/${session.id}`] = apiSession({ root, date, id: session.id });
  }
  return payloads;
}

/** One drill-down per skill the movement table names: its series across the whole record, not one day. */
function skillPayloads({ root, movement, maxDays }) {
  const payloads = {};
  for (const row of movement.movement ?? []) {
    payloads[`/api/skill/${row.name}`] = apiSkill({ root, name: row.name, maxDays });
  }
  return payloads;
}

/**
 * The days a reader can reach, newest first: the newest pack, then every day the record names.
 *
 * A day whose pack is gone is not one the app can open — the calendar refuses to link it — so the list is the
 * days the record knows about, and `dayPayloads` skips the ones with nothing behind them.
 */
function daysNewestFirst(root, days) {
  const newest = newestPack(root);
  const recorded = days?.dates ?? [];
  return [...new Set([...(newest ? [newest] : []), ...recorded])].sort().reverse();
}

/**
 * Every payload the app asks for, keyed by the path it asks for it on.
 *
 * Every day the rail or the calendar can reach is baked, newest first, so a day a reader can click is a day
 * that opens. The limit is a byte budget rather than a count, because one day's pack is not the size of
 * another's: the days past it are left out and say so, and the newest day is always baked — a panel holding
 * no day at all, and a panel holding the wrong one, are different kinds of broken.
 */
export function payloadTable({ root = DEFAULT_ROOT, maxDays = MAX_DAYS, budget = MAX_SNAPSHOT_BYTES } = {}) {
  const movement = apiMovement({ root, maxDays });
  const days = apiDays({ root, maxDays });
  const table = {
    "/api/movement": movement,
    "/api/days": days,
    "/api/todos": apiTodos({ root }),
    ...skillPayloads({ root, movement, maxDays }),
  };
  let bytes = 0;
  for (const date of daysNewestFirst(root, days)) {
    const payloads = dayPayloads({ root, date });
    if (!payloads) continue;
    const size = JSON.stringify(payloads).length;
    if (bytes > 0 && bytes + size > budget) break;
    Object.assign(table, payloads);
    bytes += size;
  }
  return table;
}

/** The days a snapshot carries, newest first — read back off the table, so the two cannot disagree. */
export function bakedDays(data) {
  return Object.keys(data)
    .map((path) => path.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})$/)?.[1])
    .filter(Boolean)
    .sort()
    .reverse();
}

/** A built panel: its HTML, and the contents of every file that HTML points at. */
export function readPanelBundle(dist = DEFAULT_DIST) {
  const index = path.join(dist, "index.html");
  if (!fs.existsSync(index)) {
    throw new Error(`no built panel in ${dist} — run: npm run report:panel`);
  }
  const html = fs.readFileSync(index, "utf8");
  const assets = {};
  for (const [, url] of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const file = path.join(dist, url.replace(/^\//, ""));
    if (fs.existsSync(file)) assets[url] = fs.readFileSync(file, "utf8");
  }
  return { html, assets };
}

function assetText(assets, url) {
  if (!(url in assets)) throw new Error(`the built panel asks for ${url}, which is not in the bundle`);
  return assets[url];
}

/**
 * The HTML, with its script and stylesheet inlined.
 *
 * The panel policy is `default-src 'none'` with `script-src 'unsafe-inline'`, so an external reference is not
 * merely slower here, it is blocked: a built panel that keeps one shows a blank pane.
 */
export function inlineAssets(html, assets) {
  return html
    .replace(
      /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/,
      (_, url) => `<style>${assetText(assets, url)}</style>`
    )
    .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, "")
    .replace(
      /<script[^>]*src="([^"]+)"[^>]*><\/script>/,
      (_, url) => `<script type="module">${assetText(assets, url)}</script>`
    );
}

/** The HTML with the snapshot spliced in, so the app can answer before it ever looks for a network. */
export function withSnapshot(html, snapshot) {
  const script = `<script>window.__REPORT__ = ${JSON.stringify(snapshot)};</script>\n`;
  return html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : `${html}\n${script}`;
}

/**
 * Put the signpost in place when there is no panel at all.
 *
 * A plugin ships its panel file and Orca reads it when the panel opens, so a declared entry that is not there is
 * a plugin Orca refuses to load — which is why the signpost is committed as `panel.html` rather than only copied
 * into place. This is the repair for a copy of the plugin whose panel went missing anyway: a directory that is
 * not a git checkout, or one whose panel was deleted by hand. It never overwrites a panel that exists, so a
 * failed bake cannot take the last good one away.
 */
export function ensureFallback({ out = DEFAULT_OUT, fallback = DEFAULT_FALLBACK } = {}) {
  if (fs.existsSync(out) || !fs.existsSync(fallback)) return { written: false, out };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(fallback, out);
  return { written: true, out };
}

/**
 * The panel file as the marker names it: which bytes are there, not only which record they came from.
 *
 * Size and mtime are what a stat can answer, and they are enough to tell the file the baker wrote from the
 * committed signpost a clone starts with — replacing one with the other moves both.
 */
function panelStamp(file) {
  try {
    const { size, mtimeMs } = fs.statSync(file);
    return `${size}:${mtimeMs}`;
  } catch {
    return "absent";
  }
}

/** Build the snapshot, write the panel, and answer the path that was written. */
export function bake({
  root = DEFAULT_ROOT,
  dist = DEFAULT_DIST,
  out = DEFAULT_OUT,
  maxDays = MAX_DAYS,
  budget = MAX_SNAPSHOT_BYTES,
  now = new Date(),
} = {}) {
  const { html, assets } = readPanelBundle(dist);
  const data = payloadTable({ root, maxDays, budget });
  const snapshot = { bakedAt: now.toISOString(), newest: newestPack(root), days: bakedDays(data), data };
  const panel = withSnapshot(inlineAssets(html, assets), snapshot);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const staging = `${out}.tmp`;
  fs.writeFileSync(staging, panel);
  fs.renameSync(staging, out);
  return out;
}

/** Every file under a directory, in a stable order: the walk both fingerprints below are built on. */
function filesUnder(dir, base = dir, found = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      filesUnder(file, base, found);
      continue;
    }
    try {
      const { size, mtimeMs } = fs.statSync(file);
      found.push(`${path.relative(base, file)}:${size}:${mtimeMs}`);
    } catch {
      found.push(`${path.relative(base, file)}:gone`);
    }
  }
  return found;
}

/**
 * What the record looks like from outside: every file's path, size and mtime.
 *
 * A cheap question, so a poll can ask it often. "none" is a record with no files yet.
 */
export function recordFingerprint(root = DEFAULT_ROOT) {
  const files = filesUnder(root);
  return files.length ? files.join("|") : "none";
}

/** What the panel would show, hashed: two records that render the same hash the same. */
export function renderHash({ root = DEFAULT_ROOT, maxDays = MAX_DAYS, budget = MAX_SNAPSHOT_BYTES } = {}) {
  const data = payloadTable({ root, maxDays, budget });
  return createHash("sha256").update(JSON.stringify({ data, newest: newestPack(root) })).digest("hex");
}

/**
 * Bake only if the panel would show something else than what it shows now.
 *
 * The marker beside the panel holds what was last rendered *and* the file it was rendered into, so a change the
 * app does not read — a markdown nobody renders, a file rewritten with the same content — is not a repaint, and a
 * reader who is in the middle of the panel keeps their place. The file's own size and mtime are in there because
 * the panel is committed: a clone, or a checkout that restored the signpost from git, has a panel the baker never
 * wrote, and a marker that only knew the record would call that panel current and never render the record into it.
 * The marker is a sibling file rather than plugin storage because this runs in a plain Node process as often as in
 * a worker, and it is what keeps two callers from baking each other's work away.
 */
export function bakeIfStale({
  root = DEFAULT_ROOT,
  dist = DEFAULT_DIST,
  out = DEFAULT_OUT,
  maxDays = MAX_DAYS,
  budget = MAX_SNAPSHOT_BYTES,
  force = false,
  now = new Date(),
} = {}) {
  const stamp = renderHash({ root, maxDays, budget });
  const marker = `${out}.fingerprint`;
  const seen = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : null;
  const written = `${stamp}:${panelStamp(out)}`;
  if (!force && seen === written) return { baked: false, reason: "current", stamp };
  ensureFallback({ out });
  bake({ root, dist, out, maxDays, budget, now });
  fs.writeFileSync(marker, `${stamp}:${panelStamp(out)}\n`);
  return { baked: true, stamp, out };
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      out[args[i].slice(2)] = args[++i];
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out ?? DEFAULT_OUT;
  const written = bake({
    root: args.root ?? DEFAULT_ROOT,
    dist: args.dist ?? DEFAULT_DIST,
    out,
  });
  const size = (fs.statSync(written).size / 1024).toFixed(0);
  process.stdout.write(`panel baked: ${path.relative(process.cwd(), written)} (${size} kB)\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
