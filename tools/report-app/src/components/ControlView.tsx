import { For, Show, createResource } from "solid-js";
import { api, type ControlPage, type ControlSkill } from "../api";
import { linkProps } from "../router";
import { num } from "../lib";
import { Sparkline } from "./charts";
import { Loader } from "./Loader";

/**
 * The control chart: does the newest day differ from the days before it, measured in the record's own noise?
 *
 * A lab does not ask whether a value changed; it asks whether a *rule* fired, and every rule comes with the
 * false alarms it costs. That is the whole repair this panel needed: its "up past 0.5 points" and "held past
 * two points" are invented thresholds, and on this record a move under 14 points is indistinguishable from
 * noise. Here the limits are the record's, the rules are Westgard's, and each one is priced — so "nothing
 * fired" is an answer a reader can trust, and the one move that is real is the only loud row.
 */
export function ControlView() {
  const [page] = createResource<ControlPage>(() => api.control());
  return (
    <Loader resource={page} loading="Loading the control chart…" empty="No skill has been measured yet, so there is nothing to chart.">
      {(loaded) => {
        const loud = () => loaded().skills.filter((skill) => skill.alarming || skill.warned);
        const quiet = () => loaded().skills.filter((skill) => !skill.alarming && !skill.warned);
        return (
          <>
            <header>
              <h1>Under control, or not</h1>
              <p class="facts">
                {loaded().skills.length} skills ·{" "}
                <span class={loaded().alarming ? "weak" : "dim"}>
                  {loaded().alarming} alarm{loaded().alarming === 1 ? "" : "s"}
                </span>
                , {loaded().warned} warning{loaded().warned === 1 ? "" : "s"} · sigma{" "}
                {loaded().sigma === null ? "unknown" : num(loaded().sigma)} points
                <Show when={loaded().pooled.mdc}> · a change must clear {num(loaded().pooled.mdc)} to be real</Show>
              </p>
              <p class="dim prose">
                Limits come from the record, not from a convention: the centre is each skill's baseline (every
                measured day but the ones under judgement) and the spread is the skill's own once it has ten
                baseline days, and the record's {loaded().pooled.pairs} day-to-day differences until then. At{" "}
                {loaded().fleet} skills, a 2s rule would fire on nothing about {num(loaded().expectedAt2s)} times a
                day, which is why the rules here are the specific ones.
              </p>
            </header>

            <Show when={loud().length} fallback={<p class="empty">Nothing fired: every skill sits inside its limits. That is the expected answer on most days, and it is a real one.</p>}>
              <div class="ctl">
                <For each={loud()}>{(skill) => <ControlRow skill={skill} page={loaded()} />}</For>
              </div>
            </Show>

            <Show when={quiet().length}>
              <details class="evidence">
                <summary>inside the limits — {quiet().length} skills, nothing to do</summary>
                <div class="ctl">
                  <For each={quiet()}>{(skill) => <ControlRow skill={skill} page={loaded()} quiet />}</For>
                </div>
              </details>
            </Show>

            <h2>The rules this chart is read by</h2>
            <div class="table-wrap">
              <table class="rules">
                <thead>
                  <tr>
                    <th>rule</th>
                    <th>what it looks for</th>
                    <th class="num">false alarms</th>
                    <th>why that number</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={loaded().rules}>
                    {(rule) => (
                      <tr class={rule.kind === "warn" ? "dim" : ""}>
                        <td class="mono">
                          {rule.key}
                          <Show when={rule.kind === "warn"}>
                            <span class="dim"> warning</span>
                          </Show>
                        </td>
                        <td>{rule.what}</td>
                        <td class="num">{(rule.falseAlarm * 100).toFixed(2)}%</td>
                        <td class="dim mono">{rule.because}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    </Loader>
  );
}

function ControlRow(props: { skill: ControlSkill; page: ControlPage; quiet?: boolean }) {
  const limits = () => props.skill.limits;
  const bands = () => (limits() ? [limits()!.three, limits()!.two, limits()!.one, limits()!.two, limits()!.three] : undefined);
  const domain = (): [number, number] => {
    const found = limits();
    if (!found || props.skill.center === null) return [0, 100];
    return [props.skill.center - 3.5 * props.skill.sigma!, props.skill.center + 3.5 * props.skill.sigma!];
  };
  return (
    <div class={`ctl-row ${props.skill.alarming ? "alarm" : props.skill.warned ? "warn" : "quiet"}`}>
      <a class="mono" {...linkProps({ name: "skill", skill: props.skill.name })}>
        {props.skill.name}
      </a>
      <span class="ctl-chart">
        <Show when={props.skill.days >= 2} fallback={<span class="dim">one measured day so far</span>}>
          <Sparkline
            points={props.skill.series.filter((point) => (point.n ?? 0) > 0)}
            width={420}
            domain={domain()}
            bands={bands()}
            canvas
          />
        </Show>
      </span>
      <span class="num dim">
        {props.skill.latest === null ? "—" : num(props.skill.latest)}
        <Show when={props.skill.z !== null}>
          <span class="dim"> ({props.skill.z! > 0 ? "+" : ""}{num(props.skill.z)}σ)</span>
        </Show>
      </span>
      <span class="ctl-why">
        <Show
          when={props.skill.fired.length}
          fallback={<span class="dim">inside ±2σ of {num(props.skill.center)}</span>}
        >
          <For each={props.skill.fired}>
            {(key) => {
              const rule = () => props.page.rules.find((entry) => entry.key === key);
              return (
                <span class={`pill ${rule()?.kind === "warn" ? "unknown" : "weak"}`} title={`${rule()?.what ?? key} — fires on ${((rule()?.falseAlarm ?? 0) * 100).toFixed(2)}% of good days by chance`}>
                  {key}
                </span>
              );
            }}
          </For>
        </Show>
        <span class="dim">
          {" "}
          baseline {props.skill.baselineDays}d · judged {props.skill.judgedDays}d · sigma{" "}
          {props.skill.source === "own" ? "its own" : props.skill.source === "pooled" ? "the record's" : "none"}
        </span>
      </span>
    </div>
  );
}
