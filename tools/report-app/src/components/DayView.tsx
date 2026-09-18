import { For, Show, createResource, createSignal } from "solid-js";
import { api, isSnapshot, type Day, type Signal, type TodoItem } from "../api";
import { linkProps } from "../router";
import { Bar } from "./charts";
import { Card, CardHead, CardName } from "./Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { bandKey, severityClass } from "../lib";
import { TaskList } from "./TaskList";
import { Loader } from "./Loader";
import { taskFromProposal, type Task } from "../tasks";

/** One day: what was scanned, how the skills scored, and what the digest wants changed. */
export function DayView(props: { date: string }) {
  // Remounted per route by the shell (see App), so this fetches once for the date it was given.
  const [day] = createResource(() => api.day(props.date));
  return (
    <Loader resource={day} loading={`Loading ${props.date}…`} empty={`No pack on disk for ${props.date}.`}>
      {(loaded) => (
        <>
          <Show when={loaded().pack} fallback={<p class="failed">No pack on disk for {props.date}.</p>}>
            <DayHeader date={props.date} loaded={loaded()} />

            <Show when={loaded().proposals.length}>
              <h2 class="section-head">Proposals — {loaded().proposals.length}</h2>
              <TaskList
                tasks={loaded().proposals.map((proposal) => taskFromProposal(proposal))}
                empty="The digest proposed nothing."
                action={(task) => <TodoButton task={task} />}
              />
            </Show>

            {/* The pack, not the review: everything the run saw, behind one control so the decisions above
                stay the page. Closed by default — a reader who wants the raw record opens it. */}
            <details class="evidence">
              <summary>
                the evidence — {loaded().scores.length} scores · {loaded().pack.sessions.length} sessions ·{" "}
                {loaded().pack.signals.length} signals
              </summary>

              <h2>Scores that day</h2>
              <ScoreList day={loaded()} />

              <h2>Sessions — {loaded().pack.sessions.length}</h2>
              <SessionTable date={props.date} day={loaded()} />

              <h2>Signals — {loaded().pack.signals.length}</h2>
              <SignalList signals={loaded().pack.signals} date={props.date} limit={worthReading(loaded().pack.signals)} />

              <Show when={loaded().pack.warnings.length}>
                <h2>Warnings</h2>
                <ul>
                  <For each={loaded().pack.warnings}>
                    {(warning) => (
                      <li class="dim">
                        <span class="mono">{warning.scope}</span> — {warning.reason}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </details>
          </Show>
        </>
      )}
    </Loader>
  );
}

function DayHeader(props: { date: string; loaded: Day }) {
  const counts = () => props.loaded.pack.counts;
  return (
    <header>
      <h1>
        <span class="mono">{props.date}</span>{" "}
        <span class="dim">{props.loaded.pack.window ? `last ${props.loaded.pack.window.hours}h` : ""}</span>
      </h1>
      <p class="facts">
        {counts().scanned ?? props.loaded.pack.sessions.length} sessions · {counts().toolCalls ?? 0} tool calls ·{" "}
        {counts().toolFailures ?? 0} failures · {counts().corrections ?? 0} corrections ·{" "}
        {counts().highSignals ?? 0} high signals
      </p>
      <div class="toolbar">
        <For each={props.loaded.pack.hosts.filter((host) => host.status !== "absent")}>
          {(host) => (
            <span class="dim">
              {host.id} {host.sessions}
            </span>
          )}
        </For>
      </div>
    </header>
  );
}

/** The day's scores, with a bar per axis the row measured and the numerator behind each. */
function ScoreList(props: { day: Day }) {
  const measured = (dimensions: Record<string, number | null | undefined>) =>
    Object.entries(dimensions).filter(([, value]) => value !== null && value !== undefined) as [string, number][];
  return (
    <Show when={props.day.scores.length} fallback={<p class="empty">No score was recorded that day.</p>}>
      <div class="cards">
        <For each={props.day.scores}>
          {(row) => (
            <Card
              as="a"
              {...linkProps({ name: "skill", skill: row.name })}
              label={row.name}
              title={`${row.name} — its own page`}
            >
              <CardHead>
                <CardName>
                  <span class="mono">{row.name}</span>
                </CardName>
                <Badge tone={row.band.key}>{row.band.label}</Badge>
                <span class={`mono score big ${row.score === null ? "dim" : row.band.key}`}>
                  {row.score === null ? "—" : row.score.toFixed(1)}
                </span>
              </CardHead>
              <p class="m-0 text-chrome break-anywhere">loaded {row.n} · named {row.named}</p>
              <span class="axes">
                <For each={measured(row.dimensions)}>
                  {([name, value]) => (
                    <span class="axis" title={`${name} ${Math.round(value * 100)}%`}>
                      <span class="mono dim">{name.slice(0, 4)}</span>
                      <Bar value={value} band={{ key: bandKey(value), label: "" }} width={40} />
                      <span class="num">{Math.round(value * 100)}%</span>
                    </span>
                  )}
                </For>
              </span>
            </Card>
          )}
        </For>
      </div>
    </Show>
  );
}

function SessionTable(props: { date: string; day: Day }) {
  return (
    <div class="table-wrap records">
      <table>
        <thead>
          <tr>
            <th>Session</th>
            <th>Host</th>
            <th class="num">Tools</th>
            <th class="num">Failures</th>
            <th class="num">Corrected</th>
            <th>Loaded</th>
            <th class="num">High</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.day.pack.sessions}>
            {(session) => (
              <tr>
                <td data-label="Session">
                  <a {...linkProps({ name: "session", date: props.date, id: session.id })}>
                    {session.title ?? "(untitled)"}
                  </a>
                  <div class="dim mono">{session.id}</div>
                </td>
                <td class="dim" data-label="Host">{session.host}</td>
                <td class="num" data-label="Tools">{session.stats.toolCalls}</td>
                <td class="num" data-label="Failures">{session.stats.toolFailures}</td>
                <td class="num" data-label="Corrected">{session.stats.corrections}</td>
                <td class="dim mono" data-label="Loaded">{session.skills.loaded.join(", ") || "—"}</td>
                <td class="num" data-label="High">{session.high || ""}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every signal the scanner recorded, worst first.
 *
 * A row, not a table cell: the summary is the payload and it takes as many lines as the width allows, so
 * nothing is clipped and nothing spills off the page. The row's head carries the labels — severity, the
 * scanner's kind, and how often the pattern was seen, spelled out because a bare "×4" tells a reader
 * nothing.
 *
 * The row is a link to the session it came from, and the session is only named in the head when the list
 * spans more than one — on a session's own page that column was a column of the same title repeated. There,
 * the sessions' own excerpts are shown instead, because the row has nowhere to send you.
 *
 * `showDay` adds the day (a skill's signals span the record); `compact` drops the other suspects the signal
 * names, which on a page about one skill is noise; `limit` shows the worst few and keeps the rest one click
 * away.
 */
export function SignalList(props: {
  signals: (Signal & { date?: string })[];
  date: string;
  showDay?: boolean;
  compact?: boolean;
  limit?: number;
}) {
  const [all, setAll] = createSignal(false);
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const order = (severity: keyof typeof rank) => rank[severity];
  const sorted = () => [...props.signals].sort((a, b) => order(a.severity) - order(b.severity) || b.count - a.count);
  const shown = () => (props.limit && !all() ? sorted().slice(0, props.limit) : sorted());
  const dayOf = (signal: Signal & { date?: string }) => signal.date ?? props.date;
  const oneSession = () => new Set(props.signals.map((signal) => signal.session)).size === 1;
  /** The session's name, or its id when the CLI never gave it one — "Untitled Session" names nothing. */
  const nameOf = (signal: Signal & { date?: string }) => {
    const title = signal.sessionTitle?.trim();
    return title && !/^untitled session$/i.test(title) ? title : signal.session;
  };
  const body = (signal: Signal & { date?: string }) => (
    <>
      <span class="sig-head">
        <Show when={props.showDay}>
          <span class="mono dim">{dayOf(signal)}</span>
        </Show>
        <span class={`sig-sev ${severityClass(signal.severity)}`}>{signal.severity}</span>
        <span class="mono dim">{signal.kind}</span>
        <span class="sig-count dim" title={`the scanner counted this pattern ${signal.count} time${signal.count === 1 ? "" : "s"} in the session`}>
          seen {signal.count}×
        </span>
        <Show when={!oneSession()}>
          <span class="dim sig-where" title={nameOf(signal)}>{nameOf(signal)}</span>
        </Show>
      </span>
      <span class="sig-text">
        {signal.summary}
        <Show when={!props.compact && signal.suspects.length}>
          <span class="dim"> — blames {signal.suspects.join(", ")}</span>
        </Show>
        <Show when={oneSession()}>
          <For each={(signal.evidence ?? []).slice(0, 2)}>
            {(item) => (
              <span class="sig-ev dim" title={item.excerpt ?? ""}>
                msg {item.message}
                {item.tool ? ` · ${item.tool}` : ""}
                {item.excerpt ? `: ${item.excerpt}` : ""}
              </span>
            )}
          </For>
        </Show>
      </span>
    </>
  );
  return (
    <Show when={props.signals.length} fallback={<p class="empty">No signal was recorded.</p>}>
      <div class="signals">
        <For each={shown()}>
          {(signal) => (
            <Show when={!oneSession()} fallback={<div class="sig">{body(signal)}</div>}>
              <a class="sig linked" {...linkProps({ name: "session", date: dayOf(signal), id: signal.session })}>
                {body(signal)}
              </a>
            </Show>
          )}
        </For>
      </div>
      <Show when={props.limit && sorted().length > props.limit}>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={() => setAll(!all())} aria-expanded={all()} variant={all() ? "primary" : "outline"}>
            {all() ? `show the worst ${props.limit}` : `show all ${sorted().length}`}
          </Button>
          <span class="text-chrome text-muted-foreground">
            showing {shown().length} of {sorted().length}, worst first
          </span>
        </div>
      </Show>
    </Show>
  );
}

/** The signals worth a reader's attention: everything that is not a low-severity repeat. */
function worthReading(signals: Signal[]): number {
  return signals.filter((signal) => signal.severity !== "low").length;
}

/**
 * The one write there is: keep a proposal on the to-do list beside the packs.
 *
 * The server already decided whether this proposal is kept (`inTodo`, matched on the work rather than on the
 * digest's label), so the row stops offering itself the moment it is on the list — including on a reload, and
 * including for entries that were saved before the list recorded which day they came from. It is exported
 * because a day is not the only screen a proposal appears on: a skill's own screen keeps it the same way.
 */
export function TodoButton(props: { task: Task }) {
  const [added, setAdded] = createSignal(props.task.inTodo);
  const [error, setError] = createSignal("");
  const todo = (): TodoItem => ({
    id: props.task.id,
    day: props.task.from,
    skill: props.task.skill,
    change: props.task.change,
    reason: props.task.reason,
    expected: props.task.expected,
    target: props.task.target,
    route: props.task.route,
    signal: props.task.signal,
    note: null,
  });
  const add = async () => {
    try {
      const current = await api.todos();
      const keep = current.items.filter((item) => !(item.id === todo().id && (item.day ?? null) === (todo().day ?? null)));
      await api.saveTodos([...keep, todo()]);
      setAdded(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Show when={!isSnapshot()} fallback={<span class="dim">a snapshot cannot write</span>}>
      <Button
        variant={added() ? "outline" : "primary"}
        onClick={add}
        disabled={added()}
        title={error() || "keep this proposal"}
      >
        {added() ? "in to-do" : "+ to-do"}
      </Button>
      <Show when={error()}>
        <span class="failed text-chrome">{error()}</span>
      </Show>
    </Show>
  );
}
