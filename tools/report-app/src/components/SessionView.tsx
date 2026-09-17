import { For, Show, createResource } from "solid-js";
import { api, type SessionDetail } from "../api";
import { linkProps } from "../router";
import { SignalList } from "./DayView";

/** One session: what the scanner counted, and every signal it blamed on a skill. */
export function SessionView(props: { date: string; id: string }) {
  const [detail] = createResource(() => api.session(props.date, props.id));
  return (
    <Show when={detail()} fallback={<p class="loading">Loading the session…</p>}>
      {(found) => (
        <>
          <header>
            <h1>{found().session.title ?? "(untitled)"}</h1>
            <p class="facts">
              <a {...linkProps({ name: "day", date: props.date })}>{props.date}</a> · {found().session.host} ·{" "}
              <span class="mono">{found().session.id}</span>
              <Show when={found().session.modified}> · {found().session.modified}</Show>
            </p>
            <Show when={found().session.project}>
              <p class="dim mono">{found().session.project}</p>
            </Show>
          </header>

          <h2>What the scanner counted</h2>
          <div class="grid">
            <Stat
              label="Messages"
              value={found().session.stats.messages}
              sub={`${found().session.stats.userMessages} user · ${found().session.stats.assistantMessages} assistant`}
            />
            <Stat label="Tool calls" value={found().session.stats.toolCalls} sub={`${found().session.stats.toolResults} results`} />
            <Stat
              label="Failures"
              value={found().session.stats.toolFailures}
              sub={`${found().session.stats.expectedExits} expected exits`}
            />
            <Stat label="Repeated calls" value={found().session.stats.repeats} />
            <Stat
              label="Corrections"
              value={found().session.stats.corrections}
              sub={`${found().session.stats.reprompts} nudges`}
            />
            <Stat
              label="Panels"
              value={found().session.stats.panels}
              sub={`${found().session.stats.proseQuestions} questions in prose`}
            />
          </div>

          <Show when={found().session.skills.loaded.length}>
            <h2>Skills loaded</h2>
            <p>
              <For each={found().session.skills.loaded}>
                {(skill, index) => (
                  <>
                    {index() > 0 ? ", " : ""}
                    <a class="mono" {...linkProps({ name: "skill", skill })}>
                      {skill}
                    </a>
                  </>
                )}
              </For>
            </p>
          </Show>

          <Show when={found().session.checks.length}>
            <h2>The skills' own checks in this session</h2>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Script</th>
                    <th class="num">Calls</th>
                    <th class="num">Pass</th>
                    <th class="num">Refused</th>
                    <th class="num">Fail</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={found().session.checks}>
                    {(check) => (
                      <tr>
                        <td class="mono">{check.skill}</td>
                        <td class="mono dim">{check.script}</td>
                        <td class="num">{check.calls}</td>
                        <td class="num good">{check.passes}</td>
                        <td class="num fair">{check.refusals}</td>
                        <td class="num weak">{check.fails}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>

          <Show when={found().session.artifacts.length || found().session.runFolders.length}>
            <h2>Run folders and artifacts</h2>
            <p class="mono dim" style={{ "overflow-wrap": "anywhere" }}>
              <For each={found().session.runFolders}>{(folder) => <div>{folder}</div>}</For>
              <For each={found().session.artifacts}>{(artifact) => <div>{artifact}</div>}</For>
            </p>
          </Show>

          <h2>Signals — {found().signals.length}</h2>
          <SignalList signals={found().signals} date={props.date} limit={12} />
        </>
      )}
    </Show>
  );
}

function Stat(props: { label: string; value: number; sub?: string }) {
  return (
    <div class="panel">
      <h3 class="dim">{props.label}</h3>
      <p class="stat-value">{props.value}</p>
      <Show when={props.sub}>
        <p class="dim" style={{ margin: 0 }}>
          {props.sub}
        </p>
      </Show>
    </div>
  );
}
