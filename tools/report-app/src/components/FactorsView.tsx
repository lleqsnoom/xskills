import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { api, type FactorCode, type FactorSkill, type FactorsPage } from "../api";
import { linkProps } from "../router";
import { num, pct } from "../lib";
import { Loader } from "./Loader";

/**
 * The reason codes: why a score is what it is, in points, and what a target on one axis would buy.
 *
 * The score is a weighted mean of measurable rates, so the gap from 100 decomposes exactly, and each axis's
 * share is what it costs. That is how a credit score is delivered — a number, the factors that depressed it,
 * and a simulator — and it is the difference between "x-fix is at 73" and "x-fix is at 73, and 40 of those 27
 * points are one thing: three sessions named it and none loaded it".
 *
 * The target is the reader's, never the fleet's average: on this record the fleet's own trigger rate is low
 * because those CLIs name far more skills than they load, so aiming at it would *cost* points.
 */
const TARGETS = [100, 90, 80, 70];

export function FactorsView() {
  const [page] = createResource<FactorsPage>(() => api.factors());
  const [target, setTarget] = createSignal(100);
  const [fleet, setFleet] = createSignal(false);
  return (
    <Loader resource={page} loading="Loading the reason codes…" empty="No session named a skill yet, so no score has a reason.">
      {(loaded) => (
        <>
          <header>
            <h1>Why the score is that number</h1>
            <p class="facts">
              {loaded().skills.length} skills scored on {loaded().to} · weights {Object.entries(loaded().weights).map(([axis, weight]) => `${axis} ${Math.round(weight * 100)}`).join(" · ")}
            </p>
            <p class="dim prose">
              Each row decomposes the gap from 100 into the points each axis is costing, with the counters it was
              measured from — and the arithmetic adds up, so the row can be checked by hand. The simulator at the
              right recomputes the score as if one axis reached a target.
            </p>
            <div class="toolbar">
              <span class="dim">simulate one axis at</span>
              <For each={TARGETS}>
                {(option) => (
                  <button
                    class={!fleet() && target() === option ? "on" : ""}
                    aria-pressed={!fleet() && target() === option}
                    onClick={() => {
                      setFleet(false);
                      setTarget(option);
                    }}
                  >
                    {option}%
                  </button>
                )}
              </For>
              <button class={fleet() ? "on" : ""} aria-pressed={fleet()} onClick={() => setFleet(true)} title="the fleet's own rate for that axis — context, not a goal">
                the fleet's rate
              </button>
            </div>
          </header>

          <div class="factors">
            <For each={loaded().skills}>
              {(skill, index) => <FactorRow skill={skill} page={loaded()} target={target()} fleet={fleet()} open={index() === 0} />}
            </For>
          </div>
        </>
      )}
    </Loader>
  );
}

function FactorRow(props: { skill: FactorSkill; page: FactorsPage; target: number; fleet: boolean; open: boolean }) {
  const total = createMemo(() =>
    props.skill.codes.reduce((sum, code) => sum + code.weight, 0)
  );
  /** What one axis reaching a target would do to the score: its weight times the rate it gains. */
  const lifted = (code: FactorCode) => {
    const goal = props.fleet ? code.pooled : props.target / 100;
    if (goal === null || goal === undefined || props.skill.score === null || !total()) return null;
    return props.skill.score + ((code.weight * (goal - code.rate)) / total()) * 100;
  };
  return (
    <details class="factor" open={props.open}>
      <summary>
        <span class="mono f-skill">{props.skill.name}</span>
        <span class={`mono f-score ${band(props.skill.score)}`}>{num(props.skill.score)}</span>
        <span class="dim num f-gap">{num(props.skill.gap)} pts on the table</span>
        <span class="f-top">
          <Show when={props.skill.top} fallback={<span class="dim">nothing measured</span>}>
            <span class="dim">worst factor</span> <span class="mono">{props.skill.top!.axis}</span>{" "}
            <span class="weak">{num(props.skill.top!.costs)} pts</span>
          </Show>
        </span>
        <span class="dim f-n">
          {props.skill.n} of {props.skill.named} sessions loaded it
        </span>
      </summary>
      <div class="factor-body">
        <div class="table-wrap">
          <table class="codes">
            <thead>
              <tr>
                <th>axis</th>
                <th class="num">weight</th>
                <th class="num">rate</th>
                <th class="num">measured over</th>
                <th class="num">costs</th>
                <th class="num">at the target</th>
                <th>the evidence</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.skill.codes}>
                {(code) => {
                  const goal = () => (props.fleet ? code.pooled : props.target / 100);
                  return (
                    <tr>
                      <td class="mono">{code.axis}</td>
                      <td class="num dim">{Math.round(code.weight * 100)}</td>
                      <td class="num">{pct(code.rate)}</td>
                      <td class="num dim">{code.denominator}</td>
                      <td class="num weak">{num(code.costs)}</td>
                      <td class="num">
                        <Show when={lifted(code) !== null} fallback={<span class="dim">—</span>}>
                          {num(lifted(code))}
                          <Show when={props.skill.score !== null}>
                            <span class={lifted(code)! > props.skill.score! ? "good" : "dim"}>
                              {" "}
                              ({lifted(code)! - props.skill.score! > 0 ? "+" : ""}
                              {num(lifted(code)! - props.skill.score!)})
                            </span>
                          </Show>
                        </Show>
                        <Show when={goal() === code.pooled && code.pooled !== null}>
                          <span class="dim"> (the fleet's {pct(code.pooled)})</span>
                        </Show>
                      </td>
                      <td class="dim">{code.evidence}</td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
        <p class="dim">
          <a class="mono" {...linkProps({ name: "skill", skill: props.skill.name })}>
            open {props.skill.name}
          </a>{" "}
          · the costs add to the gap exactly. {props.fleet
            ? "The fleet's rate is what these CLIs do, not what a skill should reach: aiming at it can cost points."
            : `The target is ${props.target}% on one axis, with every other axis where it is.`}
        </p>
      </div>
    </details>
  );
}

function band(score: number | null) {
  if (score === null) return "unknown";
  if (score >= 85) return "good";
  if (score >= 70) return "fair";
  return "weak";
}
