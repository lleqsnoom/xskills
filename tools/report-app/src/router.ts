import { createSignal } from "solid-js";

/**
 * A router in eighty lines: the path is a signal, and a link is an anchor whose click is intercepted.
 *
 * The app has seven routes and no nested layout, so a matching library would add a dependency and a version
 * to keep in step with Solid for no gain. The server answers any extension-less path with the shell, so a
 * deep link survives a reload.
 */

export type Route =
  | { name: "skills" }
  | { name: "days" }
  | { name: "day"; date: string }
  | { name: "session"; date: string; id: string }
  | { name: "skill"; skill: string }
  | { name: "todos" };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // The root is the skills screen as well: it is the app's default, and the address a bookmark holds.
  if (!parts.length) return { name: "skills" };
  if (parts[0] === "days" && parts.length === 1) return { name: "days" };
  if (parts[0] === "skills" && parts.length === 1) return { name: "skills" };
  if (parts[0] === "todos" && parts.length === 1) return { name: "todos" };
  if (parts[0] === "skill" && parts[1]) return { name: "skill", skill: parts[1] };
  if (parts[0] === "day" && parts[1]) {
    if (parts[2] === "session" && parts[3]) return { name: "session", date: parts[1], id: parts[3] };
    return { name: "day", date: parts[1] };
  }
  return { name: "skills" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "skills":
      return "/skills";
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

const [route, setRoute] = createSignal<Route>(parseRoute(window.location.pathname));

window.addEventListener("popstate", () => setRoute(parseRoute(window.location.pathname)));

/** The current route, as a tracked accessor: reading it in JSX re-renders on a navigation. */
export function current(): Route {
  return route();
}

export function navigate(to: Route, { replace = false } = {}) {
  const path = href(to);
  if (path !== window.location.pathname) {
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
  }
  setRoute(to);
  window.scrollTo({ top: 0 });
}

/**
 * An anchor that routes instead of reloading, so a link keeps the keyboard and the back button.
 *
 * A modified click or a middle click is the browser's business: `href` is on the element, so "open in a new
 * tab" and "copy link address" work without a handler of ours.
 */
export function linkProps(to: Route) {
  const go = () => navigate(to);
  const onClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    go();
  };

  return { href: href(to), onClick };
}
