import { Match, Show, Switch, onMount } from "solid-js";
import { api } from "./api";
import { watchBuild } from "./build.mjs";
import { current, linkProps, type Route } from "./router";
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
 * every screen to duplicate what the address bar already does.
 */
export function App() {
  const route = () => current();
  // A tab that is focused rather than reloaded keeps the bundle it was opened with; this is what tells it that
  // the app has moved on.
  onMount(() => watchBuild({ check: async () => (await api.version()).build }));
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
