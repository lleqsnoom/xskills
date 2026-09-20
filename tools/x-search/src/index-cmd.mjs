import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isTextFile, languageOf, walkFiles } from "./chunk.mjs";
import { missingFiles, planRoot } from "./diff.mjs";
import { guardMessage, gitignoreWarning, storeGuard } from "./guard.mjs";
import { recordStore } from "./registry.mjs";
import { findWasm, hasParser, installGrammars } from "./grammars.mjs";
import { assertEmbedder, embedBatch, embedderConfig } from "./embed.mjs";
import { createSchema, countRows, deleteFileChunks, ensureStoreDir, insertChunks, metaGet, metaSet, openStore, SCHEMA_VERSION, storeExists, withTransaction } from "./store.mjs";
import { storePathFor } from "./roots.mjs";

export class StoreError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "StoreError";
    this.exitCode = exitCode;
  }
}

export class InterruptedError extends Error {
  constructor(message) {
    super(message);
    this.name = "InterruptedError";
    this.exitCode = 130;
  }
}

let stopRequested = false;

export function requestStop() {
  stopRequested = true;
}

export function resetStop() {
  stopRequested = false;
}

function existingSchema(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  return table ? metaGet(db, "schema") : null;
}

function assertRoots(roots) {
  if (!roots.length) {
    throw new StoreError("no repository to index — add --root <path>, or list one in the Orca IDE", 2);
  }
  for (const repo of roots) {
    if (!fs.existsSync(repo.root)) throw new StoreError(`no such root: ${repo.root}`, 2);
    if (fs.existsSync(repo.root) && !fs.statSync(repo.root).isDirectory()) throw new StoreError(`root is not a directory: ${repo.root}`, 2);
    const skills = path.join(repo.root, ".x-skills");
    if (fs.existsSync(skills) && !fs.statSync(skills).isDirectory()) {
      throw new StoreError(`${skills} is a file, not a directory`, 2);
    }
  }
}

export async function writePlan(db, plan, { log = () => {}, config, onBatch = null, shouldStop = () => stopRequested }) {
  const files = plan.changed;
  let written = 0;
  let dims = null;
  let index = 0;
  while (index < files.length) {
    const batch = [];
    let size = 0;
    while (index < files.length && size < config.batchSize) {
      batch.push(files[index]);
      size += files[index].chunks.length;
      index += 1;
    }
    const texts = batch.flatMap((file) => file.chunks.map((chunk) => chunk.text));
    const vectors = await embedBatch(texts, config);
    dims = dims || vectors[0]?.length || null;
    let cursor = 0;
    for (const file of batch) {
      const slice = vectors.slice(cursor, cursor + file.chunks.length);
      cursor += file.chunks.length;
      withTransaction(db, () => {
        deleteFileChunks(db, file.relPath);
        insertChunks(db, file.chunks, slice);
      });
      written += file.chunks.length;
    }
    log(`embedded ${written} chunks`);
    onBatch?.(files.slice(index).map((file) => file.relPath), written);
    if (index < files.length && shouldStop()) {
      throw new InterruptedError(`stopped after ${written} chunks`);
    }
  }
  return { written, dims };
}

export function readPending(db) {
  const raw = metaGet(db, "pending");
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

export function writePending(db, paths) {
  if (!paths.length) return clearPending(db);
  metaSet(db, "pending", JSON.stringify([...new Set(paths)]));
}

export function clearPending(db) {
  db.prepare("DELETE FROM meta WHERE key = 'pending'").run();
}

export async function indexRoot(db, repo, { force = false, env = process.env, log = () => {} } = {}) {

  const config = embedderConfig(env);
  const schema = existingSchema(db);
  if (schema && Number(schema) > SCHEMA_VERSION) {
    throw new StoreError(`store built by a newer x-search (schema ${schema}) — upgrade, or delete ${storePathFor(repo.root)}`);
  }
  const engine = createSchema(db, schema ? Number(metaGet(db, "dims")) || 768 : 768);
  metaSet(db, "schema", SCHEMA_VERSION);
  if (!metaGet(db, "engine")) metaSet(db, "engine", engine);
  const pending = readPending(db);
  const plan = await planRoot(db, repo.root, { force, log, only: pending ? new Set(pending) : null });
  const deleted = missingFiles(db, repo.root);
  for (const relPath of deleted) {
    withTransaction(db, () => deleteFileChunks(db, relPath));
    log(`${repo.id}: removed ${relPath}`);
  }
  writePending(db, plan.changed.map((file) => file.relPath));
  const { written, dims } = await writePlan(db, plan, { log, config, onBatch: (remaining) => writePending(db, remaining) });
  metaSet(db, "embedder", config.model);
  clearPending(db);
  recordStore(storePathFor(repo.root), env);
  metaSet(db, "built_at", new Date().toISOString());
  metaSet(db, "files", plan.candidates);
  metaSet(db, "skipped", plan.skipped);
  if (dims) metaSet(db, "dims", dims);
  return {
    id: repo.id,
    name: repo.name,
    root: repo.root,
    store: storePathFor(repo.root),
    files: plan.candidates,
    skipped: plan.skipped,
    unchanged: plan.unchanged,
    changed: plan.changed.length,
    deleted: deleted.length,
    written,
    chunks: countRows(db, "chunks"),
  };
}

function missingGrammarsFor(root, log) {
  const langs = new Set(walkFiles(root).filter(isTextFile).map(languageOf));
  const missing = [...langs].filter((lang) => !findWasm(lang));
  if (!missing.length) return [];
  return installGrammars(missing, { log }) ? [] : missing;
}

export async function runIndex({ roots, force = false, allowDirty = false, env = process.env, log = () => {} } = {}) {
  assertRoots(roots);
  for (const repo of roots) {
    const guard = storeGuard(repo.root, { allowDirty });
    if (!guard.ok) throw new StoreError(guardMessage(repo.root, guard));
  }
  const warnings = roots.map((repo) => gitignoreWarning(repo.root)).filter(Boolean);
  await assertEmbedder(env);
  if (env.X_SEARCH_INSTALL_GRAMMARS === "1" && hasParser()) {
    for (const repo of roots) missingGrammarsFor(repo.root, log);
  }
  const results = [];
  for (const repo of roots) {
    if (!storeExists(repo.root)) ensureStoreDir(repo.root);
    const db = openStore(storePathFor(repo.root));
    try {
      results.push(await indexRoot(db, repo, { force, env, log }));
    } finally {
      db.close();
    }
  }
  return {
    files: results.reduce((total, result) => total + result.files, 0),
    chunks: results.reduce((total, result) => total + result.chunks, 0),
    skipped: results.reduce((total, result) => total + result.skipped, 0),
    unchanged: results.reduce((total, result) => total + result.unchanged, 0),
    store: results.length === 1 ? results[0].store : results.map((result) => result.store),
    roots: results,
    warnings,
  };
}
