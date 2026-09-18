import { For, Show, createResource } from "solid-js";
import { api, type IntervalPage, type IntervalSkill } from "../api";
import { linkProps } from "../router";
import { num } from "../lib";
import { Loader } from "./Loader";

/**
 * The interval: what score can be defended, and where the next session buys the most certainty.
 *
 * Every axis is a rate over a count, so a score carries a standard error of `σ/√n` whether or not anyone says
 * so. This screen says so: `85.2 ± 7.3` instead of `85.2`, the value the evidence alone supports (TrueSkill's
 * display rule, μ − 3σ), and the sessions it would take to halve the interval — because halving it costs four
 * times the evidence, and that is the difference between a number worth acting on and a number worth watching.
 */
export function IntervalView() {
  const [page] = createResource<IntervalPage>(() => api.interval());
  return (
    <Loader resource={page} loading="Loading the intervals…" empty="No skill has been measured yet, so no score has an interval.">
      {(loaded) => (
        <>
          <header>
            <h1>What the number is worth</h1>
            <p class="facts">
              {loaded().skills.length} skills across {loaded().days} day{loaded().days === 1 ? "" : "s"} ·{" "}
              {loaded().tallied} tallied on the newest day · intervals at ±{loaded().z}σ
              <Show when={loaded().fallbackSigma !== null}>
                {" "}
                · a day with no counters falls back to the record's σ of {num(loaded().fallbackSigma)}
              </Show>
            </p>
            <p class="dim prose">
              The interval is the sampling error of the weighted mean, from each axis's own denominator: a trigger
              rate over 3 sessions and the same rate over 40 are not the same measurement. The conservative column
              is the score the evidence alone supports. Reading down the table, the widest interval is where a
              session teaches you the most.
            </p>
          </header>

          <Show when={loaded().skills.length} fallback={<p class="empty">Nothing measured yet.</p>}>
            <div class="table-wrap">
              <table class="intervals">
                <thead>
                  <tr>
                    <th class="iv-skill">skill</th>
                    <th class="num iv-n">sessions</th>
                    <th class="iv-score">score</th>
                    <th class="num iv-pm">95% range</th>
                    <th class="num iv-cons">the evidence supports</th>
                    <th class="num iv-need">to halve it</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={loaded().skills}>{(skill) => <IntervalRow skill={skill} />}</For>
                </tbody>
              </table>
            </div>
            <p class="dim">
              Four times the sessions halves an interval (`SE = σ/√n`), so the last column is three times what a
              skill already has. A score with no interval is a score nobody should act on yet.
            </p>
          </Show>
        </>
      )}
    </Loader>
  );
}

function IntervalRow(props: { skill: IntervalSkill }) {
  const band = () => {
    const score = props.skill.score;
    if (score === null) return "unknown";
    if (score >= 85) return "good";
    if (score >= 70) return "fair";
    return "weak";
  };
  return (
    <tr>
      <td>
        <a class="mono" {...linkProps({ name: "skill", skill: props.skill.name })}>
          {props.skill.name}
        </a>
      </td>
      <td class="num">
        {props.skill.n ?? 0}
        <Show when={props.skill.named !== null && props.skill.named !== props.skill.n}>
          <span class="dim"> / {props.skill.named}</span>
        </Show>
      </td>
      <td class={`mono ${band()}`}>
        {props.skill.score === null ? "—" : num(props.skill.score)}
        <Show when={props.skill.half !== null}>
          <span class="dim"> ± {num(props.skill.half)}</span>
        </Show>
      </td>
      <td class="num dim">
        {props.skill.low === null ? "—" : `${num(props.skill.low)} .. ${num(props.skill.high)}`}
      </td>
      <td class="num">{num(props.skill.conservative)}</td>
      <td class="num">{props.skill.needsSessions === null ? "—" : `${props.skill.needsSessions} sessions`}</td>
    </tr>
  );
}
