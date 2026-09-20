import fs from "node:fs";
import path from "node:path";
import { embedBatch, embedderConfig, EmbedderUnreachable } from "./embed.mjs";
import { openStore, storeExists, vectorRanks } from "./store.mjs";
import { storePathFor } from "./roots.mjs";

export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 50;
export const SNIPPET_CHARS = 400;
export const RRF_K = 60;
const RANK_POOL = 50;

const CHUNK_COLUMNS = "c.id, c.path, c.lang, c.symbol, c.kind, c.start_line, c.end_line, c.mtime, c.text";
const MIN_TOKEN_CHARS = 2;

export function tokenize(query) {
  return query
    .split(/\s+/)
    .map((token) => token.replace(/["'*()]/g, " ").trim())
    .filter((token) => token.length >= MIN_TOKEN_CHARS);
}

function keywordRows(db, tokens) {
  const sql = `SELECT ${CHUNK_COLUMNS}, bm25(chunks_fts, 10.0, 4.0, 8.0) AS score
    FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
    WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?`;
  const statement = db.prepare(sql);
  const rows = statement.all(tokens.map((token) => `"${token}"`).join(" OR "), RANK_POOL);
  if (rows.length || tokens.length !== 1 || tokens[0].length < 3) return rows;
  return statement.all(`"${tokens[0]}"*`, RANK_POOL);
}

const passesFilter = (chunk, { lang, pathFilter }) => (!lang || chunk.lang === lang) && (!pathFilter || chunk.path.includes(pathFilter));

function rankPool(rows, filter) {
  return rows
    .filter((row) => passesFilter(row, filter))
    .slice(0, RANK_POOL)
    .map((row) => ({ id: row.id, chunk: row }));
}

function keywordRank(db, query, filter) {
  const tokens = tokenize(query);
  if (!tokens.length) return null;
  return rankPool(keywordRows(db, tokens), filter);
}

function vectorRank(db, queryVector, filter) {
  if (!queryVector) return [];
  const scored = vectorRanks(db, queryVector, RANK_POOL);
  if (scored === null) return null;
  if (!scored.length) return [];
  const placeholders = scored.map(() => "?").join(",");
  const rows = new Map(
    db.prepare(`SELECT ${CHUNK_COLUMNS} FROM chunks c WHERE c.id IN (${placeholders})`).all(...scored.map((row) => row.chunkId)).map((row) => [row.id, row]),
  );
  return scored
    .filter((row) => rows.has(row.chunkId) && passesFilter(rows.get(row.chunkId), filter))
    .map((row) => ({ id: row.chunkId, chunk: rows.get(row.chunkId), natural: row.similarity }));
}

export function reciprocalRankFusion(lists) {
  const fused = new Map();
  for (const list of lists) {
    list.forEach((entry, position) => {
      const current = fused.get(entry.id) || { id: entry.id, chunk: entry.chunk, score: 0, sides: 0 };
      current.score += 1 / (RRF_K + position + 1);
      current.sides += 1;
      fused.set(entry.id, current);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

function fileMtime(root, relPath) {
  try {
    return Math.floor(fs.statSync(path.join(root, relPath)).mtimeMs);
  } catch {
    return null;
  }
}

const toHit = (entry, project, root) => {
  const current = fileMtime(root, entry.chunk.path);
  return {
    project,
    path: entry.chunk.path,
    lineStart: entry.chunk.start_line,
    lineEnd: entry.chunk.end_line,
    symbol: entry.chunk.symbol || null,
    chunkKind: entry.chunk.kind,
    score: Number(entry.score.toFixed(6)),
    sides: entry.sides,
    stale: current === null || current !== entry.chunk.mtime,
    snippet: entry.chunk.text.length > SNIPPET_CHARS ? `${entry.chunk.text.slice(0, SNIPPET_CHARS)}…` : entry.chunk.text,
  };
};

function fuseStore(db, { query, queryVector, mode, filter, limit }) {
  const keyword = mode === "vector" ? null : keywordRank(db, query, filter);
  const vector = mode === "keyword" ? [] : vectorRank(db, queryVector, filter);
  const lists = [keyword, vector].filter((list) => list && list.length);
  if (mode === "keyword" && !keyword) return { entries: [], keywordTooShort: true };
  return {
    entries: reciprocalRankFusion(lists).slice(0, limit),
    keywordTooShort: keyword === null,
    engineUnavailable: vector === null,
  };
}

function hitStore(repo, { query, queryVector, mode, filter, limit }) {
  const db = openStore(storePathFor(repo.root), { readOnly: true });
  try {
    const fused = fuseStore(db, { query, queryVector, mode, filter, limit });
    const { entries, engineUnavailable, keywordTooShort } = fused;
    return { hits: entries.map((entry) => toHit(entry, repo.id, repo.root)), engineUnavailable, keywordTooShort, table: db.vec0Path };
  } finally {
    db.close();
  }
}

export async function runSearch({ query, roots, limit = DEFAULT_LIMIT, mode = "hybrid", lang, pathFilter, project, env = process.env, log = () => {} }) {
  const bounded = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const selected = project ? roots.filter((repo) => repo.id === project || repo.name === project) : roots;
  const stores = selected.filter((repo) => storeExists(repo.root));
  const degraded = new Set();
  const index = { missing: stores.length === 0, stale: false, degraded: null, unreadable: [], limit: bounded, mode };
  if (index.missing) return { hits: [], index };

  const config = embedderConfig(env);
  let queryVector = null;
  if (mode !== "keyword") {
    try {
      [queryVector] = await embedBatch([query], config);
    } catch (error) {
      if (!(error instanceof EmbedderUnreachable) || mode === "vector") throw error;
      degraded.add("embedder unreachable");
    }
  }

  const hits = [];
  const filter = { lang, pathFilter };
  for (const repo of stores) {
    try {
      const result = hitStore(repo, { query, queryVector, mode, filter, limit: bounded });
      if (result.keywordTooShort) degraded.add("query too short for keyword");
      if (result.engineUnavailable) {
        log(`${repo.id}: this store needs vec0, which is not available here — searches fall back to keyword`);
        degraded.add("vector engine unavailable");
      }
      hits.push(...result.hits);
    } catch (error) {
      log(`${repo.id}: ${error.message}`);
      index.unreadable.push(repo.id);
    }
  }
  hits.sort((a, b) => b.score - a.score);
  index.stale = hits.some((hit) => hit.stale);
  index.degraded = degraded.size ? [...degraded].join("; ") : null;
  log(`searched ${stores.length} store(s)`);
  return { hits: hits.slice(0, bounded), index };
}
