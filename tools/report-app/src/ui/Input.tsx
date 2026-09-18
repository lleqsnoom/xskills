import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "./cn";

/**
 * A text field, on the app's tokens.
 *
 * `w-full` up to a readable width rather than a fixed 236px: the browser's own default width for a search box
 * was what made the page wider than a narrow pane, and a field that fills its place in a layout cannot do that.
 * The 16px font at a phone-sized pane is what stops iOS zooming the page when the field takes focus.
 */
export function Input(props: ComponentProps<"input">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <input
      {...rest}
      class={cn(
        "h-7 w-full min-w-0 max-w-96 rounded-md border border-input bg-transparent px-2 text-chrome text-foreground",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "max-[860px]:h-11 max-[860px]:text-base",
        local.class
      )}
    />
  );
}
