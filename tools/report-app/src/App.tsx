import { For, Match, Show, Switch, createResource, createSignal } from "solid-js";
import { api, isSnapshot, type MovementPage } from "./api";
import { bakedReport } from "./baked.mjs";
import { current, linkProps, type Route } from "./router";
import { Movement } from "./components/Movement";
import { DaysView } from "./components/DaysView";
import { DayView } from "./components/DayView";
import { SessionView } from "./components/SessionView";
import { SkillView } from "./components/SkillView";
import { TodosView } from "./components/TodosView";
import { Loader } from "./components/Loader";

/**
 * The shell: a rail with the screens and the recent days, a pane title bar with the actions, and the routed
 * view beside them — the shape Orca itself uses, so this reads as the same application.
 *
 * The rail carries the days because that is the navigation a reader repeats — reaching yesterday's report
 * should not need the calendar.
 */
export function App() {
  const [movement] = createResource<MovementPage>(() => api.movement());
  const route = () => current();
  return (
    <div class="app">
      <aside class="rail">
        <div class="brand">x-skills</div>
        <span class="dim">the daily record</span>

        <nav>
          <Nav to={{ name: "movement" }} label="Movement" route={route()} />
          <Nav to={{ name: "days" }} label="Days" route={route()} />
          <Nav to={{ name: "todos" }} label="To-do" route={route()} />
        </nav>

        {/* The rail loads the same payload the screens do, and it sits in the same tree: a throw from this
            read would take the routed view down with it. */}
        <Loader resource={movement} loading="Loading the record…" empty="Nothing recorded yet.">
          {(loaded) => (
            <>
              <section>
                <span class="dim">
                  {loaded().days} day{loaded().days === 1 ? "" : "s"} recorded
                </span>
                <div class="rail-days">
                  <For each={loaded().recent}>
                    {(day) => (
                      <a {...linkProps({ name: "day", date: day.date })}>
                        {day.date}
                        <span class={`num ${day.band.key}`} style={{ float: "right" }}>
                          {day.mean === null ? "—" : day.mean.toFixed(1)}
                        </span>
                      </a>
                    )}
                  </For>
                </div>
              </section>
              <section>
                <span class="dim">skills in use</span>
                <div class="rail-days">
                  <For each={loaded().movement.slice(0, 12)}>
                    {(row) => (
                      <a {...linkProps({ name: "skill", skill: row.name })}>
                        {row.name}
                        <span class={`num ${row.direction}`} style={{ float: "right" }}>
                          {row.change === null ? "" : `${row.change > 0 ? "+" : ""}${row.change.toFixed(1)}`}
                        </span>
                      </a>
                    )}
                  </For>
                </div>
              </section>
            </>
          )}
        </Loader>
      </aside>

      <header class="topbar">
        <span class="topbar-label">{label(route())}</span>
        <span class="topbar-actions">
          <Show when={!isSnapshot()} fallback={<Snapshot />}>
            <Run />
          </Show>
        </span>
      </header>

      <main class="main">
        {/* Keyed on the route object, so a new date or skill remounts its screen and re-fetches. */}
        <Show when={route()} keyed fallback={<p class="loading">Loading…</p>}>
          {(r) => (
            <Switch>
              <Match when={r.name === "movement"}>
                <Movement />
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

/** What the pane title bar says: which screen this is. The heading below it is the page's own headline. */
function label(route: Route): string {
  switch (route.name) {
    case "movement":
      return "Movement";
    case "days":
      return "Days";
    case "todos":
      return "To-do";
    case "day":
      return `Day · ${route.date}`;
    case "session":
      return `Session · ${route.id}`;
    case "skill":
      return `Skill · ${route.skill}`;
  }
}

/**
 * What a snapshot says instead of `Run`: a panel cannot reach the server, so the honest line is when the
 * numbers beside it were taken.
 */
function Snapshot() {
  const bakedAt = bakedReport()?.bakedAt;
  return <span class="dim">snapshot · {bakedAt ? new Date(bakedAt).toLocaleString() : "unknown"}</span>;
}

/**
 * Run: put this report in front of the reader, wherever they are reading it from.
 *
 * `Run` asks for an Orca browser tab, which is the surface the app belongs in and the one where a click can
 * reach the reader's own IDE. Orca draws its own browser toolbar in that tab, so `window` opens the same URL
 * in an application window instead: no tabs, no address bar, no back button — the closest thing to a pane.
 * Both go through the server, which knows whether the tab is already open and focuses it rather than
 * stacking a second copy.
 */
function Run() {
  const [status, setStatus] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const open = async (surface: "orca" | "window") => {
    setBusy(true);
    setStatus("opening…");
    try {
      setStatus((await api.open(surface)).message);
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <span class="run-status">{status()}</span>
      <button
        disabled={busy()}
        onClick={() => open("window")}
        title="open this report in a window with no browser controls at all"
      >
        window
      </button>
      <button
        class="primary"
        disabled={busy()}
        onClick={() => open("orca")}
        title="open this report in an Orca browser tab, focusing it if it is already open"
      >
        Run
      </button>
    </>
  );
}

function Nav(props: { to: Route; label: string; route: Route }) {
  const active = () => JSON.stringify(props.to) === JSON.stringify(props.route);
  return (
    <a {...linkProps(props.to)} class={active() ? "active" : ""}>
      {props.label}
    </a>
  );
}
