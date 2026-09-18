#!/usr/bin/env node
import { DIMENSIONS, HISTORY_FILE, readHistory } from "./metrics.mjs";

/**
 * Everything the report UI needs, derived from the JSON on disk and nothing else.
 *
 * This is the data half of what used to be `render-report.mjs`: the arithmetic, the movement, the calendar
 * and the proposals, with no markup in sight. The app draws; this decides what is true, so the numbers the
 * app shows and the numbers a test asserts come from one place.
 */

/** The band a score falls in. The label travels with the colour, so a UI never relies on hue alone. */
export function band(score) {
  if (score === null || score === undefined) return { key: "unknown", label: "not scored" };
  if (score >= 85) return { key: "good", label: "healthy" };
  if (score >= 70) return { key: "fair", label: "fair" };
  return { key: "weak", label: "needs work" };
}

/** The axes a skill has a denominator for. An axis with no reading is left out of every drawing. */
export function measuredOf(dimensions) {
  return DIMENSIONS.filter((name) => dimensions?.[name] !== null && dimensions?.[name] !== undefined);
}

/** The axes a set of rows can be compared on: an axis nobody measured is not a column. */
export function measuredAxes(rows) {
  return DIMENSIONS.filter((name) => rows.some((row) => row.dimensions?.[name] !== null && row.dimensions?.[name] !== undefined));
}

/** `conformance` → `conf`, for a column header that still reads. */
export function shortAxis(name) {
  if (name === "conformance") return "conf";
  if (name === "adherence") return "adher";
  return name.slice(0, 4);
}

/** A cell's shade on the heat ramp: a value in [0,1] mapped to one of eight steps. */
export function heatStep(value) {
  if (value === null || value === undefined) return 0;
  return Math.min(7, Math.max(0, Math.round(value * 7)));
}

/** Which axes moved between two days, biggest first — the part of "improved" that is actionable. */
export function movedAxes(before = {}, after = {}) {
  const parts = DIMENSIONS.map((name) => {
    const from = before?.[name];
    const to = after?.[name];
    if (from === null || from === undefined || to === null || to === undefined) return null;
    const delta = to - from;
    if (Math.abs(delta) < 0.02) return null;
    return { name, delta, points: Math.round(delta * 100) };
  })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return parts.slice(0, 3);
}

/** The raw numerator and denominator behind one axis, so a rate is never shown alone. */
export function axisMath(row, dimension) {
  const counters = row.counters ?? {};
  const checks = counters.checks ?? {};
  const graphs = counters.graphs ?? {};
  const toolCalls = counters.toolCalls ?? 0;
  const repeats = counters.repeats ?? 0;
  if (dimension === "conformance") {
    const passes = checks.passes ?? 0;
    return `${passes}/${passes + (checks.fails ?? 0)}${checks.refusals ? ` +${checks.refusals} refused` : ""}`;
  }
  if (dimension === "adherence") return `${graphs.calls ?? 0} graph calls`;
  if (dimension === "trigger") return `${row.n} of ${row.named}`;
  if (dimension === "rework") return `${toolCalls - repeats}/${toolCalls}`;
  return `${counters.panels ?? 0} panels + ${counters.proseQuestions ?? 0} prose`;
}

/** Every day the record holds, oldest first, as the app's index. */
export function days(history) {
  return [...history.keys()].sort();
}

/**
 * One row per skill in use: its daily series, how far it moved, and which axes did it.
 *
 * "In use" means loaded at least once across the record. A skill that only appeared in a transcript has no
 * movement worth following, and listing it would bury the ones that do.
 */
export function movement(history, { maxDays = 14 } = {}) {
  const dates = days(history).slice(-maxDays);
  const inUse = new Set();
  for (const date of history.keys()) {
    for (const skill of history.get(date).skills ?? []) {
      if ((skill.n ?? 0) > 0) inUse.add(skill.name);
    }
  }
  return [...inUse]
    .map((name) => {
      const series = dates.map((date) => {
        const skill = (history.get(date).skills ?? []).find((entry) => entry.name === name);
        return {
          date,
          score: skill?.score ?? null,
          raw: skill?.raw ?? null,
          n: skill?.n ?? null,
          dimensions: skill?.dimensions ?? null,
        };
      });
      const measured = series.filter((point) => (point.raw ?? point.score) !== null);
      const first = measured[0] ?? null;
      const latest = measured[measured.length - 1] ?? null;
      const change = measured.length >= 2 ? (latest.raw ?? latest.score) - (first.raw ?? first.score) : null;
      const latestScore = latest ? (latest.score ?? latest.raw) : null;
      return {
        name,
        series,
        measured: measured.length,
        first: first?.date ?? null,
        latest: latest?.date ?? null,
        latestScore,
        change,
        band: band(latestScore),
        moved: first && latest ? movedAxes(first.dimensions, latest.dimensions) : [],
        direction: change === null ? "flat" : change < -0.5 ? "down" : change > 0.5 ? "up" : "flat",
      };
    })
    .filter((row) => row.series.length)
    .sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity) || (b.latestScore ?? 0) - (a.latestScore ?? 0));
}

/** The days a reader can click: the newest few, then the calendar fills in the rest. */
export function recentDays(history, { count = 5 } = {}) {
  return days(history)
    .slice(-count)
    .reverse()
    .map((date) => {
      const line = history.get(date);
      const skills = line.skills ?? [];
      const measured = skills.filter((skill) => (skill.raw ?? skill.score) !== null);
      const scored = skills.filter((skill) => skill.status === "scored" && skill.score !== null);
      const mean = measured.length ? measured.reduce((sum, skill) => sum + (skill.raw ?? skill.score), 0) / measured.length : null;
      return {
        date,
        mean: mean === null ? null : Math.round(mean * 10) / 10,
        band: band(scored.length ? mean : null),
        sessions: line.sessions ?? null,
        measured: measured.length,
        scored: scored.length,
        skills: skills.length,
      };
    });
}

/** A month grid per recorded month, newest first: every day is a cell, the recorded ones link. */
export function calendar(history) {
  const recorded = new Set(history.keys());
  const months = [...new Set([...recorded].map((date) => date.slice(0, 7)))].sort().reverse();
  return months.map((month) => {
    const [year, number] = month.split("-").map(Number);
    const total = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const leading = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7; // Monday first
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push({ day: null, date: null, recorded: false });
    for (let day = 1; day <= total; day++) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      cells.push({ day, date, recorded: recorded.has(date) });
    }
    return { month, cells };
  });
}

/** The default screen in one payload, so the app makes one request to open. */
export function movementPage(history, options = {}) {
  return {
    days: days(history).length,
    movement: movement(history, options),
    recent: recentDays(history, options),
    calendar: calendar(history),
  };
}

/** Load the record once, or an empty one when nothing has been collected yet. */
export function loadHistory(file = HISTORY_FILE) {
  return readHistory(file);
}
