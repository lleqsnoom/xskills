import { Match, Show, Switch, onCleanup, onMount } from "solid-js";
import { api, isSnapshot } from "./api";
import { bakedReport } from "./baked.mjs";
import { watchBuild } from "./build.mjs";
import { watchFreshness } from "./revalidate.mjs";
import { current, linkProps, refreshRoute, type Route } from "./router";
import { DaysView } from "./components/DaysView";
import { DayView } from "./components/DayView";
import { SessionView } from "./components/SessionView";
import { SkillView } from "./components/SkillView";
import { Skills } from "./components/Skills";
import { TodosView } from "./components/TodosView";

/**
 * The shell: three tabs and the routed view — the shape Orca itself uses, so this reads as the same
 * application.
 *
 * The tabs are the whole navigation, and there are three of them: on a wide pane they are a rail down the
 * side; in a narrow one they become a bar across the top, where a thumb can reach them and where they cannot
 * push the report off the first screen. The lists that used to hang off the rail are screens now: the days in
 * Days, the skills in use in Skills, which is also the screen the app opens on.
 *
 * Nothing else is chrome. `Run` and `window` used to have a bar of their own across the top of the view, to
 * ask the server to show this page in an Orca browser tab or in a window without browser controls — a row off
 * every screen to duplicate what the address bar already does. The one thing worth keeping from that bar
 * stays, below: a baked panel still says when its numbers were taken.
 */
export function App() {
  const route = () => current();
  keepCurrent();
  return (
    <div class="app">
      <aside class="rail">
        <div class="brand">x-skills</div>
        <span class="dim">the daily record</span>

        <nav aria-label="the screens">
          <Nav to={{ name: "skills" }} label="Skills" route={route()} also={["skill"]} />
          <Nav to={{ name: "days" }} label="Days" route={route()} also={["day", "session"]} />
          <Nav to={{ name: "todos" }} label="To-do" route={route()} />
        </nav>

        <Show when={isSnapshot()}>
          <Snapshot />
        </Show>
      </aside>

      <main class="main">
        {/* Keyed on the route object, so a new date or skill remounts its screen and re-fetches. */}
        <Show when={route()} keyed fallback={<p class="loading">Loading…</p>}>
          {(r) => (
            <Switch>
              <Match when={r.name === "skills"}>
                <Skills />
              </Match>
              <Match when={r.name === "days"}>
                <DaysView />
              </Match>
              <Match when={r.name === "todos"}>
                <TodosView />
              </Match>
              <Match when={r.name === "day" && r}>
                {(day) => <DayView date={day().date} />}
              </Match>
              <Match when={r.name === "session" && r}>
                {(session) => <SessionView date={session().date} id={session().id} />}
              </Match>
              <Match when={r.name === "skill" && r}>
                {(skill) => <SkillView name={skill().skill} />}
              </Match>
            </Switch>
          )}
        </Show>
      </main>
    </div>
  );
}

/**
 * The one line kept from the action bar: a panel cannot reach the server, so what a reader needs to know about
 * the numbers is when they were taken — and where the copy that can be written lives. Only a baked panel
 * renders this: the served app is the live one, and says nothing.
 */
function Snapshot() {
  const bakedAt = bakedReport()?.bakedAt;
  return (
    <span class="snapshot">
      snapshot · {bakedAt ? new Date(bakedAt).toLocaleString() : "unknown"} · read-only — Orca’s palette opens
      the live ones: “x-skills report: Open” (a tab) or “x-skills report: Console” (a pane you can type at)
    </span>
  );
}

/**
 * Keep the page honest about what is on disk: the bundle it was built from, and the screen it is showing.
 *
 * A tab that is focused rather than reloaded keeps the bundle it was opened with, so a stale one reloads itself
 * when the reader comes back. The record is written while the page sits open, so the same moment is also when
 * the screen is read again — cleared cache first, then the remount. A panel arms neither: it is a snapshot with
 * no network to re-read with and no bundle to compare. Everything armed here is disarmed on cleanup, because a
 * listener that outlives its component is a listener nothing can take away.
 */
function keepCurrent() {
  onMount(() => {
    onCleanup(watchBuild({ check: async () => (await api.version()).build }));
  });
  onMount(() => {
    if (isSnapshot()) return;
    onCleanup(
      watchFreshness({
        onDue: () => {
          api.invalidate();
          refreshRoute();
        },
      })
    );
  });
}

/**
 * One tab. `also` names the routes this tab owns but does not equal: a skill page belongs to Skills, a day and
 * its sessions to Days, so the tab a reader came through stays lit while they read one of its records.
 */
function Nav(props: { to: Route; label: string; route: Route; also?: string[] }) {
  const active = () =>
    JSON.stringify(props.to) === JSON.stringify(props.route) || (props.also ?? []).includes(props.route.name);
  return (
    <a {...linkProps(props.to)} class={active() ? "active" : ""}>
      {props.label}
    </a>
  );
}
