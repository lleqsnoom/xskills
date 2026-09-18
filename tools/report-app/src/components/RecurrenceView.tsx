import { For, Show, createResource } from "solid-js";
import { api, type Finding, type RecurrencePage } from "../api";
import { linkProps } from "../router";
import { Loader } from "./Loader";

/**
 * The recurrence board: the findings that keep coming back.
 *
 * A mean of five axes cannot be fixed; a defect can, and it can go to zero. So the headline here is not a score
 * but a count of findings, and the finding that matters most is one that appeared *after* a commit to its file:
 * that is the record saying the fix did not work, which is the sharpest thing the panel can say.
 *
 * A finding is a file rather than an improvement class, because the class is written by the reflection and its
 * wording drifts between runs — one digest files a defect as `doc-command-drift:` and the next as
 * `` `x-epic`: ``. Grouping by class would orphan that history and read as progress.
 */
export function RecurrenceView() {
  const [page] = createResource<RecurrencePage>(() => api.recurrence());
  return (
    <Loader
      resource={page}
      loading="Loading the findings…"
      empty="No digest has proposed anything in the window, so there is nothing to come back."
    >
      {(loaded) => (
        <>
          <header>
            <h1>What keeps coming back</h1>
            <p class="facts">
              {loaded().summary.open} open ·{" "}
              <span class="weak">{loaded().summary.cameBack} came back after a fix</span> ·{" "}
              {loaded().summary.chronic} chronic · <span class="good">{loaded().summary.closed} closed</span>
            </p>
            <p class="dim prose">
              One row per file a digest has proposed something about. A commit to that file is a fix attempt; a
              sighting after the last attempt is the finding coming back. A finding with a fix and no sighting for{" "}
              {loaded().closedAfterDays} days is closed by evidence rather than declared fixed, so it says how long the
              quiet has lasted.
            </p>
          </header>

          <Show
            when={loaded().findings.length}
            fallback={<p class="empty">No proposals in the window. This board fills up as digests are written.</p>}
          >
            <div class="findings">
              <For each={loaded().findings}>{(finding) => <FindingRow finding={finding} />}</For>
            </div>
          </Show>
        </>
      )}
    </Loader>
  );
}

const STATUS: Record<Finding["status"], { label: string; tone: string; note: string }> = {
  "came-back": { label: "came back", tone: "weak", note: "seen again after a fix landed" },
  chronic: { label: "chronic", tone: "fair", note: "proposed on more than one day, with no fix between" },
  new: { label: "new", tone: "unknown", note: "proposed today" },
  open: { label: "open", tone: "unknown", note: "proposed once, not yet fixed" },
  closed: { label: "closed", tone: "good", note: "a fix landed and nothing has been seen since" },
};

function FindingRow(props: { finding: Finding }) {
  const status = () => STATUS[props.finding.status];
  const quiet = () =>
    props.finding.status === "closed" && props.finding.quietDays !== null
      ? `not seen for ${props.finding.quietDays} days`
      : null;
  return (
    <details class={`finding ${props.finding.status}`}>
      <summary>
        <span class={`pill ${status().tone}`} title={status().note}>
          {status().label}
        </span>
        <span class="mono dim finding-class">
          {props.finding.klass}
          <Show when={props.finding.relabelled}>
            <span title={`also filed as: ${props.finding.klasses.join(", ")}`}> +{props.finding.klasses.length - 1}</span>
          </Show>
        </span>
        <span class="mono finding-path">{props.finding.path ?? "—"}</span>
        <span class="dim finding-count">
          {props.finding.days} day{props.finding.days === 1 ? "" : "s"}
          <Show when={props.finding.sessions.length}>
            {" "}
            · {props.finding.sessions.length} session{props.finding.sessions.length === 1 ? "" : "s"}
          </Show>
        </span>
        <span class={`pill ${props.finding.severity === "unknown" ? "unknown" : props.finding.severity}`}>{props.finding.severity}</span>
      </summary>

      <div class="finding-body">
        <Show when={quiet()}>
          <p class="dim">Closed by evidence: {quiet()}.</p>
        </Show>
        <Show when={props.finding.sinceFix}>
          <p class="weak">
            Proposed {props.finding.sinceFix} time{props.finding.sinceFix === 1 ? "" : "s"} since the last commit to this
            file, on {props.finding.lastFix}: the fix did not stop it.
          </p>
        </Show>
        <dl class="fields">
          <div>
            <dt>First seen</dt>
            <dd class="mono">{props.finding.first}</dd>
          </div>
          <div>
            <dt>Fixes landed</dt>
            <dd class="mono">
              <Show when={props.finding.attempts.length} fallback={<span class="dim">nothing committed to this file yet</span>}>
                {props.finding.attempts.join(", ")}
              </Show>
            </dd>
          </div>
          <Show when={props.finding.skill}>
            <div>
              <dt>Skill</dt>
              <dd>
                <a class="mono" {...linkProps({ name: "skill", skill: props.finding.skill! })}>
                  {props.finding.skill}
                </a>
              </dd>
            </div>
          </Show>
        </dl>

        <ul class="sightings">
          <For each={props.finding.sightings}>
            {(sighting) => (
              <li>
                <span class="mono dim">
                  <a {...linkProps({ name: "day", date: sighting.date })}>{sighting.date}</a>
                </span>
                <span class="mono dim">{sighting.id}</span>
                <span class="clamp-2" title={sighting.change ?? ""}>
                  {sighting.change ?? sighting.title ?? "—"}
                </span>
                <Show when={sighting.signal}>
                  <span class="dim clamp-1" title={sighting.signal ?? ""}>
                    {sighting.signal}
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </div>
    </details>
  );
}
