import { Show, createResource, createSignal } from "solid-js";
import { api, isSnapshot, type TodoItem } from "../api";
import { improvementBrief } from "../brief.mjs";
import { settled } from "../resource.mjs";
import { taskFromTodo, type Task } from "../tasks";
import { TaskList } from "./TaskList";
import { Button } from "../ui/Button";
import { Loader } from "./Loader";

/**
 * The to-do list. This screen is why the app has a server: the selection is a file beside the packs, so it
 * survives a reload and anything else can read it — and it is the one thing the app writes.
 */
export function TodosView() {
  const [saved, { refetch }] = createResource(async () => api.todos());
  const [items, setItems] = createSignal<TodoItem[] | null>(null);
  const [status, setStatus] = createSignal("");
  // Reading the list through `settled` keeps the failure a state this screen can draw, rather than a throw
  // from inside its own update.
  const current = () => items() ?? settled(saved)?.items ?? [];

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
    const text = improvementBrief(current(), {
      generatedAt: new Date().toLocaleString(),
      savedAt: settled(saved)?.updatedAt ?? null,
    });
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`copied the brief: ${current().length} task${current().length === 1 ? "" : "s"}, ${text.split("\n").length} lines`);
    } catch {
      setStatus("could not copy: this surface has no clipboard access");
    }
  };

  return (
    <Loader resource={saved} loading="Loading the list…" empty="Nothing on the list yet.">
      {(loaded) => (
        <>
          <header>
            <h1>To-do</h1>
            <p class="facts">
              {current().length} item{current().length === 1 ? "" : "s"}
              {loaded().updatedAt ? ` · saved ${loaded().updatedAt}` : " · nothing saved yet"}
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                onClick={copy}
                disabled={!current().length}
                title="the whole loop: the data sources, the steps, and one section per task"
              >
                copy the brief
              </Button>
              <Show when={!isSnapshot()}>
                <Button onClick={clear} disabled={!current().length}>
                  clear
                </Button>
              </Show>
              <Show when={status()}>
                <span class="text-chrome text-muted-foreground">{status()}</span>
              </Show>
            </div>
          </header>

          <h2 class="section-head">The selection</h2>
          <TaskList
            tasks={current().map(taskFromTodo)}
            empty="Nothing on the list. Open a day and use “+ to-do” on a proposal, and it lands here — and in .x-skills/daily/todos.json."
            action={(task) => (
              <Show when={!isSnapshot()} fallback={<span class="dim">a snapshot cannot write</span>}>
                <Button variant="outline" onClick={() => remove(task)} title={`drop ${task.id} from the list`}>
                  remove
                </Button>
              </Show>
            )}
          />
        </>
      )}
    </Loader>
  );
}
