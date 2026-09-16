#!/usr/bin/env node
/**
 * SQLite stores, read without a dependency. `node:sqlite` is a Node built-in, so nothing is added to
 * the package, but it only exists from Node 22.5 — an older runtime gets a reason instead of an
 * import-time crash, and the host reports itself unreadable rather than absent.
 *
 * Node's own parser decides what these files contain, so a store this adapter cannot read fails
 * loudly, in whatever words the error carries. Queries are never swallowed.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let cached;
let cachedReason = null;

export function sqliteAvailable() {
  return sqliteModule() !== null;
}

export function sqliteModule() {
  if (cached !== undefined) return cached;
  try {
    cached = require("node:sqlite");
  } catch (err) {
    cached = null;
    cachedReason = `this Node has no node:sqlite (needs 22.5+): ${firstLine(err.message)}`;
  }
  return cached;
}

function firstLine(value) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 200) ?? "unknown error";
}

/** Open a store read-only. Returns `{ db }`, or `{ reason }` so the caller can report why it could not. */
export function openReadOnly(file) {
  if (!fs.existsSync(file)) return { reason: `no database at ${file}` };
  const sqlite = sqliteModule();
  if (!sqlite) return { reason: cachedReason };
  try {
    return { db: new sqlite.DatabaseSync(file, { readOnly: true }) };
  } catch (err) {
    return { reason: `cannot open ${file}: ${firstLine(err.message)}` };
  }
}

export function tablesOf(db) {
  return db.prepare("select name from sqlite_master where type = 'table'").all().map((row) => String(row.name));
}

export function columnsOf(db, table) {
  return db.prepare(`pragma table_info(${table})`).all().map((row) => String(row.name));
}
