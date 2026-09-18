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
import { fileURLToPath, pathToFileURL } from "node:url";
import { apiBench, apiControl, apiDay, apiDays, apiFactors, apiFlow, apiInterval, apiLedger, apiMovement, apiRatchet, apiRecurrence, apiSchedule, apiSession, apiSkill, apiTodos, newestPack, packFile } from "./report-server.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_ROOT = path.join(REPO_ROOT, ".x-skills", "daily");
export const DEFAULT_DIST = path.join(REPO_ROOT, "tools", "report-app", "dist-panel");
export const DEFAULT_OUT = path.join(REPO_ROOT, "tools", "orca-plugin", "panel.html");
const MAX_DAYS = 14;
/** The ledger reads a longer window than the movement table: a fix takes days to show up as held or flat. */
const LEDGER_DAYS = 30;
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
    // The improvement views. They are derived from the same packs and cost a few kilobytes each, so a panel
    // can answer every one of them without a network.
    "/api/ledger": apiLedger({ root, maxDays: LEDGER_DAYS }),
    "/api/ratchet": apiRatchet({ root, maxDays }),
    "/api/bench": apiBench({ root, maxDays }),
    "/api/recurrence": apiRecurrence({ root, maxDays }),
    "/api/control": apiControl({ root, maxDays }),
    "/api/interval": apiInterval({ root, maxDays }),
    "/api/factors": apiFactors({ root, maxDays }),
    "/api/flow": apiFlow({ root, maxDays }),
    "/api/schedule": apiSchedule({ root, maxDays }),
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
  fs.writeFileSync(out, panel);
  return out;
}

/**
 * What the record looks like right now: the newest pack, and the size and mtime of the file that carries it.
 *
 * `none` is a record with no packs yet. A change under the newest pack is what a bake is for, and both callers
 * — the server's poll and the plugin worker — compare this string rather than re-reading the record.
 */
export function packFingerprint(root = DEFAULT_ROOT) {
  const newest = newestPack(root);
  if (!newest) return "none";
  const file = packFile(root, newest);
  if (!fs.existsSync(file)) return `${newest}:missing`;
  // Sub-millisecond mtime, unrounded: a pack written twice in the same millisecond is still a bake.
  const { size, mtimeMs } = fs.statSync(file);
  return `${newest}:${size}:${mtimeMs}`;
}

/**
 * Bake only if the panel is behind the record.
 *
 * `fingerprint` is remembered beside the panel (a sibling file, not plugin storage: this runs in a plain Node
 * process as often as in a worker) so two callers cannot bake each other's work away, and a caller that has
 * nothing to do pays one stat.
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
  const stamp = packFingerprint(root);
  const marker = `${out}.fingerprint`;
  const seen = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : null;
  if (!force && seen === stamp && fs.existsSync(out)) return { baked: false, reason: "current", stamp };
  bake({ root, dist, out, maxDays, budget, now });
  fs.writeFileSync(marker, `${stamp}\n`);
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
  const written = bake({
    root: args.root ?? DEFAULT_ROOT,
    dist: args.dist ?? DEFAULT_DIST,
    out: args.out ?? DEFAULT_OUT,
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
