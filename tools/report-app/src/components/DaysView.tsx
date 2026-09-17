import { createResource } from "solid-js";
import { api, type MovementPage } from "../api";
import { DaysSection } from "./Movement";
import { Loader } from "./Loader";

/** Every day on record: the five newest as a list, then a calendar the older ones live in. */
export function DaysView() {
  const [page] = createResource<MovementPage>(() => api.movement());
  return (
    <Loader resource={page} loading="Loading the days…" empty="No day has been recorded yet.">
      {(loaded) => (
        <>
          <header>
            <h1>Days</h1>
            <p class="facts">
              {loaded().days} day{loaded().days === 1 ? "" : "s"} recorded · newest{" "}
              <span class="mono">{loaded().newest ?? "—"}</span>
              {loaded().hasPack ? "" : " · its pack is no longer on disk"}
            </p>
            <p class="dim" style={{ "max-width": "78ch" }}>
              The list shows the five most recent days; the calendar reaches the rest. A day links to its report
              while the pack is still on disk — its scores stay in <code>history.jsonl</code> either way, because
              that file is never pruned.
            </p>
          </header>
          <DaysSection page={loaded()} />
        </>
      )}
    </Loader>
  );
}
