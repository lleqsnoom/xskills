import { Show, createResource, createSignal } from "solid-js";
import { api, isSnapshot, type TodoItem } from "../api";
import { todoLine } from "../lib";
import { taskFromTodo, type Task } from "../tasks";
import { ShapePicker, TaskList } from "./TaskList";

/**
 * The to-do list. This screen is why the app has a server: the selection is a file beside the packs, so it
 * survives a reload and anything else can read it — and it is the one thing the app writes.
 */
export function TodosView() {
  const [saved, { refetch }] = createResource(async () => api.todos());
  const [items, setItems] = createSignal<TodoItem[] | null>(null);
  const [status, setStatus] = createSignal("");
  const current = () => items() ?? saved()?.items ?? [];

  const persist = async (next: TodoItem[]) => {
    setItems(next);
    try {
      const written = await api.saveTodos(next);
      setItems(written.items);
      setStatus(`saved ${written.items.length} item${written.items.length === 1 ? "" : "s"}`);
      void Promise.resolve(refetch()).catch(() => {}); // the stamp beside the list comes from the file, not from the write
    } catch (err) {
      setStatus(`could not save: ${(err as Error).message}`);
    }
  };

  const remove = (task: Task) =>
    void persist(current().filter((item) => !(item.id === task.id && (item.day ?? null) === (task.from ?? null))));
  const clear = () => void persist([]);
  const copy = async () => {
    const text = `# To-do\n\n${current().map(todoLine).join("\n")}\n`;
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`copied ${current().length} line${current().length === 1 ? "" : "s"}`);
    } catch {
      setStatus("could not copy: this surface has no clipboard access");
    }
  };

  return (
    <Show when={saved()} fallback={<p class="loading">Loading the list…</p>}>
      <header>
        <h1>To-do</h1>
        <p class="facts">
          {current().length} item{current().length === 1 ? "" : "s"}
          {saved()!.updatedAt ? ` · saved ${saved()!.updatedAt}` : " · nothing saved yet"}
        </p>
        <div class="toolbar">
          <button onClick={copy} disabled={!current().length}>
            copy as markdown
          </button>
          <Show when={!isSnapshot()}>
            <button onClick={clear} disabled={!current().length}>
              clear
            </button>
          </Show>
          <Show when={status()}>
            <span class="dim">{status()}</span>
          </Show>
        </div>
      </header>

      <div class="section-head">
        <h2>The selection</h2>
        <ShapePicker />
      </div>
      <TaskList
        tasks={current().map(taskFromTodo)}
        empty="Nothing on the list. Open a day and use “+ to-do” on a proposal, and it lands here — and in .x-skills/daily/todos.json."
        action={(task) => (
          <Show when={!isSnapshot()} fallback={<span class="dim">a snapshot cannot write</span>}>
            <button onClick={() => remove(task)} title={`drop ${task.id} from the list`}>
              remove
            </button>
          </Show>
        )}
      />
    </Show>
  );
}
