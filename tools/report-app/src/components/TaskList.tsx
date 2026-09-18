import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { linkProps } from "../router";
import { Card, CardActions, CardHead } from "./Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { importanceOf, type Task } from "../tasks";

/**
 * One list of tasks, drawn one way: a card each, opened for the whole task.
 *
 * A digest's proposals and the to-do selection are the same fields at two moments, and both are read through
 * here. The list used to ship three shapes — a table of rows, this card, a line behind a disclosure — with a
 * picker above it, which meant a reader learned three layouts for one list, and the table was the thing that
 * could not fit a narrow pane. So: the card, with the change at reading size, the file and the check under it,
 * and the full detail one click away on the head's twisty. One card at a time, because a list of nine proposals
 * is read by opening the one you are working on.
 */
export function TaskList(props: {
  tasks: Task[];
  empty: string;
  action?: (task: Task) => JSX.Element;
}) {
  const [open, setOpen] = createSignal<string | null>(null);
  return (
    <Show when={props.tasks.length} fallback={<p class="empty">{props.empty}</p>}>
      <div class="cards">
        <For each={props.tasks}>
          {(task) => (
            <Card label={`${task.id}: ${task.change ?? "no change stated"}`}>
              <CardHead>
                <Button
                  variant="quiet"
                  size="chip"
                  aria-expanded={open() === task.id}
                  title={open() === task.id ? "close" : "the whole task"}
                  onClick={() => setOpen(open() === task.id ? null : task.id)}
                >
                  <span aria-hidden="true">{open() === task.id ? "▾" : "▸"}</span>
                  <span class="mono">{task.id}</span>
                </Button>
                <Weight task={task} />
                <SkillLink task={task} />
                <CardActions>{props.action?.(task)}</CardActions>
              </CardHead>
              <p class="m-0 text-section break-anywhere" title={`${task.change ?? ""}${task.target ? ` — ${task.target}` : ""}`}>
                {task.change ?? "—"}
              </p>
              <p class="m-0 text-chrome break-anywhere">
                <SkillTarget task={task} />
              </p>
              <p class="m-0 text-chrome break-anywhere" title={task.expected ?? ""}>
                check:{" "}
                <Show when={task.expected} fallback="not stated">
                  {task.expected}
                </Show>
              </p>
              <Show when={open() === task.id}>
                <div class="mt-0.5 border-t border-[color-mix(in_srgb,var(--border)_70%,transparent)] pt-1.5">
                  <TaskDetail task={task} />
                </div>
              </Show>
            </Card>
          )}
        </For>
      </div>
    </Show>
  );
}

/** A task's skill, as a link — the one thing about it that has a page of its own. */
function SkillLink(props: { task: Task }) {
  return (
    <Show when={props.task.skill} fallback={<span class="dim">—</span>}>
      <a class="mono" {...linkProps({ name: "skill", skill: props.task.skill! })}>
        {props.task.skill}
      </a>
    </Show>
  );
}

/** The file the task touches, under the change it makes to it. */
function SkillTarget(props: { task: Task }) {
  return (
    <Show when={props.task.target} fallback={<span class="dim">no file stated</span>}>
      <span class="mono" title={props.task.target!}>
        {props.task.target}
      </span>
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
    <Badge tone={importance().key === "high" ? "weak" : importance().key === "medium" ? "fair" : "unknown"} title={importance().detail}>
      {importance().label}
    </Badge>
  );
}

/** The whole text, for the card a reader opened. */
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
