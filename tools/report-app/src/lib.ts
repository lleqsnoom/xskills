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

/** A rate's colour, for a bar the API did not band: the same two thresholds the axes are banded by. */
export function bandKey(value: number): "good" | "fair" | "weak" {
  if (value >= 0.85) return "good";
  if (value >= 0.7) return "fair";
  return "weak";
}
