import { For, Show, createResource, createSignal } from "solid-js";
import { api, type Skill } from "../api";
import { linkProps } from "../router";
import { AxisRates, Bar, Gauge, Radar, Sparkline, measuredRates } from "./charts";
import { Card, CardHead } from "./Card";
import { Badge } from "../ui/Badge";
import { bandKey } from "../lib";
import { taskFromProposal } from "../tasks";
import { SignalList, TodoButton } from "./DayView";
import { Loader } from "./Loader";
import { TaskList } from "./TaskList";

/**
 * One skill: is it improving, by how much, why, and what to do about it. The day screen decides, this screen
 * explains — and the top of it describes *one day at a time*: the newest, or whichever day the reader is
 * pointing at on the line or in the day panels below.
 */
export function SkillView(props: { name: string }) {
  const [skill] = createResource(() => api.skill(props.name));
  // The day the gauge and the radar are showing. Null means the newest measured day, which is what a reader
  // arrives for; a date means the reader is pointing at that day, on the line or in a day panel below.
  const [heldDay, setHeldDay] = createSignal<string | null>(null);
  return (
    <Loader resource={skill} loading={`Loading ${props.name}…`} empty={`No movement recorded for ${props.name}.`}>
      {(loaded) => {
        const day = () => shownDay(loaded()!, heldDay());
        return (
      <Show when={loaded().series.length} fallback={<p class="failed">No movement recorded for {props.name}.</p>}>
        <header>
          <h1 class="mono">{loaded()!.name}</h1>
        </header>

        {/* One panel for the whole top: the gauge's number, the radar's shape, and the score over time — three
            views of the same thing, of the same day, so they share a card and answer together. */}
        <section class="panel skill-top">
          <div class="status">
            <div class="status-score">
              <Gauge score={day().score} band={day().band} size={110} label={`${loaded()!.name} on ${day().date}`} />
              {/* The raw mean with a marker when the day is under the floor: the gauge draws no arc for a day
                  with no score, and the number says what the mean was instead of hiding it. Same marker, same
                  meaning, as a day panel below. */}
              <span class={`mono stat-value ${day().band.key}`}>{dayScore(day())}</span>
              <Badge tone={day().band.key}>{day().band.label}</Badge>
            </div>
            {/* The shape that day: the gauge gives the number, the radar gives where it comes from. */}
            <div class="radar-box">
              <Radar dimensions={day().dimensions} label={`${loaded()!.name} on ${day().date}`} />
              {/* The same five rates as a list, for a box too narrow to hold a labelled pentagon. */}
              <AxisRates dimensions={day().dimensions} />
            </div>
          </div>
          <p class="day-note dim">{dayNote(day(), Boolean(heldDay()))}</p>
          <div class="score-per-day">
            <h3 class="dim">Score per day</h3>
            <div class="chart-box">
              <Sparkline
                points={loaded()!.series}
                domain={[0, 100]}
                bands={[CONFIDENT, HEALTHY]}
                annotate
                timeScale="log"
                held={heldDay()}
                onHold={setHeldDay}
              />
            </div>
          </div>
        </section>

        <Show when={loaded()!.moved.length}>
          <h2>What moved</h2>
          <p>
            <For each={loaded()!.moved}>
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
          </p>
        </Show>

        <Show when={modelRows(loaded()!.models).length}>
          <h2>Per model</h2>
          <p class="dim">
            A skill is a prompt, and a prompt is coupled to the model it was tuned on: a moved rate is read here
            first as "did the model change".
          </p>
          <div class="table-wrap records">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th class="num">Sessions</th>
                  <th class="num">Shortfall</th>
                  <th>What</th>
                </tr>
              </thead>
              <tbody>
                <For each={modelRows(loaded()!.models)}>
                  {(row) => (
                    <tr>
                      <td class="mono" data-label="Model">{row.model}</td>
                      <td class="num" data-label="Sessions">{row.sessions}</td>
                      <td class="num" data-label="Shortfall">{row.shortfall}/{row.sessions || "—"}</td>
                      <td class="dim" data-label="What">{row.kinds}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={loaded()!.proposals.length}>
          <div class="section-head">
            <h2>What was proposed for it — {loaded()!.proposals.length}</h2>
          </div>
          <TaskList
            tasks={loaded()!.proposals.map((proposal) => taskFromProposal(proposal))}
            empty="No proposal targets this skill."
            action={(task) => (
              <>
                <a class="mono text-chrome" {...linkProps({ name: "day", date: task.from! })} title={`open ${task.from}`}>
                  {task.from}
                </a>
                <TodoButton task={task} />
              </>
            )}
          />
        </Show>

        <Show when={loaded()!.signals.length}>
          <h2>Signals blamed on it — {loaded()!.signals.length}</h2>
          <p class="dim">
            A signal is attached to every skill a session names, so this is what the scanner saw around this
            skill, not proof that the skill caused it.
          </p>
          <SignalList signals={loaded()!.signals} date={loaded()!.latest ?? ""} showDay compact limit={5} />
        </Show>

        <h2 class="section-head">Every day — {loaded()!.perDay.length}</h2>
        <div class="cards">
          <For each={[...loaded()!.perDay].reverse()}>
            {(day) => (
              <Card
                label={`${day.date}, ${day.score === null ? (day.raw === null ? "not measured" : `a mean of ${day.raw.toFixed(1)} below the sample floor`) : `scored ${day.score.toFixed(1)}`}`}
                held={heldDay() === day.date}
                onHold={() => setHeldDay(day.date)}
                onRelease={() => setHeldDay(null)}
              >
                <CardHead>
                  <a class="mono card-name" {...linkProps({ name: "day", date: day.date })} title={`open ${day.date}`}>
                    {day.date}
                  </a>
                  <Badge tone={day.band.key}>{day.band.label}</Badge>
                  <span class={`mono score big ${day.score === null ? "dim" : day.band.key}`}>{dayScore(day)}</span>
                </CardHead>
                <p class="m-0 text-chrome break-anywhere">
                  loaded {day.n ?? "—"} · named {day.named ?? "—"}
                  <Show when={day.score === null && day.raw !== null}> · * below the sample floor</Show>
                </p>
                <span class="axes">
                  <For each={measuredRates(day.dimensions)}>
                    {(axis) => (
                      <span class="axis" title={`${axis.name} ${Math.round(axis.value * 100)}%`}>
                        <span class="mono dim">{axis.name.slice(0, 4)}</span>
                        <Bar value={axis.value} band={{ key: bandKey(axis.value), label: "" }} width={40} />
                        <span class="num">{Math.round(axis.value * 100)}%</span>
                      </span>
                    )}
                  </For>
                </span>
                <p class="m-0 text-chrome break-anywhere">
                  <Show when={day.sample} fallback="no session was recorded with it">
                    <a {...linkProps({ name: "session", date: day.date, id: day.sample!.id })} title={`open the session ${day.sample!.id}`}>
                      {(day.sample!.title ?? day.sample!.id).slice(0, 44)}
                    </a>
                  </Show>
                </p>
              </Card>
            )}
          </For>
        </div>
      </Show>
        );
      }}
    </Loader>
  );
}

/** The thresholds the API bands a score by, drawn on the chart so the line has a reference. */
const CONFIDENT = 70;
const HEALTHY = 85;

type MeasuredDay = Skill["perDay"][number];

/**
 * One row per model the skill ran under, worst shortfall first. One model with no shortfall says nothing the
 * day cards do not, so the table appears for a comparison or for a shortfall, never for a quiet single model.
 */
function modelRows(models: Skill["models"]) {
  const rows = Object.entries(models ?? {}).map(([model, row]) => ({
    model,
    sessions: row.sessions,
    shortfall: row.shortfall,
    rate: row.rate,
    kinds: Object.entries(row.kinds)
      .map(([kind, count]) => `${kind} ×${count}`)
      .join(", "),
  }));
  const worthShowing = rows.filter((row) => row.shortfall > 0);
  return (rows.length > 1 ? rows : worthShowing).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}

/** The number on the gauge: a score, or the day's mean with a `*` when it is under the sample floor. */
function dayScore(day: MeasuredDay): string {
  if (day.score !== null) return day.score.toFixed(1);
  return day.raw === null ? "—" : `${day.raw.toFixed(1)}*`;
}

/**
 * The line under the gauge: which day this is, what that day counted, and what its number is worth. The caveat
 * lives here, beside the number, rather than as a paragraph above the first thing a reader came for.
 */
function dayNote(day: MeasuredDay, held: boolean): string {
  const parts = [day.date, held ? "" : "the newest measured day"];
  if (day.n !== null) parts.push(`n=${day.n}`, `named ${day.named ?? 0}`);
  if (day.score === null && day.raw !== null) parts.push("below the sample floor: a mean of a handful of calls, not a score");
  return parts.filter(Boolean).join(" · ");
}

/**
 * The day the top of the page describes: the one the reader is holding, or the newest measured one. Falls back
 * to the skill's own row when the window holds no day at all (a skill with a change but no per-day entry).
 */
function shownDay(skill: Skill, held: string | null): MeasuredDay {
  const day = held ? skill.perDay.find((entry) => entry.date === held) : null;
  return day ?? skill.perDay[skill.perDay.length - 1] ?? {
    date: skill.latest ?? "not measured",
    score: skill.latestScore,
    raw: null,
    n: null,
    named: null,
    dimensions: skill.dimensions,
    band: skill.band,
    sample: null,
  };
}
