import { For, Show, createResource } from "solid-js";
import { api, type Skill } from "../api";
import { linkProps } from "../router";
import { AxisRates, Gauge, Radar, Sparkline } from "./charts";
import { pct } from "../lib";
import { taskFromProposal } from "../tasks";
import { SignalList } from "./DayView";
import { Loader } from "./Loader";
import { TaskList } from "./TaskList";

/**
 * One skill: is it improving, by how much, why, and what to do about it. The three questions a reader
 * arrives with, in that order — the day screen decides, this screen explains.
 */
export function SkillView(props: { name: string }) {
  const [skill] = createResource(() => api.skill(props.name));
  return (
    <Loader resource={skill} loading={`Loading ${props.name}…`} empty={`No movement recorded for ${props.name}.`}>
      {(loaded) => (
      <Show when={loaded().series.length} fallback={<p class="failed">No movement recorded for {props.name}.</p>}>
        <header>
          <h1 class="mono">{loaded()!.name}</h1>
          <p class="facts">
            {loaded()!.measured} of {loaded()!.series.length} days measured
            {loaded()!.change === null
              ? " · one day so far, so no change yet"
              : ` · ${loaded()!.change! > 0 ? "+" : ""}${loaded()!.change!.toFixed(1)} over ${loaded()!.measured} days`}
          </p>
          <Show when={floorNote(loaded()!)}>
            <p class="dim">{floorNote(loaded()!)}</p>
          </Show>
        </header>

        {/* One panel for the whole top: the gauge's number, the radar's shape, and the score over time — the three
            views of the same thing, so they share a card instead of two that look like two subjects. */}
        <section class="panel skill-top">
          <div class="status">
            <div class="status-score">
              <Gauge score={loaded()!.latestScore} band={loaded()!.band} size={110} label={loaded()!.name} />
              <span class={`mono stat-value ${loaded()!.band.key}`}>
                {loaded()!.latestScore === null ? "—" : loaded()!.latestScore!.toFixed(1)}
              </span>
              <span class={`pill ${loaded()!.band.key}`}>{loaded()!.band.label}</span>
            </div>
            {/* The shape today: the gauge gives the number, the radar gives where it comes from. */}
            <div class="radar-box">
              <Radar dimensions={loaded()!.dimensions} label={`${loaded()!.name} on ${loaded()!.latest}`} />
              {/* The same five rates as a list, for a box too narrow to hold a labelled pentagon. */}
              <AxisRates dimensions={loaded()!.dimensions} />
            </div>
          </div>
          <div class="score-per-day">
            <h3 class="dim">Score per day</h3>
            <div class="chart-box">
              <Sparkline points={loaded()!.series} width={560} domain={[0, 100]} bands={[CONFIDENT, HEALTHY]} canvas annotate timeScale="log" />
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

        <Show when={loaded()!.proposals.length}>
          <div class="section-head">
            <h2>What was proposed for it — {loaded()!.proposals.length}</h2>
          </div>
          <TaskList
            tasks={loaded()!.proposals.map((proposal) => taskFromProposal(proposal, proposal.date))}
            empty="No proposal targets this skill."
            action={(task) => (
              <a class="mono" {...linkProps({ name: "day", date: task.from! })} title={`open ${task.from}`}>
                {task.from}
              </a>
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

        <h2>Every day</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th class="num">Score</th>
                <th class="num">Loaded</th>
                <th class="num">Named</th>
                <th>Axes</th>
                <th>A session it was loaded in</th>
              </tr>
            </thead>
            <tbody>
              <For each={[...loaded()!.perDay].reverse()}>
                {(day) => (
                  <tr>
                    <td>
                      <a class="mono" {...linkProps({ name: "day", date: day.date })}>
                        {day.date}
                      </a>
                    </td>
                    <td class={`num ${day.score === null ? "dim" : ""}`}>
                      {day.score === null ? (day.raw === null ? "—" : `${day.raw.toFixed(1)}*`) : day.score.toFixed(1)}
                    </td>
                    <td class="num">{day.n}</td>
                    <td class="num dim">{day.named}</td>
                    <td class="dim mono">
                      {day.dimensions
                        ? Object.entries(day.dimensions)
                            .filter(([, v]) => v !== null && v !== undefined)
                            .map(([k, v]) => `${k} ${pct(v as number)}`)
                            .join(" · ")
                        : "—"}
                    </td>
                    <td>
                      <Show when={day.sample} fallback={<span class="dim">—</span>}>
                        <a {...linkProps({ name: "session", date: day.date, id: day.sample!.id })}>
                          {(day.sample!.title ?? day.sample!.id).slice(0, 44)}
                        </a>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <p class="dim">* below the sample floor: the mean is shown with a marker so a thin day is visible.</p>
      </Show>
      )}
    </Loader>
  );
}

/** The thresholds the API bands a score by, drawn on the chart so the line has a reference. */
const CONFIDENT = 70;
const HEALTHY = 85;

/**
 * What the headline number is worth. A skill that is measured only on days below the sample floor has no
 * score — its change is a difference of two means over a handful of calls, and saying so beside the number
 * is the difference between a trend and a coincidence.
 */
function floorNote(skill: Skill): string {
  const measured = skill.series.filter((point) => (point.raw ?? point.score) !== null);
  const thin = measured.filter((point) => point.score === null);
  if (!thin.length) return "";
  const samples = thin.map((point) => `n=${point.n ?? "?"}`).join(", ");
  const days = thin.length === measured.length ? `all ${measured.length} measured days are` : `${thin.length} of ${measured.length} measured days are`;
  return `${days} below the sample floor (${samples}), so this is a mean of a handful of calls, not a score — read the direction, not the size.`;
}
