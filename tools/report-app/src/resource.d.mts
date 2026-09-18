/**
 * The types the app reads `resource.mjs` through.
 *
 * The rules live in plain JavaScript so a test can call them without a build step (the same reason
 * `baked.mjs` exists), and a declaration beside them is how TypeScript still knows what they hand back.
 */
import type { Resource } from "solid-js";

/** A failure, a fetch in flight, a settled answer with nothing in it, or a value. */
export type ViewState = "error" | "loading" | "empty" | "ready";

export function viewState(resource: Resource<unknown>): ViewState;

/** The value, or undefined when it is not safe to ask for one. A failed resource is never read. */
export function settled<T>(resource: Resource<T>): T | undefined;

/** What to show for a failure, whatever was thrown: an Error, or something that is not one. */
export function errorMessage(resource: { error: unknown }): string | undefined;
