import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cosine, fromBlob, toBlob } from "./embed.mjs";
import { loadVec0, resolveVec0Path } from "./engine.mjs";

export const SCHEMA_VERSION = 1;

export function openStore(file, { readOnly = false, vec0 = resolveVec0Path() } = {}) {
  const db = new DatabaseSync(file, { readOnly, allowExtension: Boolean(vec0) });
  db.vec0Path = vec0 && loadVec0(db, vec0) ? vec0 : null;
  return db;
}

export function preferredEngine(db, dims = 768) {
  const stored = metaGet(db, "engine");
  if (stored === "vec0" && !db.vec0Path) return "vec0-unavailable";
  if (stored) return stored;
  return db.vec0Path ? "vec0" : "blob";
}

export function createSchema(db, dims = 768) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS chunks(
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      lang TEXT,
      symbol TEXT,
      kind TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, path, symbol, content='chunks', content_rowid='id', tokenize='unicode61');
  `);
  if (db.vec0Path) {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_rows USING vec0(embedding float[${dims}])`);
    return "vec0";
  }
  db.exec(`CREATE TABLE IF NOT EXISTS vectors(
    chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL
  )`);
  return "blob";
}

export function withTransaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* a rollback after a failed BEGIN is not interesting */
    }
    throw error;
  }
}

export function hasTable(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(name));
}

export function vectorTable(db) {
  if (hasTable(db, "vec_rows")) return "vec_rows";
  if (hasTable(db, "vectors")) return "vectors";
  return db.vec0Path ? "vec_rows" : "vectors";
}

export function countRows(db, table) {
  return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
}

export function metaGet(db, key) {
  return db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
}

export function metaSet(db, key, value) {
  db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

export function metaAll(db) {
  return Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((row) => [row.key, row.value]));
}

export function fileState(db, relPath) {
  const row = db.prepare("SELECT max(mtime) AS mtime, max(size) AS size, count(*) AS n FROM chunks WHERE path = ?").get(relPath);
  return row.n > 0 ? { mtime: row.mtime, size: row.size, chunks: row.n } : null;
}

export function listStoredPaths(db) {
  return db.prepare("SELECT path, max(mtime) AS mtime, max(size) AS size FROM chunks GROUP BY path").all();
}

export function deleteFileChunks(db, relPath) {
  const rows = db.prepare("SELECT id, text, path, symbol FROM chunks WHERE path = ?").all(relPath);
  const dropFts = db.prepare("INSERT INTO chunks_fts(chunks_fts, rowid, text, path, symbol) VALUES ('delete', ?, ?, ?, ?)");
  for (const row of rows) dropFts.run(row.id, row.text, row.path, row.symbol);
  const table = vectorTable(db);
  if (hasTable(db, table)) {
    if (table === "vec_rows") db.prepare("DELETE FROM vec_rows WHERE rowid IN (SELECT id FROM chunks WHERE path = ?)").run(relPath);
    else db.prepare("DELETE FROM vectors WHERE chunk_id IN (SELECT id FROM chunks WHERE path = ?)").run(relPath);
  }
  db.prepare("DELETE FROM chunks WHERE path = ?").run(relPath);
  return rows.length;
}

export function insertChunks(db, chunks, vectors) {
  const insertChunk = db.prepare(
    "INSERT INTO chunks(path, lang, symbol, kind, start_line, end_line, hash, mtime, size, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const usesVec0 = vectorTable(db) === "vec_rows";
  const insertVector = usesVec0
    ? db.prepare("INSERT INTO vec_rows(rowid, embedding) VALUES (?, ?)")
    : db.prepare("INSERT INTO vectors(chunk_id, embedding) VALUES (?, ?)");
  const insertFts = db.prepare("INSERT INTO chunks_fts(rowid, text, path, symbol) VALUES (?, ?, ?, ?)");
  chunks.forEach((chunk, index) => {
    const info = insertChunk.run(chunk.path, chunk.lang, chunk.symbol, chunk.kind, chunk.startLine, chunk.endLine, chunk.hash, chunk.mtime, chunk.size, chunk.text);
    const id = Number(info.lastInsertRowid);
    insertVector.run(usesVec0 ? BigInt(id) : id, usesVec0 ? vectors[index] : toBlob(vectors[index]));
    insertFts.run(id, chunk.text, chunk.path, chunk.symbol);
  });
}

export function vectorRows(db) {
  return db
    .prepare("SELECT chunk_id, embedding FROM vectors")
    .all()
    .map((row) => ({ chunkId: row.chunk_id, vector: new Float32Array(new Uint8Array(row.embedding).buffer) }));
}

export function vectorRanks(db, queryVector, limit) {
  const table = vectorTable(db);
  if (table === "vec_rows" && !db.vec0Path) return null;
  if (table === "vec_rows") {
    return db
      .prepare("SELECT rowid AS chunkId, distance FROM vec_rows WHERE embedding MATCH ? ORDER BY distance LIMIT ?")
      .all(queryVector, limit)
      .map((row) => ({ chunkId: Number(row.chunkId), similarity: 1 - row.distance }));
  }
  return vectorRows(db)
    .map((row) => ({ chunkId: row.chunkId, similarity: cosine(queryVector, row.vector) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export function countVectors(db) {
  const table = vectorTable(db);
  if (table === "vec_rows" && !db.vec0Path) return 0;
  return countRows(db, table);
}

export function chunksByIds(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`SELECT id, path, lang, symbol, kind, start_line, end_line, text FROM chunks WHERE id IN (${placeholders})`).all(...ids);
}

export function ensureStoreDir(root) {
  const dir = path.join(root, ".x-skills", ".index");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function storeExists(root) {
  return fs.existsSync(path.join(root, ".x-skills", ".index", "index.db"));
}
