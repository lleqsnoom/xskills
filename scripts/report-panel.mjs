#!/usr/bin/env node
/**
 * Bake the report's UI into the Orca plugin's panel.
 *
 * A panel is a document with no network, and Orca re-reads its entry file from disk on every open. So the app
 * is built to a single HTML file (no external reference survives the policy) and the payloads it would have
 * fetched are written into that same file. Every panel open then shows the newest baked record, and the server
 * re-bakes after anything that changes the record.
 *
 * Usage: node scripts/report-panel.mjs [--root <dir>] [--dist <dir>] [--out <file>]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { apiDay, apiDays, apiMovement, apiSession, apiSkill, apiTodos, newestPack } from "./report-server.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_ROOT = path.join(REPO_ROOT, ".x-skills", "daily");
export const DEFAULT_DIST = path.join(REPO_ROOT, "tools", "report-app", "dist-panel");
export const DEFAULT_OUT = path.join(REPO_ROOT, "tools", "orca-plugin", "panel.html");
const MAX_DAYS = 14;

/** The newest day, its sessions, and the skills the movement rows name: every drill-down the app offers. */
function dayPayloads({ root, newest, movement, maxDays }) {
  const day = apiDay({ root, date: newest });
  const payloads = { [`/api/day/${newest}`]: day };
  for (const session of day?.pack?.sessions ?? []) {
    payloads[`/api/day/${newest}/session/${session.id}`] = apiSession({ root, date: newest, id: session.id });
  }
  for (const row of movement.movement ?? []) {
    payloads[`/api/skill/${row.name}`] = apiSkill({ root, name: row.name, maxDays });
  }
  return payloads;
}

/**
 * Every payload the app asks for, keyed by the path it asks for it on.
 *
 * One day is baked, not the window: the newest pack is the one the reader is looking at, and carrying fourteen
 * of them would multiply the file by about ten for screens nobody opens first.
 */
export function payloadTable({ root = DEFAULT_ROOT, maxDays = MAX_DAYS } = {}) {
  const movement = apiMovement({ root, maxDays });
  const newest = newestPack(root);
  return {
    "/api/movement": movement,
    "/api/days": apiDays({ root, maxDays }),
    "/api/todos": apiTodos({ root }),
    ...(newest ? dayPayloads({ root, newest, movement, maxDays }) : {}),
  };
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
  now = new Date(),
} = {}) {
  const { html, assets } = readPanelBundle(dist);
  const snapshot = { bakedAt: now.toISOString(), newest: newestPack(root), data: payloadTable({ root, maxDays }) };
  const panel = withSnapshot(inlineAssets(html, assets), snapshot);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, panel);
  return out;
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
