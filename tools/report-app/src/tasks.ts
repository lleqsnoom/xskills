import { createSignal } from "solid-js";
import type { BenchTask, Proposal, TodoItem } from "./api";

/**
 * A proposal and a to-do entry are one thing at two moments in its life: the digest proposes it, the reader
 * keeps it. They carry the same fields, so they render through the same component and differ only in the
 * action attached to the row.
 */
export type Task = {
  id: string;
  skill: string | null;
  title: string | null;
  signal: string | null;
  target: string | null;
  change: string | null;
  reason: string | null;
  expected: string | null;
  route: string | null;
  note: string | null;
  /** The day it came from, when the list is not already scoped to one (a skill's proposals). */
  from: string | null;
  /** Whether the reader has already kept it — a to-do row is kept by definition. */
  inTodo: boolean;
};

export function taskFromProposal(proposal: Proposal, from: string | null = null): Task {
  return {
    id: proposal.id,
    skill: proposal.skill,
    title: proposal.title,
    signal: proposal.signal,
    target: proposal.target,
    change: proposal.change,
    reason: proposal.reason,
    expected: proposal.expected,
    route: proposal.route,
    note: null,
    from: from ?? proposal.day ?? null,
    inTodo: proposal.inTodo === true,
  };
}

export function taskFromTodo(item: TodoItem): Task {
  return {
    id: item.id,
    skill: item.skill,
    title: null,
    signal: item.signal,
    target: item.target,
    change: item.change,
    reason: item.reason,
    expected: item.expected,
    route: item.route,
    note: item.note,
    from: item.day ?? null,
    inTodo: true,
  };
}

/** A proposal the bench picked. It is a proposal, so the same `+ to-do` action applies to it. */
export function taskFromBench(candidate: BenchTask): Task {
  return {
    id: candidate.id,
    skill: candidate.skill,
    title: candidate.title,
    signal: candidate.signal,
    target: candidate.target,
    change: candidate.change,
    reason: candidate.reason ?? null,
    expected: candidate.expected,
    route: candidate.route,
    note: null,
    from: candidate.day ?? candidate.from ?? null,
    inTodo: false,
  };
}

/**
 * How much a task matters: the worst severity among the signals it cites, and how many signals back it.
 *
 * The digest's own words are the source — `S21 (high, kept)`, `S2 and S24 (both high, kept)`,
 * `manual (medium, kept)` — because a signal id is scoped to the session that produced it: the same `S21`
 * in two sessions is two different findings, so an id cannot be looked up in the day's pack without also
 * knowing the session, and the digest's verdict is the thing a reader is deciding on anyway.
 */
export type Importance = {
  key: "high" | "medium" | "low" | "unknown";
  label: string;
  detail: string;
};

const SEVERITIES = ["high", "medium", "low"] as const;

export function importanceOf(task: Task): Importance {
  const text = task.signal ?? "";
  const ids: string[] = text.match(/\bS\d+\b/g) ?? [];
  const words = SEVERITIES.filter((word) => new RegExp(`\\b${word}\\b`).test(text));
  const severity = words[0];
  if (!severity) {
    return { key: "unknown", label: "unrated", detail: text || "the digest recorded no signal" };
  }

  const backing = Math.max(ids.length, words.length);
  return {
    key: severity,
    label: backing > 1 ? `${severity} ×${backing}` : severity,
    detail: text,
  };
}

/** The shape a list of tasks is drawn in. Three ship because which one reads best is a taste call. */
export type Shape = "a" | "b" | "c";

export const SHAPES: { id: Shape; label: string; hint: string }[] = [
  { id: "a", label: "rows", hint: "one row a task, open a row for the whole text" },
  { id: "b", label: "cards", hint: "the change first, the file and the check muted beside it" },
  { id: "c", label: "lines", hint: "one line a task, expand for the detail" },
];

function fromUrl(): Shape {
  const found = new URLSearchParams(window.location.search).get("shape");
  return found === "b" || found === "c" ? found : "a";
}

const [shape, setShape] = createSignal<Shape>(fromUrl());

export function taskShape(): Shape {
  return shape();
}

/** The choice lives in the URL, so a reload keeps it and a link can point at the shape it argues for. */
export function setTaskShape(next: Shape) {
  setShape(next);
  const url = new URL(window.location.href);
  url.searchParams.set("shape", next);
  window.history.replaceState(null, "", url);
}
