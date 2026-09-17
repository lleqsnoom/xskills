import { createSignal } from "solid-js";
import { bakedReport, navProps } from "./baked.mjs";

/**
 * A router in eighty lines: the path is a signal, and a link is an anchor whose click is intercepted.
 *
 * The app has six routes and no nested layout, so a matching library would add a dependency and a version
 * to keep in step with Solid for no gain. The server answers any extension-less path with the shell, so a
 * deep link survives a reload.
 */

export type Route =
  | { name: "movement" }
  | { name: "days" }
  | { name: "day"; date: string }
  | { name: "session"; date: string; id: string }
  | { name: "skill"; skill: string }
  | { name: "todos" };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: "movement" };
  if (parts[0] === "days" && parts.length === 1) return { name: "days" };
  if (parts[0] === "todos" && parts.length === 1) return { name: "todos" };
  if (parts[0] === "skill" && parts[1]) return { name: "skill", skill: parts[1] };
  if (parts[0] === "day" && parts[1]) {
    if (parts[2] === "session" && parts[3]) return { name: "session", date: parts[1], id: parts[3] };
    return { name: "day", date: parts[1] };
  }
  return { name: "movement" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "movement":
      return "/";
    case "days":
      return "/days";
    case "todos":
      return "/todos";
    case "skill":
      return `/skill/${encodeURIComponent(route.skill)}`;
    case "day":
      return `/day/${route.date}`;
    case "session":
      return `/day/${route.date}/session/${encodeURIComponent(route.id)}`;
  }
}

/** A panel cancels navigations, so a snapshot keeps its route in memory and never touches history. */
const baked = bakedReport() !== null;

const [route, setRoute] = createSignal<Route>(baked ? { name: "movement" } : parseRoute(window.location.pathname));

if (!baked) window.addEventListener("popstate", () => setRoute(parseRoute(window.location.pathname)));

/** The current route, as a tracked accessor: reading it in JSX re-renders on a navigation. */
export function current(): Route {
  return route();
}

export function navigate(to: Route, { replace = false } = {}) {
  const path = href(to);
  if (!baked && path !== window.location.pathname) {
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
  }
  setRoute(to);
  window.scrollTo({ top: 0 });
}

/** The attrs a link needs, in the shape the JSX spread accepts: an href, or a role and a tab stop. */
function navAttrs(to: Route): { href?: string; role?: "link"; tabindex?: number } {
  // `baked.mjs` is JavaScript, so the literal type of `role` is lost at the boundary: declare it here.
  return navProps({ baked, href: withShape(href(to)) }) as { href?: string; role?: "link"; tabindex?: number };
}

/**
 * An anchor that routes instead of reloading, so a link keeps the keyboard and the back button.
 *
 * In a snapshot it is an anchor *without* an href, because the panel host swallows those clicks: see
 * `navProps`. The role and the tab stop are then ours to supply, and Enter or Space activates it.
 */
export function linkProps(to: Route) {
  const go = () => navigate(to);
  const onClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    go();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    go();
  };

  return {
    ...navAttrs(to),
    onClick,
    ...(baked ? { onKeyDown } : {}),
  };
}

/**
 * Carry the task shape through a link. It is a reading preference rather than a route, so it rides in the
 * query: a reload or a bookmark lands on the shape the reader picked.
 */
function withShape(path: string): string {
  const shape = new URLSearchParams(baked ? "" : window.location.search).get("shape");
  return shape ? `${path}${path.includes("?") ? "&" : "?"}shape=${shape}` : path;
}
