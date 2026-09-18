import { For, Show, createResource } from "solid-js";
import { api, type BenchPage, type BenchTask } from "../api";
import { linkProps } from "../router";
import { num } from "../lib";
import { taskFromBench } from "../tasks";
import { TodoButton } from "./DayView";
import { Loader } from "./Loader";

/**
 * The bench: the one fix to do now, what is in flight, and what is waiting on the scan.
 *
 * `now` is picked mechanically and says why — severity, how often the finding has been seen, and how cheap its
 * check is — because a picker nobody can argue with is a picker nobody trusts. `doing` is one card on purpose:
 * a bench with three open fixes is a bench where none gets finished, and `queued` is what that limit costs.
 * Everything that landed but has not been measured yet is `waiting`, which is the half of the loop nothing else
 * in the panel shows — the days a fix spends out of sight, before the next scan can say whether it worked.
 */
export function BenchView() {
  const [page] = createResource<BenchPage>(() => api.bench());
  return (
    <Loader resource={page} loading="Loading the bench…" empty="No proposal is open: every finding in the window has been dealt with.">
      {(loaded) => (
        <>
          <header>
            <h1>The bench</h1>
            <p class="facts">
              {loaded().counts.open} open · {loaded().counts.kept} kept · {loaded().counts.inFlight} in flight ·{" "}
              {loaded().counts.waiting} waiting on the scan
            </p>
            <p class="dim prose">
              One fix at a time: while something is in flight, the bench offers nothing new. A fix lands when a commit
              touches the file it names, and then it waits {loaded().window} measured days for the verdict.
            </p>
          </header>

          <Show
            when={loaded().now}
            fallback={<p class="empty">Nothing open. Every proposal in the window is kept or was decided against.</p>}
          >
            {(now) => (
              <article class="panel bench-now">
                <div class="bench-head">
                  <span class="mono dim">{now().klass}</span>
                  <span class={`pill ${now().severity === "unknown" ? "unknown" : now().severity}`}>{now().severity}</span>
                  <span class="dim">
                    seen on {now().recurrence} day{now().recurrence === 1 ? "" : "s"}
                  </span>
                  <span class="bench-act">
                    <Show when={now().day}>
                      <a class="mono dim" {...linkProps({ name: "day", date: now().day! })} title="open the day it came from">
                        {now().day}
                      </a>
                    </Show>
                    <TodoButton task={taskFromBench(now())} />
                  </span>
                </div>
                <p class="bench-why">{now().why}</p>
                <p class="bench-change">{now().change ?? "—"}</p>
                <dl class="fields">
                  <div>
                    <dt>Where</dt>
                    <dd class="mono">{now().target ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Check</dt>
                    <dd>{now().expected ?? <span class="dim">the digest stated no check, which is why this costs more</span>}</dd>
                  </div>
                  <div>
                    <dt>Signal</dt>
                    <dd>{now().signal ?? <span class="dim">—</span>}</dd>
                  </div>
                </dl>
              </article>
            )}
          </Show>

          <div class="bench-cols">
            <section>
              <h2>Doing</h2>
              <Show when={loaded().doing} fallback={<p class="empty">Nothing in flight. Take the fix above.</p>}>
                {(doing) => <BenchCard task={doing()} note="kept, waiting for a commit to land it" />}
              </Show>
            </section>

            <section>
              <h2>Queued — {loaded().queued.length}</h2>
              <Show when={loaded().queued.length} fallback={<p class="empty">Nothing waiting behind it.</p>}>
                <ul class="bench-list">
                  <For each={loaded().queued}>
                    {(task) => (
                      <li>
                        <BenchLine task={task} note="kept, behind the one in flight" />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <section>
              <h2>Waiting on the scan — {loaded().waiting.length}</h2>
              <Show when={loaded().waiting.length} fallback={<p class="empty">Nothing is waiting to be measured.</p>}>
                <ul class="bench-list">
                  <For each={loaded().waiting}>
                    {(task) => (
                      <li>
                        <BenchLine
                          task={task}
                          note={`landed ${task.landed} · ${task.left ?? 0} more measured day${task.left === 1 ? "" : "s"} for a verdict`}
                        />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
          </div>

          <Show when={loaded().next.length}>
            <h2>Next in line</h2>
            <ul class="bench-list">
              <For each={loaded().next}>
                {(task) => (
                  <li>
                    <BenchLine task={task} note={`${task.severity} · seen on ${task.recurrence} day${task.recurrence === 1 ? "" : "s"}`} />
                  </li>
                )}
              </For>
            </ul>
            <p class="dim">Ordered by severity, how often the finding has been seen, and how cheap its check is.</p>
          </Show>
        </>
      )}
    </Loader>
  );
}

/** The fix in flight: the same shape as the picked card, quieter, because the picked one is the decision. */
function BenchCard(props: { task: BenchTask; note: string }) {
  return (
    <article class="panel bench-card">
      <div class="bench-head">
        <span class="mono dim">{props.task.klass}</span>
        <Show when={props.task.skill}>
          <a class="mono" {...linkProps({ name: "skill", skill: props.task.skill! })}>
            {props.task.skill}
          </a>
        </Show>
        <Show when={props.task.day}>
          <a class="mono dim" {...linkProps({ name: "day", date: props.task.day! })}>
            {props.task.day}
          </a>
        </Show>
      </div>
      <p class="bench-change clamp-3">{props.task.change ?? "—"}</p>
      <p class="dim mono clamp-1" title={props.task.target ?? ""}>
        {props.task.target ?? "—"}
      </p>
      <p class="dim">{props.note}</p>
    </article>
  );
}

/** One line about a fix that is not the decision: what it is, where, and what it is waiting for. */
function BenchLine(props: { task: BenchTask; note: string }) {
  return (
    <span class="bench-line">
      <span class="mono dim">
        <Show when={props.task.skill} fallback="—">
          <a {...linkProps({ name: "skill", skill: props.task.skill! })}>{props.task.skill}</a>
        </Show>
      </span>
      <span class="clamp-1" title={props.task.change ?? ""}>
        {props.task.change ?? "—"}
      </span>
      <span class="dim">{props.note}</span>
      <Show when={props.task.after && props.task.after.days > 0}>
        <span class="num dim">
          {num(props.task.after!.mean)} over {props.task.after!.days}d
        </span>
      </Show>
    </span>
  );
}
