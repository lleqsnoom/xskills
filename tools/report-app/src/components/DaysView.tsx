import { For, Show, createResource } from "solid-js";
import { api, type MovementPage } from "../api";
import { linkProps } from "../router";
import { DaysSection } from "./Movement";

/** Every day on record: the five newest as a list, then a calendar the older ones live in. */
export function DaysView() {
  const [page] = createResource<MovementPage>(() => api.movement());
  return (
    <Show when={page()} fallback={<p class="loading">Loading the days…</p>}>
      <header>
        <h1>Days</h1>
        <p class="facts">
          {page()!.days} day{page()!.days === 1 ? "" : "s"} recorded · newest{" "}
          <span class="mono">{page()!.newest ?? "—"}</span>
          {page()!.hasPack ? "" : " · its pack is no longer on disk"}
        </p>
        <p class="dim" style={{ "max-width": "78ch" }}>
          The list shows the five most recent days; the calendar reaches the rest. A day links to its report
          while the pack is still on disk — its scores stay in <code>history.jsonl</code> either way, because
          that file is never pruned.
        </p>
      </header>
      <DaysSection page={page()!} />
    </Show>
  );
}
