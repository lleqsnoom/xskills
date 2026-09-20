import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function registryFile(env = process.env) {
  if (env.X_SEARCH_STATE) return env.X_SEARCH_STATE;
  const base = env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(), ".local", "state");
  return path.join(base, "x-search", "stores.json");
}

export function readRegistry(env = process.env) {
  const file = registryFile(env);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed.stores) ? parsed.stores : [];
  } catch {
    return [];
  }
}

export function writeRegistry(stores, env = process.env) {
  const file = registryFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ stores: [...new Set(stores)].sort() }, null, 2)}\n`);
  return file;
}

export function recordStore(storePath, env = process.env) {
  const stores = readRegistry(env);
  if (stores.includes(storePath)) return stores;
  return writeRegistry([...stores, storePath], env);
}
