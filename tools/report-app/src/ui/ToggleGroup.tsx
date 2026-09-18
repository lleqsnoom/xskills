import { ToggleGroup as Kobalte } from "@kobalte/core/toggle-group";
import { For } from "solid-js";
import { cn } from "./cn";

/**
 * One control, not three buttons: a segmented switch for a small set of mutually exclusive filters.
 *
 * This is the piece the hand-written version got wrong — three buttons in a wrapping row sit flush against each
 * other as soon as the row is tight, and a reader cannot tell a gap from a border. Kobalte's `ToggleGroup` is
 * the same control Orca uses for its own view switches: one track, one selected segment, roving focus, and the
 * accessibility work already done (`role="group"`, `aria-pressed` on each item, arrow keys between them).
 * The look is this app's: a track in `--input` at 40%, the chosen segment raised on the card surface.
 */
export function ToggleGroup<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  class?: string;
}) {
  return (
    <Kobalte
      value={props.value}
      onChange={(next) => next && props.onChange(next as T)}
      class={cn(
        "inline-flex shrink-0 gap-0.5 rounded-md p-0.5",
        "bg-[color-mix(in_srgb,var(--input)_40%,transparent)]",
        props.class
      )}
      aria-label={props.label}
    >
      <For each={props.options}>
        {(option) => (
          <Kobalte.Item
            value={option.value}
            title={option.title}
            class={cn(
              "inline-flex shrink-0 items-center justify-center rounded-sm px-2 py-1 text-chrome font-normal",
              "text-muted-foreground whitespace-nowrap",
              "hover:bg-[color-mix(in_srgb,var(--background)_40%,transparent)] hover:text-foreground",
              "data-[pressed]:bg-background data-[pressed]:font-medium data-[pressed]:text-foreground",
              "data-[pressed]:shadow-xs",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              "max-[860px]:min-h-11"
            )}
          >
            {option.label}
          </Kobalte.Item>
        )}
      </For>
    </Kobalte>
  );
}
