import fs from "node:fs";
import path from "node:path";
import { chunkFile, isTextFile, readChunkableFile, walkFiles } from "./chunk.mjs";
import { fileState } from "./store.mjs";

const chunkKey = (rows) =>
  rows
    .map((row) => `${row.start_line ?? row.startLine}:${row.hash}`)
    .sort()
    .join("|");

async function planFile(db, root, relPath, { force, log }) {
  const state = fileState(db, relPath);
  const stat = fs.statSync(path.join(root, relPath));
  const mtime = Math.floor(stat.mtimeMs);
  if (!force && state && state.mtime === mtime && state.size === stat.size) return { status: "unchanged" };
  const chunks = await chunkFile(root, relPath, { log });
  if (!chunks.length) return { status: "empty" };
  if (!force && state) {
    const stored = db.prepare("SELECT start_line, hash FROM chunks WHERE path = ?").all(relPath);
    if (chunkKey(stored) === chunkKey(chunks.map((chunk) => ({ start_line: chunk.startLine, hash: chunk.hash })))) {
      db.prepare("UPDATE chunks SET mtime = ? WHERE path = ?").run(chunks[0].mtime, relPath);
      return { status: "unchanged" };
    }
  }
  return { status: "changed", chunks };
}

export async function planRoot(db, root, { force = false, log = () => {}, only = null } = {}) {
  const candidates = only ? [...only].filter(isTextFile) : walkFiles(root);
  const plan = { changed: [], skipped: 0, unchanged: 0, candidates: 0 };
  for (const relPath of candidates) {
    try {
      if (!isTextFile(relPath)) {
        plan.skipped += 1;
        continue;
      }
      const read = readChunkableFile(root, relPath);
      if (!read) {
        plan.skipped += 1;
        continue;
      }
      plan.candidates += 1;
      const decided = await planFile(db, root, relPath, { force, log });
      if (decided.status === "changed") plan.changed.push({ relPath, chunks: decided.chunks });
      else if (decided.status === "unchanged") plan.unchanged += 1;
    } catch {
      plan.skipped += 1;
    }
  }
  return plan;
}

export function missingFiles(db, root) {
  return db
    .prepare("SELECT path, max(mtime) AS mtime, max(size) AS size FROM chunks GROUP BY path")
    .all()
    .filter((row) => !fs.existsSync(path.join(root, row.path)))
    .map((row) => row.path);
}

export function deletedByPath(root, relPaths) {
  return relPaths.filter((relPath) => !fs.existsSync(path.join(root, relPath)));
}
