/**
 * The types the app reads `revalidate.mjs` through.
 *
 * The rules live in plain JavaScript so a test can drive them with a fake clock (the same reason `resource.mjs`
 * and `backend.mjs` exist), and a declaration beside them is how TypeScript still knows what they take.
 */

export function due(input: { now: number; last: number; gapMs: number }): boolean;

export type FreshnessOptions = {
  target?: { visibilityState: string; addEventListener: (n: string, h: () => void) => void; removeEventListener: (n: string, h: () => void) => void } | null;
  win?: { addEventListener: (n: string, h: () => void) => void; removeEventListener: (n: string, h: () => void) => void } | null;
  now?: () => number;
  gapMs?: number;
  intervalMs?: number;
  timer?: (handler: () => void, ms: number) => unknown;
  clear?: (handle: unknown) => void;
  onDue?: (() => void) | null;
};

export function watchFreshness(options?: FreshnessOptions): () => void;
