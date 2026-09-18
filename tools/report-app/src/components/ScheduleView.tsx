import { For, Show, createResource, createSignal } from "solid-js";
import { api, isSnapshot, type ReviewRow, type SchedulePage } from "../api";
import { num } from "../lib";
import { linkProps } from "../router";
import { Loader } from "./Loader";

/**
 * The schedule: which believed-fixed findings are due for a re-check.
 *
 * A fix is not verified by the absence of evidence; it is verified by looking again, at widening intervals —
 * one day, then six, then the easiness factor multiplies — which is how a spaced-repetition schedule keeps a
 * queue bounded (SM-2's shape, applied to findings rather than to facts). Half of the checks need no human at
 * all: the recurrence board already knows whether a class and file appeared again in a new pack, so this list
 * asks only for what the scanner cannot see. A finding that lapses twice is marked for reformulation, because
 * Wozniak's own conclusion applies: an item that keeps failing has a flaw in how it is written.
 */
export function ScheduleView() {
  const [page, { refetch }] = createResource<SchedulePage>(() => api.schedule());
  const [status, setStatus] = createSignal("");
  const record = async (row: ReviewRow, outcome: "held" | "came-back" | "reformulate") => {
    setStatus(`recording ${outcome} for ${row.path}…`);
    try {
      await api.review(row.path, outcome);
      setStatus(outcome === "held" ? `${row.path} held: the next check is further away` : `${row.path} ${outcome}`);
      void Promise.resolve(refetch()).catch(() => {});
    } catch (err) {
      setStatus((err as Error).message);
    }
  };
  return (
    <Loader resource={page} loading="Loading the schedule…" empty="No finding is open, so nothing needs re-checking.">
      {(loaded) => (
        <>
          <header>
            <h1>Due for a re-check</h1>
            <p class="facts">
              {loaded().dueCount} of {loaded().open} open findings are due · {loaded().autoAnswered} already answered by
              the scan · {num(loaded().perDay)} finding{loaded().perDay === 1 ? "" : "s"} a day arrive
              <Show when={loaded().load !== null}>
                , so the schedule asks for about {num(loaded().load)} checks a day
              </Show>
            </p>
            <p class="dim prose">
              Intervals are {loaded().steps[0]} day, then {loaded().steps[1]}, then the easiness factor multiplies — so a
              check that holds pushes the next one further out, and a finding that comes back is due again tomorrow.
              Nothing is declared closed here: the recurrence board does that, and it says on what evidence.
            </p>
            <Show when={status()}>
              <div class="toolbar">
                <span class="dim">{status()}</span>
              </div>
            </Show>
          </header>

          <Show
            when={loaded().due.length}
            fallback={
              <p class="empty">
                Nothing is due. {nextDue(loaded()) ? `The next check is ${nextDue(loaded())}.` : "The schedule is empty."}
              </p>
            }
          >
            <div class="schedule">
              <For each={loaded().due}>{(row) => <ReviewCard row={row} snapshot={isSnapshot()} onRecord={record} />}</For>
            </div>
          </Show>

          <Show when={loaded().next.length}>
            <h2>Next in line</h2>
            <div class="table-wrap">
              <table class="due-next">
                <thead>
                  <tr>
                    <th>finding</th>
                    <th class="num">seen</th>
                    <th class="num">interval</th>
                    <th class="num">due</th>
                    <th>last checked</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={loaded().next}>
                    {(row) => (
                      <tr>
                        <td class="mono">{row.path}</td>
                        <td class="num dim">
                          {row.days} day{row.days === 1 ? "" : "s"}
                        </td>
                        <td class="num">{row.interval}d</td>
                        <td class="num">{row.due}</td>
                        <td class="dim mono">{row.reviewedAt ? row.reviewedAt.slice(0, 10) : "never"}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>

          <p class="dim">
            A check is one command away rather than one memory away: open the finding, re-run what the fix promised,
            and record what happened.
          </p>
        </>
      )}
    </Loader>
  );
}

/** The date of the earliest check that is not due yet, when the list is empty. */
function nextDue(page: SchedulePage): string | null {
  return page.next[0]?.due ?? null;
}

function ReviewCard(props: { row: ReviewRow; snapshot: boolean; onRecord: (row: ReviewRow, outcome: "held" | "came-back" | "reformulate") => void }) {
  const row = () => props.row;
  return (
    <article class={`review ${row().auto ? "auto" : ""}`}>
      <div class="review-head">
        <span class="mono dim">{row().klass}</span>
        <span class={`pill ${row().severity === "high" ? "high" : row().severity === "medium" ? "medium" : "low"}`}>
          {row().severity}
        </span>
        <span class="dim">
          step {row().step} · interval {row().interval}d · due {row().due}
          <Show when={(row().overdueBy ?? 0) > 0}> · {row().overdueBy} days over</Show>
        </span>
        <span class="review-act">
          <Show when={!props.snapshot} fallback={<span class="dim">a snapshot cannot write</span>}>
            <button onClick={() => props.onRecord(row(), "held")} title="the fix held: push the next check further out">
              held
            </button>
            <button class="came-back" onClick={() => props.onRecord(row(), "came-back")} title="the finding is back: the next check is tomorrow">
              came back
            </button>
            <button onClick={() => props.onRecord(row(), "reformulate")} title="this keeps failing its check: the finding itself needs rewriting">
              reformulate
            </button>
          </Show>
        </span>
      </div>
      <p class="review-path">
        <span class="mono">{row().path}</span>
        <Show when={row().skill}>
          {" "}
          <a class="mono" {...linkProps({ name: "skill", skill: row().skill! })}>
            {row().skill}
          </a>
        </Show>
      </p>
      <Show when={row().auto}>
        <p class="weak">
          The scan already answered this one: the class and file appear again in a newer pack, so the fix did not
          hold. Recording it takes one click.
        </p>
      </Show>
      <p class="dim">
        first seen {row().first} · last seen {row().last} · {row().days} day{row().days === 1 ? "" : "s"}
        <Show when={row().lapses}>
          {" "}
          · lapsed {row().lapses}× (the interval is one day again
          <Show when={row().lapses >= 2}>, and the finding is flagged for rewriting</Show>)
        </Show>
      </p>
    </article>
  );
}
