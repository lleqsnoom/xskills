import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** How long a holder may hold the lock before it is assumed to have died mid-write. */
const LOCK_STALE_MS = 10000;
/** How long a writer waits for another before going ahead unlocked. */
const LOCK_WAIT_MS = 2000;
const LOCK_POLL_MS = 25;

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

/**
 * Publish the list where a reader can only ever see all of it: a temp file beside the target, renamed
 * over it. A reader that caught the target half-written would parse nothing and conclude that the whole
 * registry is empty, which is the one failure this file must not have.
 */
function publish(stores, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ stores: [...new Set(stores)].sort() }, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function reclaimStaleLock(lock) {
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
  } catch {
    // the holder released it between the test and the remove, so there is nothing to reclaim
  }
}

/**
 * `watch` runs for weeks while `index --all` is a command a reader can run beside it, and both record
 * stores: read the list, add one, write it back. Overlap the two and the second write drops the first
 * one's entry. The lock is a file created with `wx`, so exactly one process can hold it; a holder that
 * died leaves it behind and the next writer reclaims it. A writer that cannot get the lock in
 * LOCK_WAIT_MS goes ahead anyway, because the publish is atomic and a lost entry is recoverable while a
 * stalled indexing pass is not.
 */
function withLock(file, work) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      reclaimStaleLock(lock);
      if (Date.now() >= deadline) return work();
      sleep(LOCK_POLL_MS);
      continue;
    }
    try {
      return work();
    } finally {
      fs.rmSync(lock, { force: true });
    }
  }
}

/**
 * Read the registry, hand it to `mutate`, and publish what comes back, all under the lock: the mutation
 * is decided against the list as it is now, not as it was when the caller last looked.
 */
export function updateRegistry(mutate, env = process.env) {
  const file = registryFile(env);
  return withLock(file, () => {
    const next = mutate(readRegistry(env));
    publish(next, file);
    return next;
  });
}

export function recordStore(storePath, env = process.env) {
  return updateRegistry((stores) => (stores.includes(storePath) ? stores : [...stores, storePath]), env);
}
