import { For, Show, createResource } from "solid-js";
import { api, type FlowPage } from "../api";
import { num } from "../lib";
import { linkProps } from "../router";
import { Loader } from "./Loader";

/**
 * The flow: is the bottleneck the skills, or the way they get fixed?
 *
 * The panel measures skills and never once asked whether the *fixing* keeps up. A factory reads lead time off
 * work in process (Little's law: the wait is the queue divided by the throughput), and the same arithmetic
 * applies here: what arrives a day, what closes a day, and what the gap means. On a two-day record the answer
 * is unflattering and useful — arrivals with no closures, so the queue grows and nothing has been verified.
 */
export function FlowView() {
  const [page] = createResource<FlowPage>(() => api.flow());
  /** Everything proposed in the window: the width every band is measured against. */
  const proposed = (page: FlowPage) => page.stages[0]?.count ?? 0;
  return (
    <Loader resource={page} loading="Loading the flow…" empty="Nothing has been proposed yet, so nothing is in the pipeline.">
      {(loaded) => (
        <>
          <header>
            <h1>What arrives, and what closes</h1>
            <p class="facts">
              {loaded().arrivals} proposed in {loaded().perDay.length} day{loaded().perDay.length === 1 ? "" : "s"} ·{" "}
              <span class="dim">{num(loaded().arrivalsPerDay)} a day in</span> ·{" "}
              <span class={loaded().closures === 0 ? "weak" : "dim"}>
                {num(loaded().closuresPerDay)} a day resolved
              </span>{" "}
              · {loaded().wip} open
            </p>
            <p class="dim prose">
              Bands are cumulative: everything proposed, everything kept, everything whose fix has landed, and
              everything closed. Where a band stops growing is the constraint. The wait is Little's law — the open
              queue divided by the rate — and with nothing closed there is no resolution rate to divide by, which
              is itself the finding.
            </p>
          </header>

          <div class="flow-bands">
            <For each={loaded().stages}>
              {(stage) => (
                <div class="flow-band">
                  <span class="dim flow-label">{stage.label}</span>
                  <span class="flow-track">
                    <span
                      class={`flow-fill ${stage.key}`}
                      style={{ width: `${proposed(loaded()) ? (stage.count / proposed(loaded())) * 100 : 0}%` }}
                    />
                  </span>
                  <span class="num">{stage.count}</span>
                </div>
              )}
            </For>
          </div>

          <div class="flow-grid">
            <div class="panel">
              <h3>Where it is stuck</h3>
              <Show when={loaded().constraint} fallback={<p class="dim">Nothing has entered the pipeline yet.</p>}>
                <p class="flow-answer">
                  <span class="mono">{loaded().constraint}</span>
                </p>
                <p class="dim">
                  Work has reached this stage and not left it. {loaded().reached.length} of {loaded().stages.length} stages
                  have ever held anything.
                </p>
              </Show>
            </div>
            <div class="panel">
              <h3>What the queue implies</h3>
              <dl class="fields">
                <div>
                  <dt>Open now</dt>
                  <dd>
                    {loaded().wip}
                    <Show when={loaded().oldestDays !== null}>
                      <span class="dim"> · oldest {loaded().oldestDays}d</span>
                    </Show>
                  </dd>
                </div>
                <div>
                  <dt>Wait at this rate</dt>
                  <dd>
                    <Show when={loaded().waitAtArrivals !== null} fallback={<span class="dim">—</span>}>
                      {num(loaded().waitAtArrivals)} days
                    </Show>
                    <span class="dim"> if arrivals stopped</span>
                  </dd>
                </div>
                <div>
                  <dt>Wait for a closure</dt>
                  <dd>
                    <Show when={loaded().waitAtClosures !== null} fallback={<span class="dim">nothing closes, so no rate to divide by</span>}>
                      {num(loaded().waitAtClosures)} days
                    </Show>
                  </dd>
                </div>
                <div>
                  <dt>Fixes kept</dt>
                  <dd>
                    {loaded().kept} of {loaded().findings} findings
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <Show when={loaded().perDay.length}>
            <h2>The pipeline, day by day</h2>
            <div class="table-wrap">
              <table class="flow-days">
                <thead>
                  <tr>
                    <th>day</th>
                    <th class="num">proposed</th>
                    <th class="num">kept</th>
                    <th class="num">landed</th>
                    <th class="num">closed</th>
                    <th class="num">open</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={loaded().perDay}>
                    {(day) => (
                      <tr>
                        <td>
                          <a class="mono" {...linkProps({ name: "day", date: day.date })}>
                            {day.date}
                          </a>
                        </td>
                        <td class="num">{day.cumulative.proposed}</td>
                        <td class="num">{day.cumulative.kept}</td>
                        <td class="num">{day.cumulative.landed}</td>
                        <td class="num">{day.cumulative.closed}</td>
                        <td class="num dim">{day.cumulative.proposed - day.cumulative.closed}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <p class="dim">
              A closure is dated by the rule that produces it: the last commit to the file, plus the {loaded().closedAfterDays}{" "}
              quiet days the recurrence board asks for before it calls a finding closed by evidence.
            </p>
          </Show>
        </>
      )}
    </Loader>
  );
}
