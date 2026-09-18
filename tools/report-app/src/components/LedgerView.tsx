import { For, Show, createResource, createSignal } from "solid-js";
import { api, type LedgerItem, type LedgerPage, type Verdict } from "../api";
import { linkProps } from "../router";
import { num } from "../lib";
import { Loader } from "./Loader";

/**
 * The ledger: the fixes the reader kept, and what the score did around each one.
 *
 * This is the question nothing in the panel could answer before it. A fix landed, and no screen ever asked
 * whether it worked — `todos.json` recorded the intent and `history.jsonl` recorded the scores, and the two
 * were never joined. The window sits either side of the day a commit touched the file the fix names, and the
 * verdict waits for the whole window, because one measured day after a fix is a coin toss.
 */
export function LedgerView() {
  const [page] = createResource<LedgerPage>(() => api.ledger());
  return (
    <Loader
      resource={page}
      loading="Loading the ledger…"
      empty="No fix has been kept yet, so there is nothing to check — keep one from a day's proposals."
    >
      {(loaded) => (
        <>
          <header>
            <h1>The ledger</h1>
            <p class="facts">
              {loaded().summary.shipped} fix{loaded().summary.shipped === 1 ? "" : "es"} kept ·{" "}
              <span class="good">{loaded().summary.held} held</span>,{" "}
              <span class="weak">{loaded().summary.regressed} regressed</span>, {loaded().summary.flat} flat
              <Show when={loaded().summary.measuring}> · {loaded().summary.measuring} still measuring</Show>
              <Show when={loaded().summary.notLanded}> · {loaded().summary.notLanded} with no commit yet</Show>
              <Show when={loaded().summary.cameBack}> · {loaded().summary.cameBack} came back</Show>
            </p>
            <p class="dim prose">
              A fix is measured either side of the day a commit touched the file it names: {loaded().windowDays} measured
              days before and {loaded().windowDays} after. A move under two points is flat, because that is the noise the
              movement table already treats as flat, and a window the record did not measure is a dash rather than a
              guess.
            </p>
          </header>

          <Show
            when={loaded().items.length}
            fallback={<p class="empty">Nothing has been kept yet. A fix starts on a day, in its proposals.</p>}
          >
            <div class="table-wrap">
              <table class="ledger">
                <thead>
                  <tr>
                    <th class="l-when">kept</th>
                    <th class="l-skill">skill</th>
                    <th>what was wrong</th>
                    <th class="l-land">landed</th>
                    <th class="num l-move">score either side</th>
                    <th class="l-verdict">verdict</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={loaded().items}>{(item) => <LedgerRow item={item} />}</For>
                </tbody>
              </table>
            </div>
            <p class="dim">
              “Landed” is the first commit to the file the fix names, on or after the day it was kept. A fix that was
              written but never committed has no landed date, and takes no credit for an earlier commit.
            </p>
          </Show>
        </>
      )}
    </Loader>
  );
}

const VERDICTS: Record<Verdict, { label: string; tone: string }> = {
  held: { label: "held", tone: "good" },
  flat: { label: "flat", tone: "fair" },
  regressed: { label: "regressed", tone: "weak" },
  measuring: { label: "measuring", tone: "unknown" },
  unmeasured: { label: "not measured", tone: "unknown" },
  "no-commit": { label: "no commit yet", tone: "unknown" },
};

function LedgerRow(props: { item: LedgerItem }) {
  const [open, setOpen] = createSignal(false);
  const verdict = () => VERDICTS[props.item.verdict];
  const moved = () => {
    const { before, after, landed } = props.item;
    if (!landed || !after || after.days === 0) return "—";
    if (!before || before.days === 0) return `${num(after.mean)} after`;
    return `${num(before.mean)} → ${num(after.mean)}`;
  };
  const window = (side: "before" | "after") => {
    const found = props.item[side];
    if (!found || found.days === 0) return "nothing measured";
    return `${found.days} day${found.days === 1 ? "" : "s"} · ${found.calls} calls${found.thin ? ` · ${found.thin} below the floor` : ""}`;
  };
  return (
    <>
      <tr classList={{ open: open() }}>
        <td class="l-when">
          <button
            class="twisty"
            aria-expanded={open()}
            onClick={() => setOpen(!open())}
            title={open() ? "close the fix" : "open the fix"}
          >
            <span class="mark">{open() ? "▾" : "▸"}</span> <span class="mono">{props.item.day ?? "—"}</span>
          </button>
        </td>
        <td>
          <Show when={props.item.skill} fallback={<span class="dim">—</span>}>
            <a class="mono" {...linkProps({ name: "skill", skill: props.item.skill! })}>
              {props.item.skill}
            </a>
          </Show>
        </td>
        <td>
          <span class="mono dim">{props.item.klass}</span>{" "}
          <span class="clamp-1" title={props.item.change ?? ""}>
            {props.item.change ?? "—"}
          </span>
        </td>
        <td class="mono dim">
          <Show
            when={props.item.landed}
            fallback={
              <Show when={props.item.lastCommit} fallback={<>—</>}>
                <span title="the file has been committed, but not since you kept this: nothing here measures your decision">
                  {props.item.lastCommit} (before)
                </span>
              </Show>
            }
          >
            {props.item.landed}
          </Show>
        </td>
        <td class="num">{moved()}</td>
        <td class="l-verdict">
          <span class={`pill ${verdict().tone}`}>
            {verdict().label}
            {props.item.verdict === "measuring" ? ` ${props.item.after?.days ?? 0}/${props.item.needDays}` : ""}
          </span>
          <Show when={props.item.cameBack}>
            <span class="pill weak" title="the same file was proposed again after this fix landed">
              came back
            </span>
          </Show>
        </td>
      </tr>
      <Show when={open()}>
        <tr class="task-detail">
          <td colSpan={6}>
            <div class="task-detail-body">
              <dl class="fields">
                <div>
                  <dt>Change</dt>
                  <dd>{props.item.change ?? <span class="dim">not stated</span>}</dd>
                </div>
                <div>
                  <dt>Where</dt>
                  <dd class="mono">{props.item.target ?? "—"}</dd>
                </div>
                <div>
                  <dt>Check</dt>
                  <dd>{props.item.check ?? <span class="dim">no check stated</span>}</dd>
                </div>
                <div>
                  <dt>Signal</dt>
                  <dd>{props.item.signal ?? <span class="dim">—</span>}</dd>
                </div>
                <div>
                  <dt>Before it landed</dt>
                  <dd>{window("before")}</dd>
                </div>
                <div>
                  <dt>After it landed</dt>
                  <dd>{window("after")}</dd>
                </div>
              </dl>
            </div>
          </td>
        </tr>
      </Show>
    </>
  );
}
