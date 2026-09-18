import { createSignal } from "solid-js";

/**
 * The five ways of looking at the same record.
 *
 * The panel has one goal — make the skills better over time — and one screen cannot serve it from one angle.
 * So all five ship and the picker sits on the main screen: the movement table says whether anything moved, the
 * bench says what to do about it, the ledger says whether the last fixes worked, the ratchet says whether a
 * regression has slipped past the floor, and the recurrence board says whether a finding keeps coming back.
 *
 * The choice lives in the URL like the task shape (`?view=`), so a reload keeps it and a link can point at the
 * view it argues for.
 */
export type ViewId = "movement" | "bench" | "ledger" | "ratchet" | "recurrence" | "control" | "interval" | "factors" | "flow" | "schedule";

export const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: "movement", label: "movement", hint: "one row per skill: did it go up or down, and by which axis" },
  { id: "bench", label: "bench", hint: "one fix to do now, what is in flight, and what is waiting on the scan" },
  { id: "ledger", label: "ledger", hint: "the fixes you kept, and what the score did around each one" },
  { id: "ratchet", label: "ratchet", hint: "one floor per skill; only a regression below it is loud" },
  { id: "recurrence", label: "recurrence", hint: "findings that keep coming back after a fix" },
  { id: "control", label: "control", hint: "limits from the record's own noise, and the rule that fired" },
  { id: "interval", label: "interval", hint: "each score with the interval its evidence earns, and where the next session pays" },
  { id: "factors", label: "factors", hint: "why a score is what it is, in points, and what a target on one axis would buy" },
  { id: "flow", label: "flow", hint: "the fixing process: what arrives, what closes, and how long the queue implies" },
  { id: "schedule", label: "schedule", hint: "which believed-fixed findings are due for a re-check" },
];

function fromUrl(): ViewId {
  const found = new URLSearchParams(window.location.search).get("view");
  return VIEWS.some((view) => view.id === found) ? (found as ViewId) : "movement";
}

const [view, setView] = createSignal<ViewId>(fromUrl());

export function currentView(): ViewId {
  return view();
}

export function currentHint(): string {
  return VIEWS.find((entry) => entry.id === view())?.hint ?? "";
}

export function setCurrentView(next: ViewId) {
  setView(next);
  const url = new URL(window.location.href);
  // The default view is the absence of the parameter, so the plain URL stays the plain URL.
  if (next === "movement") url.searchParams.delete("view");
  else url.searchParams.set("view", next);
  window.history.replaceState(null, "", url);
}
