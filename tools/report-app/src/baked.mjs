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

/** What to say when the snapshot does not hold what was asked for: name the days it does, and where to look. */
export function missingSentence(report, path) {
  const days = report?.days ?? [];
  const holds = !days.length
    ? "no day"
    : days.length === 1
      ? `${days[0]} only`
      : `${days.length} days, up to ${days[0]}`;
  return `this snapshot holds ${holds}, so it has no ${path} — open the live report for it`;
}

/**
 * A pane is a copy of the record, and a copy cannot write: it has no network. Say so, and say where the copy
 * that *can* be written is, rather than leaving a button looking broken.
 */
export function writeRefused(report, path) {
  return `this snapshot cannot write, so ${path} is unavailable — the live report is where the to-do buttons work`;
}

/**
 * What a link carries where it is rendered.
 *
 * In a panel the host cancels every click on an `<a href>` in the capture phase, before any handler of ours
 * runs — and it cancels navigations besides. So a snapshot renders the same anchors *without* an `href`: the
 * host leaves those alone, the app routes in memory as it already does, and the keyboard keeps its tab stop
 * through an explicit role.
 *
 * Returning the href only when it is safe to have one is the whole point: a link that keeps its href in a
 * panel is a click that does nothing, which is what "the buttons do not work" looked like.
 */
export function navProps({ baked, href }) {
  return baked ? { role: "link", tabindex: 0 } : { href };
}
