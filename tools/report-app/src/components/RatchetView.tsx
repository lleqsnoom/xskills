import { For, Show, createResource, createSignal } from "solid-js";
import { api, isSnapshot, type RatchetPage, type RatchetSkill } from "../api";
import { linkProps } from "../router";
import { num } from "../lib";
import { Loader } from "./Loader";

/**
 * The ratchet: one floor per skill, and the only loud row is one that slipped below it.
 *
 * A floor is the best *sustained* value a skill has held — a run of measured days, or the whole window's score
 * when the record is too short for a run. Never the best single day, because one lucky day is not something a
 * skill has held. A floor the reader committed to beats an automatic one, and lowering one takes a reason:
 * that is the rule RuboCop's todo list needs, where re-baselining silently absorbs whatever went wrong.
 *
 * Nothing above its floor gets pixels. Twenty-six sparklines is a dashboard; one row that dropped is a
 * decision.
 */
export function RatchetView() {
  const [page, { refetch }] = createResource<RatchetPage>(() => api.ratchet());
  const [status, setStatus] = createSignal("");
  const [lowering, setLowering] = createSignal<string | null>(null);
  const [reason, setReason] = createSignal("");

  const move = async (skill: string, action: "hold" | "lower") => {
    setStatus(`${action === "hold" ? "holding" : "lowering"} ${skill}…`);
    try {
      await api.saveFloor({ skill, action, reason: reason() || undefined });
      setStatus(action === "hold" ? `held ${skill} in` : `lowered ${skill}`);
      setLowering(null);
      setReason("");
      void Promise.resolve(refetch()).catch(() => {});
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  return (
    <Loader resource={page} loading="Loading the ratchet…" empty="No skill has been measured yet, so no floor can be held.">
      {(loaded) => (
        <>
          <header>
            <h1>The ratchet</h1>
            <p class="facts">
              {loaded().skills.length} skills measured ·{" "}
              <span class={loaded().state.key === "under" ? "dim" : "weak"}>{loaded().state.label}</span>
              <Show when={loaded().updatedAt}> · floors saved {loaded().updatedAt}</Show>
            </p>
            <p class="dim prose">
              A filled bar is the latest score on a 0–100 scale and the notch is the floor it has to stay at or above.
              Everything at or above its floor is one muted line; a skill below is the only row asking for anything.
              A day below the sample floor can neither hold nor break a floor, so a thin day never reads as a
              regression.
            </p>
            <div class="toolbar">
              <a class="dim" {...linkProps({ name: "movement" })}>
                the line for every skill is on movement
              </a>
              <Show when={status()}>
                <span class="dim">{status()}</span>
              </Show>
            </div>
          </header>

          <div class="ratchet">
            <div class="rat-row head">
              <span>skill</span>
              <span>score against the floor</span>
              <span class="num">latest</span>
              <span>floor</span>
              <span class="rat-act">decision</span>
            </div>
            <For each={loaded().skills}>
              {(skill) => (
                <RatchetRow
                  skill={skill}
                  lowering={lowering() === skill.name}
                  reason={reason()}
                  onReason={setReason}
                  onLower={(open) => {
                    setLowering(open ? skill.name : null);
                    setReason("");
                  }}
                  onMove={(action) => void move(skill.name, action)}
                />
              )}
            </For>
          </div>
        </>
      )}
    </Loader>
  );
}

function RatchetRow(props: {
  skill: RatchetSkill;
  lowering: boolean;
  reason: string;
  onReason: (value: string) => void;
  onLower: (open: boolean) => void;
  onMove: (action: "hold" | "lower") => void;
}) {
  const value = () => props.skill.latestScore;
  const width = () => {
    const score = value();
    return score === null ? 0 : Math.max(0, Math.min(100, score));
  };
  const floor = () => props.skill.floor;
  const source = () => {
    const found = floor();
    if (!found) return "";
    if (found.source === "reader") return "you committed to it";
    if (found.source === "run") return `held over ${found.basis} day${found.basis === 1 ? "" : "s"}`;
    return `the ${found.basis}-day window`;
  };
  return (
    <div class={`rat-row ${props.skill.status}`}>
      <a class="mono" {...linkProps({ name: "skill", skill: props.skill.name })}>
        {props.skill.name}
      </a>
      <span class="rat-track" title={floor() ? `floor ${num(floor()!.value)}` : "no floor yet"}>
        <span class={`rat-fill ${props.skill.band.key}`} style={{ width: `${width()}%` }} />
        <Show when={floor()}>
          <span class="rat-notch" style={{ left: `${Math.max(0, Math.min(100, floor()!.value))}%` }} />
        </Show>
      </span>
      <span class={`num ${props.skill.band.key}`} title={props.skill.latestSolid ? "" : "below the sample floor: read the direction, not the size"}>
        {value() === null ? "—" : `${num(value())}${props.skill.latestSolid ? "" : "*"}`}
      </span>
      <span class="dim rat-floor">
        <Show when={floor()} fallback={<span>no floor yet — no run of measured days to hold</span>}>
          {num(floor()!.value)} · {source()}
          <Show when={floor()!.reason}> · “{floor()!.reason}”</Show>
        </Show>
        <Show when={props.skill.belowBy !== null}>
          <span class="weak"> · below by {num(props.skill.belowBy)}</span>
        </Show>
      </span>
      <span class="rat-act">
        <Show when={!isSnapshot()} fallback={<span class="dim">a snapshot cannot write</span>}>
          <Show when={floor()}>
            <Show when={floor()!.source !== "reader"}>
              <button onClick={() => props.onMove("hold")} title="hold this skill to the value it already reached">
                hold this in
              </button>
            </Show>
            <Show when={props.lowering} fallback={
              <button onClick={() => props.onLower(true)} title="lower the floor, with a reason on the record">
                lower
              </button>
            }>
              <input
                type="text"
                value={props.reason}
                placeholder="why lower it?"
                onInput={(event) => props.onReason(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.onMove("lower");
                  if (event.key === "Escape") props.onLower(false);
                }}
              />
              <button onClick={() => props.onMove("lower")} disabled={!props.reason.trim()}>
                confirm
              </button>
              <button onClick={() => props.onLower(false)}>cancel</button>
            </Show>
          </Show>
        </Show>
      </span>
    </div>
  );
}
