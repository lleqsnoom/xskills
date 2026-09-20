import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { deletedByPath, missingFiles, planRoot } from "./diff.mjs";
import { assertEmbedder, embedderConfig } from "./embed.mjs";
import { writePlan } from "./index-cmd.mjs";
import { recordStore } from "./registry.mjs";
import { SCHEMA_VERSION, createSchema, deleteFileChunks, ensureStoreDir, metaGet, metaSet, openStore, storeExists, withTransaction } from "./store.mjs";
import { storePathFor } from "./roots.mjs";

export const DEFAULT_DEBOUNCE_MS = 2000;
export const DEFAULT_SCAN_INTERVAL_MS = 60000;
const FULL_PASS_THRESHOLD = 200;
const RETRY_MS = 5000;

const IGNORED_SEGMENTS = new Set(["node_modules", ".git", "dist", "build", ".venv", "vendor", ".index", ".astro", ".next"]);

export function isIgnoredChange(relPath) {
  return relPath.split(path.sep).some((segment) => IGNORED_SEGMENTS.has(segment));
}

function storedSchema(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  return table ? metaGet(db, "schema") : null;
}

function openWritableStore(root) {
  if (!storeExists(root)) ensureStoreDir(root);
  const db = openStore(storePathFor(root));
  const schema = storedSchema(db);
  if (schema && Number(schema) > SCHEMA_VERSION) {
    db.close();
    throw new Error(`store built by a newer x-search (schema ${schema})`);
  }
  const engine = createSchema(db, schema ? Number(metaGet(db, "dims")) || 768 : 768);
  metaSet(db, "schema", SCHEMA_VERSION);
  if (!metaGet(db, "engine")) metaSet(db, "engine", engine);
  return db;
}

async function removeDeleted(db, root, relPaths, log) {
  for (const relPath of relPaths) {
    withTransaction(db, () => deleteFileChunks(db, relPath));
    log(`${root}: removed ${relPath}`);
  }
}

export async function refreshRoot(repo, { env, log = () => {}, force = false, only = null }) {
  const config = embedderConfig(env);
  const db = openWritableStore(repo.root);
  try {
    const plan = await planRoot(db, repo.root, { force, log, only });
    const deleted = only ? deletedByPath(repo.root, [...only]) : missingFiles(db, repo.root);
    await removeDeleted(db, repo.root, deleted, log);
    const { written, dims } = await writePlan(db, plan, { log, config });
    if (dims) metaSet(db, "dims", dims);
    recordStore(storePathFor(repo.root), env);
    metaSet(db, "built_at", new Date().toISOString());
    metaSet(db, "embedder", config.model);
    return { ...plan, written, deleted };
  } finally {
    db.close();
  }
}

function createState(repo) {
  return { repo, watcher: null, gone: false, pending: new Set(), timer: null };
}

function markGone(state, log) {
  log(`${state.repo.id} is gone, no longer watched`);
  state.gone = true;
  state.watcher?.close();
  if (state.timer) clearTimeout(state.timer);
}

function schedulePass(state, ms) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    const batch = state.pending;
    state.pending = new Set();
    state.run(batch);
  }, ms);
}

function makePass(state, { env, log, retryMs }) {
  return async (batch) => {
    if (state.gone) return;
    if (!fs.existsSync(state.repo.root)) return markGone(state, log);
    const only = batch && batch.size > 0 && batch.size <= FULL_PASS_THRESHOLD ? batch : null;
    try {
      const result = await refreshRoot(state.repo, { env, log, only });
      log(`${state.repo.id}: ${result.changed.length} changed, ${result.deleted.length} removed, ${result.written} chunks`);
    } catch (error) {
      log(`${state.repo.id}: ${error.message} — retrying in ${retryMs}ms`);
      if (!batch) return;
      for (const relPath of batch) state.pending.add(relPath);
      schedulePass(state, retryMs);
    }
  };
}

function attachWatcher(state, { debounceMs, log }) {
  try {
    state.watcher = fs.watch(state.repo.root, { recursive: true }, (event, filename) => {
      const rel = filename ? filename.toString() : "";
      if (rel && isIgnoredChange(rel)) return;
      if (rel) state.pending.add(rel);
      schedulePass(state, debounceMs);
    });
  } catch (error) {
    log(`${state.repo.id}: cannot watch (${error.message}), polling instead`);
  }
}

function stopAll(states, ticker) {
  clearInterval(ticker);
  for (const state of states) {
    state.watcher?.close();
    if (state.timer) clearTimeout(state.timer);
  }
}

function untilSignal(signal) {
  if (signal) return signal;
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

export async function runWatch({ roots, env = process.env, log = () => {}, signal = null } = {}) {
  await assertEmbedder(env).catch((error) => {
    log(`${error.message} — the watcher waits for it and retries`);
  });
  const debounceMs = Number(env.X_SEARCH_DEBOUNCE || DEFAULT_DEBOUNCE_MS);
  const intervalMs = Number(env.X_SEARCH_SCAN_INTERVAL || DEFAULT_SCAN_INTERVAL_MS);
  const retryMs = Math.min(intervalMs, RETRY_MS);

  const states = roots.map(createState);
  for (const state of states) {
    state.run = makePass(state, { env, log, retryMs });
    await state.run(null);
    if (!state.gone) attachWatcher(state, { debounceMs, log });
  }
  log(`watching ${states.filter((state) => !state.gone).length} repository(ies)`);

  const ticker = setInterval(() => {
    for (const state of states) state.run(null);
  }, intervalMs);

  await untilSignal(signal);
  stopAll(states, ticker);
  return 0;
}
