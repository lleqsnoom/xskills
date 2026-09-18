/**
 * Where a resource is, and the one safe way to read it.
 *
 * Solid hands a failed fetch to a view by *throwing* out of the resource's accessor — that is how an
 * ErrorBoundary is meant to catch it. So every unguarded read of a failed resource throws from inside the
 * update that recorded the failure, aborts the rest of that update, and leaves the view as it was a moment
 * earlier: a spinner that never turns into a message. A memo that reads it does the same thing from further
 * away, which is why the guard has to be shared rather than spelled out at each call site.
 *
 * `.mjs` rather than `.ts`, like `baked.mjs`: the app is bundled and the rules are not, so a test can call
 * them directly.
 */

/** A failure, a fetch in flight, a settled answer with nothing in it, or a value. */
export function viewState(resource) {
  if (resource.error !== undefined) return "error";
  if (resource.loading) return "loading";
  return settled(resource) == null ? "empty" : "ready";
}

/** The value, or undefined when it is not safe to ask for one. A failed resource is never read. */
export function settled(resource) {
  if (resource.error !== undefined) return undefined;
  return resource();
}

/** What to show for a failure, whatever was thrown: an Error, or something that is not one. */
export function errorMessage(resource) {
  const error = resource.error;
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}
