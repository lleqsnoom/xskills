import { For, Match, Show, Switch, createMemo, createResource, createSignal } from "solid-js";
import { api, type Band, type MovementPage, type MovementRow } from "../api";
import { linkProps } from "../router";
import { settled } from "../resource.mjs";
import { currentHint, currentView, setCurrentView, VIEWS } from "../views";
import { BenchView } from "./BenchView";
import { LedgerView } from "./LedgerView";
import { RatchetView } from "./RatchetView";
import { RecurrenceView } from "./RecurrenceView";
import { ControlView } from "./ControlView";
import { IntervalView } from "./IntervalView";
import { FactorsView } from "./FactorsView";
import { FlowView } from "./FlowView";
import { ScheduleView } from "./ScheduleView";
import { Gauge, Sparkline } from "./charts";
import { Loader } from "./Loader";

/**
 * The main screen, in ten views with one goal: make the skills better.
 *
 * They answer different questions about the same record, so all ten ship and the reader picks. The first five
 * measure the work: movement (did anything move), bench (what to do now), ledger (did the fixes hold), ratchet
 * (has anything slipped below its floor), recurrence (what keeps coming back). The last five measure the
 * measurement: control (is a move real, given the record's own noise), interval (what is a score worth),
 * factors (why is it that number, in points), flow (is the fixing keeping up), schedule (what must be
 * re-checked). The picker is a tab strip because that is what it is: the same screen, a different question. The
 * choice rides in `?view=`, so a link can point at the view it argues for.
 */
export function Movement() {
  return (
    <>
      <div class="view-tabs" role="tablist" aria-label="how to look at the record">
        <span class="dim">Improving the skills, five ways</span>
        <For each={VIEWS}>
          {(option) => (
            <button
              role="tab"
              aria-selected={currentView() === option.id}
              class={currentView() === option.id ? "on" : ""}
              title={option.hint}
              onClick={() => setCurrentView(option.id)}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
      <p class="dim view-hint">{currentHint()}</p>
      <Switch>
        <Match when={currentView() === "bench"}>
          <BenchView />
        </Match>
        <Match when={currentView() === "ledger"}>
          <LedgerView />
        </Match>
        <Match when={currentView() === "ratchet"}>
          <RatchetView />
        </Match>
        <Match when={currentView() === "recurrence"}>
          <RecurrenceView />
        </Match>
        <Match when={currentView() === "control"}>
          <ControlView />
        </Match>
        <Match when={currentView() === "interval"}>
          <IntervalView />
        </Match>
        <Match when={currentView() === "factors"}>
          <FactorsView />
        </Match>
        <Match when={currentView() === "flow"}>
          <FlowView />
        </Match>
        <Match when={currentView() === "schedule"}>
          <ScheduleView />
        </Match>
        <Match when={currentView() === "movement"}>
          <MovementTable />
        </Match>
      </Switch>
    </>
  );
}

/** The movement table: did anything in use get better or worse, and by which axis. */
function MovementTable() {
  const [page] = createResource<MovementPage>(() => api.movement());
  const [filter, setFilter] = createSignal("");
  const [only, setOnly] = createSignal<"all" | "up" | "down">("all");

  // Both memos read the resource, so both ask for the value safely: an unguarded read throws the failure out
  // of the update that records it, and the screens below never get to draw their message.
  const rows = createMemo(() => {
    const found = settled(page)?.movement ?? [];
    const needle = filter().trim().toLowerCase();
    const pick = only();
    return found.filter(
      (row) =>
        (!needle || row.name.includes(needle)) &&
        (pick === "all" || (pick === "up" && row.direction === "up") || (pick === "down" && row.direction === "down"))
    );
  });

  const counts = createMemo(() => {
    const found = settled(page)?.movement ?? [];
    return {
      up: found.filter((r) => r.direction === "up").length,
      down: found.filter((r) => r.direction === "down").length,
      flat: found.filter((r) => r.direction === "flat").length,
    };
  });

  return (
    <Loader resource={page} loading="Loading the record…" empty="No skill has been recorded yet.">
      {(loaded) => (
        <>
          <header>
            <h1>Movement per skill</h1>
            <p class="facts">
              {loaded().days} day{loaded().days === 1 ? "" : "s"} recorded · {loaded().movement.length} skill
              {loaded().movement.length === 1 ? "" : "s"} in use ·{" "}
              <span class="good">{counts().up} improved</span>, <span class="weak">{counts().down} regressed</span>,{" "}
              {counts().flat} flat
            </p>
            <div class="toolbar">
              <input type="search" placeholder="filter by skill" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
              <button class={only() === "all" ? "on" : ""} onClick={() => setOnly("all")}>all</button>
              <button class={only() === "up" ? "on" : ""} onClick={() => setOnly("up")}>improved</button>
              <button class={only() === "down" ? "on" : ""} onClick={() => setOnly("down")}>regressed</button>
            </div>
          </header>

          <p class="dim" style={{ margin: "1rem 0 .4rem", "max-width": "78ch" }}>
            One row per skill, and the line is its daily mean before the sample floor — so the question this page
            answers is whether it is going up or down, not what it scored on Tuesday. Ordered by change: the top
            is where the work paid off, the bottom is where it did not.
          </p>

          <Show when={rows().length} fallback={<p class="empty">No skill matches.</p>}>
            <div class="movement">
              <div class="mrow head">
                <span>skill</span>
                <span>line</span>
                <span class="num">change</span>
                <span>what moved</span>
                <span class="num">latest</span>
              </div>
              <For each={rows()}>
                {(row) => <MovementLine row={row} />}
              </For>
            </div>
          </Show>
        </>
      )}
    </Loader>
  );
}

function MovementLine(props: { row: MovementRow }) {
  return (
    <div class={`mrow ${props.row.direction}`}>
      <a class="mono" {...linkProps({ name: "skill", skill: props.row.name })}>
        {props.row.name}
      </a>
      <Show when={props.row.series.length >= 2} fallback={<span class="dim">one day so far</span>}>
        <Sparkline points={props.row.series} />
      </Show>
      <span class={`num change ${props.row.direction}`}>
        {props.row.change === null ? "one day" : `${props.row.change > 0 ? "+" : ""}${props.row.change.toFixed(1)}`}
      </span>
      <span class="dim moved">
        <Show when={props.row.moved.length} fallback={<span>no axis moved</span>}>
          <For each={props.row.moved}>
            {(axis, index) => (
              <>
                {index() > 0 ? " · " : ""}
                <span class={axis.delta > 0 ? "good" : "weak"}>
                  {axis.delta > 0 ? "▲" : "▼"} {axis.name} {axis.points > 0 ? "+" : ""}
                  {axis.points}pt
                </span>
              </>
            )}
          </For>
        </Show>
      </span>
      <span class="num dim">{props.row.latestScore === null ? "—" : props.row.latestScore.toFixed(1)}</span>
    </div>
  );
}

/** The five most recent days beside the calendar for the rest: when a day happened, and which days exist. */
export function DaysSection(props: { page: MovementPage }) {
  return (
    <section>
      <h2>Days</h2>
      <div class="days-split">
        <ul class="recent">
          <For each={props.page.recent}>
            {(day) => (
              <li class="day">
                <a class="mono" {...linkProps({ name: "day", date: day.date })}>
                  {day.date}
                </a>
                <span class={`num ${day.band.key}`}>{day.mean === null ? "—" : day.mean.toFixed(1)}</span>
                <span class="dim">
                  {day.sessions === null ? "" : `${day.sessions} sessions · `}
                  {day.measured} skills measured
                </span>
              </li>
            )}
          </For>
        </ul>
        <div class="calendars">
          <For each={props.page.calendar}>
            {(month) => (
              <div class="cal">
                <h3 class="dim">{month.month}</h3>
                <div class="cal-grid">
                  <For each={["M", "T", "W", "T", "F", "S", "S"]}>{(d) => <span class="cal-head">{d}</span>}</For>
                  <For each={month.cells}>
                    {(cell) => (
                      <Show when={cell.day} fallback={<span class="cal-day cal-blank" />}>
                        <Show
                          when={cell.recorded}
                          fallback={<span class="cal-day dim" title={`${cell.date}: nothing recorded`}>{cell.day}</span>}
                        >
                          <a class="cal-day cal-has" {...linkProps({ name: "day", date: cell.date! })} title={cell.date!}>
                            {cell.day}
                          </a>
                        </Show>
                      </Show>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

/** A gauge tile, used by the skill screen and the day list. */
export function ScoreTile(props: { label: string; score: number | null; band: Band; meta?: string }) {
  return (
    <div class="panel" style={{ display: "grid", "justify-items": "center", gap: ".2rem" }}>
      <h3 class="mono">{props.label}</h3>
      <Gauge score={props.score} band={props.band} size={84} label={props.label} />
      <span class={`mono stat-value ${props.band.key}`}>
        {props.score === null ? "—" : props.score.toFixed(1)}
      </span>
      <span class={`pill ${props.band.key}`}>{props.band.label}</span>
      <Show when={props.meta}>
        <span class="dim">{props.meta}</span>
      </Show>
    </div>
  );
}
