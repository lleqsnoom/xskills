/**
 * Is the page I am showing still true?
 *
 * The report is written to disk by the collector while a tab sits open, so the answer changes under the reader:
 * coming back to a tab, or leaving it open for a while, has to mean "read that screen again". This module
 * answers only *when* — what to re-read is the caller's business — which is why it holds no data, no route and
 * no backend, and why a test can drive it with a fake clock instead of sleeping.
 *
 * A plugin panel never arms this (`App.tsx` guards on the backend's kind): a snapshot has no network to
 * re-check with, so a signal there would be a request that cannot be made.
 */

/** Is a check due? `gapMs` keeps a burst of focus events from becoming a burst of requests. */
export function due({ now, last, gapMs }) {
  return now - last >= gapMs;
}

/**
 * Call `onDue` when the reader comes back (focus, or the tab becoming visible) and every `intervalMs` while the
 * tab is visible. Returns a stop function that removes every listener and silences the timer.
 *
 * The timer is injected because a test should not wait thirty seconds for an answer, and because the caller
 * that owns the process — a browser — owns its timers. Without a document there is nothing to watch, so this
 * answers a no-op stop function rather than throwing in a process that merely imported the app.
 */
export function watchFreshness({
  target = typeof document === "undefined" ? null : document,
  win = typeof window === "undefined" ? null : window,
  now = () => Date.now(),
  gapMs = 5_000,
  intervalMs = 30_000,
  timer = setInterval,
  clear = clearInterval,
  onDue = null,
} = {}) {
  if (!target || !win || typeof onDue !== "function") return () => {};

  let last = -Infinity;
  let stopped = false;
  const visible = () => target.visibilityState !== "hidden";

  const look = () => {
    if (stopped || !visible()) return;
    const at = now();
    if (!due({ now: at, last, gapMs })) return;
    last = at;
    onDue();
  };

  const handle = timer(look, intervalMs);
  target.addEventListener("visibilitychange", look);
  win.addEventListener("focus", look);

  return () => {
    stopped = true;
    clear(handle);
    target.removeEventListener("visibilitychange", look);
    win.removeEventListener("focus", look);
  };
}
