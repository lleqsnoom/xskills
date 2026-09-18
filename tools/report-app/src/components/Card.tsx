import type { JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "../ui/cn";

/**
 * One panel, and the only shape this app puts a thing in.
 *
 * A skill in use, a day it was measured on, the scores of one day, a proposal: each of them is an entry with a
 * head (what it is, its score, its state) and a body (the numbers behind it), and each was drawn differently
 * before — a table row here, a five-column grid there, a card on one screen and a line on another. The reader
 * had to learn four layouts for four views of the same kind of thing. So there is one card, laid out in a
 * `.cards` grid, and every list on every screen is made of it.
 *
 * Three behaviours belong to the card rather than to something inside it: `held` marks the card a reader is on
 * (the skill screen's days drive the gauge and the radar above it), `onHold`/`onRelease` make the whole panel
 * the target for a pointer and for the keyboard, and `as="a"` makes the panel itself the link — `/skills` wants
 * the row a reader aims at to be the thing that opens, not the name inside it.
 */
export function Card(props: {
  /** A card is an `<article>` unless the whole panel is the link (see `/skills`). */
  as?: "article" | "a";
  /** What the card is, for a reader who cannot see the layout. */
  label?: string;
  held?: boolean;
  onHold?: () => void;
  onRelease?: () => void;
  class?: string;
  title?: string;
  /** What a link's own attributes are, as `linkProps` hands them over. */
  href?: string;
  role?: "link";
  tabindex?: number;
  onClick?: (event: MouseEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  children: JSX.Element;
}) {
  const interactive = () => Boolean(props.onHold);
  return (
    <Dynamic
      component={props.as ?? "article"}
      class={cn(
        // `card` is the hook the app's own stylesheet and the tests use (`.card .axes`, `.card.held`).
        "card",
        // The surface: a card on Orca's `--card` with a hairline, and the panel every list in this app is made of.
        "grid content-start gap-1.5 rounded-lg border border-border bg-card p-2.5 text-foreground no-underline",
        // The card a reader is on. On a skill's screen the days drive the gauge and the radar above them, and
        // the mark is what says which one is being described when the top of the page is off screen.
        props.held === true && "border-[color-mix(in_srgb,var(--primary)_55%,var(--border))]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        props.class
      )}
      href={props.href}
      role={props.role}
      title={props.title}
      tabindex={interactive() ? 0 : props.tabindex}
      aria-label={props.label}
      onClick={props.onClick}
      onKeyDown={props.onKeyDown}
      onMouseEnter={props.onHold}
      onMouseLeave={props.onRelease}
      onFocusIn={props.onHold}
      onFocusOut={props.onRelease}
    >
      {props.children}
    </Dynamic>
  );
}

/**
 * The card's head: what it is on the left, what it scored on the right, and the action at the end.
 *
 * The gap is the head's own (`gap-x-2 gap-y-1`) and the action takes the slack with `ml-auto`, which is what
 * keeps a control from ever touching the label beside it: there is no margin on any child to forget, and a head
 * that runs out of room wraps the whole item to the next line rather than overlapping.
 */
export function CardHead(props: { children: JSX.Element }) {
  return <header class="card-head flex flex-wrap items-center gap-x-2 gap-y-1">{props.children}</header>;
}

/** What the card is about: the name of a skill, the date of a day — the one thing in it that links somewhere. */
export function CardName(props: { children: JSX.Element }) {
  return <span class="card-name">{props.children}</span>;
}

/** The actions at the end of a head. A wrapper so several controls share one gap and one right edge. */
export function CardActions(props: { children: JSX.Element }) {
  return <span class="ml-auto inline-flex flex-wrap items-center justify-end gap-1.5">{props.children}</span>;
}
