export function severityClass(severity: string): string {
  if (severity === "high") return "weak";
  if (severity === "medium") return "fair";
  return "dim";
}

/** A score or a rate, printed the same way everywhere. */
export function num(value: number | null | undefined, places = 1): string {
  return value === null || value === undefined ? "—" : value.toFixed(places);
}

/** A rate as a whole percentage. */
export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

/** Markdown for one to-do item, so the list can be pasted anywhere. */
export function todoLine(item: {
  skill: string | null;
  change: string | null;
  expected: string | null;
  target: string | null;
  route: string | null;
}): string {
  const route = item.route ? ` (${item.route})` : "";
  return `- [ ] ${item.skill ?? "?"}: ${item.change ?? "?"}${route} — expected: ${item.expected ?? "not stated"} — target: ${item.target ?? "?"}`;
}
