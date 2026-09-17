import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { api, type Band, type MovementPage, type MovementRow } from "../api";
import { linkProps } from "../router";
import { Gauge, Sparkline } from "./charts";

/** The default screen: did anything in use get better or worse, and by which axis. */
export function Movement() {
  const [page] = createResource<MovementPage>(() => api.movement());
  const [filter, setFilter] = createSignal("");
  const [only, setOnly] = createSignal<"all" | "up" | "down">("all");

  const rows = createMemo(() => {
    const found = page()?.movement ?? [];
    const needle = filter().trim().toLowerCase();
    const pick = only();
    return found.filter(
      (row) =>
        (!needle || row.name.includes(needle)) &&
        (pick === "all" || (pick === "up" && row.direction === "up") || (pick === "down" && row.direction === "down"))
    );
  });

  const counts = createMemo(() => {
    const found = page()?.movement ?? [];
    return {
      up: found.filter((r) => r.direction === "up").length,
      down: found.filter((r) => r.direction === "down").length,
      flat: found.filter((r) => r.direction === "flat").length,
    };
  });

  return (
    <Show when={page()} fallback={<p class="loading">Loading the record…</p>}>
      <header>
        <h1>Movement per skill</h1>
        <p class="facts">
          {page()!.days} day{page()!.days === 1 ? "" : "s"} recorded · {page()!.movement.length} skill
          {page()!.movement.length === 1 ? "" : "s"} in use ·{" "}
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
    </Show>
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
