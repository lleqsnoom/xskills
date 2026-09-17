import { For, Match, Show, Switch, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { linkProps } from "../router";
import { SHAPES, importanceOf, setTaskShape, taskShape, type Task } from "../tasks";

/**
 * One list of tasks, drawn three ways. A digest's proposals and the to-do selection are the same fields at
 * two moments, so both screens render them here — the only difference is the action threaded in.
 *
 * Which shape reads best is a taste call, so all three ship and the reader picks; the picker is beside the
 * list because the shape is a property of the list, not of the screen.
 */
export function TaskList(props: {
  tasks: Task[];
  empty: string;
  action?: (task: Task) => JSX.Element;
}) {
  return (
    <Show when={props.tasks.length} fallback={<p class="empty">{props.empty}</p>}>
      <Switch>
        <Match when={taskShape() === "a"}>
          <TaskRows {...props} />
        </Match>
        <Match when={taskShape() === "b"}>
          <TaskCards {...props} />
        </Match>
        <Match when={taskShape() === "c"}>
          <TaskLines {...props} />
        </Match>
      </Switch>
    </Show>
  );
}

/** The three shapes, as a control. Placed beside the list it reshapes. */
export function ShapePicker() {
  return (
    <span class="shapes" role="group" aria-label="how to draw the tasks">
      <For each={SHAPES}>
        {(option) => (
          <button
            class={taskShape() === option.id ? "on" : ""}
            aria-pressed={taskShape() === option.id}
            title={option.hint}
            onClick={() => setTaskShape(option.id)}
          >
            {option.label}
          </button>
        )}
      </For>
    </span>
  );
}

/** A row's skill, as a link — the one thing about a task that has a page of its own. */
function SkillLink(props: { task: Task }) {
  return (
    <Show when={props.task.skill} fallback={<span class="dim">—</span>}>
      <a class="mono" {...linkProps({ name: "skill", skill: props.task.skill! })}>
        {props.task.skill}
      </a>
    </Show>
  );
}

/**
 * How much the task matters, as a badge: the severity word carries it and the colour only reinforces it, so
 * the list still reads with colour removed. The title says what the badge counted.
 */
function Weight(props: { task: Task }) {
  const importance = () => importanceOf(props.task);
  return (
    <span class={`pill ${importance().key}`} title={importance().detail}>
      {importance().label}
    </span>
  );
}

/** The whole text, for the shapes that hide it behind a disclosure. */
function TaskDetail(props: { task: Task }) {
  const field = (label: string, value: string | null) => (
    <div>
      <dt>{label}</dt>
      <dd>
        <Show when={value} fallback={<span class="dim">not stated</span>}>
          {value}
        </Show>
      </dd>
    </div>
  );
  return (
    <div class="task-detail-body">
      <Show when={props.task.title}>
        <p class="dim task-title">{props.task.title}</p>
      </Show>
      <dl class="fields">
        {field("Change", props.task.change)}
        {field("Where", props.task.target)}
        {field("Check", props.task.expected)}
        {field("Signal", props.task.signal)}
        {field("Route", props.task.route)}
        {field("Note", props.task.note)}
      </dl>
    </div>
  );
}

/**
 * A: a row each — the shape for a digest with nine proposals in it. The change is the only prose left in
 * the row; the file and the check are one click away, which is where a reader wants them, not in every row.
 */
function TaskRows(props: { tasks: Task[]; action?: (task: Task) => JSX.Element }) {
  const [open, setOpen] = createSignal<string | null>(null); // one open row at a time keeps the list scannable
  return (
    <div class="table-wrap">
      <table class="tasks">
        <thead>
          <tr>
            <th class="t-id">#</th>
            <th class="t-skill">skill</th>
            <th>what changes</th>
            <th class="t-weight">importance</th>
            <th class="t-act"></th>
          </tr>
        </thead>
        <tbody>
          <For each={props.tasks}>
            {(task) => (
              <>
                <tr classList={{ open: open() === task.id }}>
                  <td class="t-id">
                    <button
                      class="twisty"
                      aria-expanded={open() === task.id}
                      onClick={() => setOpen(open() === task.id ? null : task.id)}
                    >
                      <span class="mark">{open() === task.id ? "▾" : "▸"}</span> <span class="mono">{task.id}</span>
                    </button>
                  </td>
                  <td>
                    <SkillLink task={task} />
                  </td>
                  <td>
                    <span class="clamp-1" title={`${task.change ?? ""}${task.target ? ` — ${task.target}` : ""}`}>
                      {task.change ?? "—"}
                    </span>
                  </td>
                  <td>
                    <Weight task={task} />
                  </td>
                  <td class="t-act">{props.action?.(task)}</td>
                </tr>
                <Show when={open() === task.id}>
                  <tr class="task-detail">
                    <td colSpan={5}>
                      <TaskDetail task={task} />
                    </td>
                  </tr>
                </Show>
              </>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

/** B: a card each, the change at reading size and everything else muted beside it. */
function TaskCards(props: { tasks: Task[]; action?: (task: Task) => JSX.Element }) {
  return (
    <div class="task-cards">
      <For each={props.tasks}>
        {(task) => (
          <article class="task-card">
            <div class="task-card-head">
              <span class="mono task-id">{task.id}</span>
              <Weight task={task} />
              <span class="task-act">{props.action?.(task)}</span>
            </div>
            <p class="task-change clamp-3" title={task.change ?? ""}>
              {task.change ?? "—"}
            </p>
            <p class="task-meta">
              <SkillLink task={task} />
              <Show when={task.target}>
                <span class="mono dim clamp-1" title={task.target!}>
                  {task.target}
                </span>
              </Show>
            </p>
            <p class="task-check dim clamp-2" title={task.expected ?? ""}>
              <Show when={task.expected} fallback="no check stated">
                {task.expected}
              </Show>
            </p>
          </article>
        )}
      </For>
    </div>
  );
}

/** C: one line each, the whole task behind a disclosure — the shape for scanning a long list. */
function TaskLines(props: { tasks: Task[]; action?: (task: Task) => JSX.Element }) {
  return (
    <div class="task-lines">
      <For each={props.tasks}>
        {(task) => (
          <div class="task-line">
            <details>
              <summary>
                <span class="mono task-id">{task.id}</span>
                <Weight task={task} />
                <span class="task-line-skill">
                  <SkillLink task={task} />
                </span>
                <span class="clamp-1" title={task.change ?? ""}>
                  {task.change ?? "—"}
                </span>
              </summary>
              <TaskDetail task={task} />
            </details>
            <span class="task-act">{props.action?.(task)}</span>
          </div>
        )}
      </For>
    </div>
  );
}
