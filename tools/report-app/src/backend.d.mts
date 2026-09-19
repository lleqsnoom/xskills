/**
 * The types the app reads `backend.mjs` through.
 *
 * The rules live in plain JavaScript so a test can call them without a build step (the same reason
 * `resource.mjs` and `brief.mjs` exist), and a declaration beside them is how TypeScript still knows what they
 * hand back.
 */

export type Backend = {
  /** The payload the server holds for a route; rejects with a sentence worth showing. */
  read: <T>(path: string) => Promise<T>;
  /** Write a body to a route; rejects with a sentence worth showing. */
  write: <T>(path: string, body: unknown) => Promise<T>;
  /** Which bundle the server is serving now, or null when nothing can say. */
  bundleName: () => Promise<string | null>;
  /** Forget what has been read, because a write makes every answer stale. */
  invalidate: () => void;
};

export function httpBackend(options?: { fetchImpl?: typeof fetch }): Backend;