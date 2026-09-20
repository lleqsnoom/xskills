import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const VECTOR_SCHEMA = {
  vec0: (dims) => `CREATE VIRTUAL TABLE IF NOT EXISTS vec_rows USING vec0(embedding float[${dims}])`,
  blob: () => `CREATE TABLE IF NOT EXISTS vectors(
    chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL
  )`,
};

const BINARY_BY_PLATFORM = {
  linux: "vec0.so",
  darwin: "vec0.dylib",
  win32: "vec0.dll",
};

export function binaryName(platform = process.platform) {
  return BINARY_BY_PLATFORM[platform] || "vec0.so";
}

export function resolveVec0Path(env = process.env, { platform = process.platform, arch = process.arch } = {}) {
  if (env.X_SEARCH_NO_VEC0 === "1") return null;
  if (env.X_SEARCH_VEC0) return fs.existsSync(env.X_SEARCH_VEC0) ? env.X_SEARCH_VEC0 : null;
  const candidates = [`sqlite-vec-${platform}-${arch}/${binaryName(platform)}`, "sqlite-vec"];
  for (const candidate of candidates) {
    try {
      const resolved = require.resolve(candidate);
      if (fs.existsSync(resolved) && resolved.endsWith(binaryName(platform))) return resolved;
    } catch {
      continue;
    }
  }
  try {
    const umbrella = require("sqlite-vec");
    const loadable = umbrella?.getLoadablePath?.();
    return loadable && fs.existsSync(loadable) ? loadable : null;
  } catch {
    return null;
  }
}

export function loadVec0(db, vec0Path) {
  if (!vec0Path) return null;
  try {
    db.loadExtension(vec0Path);
    return db.prepare("SELECT vec_version() AS v").get().v;
  } catch {
    return null;
  }
}

export function openEngineDatabase(file, { readOnly = false } = {}) {
  const module = require("node:sqlite");
  return new module.DatabaseSync(file, { readOnly, allowExtension: true });
}
