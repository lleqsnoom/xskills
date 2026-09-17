/**
 * The app, running on a snapshot.
 *
 * A plugin panel is a document with `connect-src 'none'`: it cannot ask the server for anything. So the server
 * bakes the payloads the app would have asked for into the panel file, and the app answers from them exactly
 * as it answers from the network. Nothing here fetches, and nothing here writes.
 */

/** The snapshot this document carries, or null. In the served app there is no `window.__REPORT__`. */
export function bakedReport() {
  if (typeof window === "undefined") return null;
  return window.__REPORT__ ?? null;
}

export function isBaked(report) {
  return Boolean(report);
}

/**
 * The payload baked under a path, or null.
 *
 * The query is a knob (`?days=14`), not part of the key: a snapshot holds one answer per route, and the app
 * must not miss it over a parameter the bake fixed anyway.
 */
export function bakedAt(report, path) {
  const data = report?.data;
  if (!data || typeof data !== "object") return null;
  if (Object.hasOwn(data, path)) return data[path];
  const bare = path.split("?")[0];
  return Object.hasOwn(data, bare) ? data[bare] : null;
}

/** What to say when the snapshot does not hold what was asked for: name the day it does, and where to look. */
export function missingSentence(report, path) {
  const day = report?.newest ?? "no day";
  return `this snapshot holds ${day} only, so it has no ${path} — open the live report for it`;
}

/** A snapshot cannot write: it has no network, so say so rather than leave a button looking broken. */
export function writeRefused(report, path) {
  return `this snapshot cannot write, so ${path} is unavailable — open the live report for it`;
}
