import type { JSX } from "solid-js";
import { cn } from "./cn";

/**
 * A chip: the state of a score, or how much a task matters.
 *
 * Orca's recipe, copied from its own badges: the colour at 10% behind a 25% edge, the word in the colour, and
 * the border radius small. The word carries the meaning and the colour only agrees with it, so a badge still
 * reads with colour removed — which is why there is no variant that is colour alone.
 */
export type BadgeTone = "good" | "fair" | "weak" | "unknown";

const TONES: Record<BadgeTone, string> = {
  good: "text-good",
  fair: "text-fair",
  weak: "text-weak",
  unknown: "text-unknown",
};

export function Badge(props: { tone?: BadgeTone; title?: string; class?: string; children: JSX.Element }) {
  return (
    <span
      title={props.title}
      class={cn(
        "inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px text-chrome font-medium whitespace-nowrap",
        TONES[props.tone ?? "unknown"],
        props.class
      )}
      style={{
        background: "color-mix(in srgb, currentColor 10%, transparent)",
        "border-color": "color-mix(in srgb, currentColor 25%, transparent)",
      }}
    >
      {props.children}
    </span>
  );
}
