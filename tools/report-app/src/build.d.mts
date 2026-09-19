/**
 * The types the app reads `build.mjs` through.
 *
 * The rules live in plain JavaScript so a test can call them without a build step, and a declaration beside
 * them is how TypeScript still knows what they hand back.
 */
export function bundleName(url: string): string | null;

/** Is the page running a bundle other than the one the server is serving now? */
export function isStale(own: string | null, served: string | null): boolean;

/**
 * Watch for a newer build and reload when there is one. `check` answers the name the server serves.
 * Returns the function that stops the watching.
 */
export function watchBuild(options?: {
  own?: string | null;
  check?: () => Promise<string | null>;
  reload?: () => void;
  everyMs?: number;
  gapMs?: number;
  now?: () => number;
}): () => void;
