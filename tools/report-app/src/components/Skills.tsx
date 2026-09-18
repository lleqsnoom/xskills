import { For, Match, Show, Switch, createMemo, createResource, createSignal } from "solid-js";
import { api, type MovementPage, type MovementRow } from "../api";
import { linkProps } from "../router";
import { settled } from "../resource.mjs";
import { Gauge, Sparkline } from "./charts";
import { Card, CardHead, CardName } from "./Card";
import { Badge } from "../ui/Badge";
import { Input } from "../ui/Input";
import { ToggleGroup } from "../ui/ToggleGroup";
import { Loader } from "./Loader";

/** The screen the app opens on: one row per skill in use, and whether it is going up or down. */
export function Skills() {
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
            <h1>Skills</h1>
            <p class="facts">
              {loaded().days} day{loaded().days === 1 ? "" : "s"} recorded · {loaded().movement.length} skill
              {loaded().movement.length === 1 ? "" : "s"} in use ·{" "}
              <span class="good">{counts().up} improved</span>, <span class="weak">{counts().down} regressed</span>,{" "}
              {counts().flat} flat
            </p>
            {/* The filter on its own line, the switch under it: side by side they are two controls competing
                for the same row on a narrow pane, and the field is the one being typed into. */}
            <div class="mt-3 flex flex-col items-start gap-2">
              <Input
                type="search"
                placeholder="filter by skill"
                value={filter()}
                onInput={(e) => setFilter(e.currentTarget.value)}
              />
              <ToggleGroup
                label="which skills to show"
                value={only()}
                onChange={setOnly}
                options={[
                  { value: "all", label: "all" },
                  { value: "up", label: "improved", title: "skills whose line is going up" },
                  { value: "down", label: "regressed", title: "skills whose line is going down" },
                ]}
              />
            </div>
          </header>

          <Show when={rows().length} fallback={<p class="empty">No skill matches.</p>}>
            <div class="cards">
              <For each={rows()}>{(row) => <SkillCard row={row} />}</For>
            </div>
          </Show>
        </>
      )}
    </Loader>
  );
}

/** One skill, as a card: the whole card is the link, so a reader aims at the skill they see. */
function SkillCard(props: { row: MovementRow }) {
  return (
    <Card
      as="a"
      {...linkProps({ name: "skill", skill: props.row.name })}
      label={props.row.name}
      title={`${props.row.name} — its own page`}
      class="hover:border-[color-mix(in_srgb,var(--primary)_35%,var(--border))]"
    >
      <CardHead>
        <Gauge score={props.row.latestScore} band={props.row.band} size={34} label={props.row.name} />
        <CardName>
          <span class="mono">{props.row.name}</span>
        </CardName>
        <Badge tone={props.row.band.key}>{props.row.band.label}</Badge>
        <span class={`mono score big ${props.row.band.key}`}>
          {props.row.latestScore === null ? "—" : props.row.latestScore.toFixed(1)}
        </span>
      </CardHead>
      <p class="m-0 text-chrome break-anywhere">
        {props.row.measured} of {props.row.series.length} days measured
        {props.row.change === null ? " · no change yet" : ` · ${props.row.change > 0 ? "+" : ""}${props.row.change.toFixed(1)}`}
      </p>
      {/* Painted at the width this card actually gives it, so the line grows with the pane and its dots stay
          round — a fixed drawing was 190px of a 688px column, and told the reader nothing about the rest. */}
      <Show when={props.row.series.length >= 2} fallback={<span class="dim">one day so far</span>}>
        <Sparkline points={props.row.series} />
      </Show>
    </Card>
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
