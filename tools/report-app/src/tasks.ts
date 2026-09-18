import type { Proposal, TodoItem } from "./api";

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
