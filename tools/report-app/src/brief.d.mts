/**
 * The types the app reads `brief.mjs` through.
 *
 * The rules live in plain JavaScript so a test can call them without a build step, and a declaration beside
 * them is how TypeScript still knows what they hand back.
 */
import type { TodoItem } from "./api";

/**
 * The selection as a markdown brief: the data sources, the loop, and one section per task with its evidence,
 * target and check. `generatedAt` and `savedAt` are stamped into it.
 */
export function improvementBrief(
  items: TodoItem[],
  options?: { generatedAt?: string | null; savedAt?: string | null }
): string;
