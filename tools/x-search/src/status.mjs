import fs from "node:fs";
import path from "node:path";
import { MESSAGES } from "./messages.mjs";
import { readRegistry, writeRegistry } from "./registry.mjs";
import { countRows, countVectors, metaAll, openStore, storeExists, vectorTable } from "./store.mjs";
import { storePathFor } from "./roots.mjs";

const rootOf = (storePath) => path.dirname(path.dirname(path.dirname(storePath)));

function describeStore(storePath) {
  const db = openStore(storePath, { readOnly: true });
  try {
    const meta = metaAll(db);
    const chunks = countRows(db, "chunks");
    const vectors = countVectors(db);
    return {
      chunks,
      vectors,
      mismatched: chunks !== vectors,
      engine: meta.engine || "blob",
      engineTable: vectorTable(db),
      embedder: meta.embedder || null,
      dims: meta.dims ? Number(meta.dims) : null,
      schema: meta.schema ? Number(meta.schema) : null,
      builtAt: meta.built_at || null,
      files: meta.files ? Number(meta.files) : null,
      skipped: meta.skipped ? Number(meta.skipped) : null,
      pending: meta.pending ? JSON.parse(meta.pending).length : 0,
      withVectors: vectors > 0,
    };
  } finally {
    db.close();
  }
}

function sourceOf(root, roots) {
  const match = roots.find((repo) => repo.root === root);
  if (match) return match.source;
  if (!fs.existsSync(root)) return "gone";
  return "unlisted";
}

export function collectStatus({ roots, env = process.env } = {}) {
  const known = new Set(readRegistry(env));
  for (const repo of roots) known.add(storePathFor(repo.root));

  return [...known]
    .map((storePath) => {
      const root = rootOf(storePath);
      const source = sourceOf(root, roots);
      if (!fs.existsSync(storePath)) {
        return { id: path.basename(root), root, store: storePath, source, missingStore: true, chunks: 0, vectors: 0 };
      }
      try {
        return { id: path.basename(root), root, store: storePath, source, missingStore: false, ...describeStore(storePath) };
      } catch (error) {
        return { id: path.basename(root), root, store: storePath, source, missingStore: false, unreadable: error.message, chunks: 0, vectors: 0 };
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function pruneStores({ roots, env = process.env, dryRun = false, log = () => {} } = {}) {
  const known = readRegistry(env);
  const doomed = known.filter((storePath) => !fs.existsSync(rootOf(storePath)));
  const kept = known.filter((storePath) => !doomed.includes(storePath));
  if (doomed.length && !dryRun) {
    for (const storePath of doomed) {
      fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
      log(`x-search: pruned ${storePath}`);
    }
    writeRegistry(kept, env);
  }
  return { pruned: doomed, kept, dryRun };
}

export function formatStatus(rows) {
  if (!rows.length) return MESSAGES.noRoots();
  const header = `project        chunks  vectors  engine  built                files  skipped  source`;
  const lines = rows.map((row) => {
    const built = row.builtAt ? row.builtAt.slice(0, 16).replace("T", " ") : "never";
    const flag = row.mismatched ? "  mismatch" : "";
    const pending = row.pending ? `  pending:${row.pending}` : "";
    return `${String(row.id).padEnd(14)}  ${String(row.chunks).padStart(6)}  ${String(row.vectors).padStart(7)}  ${String(row.engine || "-").padEnd(6)}  ${built.padEnd(19)}  ${String(row.files ?? "-").padStart(5)}  ${String(row.skipped ?? "-").padStart(7)}  ${row.source}${flag}${pending}`;
  });
  const total = rows.reduce((sum, row) => sum + (row.chunks || 0), 0);
  return [header, ...lines, "", `${rows.length} store(s), ${total} chunks`].join("\n");
}
