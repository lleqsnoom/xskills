import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "./cn";

/**
 * The app's button, on Tailwind utilities and this app's tokens.
 *
 * Every control in the app goes through here, which is what fixes the class of problem the hand-written ones
 * kept having: two controls that touched, or a label that sat flush against its neighbour. A button carries its
 * own height, padding and corner radius, its disabled and focus states come from one place, and the *space
 * between* controls is always the layout's `gap` — never a margin one of them forgot to leave.
 *
 * Sizes are 24px for a chip inside a card, 28px for a control in a toolbar (Orca's own small-control height),
 * and 44px in a pane narrow enough to be a phone, where a thumb cannot hit 28. `whitespace-nowrap` keeps a
 * label on one line, so a squeezed button pushes its neighbour rather than growing taller.
 */
export type ButtonVariant = "outline" | "primary" | "ghost" | "quiet";
export type ButtonSize = "chip" | "control";

const VARIANTS: Record<ButtonVariant, string> = {
  /** The default: a card surface with a hairline, like Orca's secondary button. */
  outline: "border border-border bg-card text-foreground hover:bg-muted",
  /** The one action a screen is actually asking for. */
  primary: "border border-primary bg-primary text-primary-foreground font-semibold hover:opacity-90",
  /** No chrome until the pointer is on it: a row's twisty, a panel's close. */
  ghost: "border border-transparent bg-transparent text-foreground hover:bg-muted",
  /** A smaller, muted control: an inline action beside a value. */
  quiet: "border border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
};

const SIZES: Record<ButtonSize, string> = {
  chip: "min-h-6 px-1.5 text-chrome",
  control: "min-h-7 px-2.5 text-chrome max-[860px]:min-h-11 max-[860px]:px-3",
};

export function Button(props: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "type"]);
  return (
    <button
      type={local.type ?? "button"}
      {...rest}
      class={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        SIZES[local.size ?? "control"],
        VARIANTS[local.variant ?? "outline"],
        local.class
      )}
    />
  );
}
