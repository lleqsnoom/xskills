/**
 * Is this page older than the app the server is serving?
 *
 * Opening the report focuses the tab that already has it (`scripts/report-open.mjs`), and focusing a tab does
 * not reload it: a reader can sit on yesterday's bundle for days, with every fix merged and none of it in front
 * of them. The bundle carries its own name (`/assets/index-<hash>.js`), the server reports the name its
 * `index.html` asks for (`GET /api/version`), and those two names differ exactly when the page is older than
 * the app. Then the page reloads itself once, and the reader gets what they were promised.
 *
 * Under `vite dev` the app runs from `/src/main.tsx`, which is not a build — a name that is not a bundle is a
 * name that says nothing about staleness.
 */

/** A built bundle's file name, or null when the url is not one (a dev module, a plain page). */
export function bundleName(url) {
  try {
    const name = new URL(url, "http://localhost").pathname.split("/").pop() ?? "";
    return /^index-[\w-]+\.js$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

/** Two names, one app: a page whose bundle is not the one being served is a page from before the last build. */
export function isStale(own, served) {
  return Boolean(own && served && own !== served);
}

/**
 * Watch for a newer build, and reload when there is one. Checked when the page becomes visible or focused —
 * the moment a reader comes back to it — and at least `everyMs` apart, because a page left open in the
 * foreground does not need an answer a second either. Returns a stop function.
 */
export function watchBuild({
  own = typeof import.meta !== "undefined" ? bundleName(import.meta.url) : null,
  check,
  reload = () => window.location.reload(),
  everyMs = 60_000,
  gapMs = 5_000,
  now = () => Date.now(),
} = {}) {
  // No bundle name, no check: a dev server serves modules, not a hashed bundle.
  if (!own || !check || typeof document === "undefined") return () => {};

  let last = 0;
  const look = async () => {
    const at = now();
    if (at - last < gapMs) return;
    last = at;
    const served = await check().catch(() => null);
    if (isStale(own, served)) reload();
  };

  const onWake = () => {
    if (document.visibilityState === "visible") void look();
  };
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);
  const timer = setInterval(() => void look(), everyMs);
  void look();

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("focus", onWake);
  };
}
