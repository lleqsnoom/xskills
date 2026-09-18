/**
 * The arithmetic behind the four views that answer "is this getting better?".
 *
 * `derive.mjs` decides what a score is; this decides what a *change to a skill* did, which is the question the
 * improvement loop turns on. Everything here is a function of what the packs already hold — a day's line, its
 * digest's proposals, the kept selection — plus one fact from outside the record, the date a fix landed. That
 * fact arrives through the `applied` and `commits` seams below, so every rule in this file is testable without
 * a git repository, and the server is the only place that shells out.
 *
 * The rules are deliberately conservative: a score below the sample floor can never hold or break a floor, a
 * window that has not been measured yet is "measuring" rather than a verdict, and every number a view prints
 * travels with the count of days it was computed from.
 */

/** The improvement classes the reflection writes at the front of a proposal's title. */
export const CLASSES = [
  "doc-command-drift",
  "script-hardening",
  "missing-gate",
  "panel-rule",
  "missing-check",
  "stopping-point",
  "contract-drift",
  "manual",
];

/** A move smaller than this is noise, so a fix with one is flat rather than held or regressed. */
export const FLAT = 2;

/** `script-hardening: resolve the report path` → `script-hardening`; anything else is `manual`. */
export function classOf(title) {
  const match = String(title ?? "").match(/^\s*([a-z]+(?:-[a-z]+)+)\s*:/);
  return match && CLASSES.includes(match[1]) ? match[1] : "manual";
}

/**
 * The file a proposal names, without its line numbers: ``skills/x/SKILL.md:12-14`` → `skills/x/SKILL.md`.
 *
 * A target can name two files (`...:154-155` and `skills/x-plan/scripts/scenario.mjs:67-68`), so the first
 * path-shaped token wins: the identity of a finding has to be one string, and the first file named is the one
 * the title leads with.
 */
export function pathOf(target) {
  if (!target) return null;
  const first = String(target)
    .split(/[\s,]+/)
    .map((part) => part.replace(/^`+|`+$/g, ""))
    .find((part) => part.includes("/"));
  if (!first) return null;
  return first.replace(/:\d+(?:-\d+)?$/, "").replace(/[).,;]+$/, "");
}

/** A date, moved. Pure on `YYYY-MM-DD`, so a window is arithmetic rather than a calendar. */
export function shiftDays(date, delta) {
  const [year, month, day] = String(date).split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + delta));
  return moved.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from, to) {
  const [y1, m1, d1] = String(from).split("-").map(Number);
  const [y2, m2, d2] = String(to).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** The session ids a signal line cites, kept only when the day's own pack knows them. */
export function sessionsIn(signal, known = null) {
  const quoted = [...String(signal ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const ids = quoted.filter((id) => /^[0-9a-f][0-9a-f-]{5,}$/i.test(id));
  return known ? [...new Set(ids.filter((id) => known.has(id)))] : [...new Set(ids)];
}

/**
 * The mean of a skill's measured days inside a window, with the count of days it came from.
 *
 * A day below the sample floor still contributes its raw mean — it was measured — but `thin` counts how many
 * of the days were, so a view can say "2 days, both below the floor" instead of printing a number as if it
 * were a score.
 */
export function windowMean(series, from, to) {
  const points = (series ?? []).filter(
    (point) => point.date >= from && point.date <= to && (point.raw ?? point.score) !== null && (point.raw ?? point.score) !== undefined
  );
  if (!points.length) return { mean: null, days: 0, calls: 0, thin: 0, dates: [] };
  const values = points.map((point) => point.raw ?? point.score);
  return {
    mean: round1(values.reduce((sum, value) => sum + value, 0) / values.length),
    days: points.length,
    calls: points.reduce((sum, point) => sum + (point.n ?? 0), 0),
    thin: points.filter((point) => point.score === null).length,
    dates: points.map((point) => point.date),
  };
}

/**
 * Did the fix work?
 *
 * `measuring` until the whole window is there, because a verdict from one day after a fix is a coin toss; then
 * a before/after comparison, where a move under two points is flat — the same noise threshold the movement
 * table treats as flat.
 */
export function verdictFor({ before, after, needDays, landed = null, sampleFloor = 5 }) {
  if (!landed) return "no-commit";
  if (!after || after.days < needDays) return "measuring";
  if (!before || before.days === 0) return "unmeasured";
  const delta = after.mean - before.mean;
  if (delta >= FLAT) return "held";
  if (delta <= -FLAT) return "regressed";
  return "flat";
}

/**
 * One row per kept fix: what was wrong, where, whether it landed, and what the score did around it.
 *
 * `items` carry the proposal they came from, so a row can name its class and its file; `applied(path, since)`
 * answers with the date a commit touched that file on or after the day the reader kept it, which is the only
 * outside fact in the file. A fix whose file was last touched *before* it was kept has not landed, and says so
 * rather than taking credit for an earlier commit.
 */
export function ledgerRows({
  items = [],
  seriesBySkill = new Map(),
  applied = () => null,
  lastCommit = () => null,
  today,
  windowDays = 2,
  sampleFloor = 5,
  cameBack = () => false,
} = {}) {
  const rows = items.map((item) => {
    const path = item.path ?? pathOf(item.target);
    const landed = path ? applied(path, item.day ?? null) : null;
    const before = landed && item.day ? windowMean(seriesBySkill.get(item.skill), shiftDays(landed, -windowDays), shiftDays(landed, -1)) : null;
    const after = landed ? windowMean(seriesBySkill.get(item.skill), shiftDays(landed, 1), shiftDays(landed, windowDays)) : null;
    const verdict = verdictFor({ before, after, needDays: windowDays, landed, sampleFloor });
    return {
      id: item.id,
      day: item.day ?? null,
      skill: item.skill ?? null,
      klass: item.klass ?? "manual",
      title: item.title ?? null,
      change: item.change ?? null,
      target: item.target ?? null,
      path,
      check: item.check ?? null,
      signal: item.signal ?? null,
      route: item.route ?? null,
      landed,
      /**
       * The last commit before the decision. It is not a landing — the fix may predate the reader's choice to
       * keep it — but a row that said only "no commit yet" beside a file committed yesterday would send a
       * reader looking for a bug that is not there.
       */
      lastCommit: landed ? null : path ? lastCommit(path, item.day ?? null) : null,
      before,
      after,
      needDays: windowDays,
      verdict,
      cameBack: Boolean(landed) && cameBack(item.klass ?? "manual", path),
      windowDays,
    };
  });

  const counts = {};
  for (const row of rows) counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
  return {
    today,
    windowDays,
    summary: {
      shipped: rows.length,
      held: counts.held ?? 0,
      flat: counts.flat ?? 0,
      regressed: counts.regressed ?? 0,
      measuring: (counts.measuring ?? 0) + (counts.unmeasured ?? 0),
      notLanded: counts["no-commit"] ?? 0,
      cameBack: rows.filter((row) => row.cameBack).length,
    },
    counts,
    items: rows.sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "")),
  };
}

/** A point a floor may be built from: scored, and at or above the sample floor. */
function solid(point, sampleFloor) {
  return point && point.score !== null && point.score !== undefined && (point.n ?? 0) >= sampleFloor;
}

/**
 * The best *sustained* value in a series: the highest mean over a run of consecutive measured days.
 *
 * Never the best single day, because one lucky day is not a floor — a floor says "this skill has held this",
 * and one day cannot say that. The run shrinks from the configured window when the record is too short, but a
 * floor needs at least two days however short the record is.
 */
export function sustainedBest(series = [], { window = 3, sampleFloor = 5 } = {}) {
  for (let size = Math.min(window, series.length); size >= 2; size--) {
    let best = null;
    for (let start = 0; start + size <= series.length; start++) {
      const slice = series.slice(start, start + size);
      if (!slice.every((point) => solid(point, sampleFloor))) continue;
      const value = round1(slice.reduce((sum, point) => sum + point.score, 0) / size);
      if (!best || value > best.value) best = { value, from: slice[0].date, to: slice[size - 1].date, basis: size };
    }
    if (best) return best;
  }
  return null;
}

/**
 * A floor per skill, and how far each one has slipped below it.
 *
 * The floor is a commitment when the reader has made one (`floors`), the best sustained run of measured days
 * otherwise, and failing that the whole window's accumulated score — which is the stronger evidence when the
 * record is too short to hold a run: one day can be under the sample floor while fourteen days of calls are
 * not. `source` says which of the three it is, so a view never presents a number as a commitment it is not.
 *
 * `belowBy` only exists when the latest day is solid: a thin day cannot break a floor, and saying that it had
 * would be the panel inventing a regression.
 */
export function ratchetRows({ rows = [], floors = {}, window = 3, sampleFloor = 5, windowScores = new Map(), today = null } = {}) {
  const skills = rows.map((row) => {
    const series = row.series ?? [];
    const measured = series.filter((point) => (point.raw ?? point.score) !== null);
    const latest = measured[measured.length - 1] ?? null;
    const latestValue = latest ? (latest.score ?? latest.raw) : null;
    const isSolid = latest ? solid(latest, sampleFloor) : false;
    const stored = floors[row.name] ?? null;
    const sustained = sustainedBest(series, { window, sampleFloor });
    const aggregate = windowScores.get(row.name) ?? null;
    const floor = stored
      ? { value: round1(stored.floor), since: stored.since ?? null, basis: stored.basis ?? null, reason: stored.reason ?? null, held: true, source: "reader" }
      : sustained
        ? { value: sustained.value, since: sustained.from, basis: sustained.basis, reason: null, held: false, source: "run", n: null }
        : aggregate
          ? { value: round1(aggregate.score), since: row.latest ?? null, basis: aggregate.days ?? null, reason: null, held: false, source: "window", n: aggregate.n ?? null }
          : null;
    const belowBy = floor && isSolid && latestValue < floor.value ? round1(floor.value - latestValue) : null;
    const since = floor?.since ?? null;
    const later = since ? series.filter((point) => point.date > since) : [];
    const regressions = floor ? later.filter((point) => point.score !== null && point.score !== undefined && point.score < floor.value - FLAT).length : 0;
    const status = belowBy !== null ? "below" : !floor ? "thin" : "held";
    return {
      name: row.name,
      series,
      latest: latest?.date ?? null,
      latestScore: latestValue,
      latestSolid: isSolid,
      n: latest?.n ?? null,
      band: row.band,
      floor,
      belowBy,
      regressions,
      measuredDays: measured.length,
      status,
    };
  });

  const below = skills.filter((skill) => skill.status === "below");
  return {
    today,
    window,
    sampleFloor,
    skills: skills.sort((a, b) => {
      // Below the floor first, then the skills that can be judged at all, then the ones with too little evidence
      // to hold a floor: a row nobody can act on does not belong above the rows they can.
      const rank = { below: 0, held: 1, thin: 2 };
      return rank[a.status] - rank[b.status] || (b.belowBy ?? -1) - (a.belowBy ?? -1) || (b.latestScore ?? 0) - (a.latestScore ?? 0);
    }),
    below: below.length,
  };
}

/** The budget, and what it means for today: under it, at it, or over it. */
export function budgetState(below, budget) {
  if (below > budget) return { key: "over", label: `${below} below floor, over the budget of ${budget}` };
  if (below === budget) return { key: "at", label: `at the budget: ${below} of ${budget}` };
  return { key: "under", label: `${below} below floor, inside the budget of ${budget}` };
}

const SEVERITY_WEIGHT = { high: 3, medium: 1.4, low: 0.5 };

/**
 * What to fix first, and why.
 *
 * Severity, how often the same finding has been seen, and how cheap its check is — the last because a fix
 * whose proof is one command gets done and a fix with no proof does not. The `why` is part of the answer, not
 * a tooltip: a picker nobody can argue with is a picker nobody trusts.
 */
export function rankCandidates(candidates = []) {
  return candidates
    .map((candidate) => {
      const severity = String(candidate.severity ?? "unknown").toLowerCase();
      const weight = SEVERITY_WEIGHT[severity] ?? 1;
      const seen = Math.max(1, candidate.recurrence ?? 1);
      const hasCheck = Boolean(candidate.expected);
      const score = Math.round(((weight * (1 + 0.5 * (seen - 1))) / (hasCheck ? 1 : 3)) * 100) / 100;
      const parts = [
        SEVERITY_WEIGHT[severity] ? `it is ${severity}` : "its severity is unknown",
        seen > 1 ? `seen on ${seen} days` : "seen once",
        hasCheck ? "its check is one command" : "it states no check, which makes it expensive to prove",
      ];
      return { ...candidate, hasCheck, score, why: `picked because ${parts.join(", ")}.` };
    })
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
}

/**
 * Findings that keep coming back, which is the sharpest improvement metric the record holds.
 *
 * A finding is a *file* that keeps being the problem, and its sightings are the days a digest proposed
 * something about it. The identity is the path and not the improvement class, because the class is authored by
 * the reflection and its wording drifts between runs — one digest writes `doc-command-drift: …` and the next
 * writes `` `x-epic`: … `` for the same file. Grouping by class would orphan that history and read as progress;
 * the class travels beside the finding instead, and a file that has carried more than one says so.
 *
 * A commit to the file after a sighting is a fix attempt, and a sighting after the *last* attempt is the
 * finding coming back — the one thing the panel can say that means the fix did not work. A finding with a fix
 * and no sighting for `closedAfterDays` is closed by evidence, and says how long the quiet has lasted rather
 * than claiming certainty.
 */
export function recurrenceFindings({ sightings = [], commits = () => [], today, closedAfterDays = 7 } = {}) {
  const groups = new Map();
  for (const sighting of sightings) {
    const key = sighting.path ?? `${sighting.klass ?? "manual"}|${sighting.target ?? "?"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sighting);
  }

  const findings = [...groups.values()].map((list) => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    const dates = [...new Set(sorted.map((sighting) => sighting.date))];
    const first = dates[0];
    const last = dates[dates.length - 1];
    const path = sorted.find((sighting) => sighting.path)?.path ?? null;
    const klasses = [...new Set(sorted.map((sighting) => sighting.klass ?? "manual"))];
    const attempts = path
      ? [
          ...new Set(
            commits(path)
              .map((stamp) => String(stamp).slice(0, 10))
              .filter((date) => date >= first && date <= today)
          ),
        ].sort()
      : [];
    const lastFix = attempts[attempts.length - 1] ?? null;
    const afterFix = lastFix ? sorted.filter((sighting) => sighting.date > lastFix) : [];
    const quietDays = lastFix ? daysBetween(lastFix, today) : null;
    const status = afterFix.length
      ? "came-back"
      : lastFix && quietDays >= closedAfterDays
        ? "closed"
        : dates.length >= 2
          ? "chronic"
          : last === today
            ? "new"
            : "open";
    const rank = { high: 0, medium: 1, low: 2 };
    const severity = [...new Set(sorted.map((sighting) => sighting.severity).filter(Boolean))].sort(
      (a, b) => (rank[a] ?? 3) - (rank[b] ?? 3)
    )[0] ?? "unknown";
    const sessions = [...new Set(sorted.flatMap((sighting) => sighting.sessions ?? []))];
    return {
      klass: sorted[sorted.length - 1].klass ?? "manual",
      klasses,
      relabelled: klasses.length > 1,
      path,
      target: sorted[0].target ?? null,
      skill: sorted[0].skill ?? null,
      title: sorted[sorted.length - 1].title ?? null,
      severity,
      first,
      last,
      days: dates.length,
      sessions,
      sightings: sorted.map((sighting) => ({ ...sighting })),
      attempts,
      lastFix,
      quietDays,
      sinceFix: afterFix.length,
      status,
    };
  });

  const order = { "came-back": 0, chronic: 1, new: 2, open: 3, closed: 4 };
  return {
    today,
    summary: {
      open: findings.filter((finding) => finding.status !== "closed").length,
      cameBack: findings.filter((finding) => finding.status === "came-back").length,
      chronic: findings.filter((finding) => finding.status === "chronic").length,
      closed: findings.filter((finding) => finding.status === "closed").length,
    },
    findings: findings.sort(
      (a, b) =>
        order[a.status] - order[b.status] ||
        b.sessions.length - a.sessions.length ||
        b.days - a.days ||
        String(a.path).localeCompare(String(b.path))
    ),
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/* ---------------------------------------------------------------------------------------------------------
 * Part 2 — five more ways of asking "is this getting better?", each borrowed from a field that already
 * solved the same problem: clinical QC (is the move real?), competitive rating (how sure are we?),
 * consumer credit (why is the number what it is?), queueing (is the process keeping up?) and spaced
 * repetition (when must this be re-checked?).
 * ------------------------------------------------------------------------------------------------------ */

function mean(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * The values a statistic may use: days that were actually measured.
 *
 * A day with no loaded session still carries a `raw` number from the scanner's baseline, and treating that as
 * a measurement puts a jump of zero or two points into the record for a skill nobody used. Every statistical
 * view here reads this instead of the series directly; the movement table keeps the report's own convention,
 * because there the number is shown with its denominator beside it.
 */
function measuredValues(series = []) {
  return (series ?? [])
    .filter((point) => (point.n ?? 0) > 0 && (point.raw ?? point.score) !== null && (point.raw ?? point.score) !== undefined)
    .map((point) => point.raw ?? point.score);
}

/** The sample standard deviation. `null` for fewer than two values, because one value has no spread. */
function sd(values = []) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** The tails of a normal distribution, the only fixed numbers in the rule table below. */
const TAIL = { 1: 0.1587, 2: 0.0228, 3: 0.00135 };

/**
 * The rules a control chart is read by, each with the false alarm it costs.
 *
 * Westgard's multirule trick is that a *sensitive* rule warns and *specific* ones reject: `1_2s` says look
 * carefully, `1_3s` says stop, and the run rules catch a small shift that no single day proves. The numbers
 * are the tail probabilities, computed rather than quoted, so a test can check them.
 */
export const CONTROL_RULES = [
  { key: "1_3s", kind: "reject", what: "one day beyond the 3s limit", falseAlarm: 2 * TAIL[3], because: "2 × P(|Z| > 3)" },
  { key: "1_2s", kind: "warn", what: "one day beyond the 2s limit: look carefully", falseAlarm: 2 * TAIL[2], because: "2 × P(|Z| > 2)" },
  { key: "2_2s", kind: "reject", what: "two days running beyond the same 2s limit", falseAlarm: 2 * TAIL[2] ** 2, because: "2 × P(Z > 2)²" },
  { key: "4_1s", kind: "reject", what: "four days running beyond the same 1s limit", falseAlarm: 2 * TAIL[1] ** 4, because: "2 × P(Z > 1)⁴" },
  { key: "10x", kind: "reject", what: "ten days running on one side of the mean", falseAlarm: 2 * 0.5 ** 10, because: "2 × (1/2)¹⁰" },
  { key: "7T", kind: "reject", what: "seven days climbing or falling", falseAlarm: 2 / 5040, because: "2 / 7!" },
];

export function ruleOf(key) {
  return CONTROL_RULES.find((rule) => rule.key === key) ?? null;
}

/** The rules a series fires, anchored on its last day: the only day a reader can act on. */
export function rulesFired(values = [], center = null, sigma = null) {
  if (!sigma || center === null || !values.length) return [];
  const z = values.map((value) => (value - center) / sigma);
  const last = z[z.length - 1];
  const side = (value) => (value > 0 ? 1 : value < 0 ? -1 : 0);
  const fired = [];
  if (Math.abs(last) > 3) fired.push("1_3s");
  else if (Math.abs(last) > 2) fired.push("1_2s");
  if (z.length >= 2 && Math.abs(z[z.length - 2]) > 2 && side(z[z.length - 2]) === side(last)) fired.push("2_2s");
  if (z.length >= 4 && z.slice(-4).every((value) => Math.abs(value) > 1 && side(value) === side(last))) fired.push("4_1s");
  if (z.length >= 10 && z.slice(-10).every((value) => value !== 0 && side(value) === side(last))) fired.push("10x");
  const week = values.slice(-7);
  if (week.length === 7 && (week.every((value, index) => index === 0 || value > week[index - 1]) || week.every((value, index) => index === 0 || value < week[index - 1]))) {
    fired.push("7T");
  }
  return fired;
}

/**
 * How much this record can resolve, measured from the record itself.
 *
 * The spread of day-to-day differences is the honest noise floor: if it is 7.2 points, a "change" of 3 is a
 * coin toss, and the minimal detectable change is 1.96 × that spread (the same quantity a rehab clinic calls
 * the MDC95). This is the number every invented threshold in the panel should have been compared against.
 */
export function pooledDaySigma(rows = []) {
  const deltas = [];
  for (const row of rows) {
    const values = measuredValues(row.series);
    for (let index = 1; index < values.length; index++) deltas.push(values[index] - values[index - 1]);
  }
  if (deltas.length < 2) return { sigma: null, pairs: deltas.length, spread: null, mdc: null };
  const spread = sd(deltas);
  return { sigma: spread / Math.SQRT2, pairs: deltas.length, spread: round1(spread), mdc: round1(1.96 * spread) };
}

/**
 * A control chart per skill: limits from the record's own variation, and the rule that fired.
 *
 * The chart is built the way a lab builds one: the centre and the spread come from a *baseline* period, and
 * the days under judgement are plotted against them. The last seven days are judged while the baseline holds
 * the rest (one day of baseline is all a two-day record can offer), which is why a two-day history can still
 * ask a real question: is today's number beyond yesterday's, measured in the record's own noise? Nothing here
 * is invented: the sigma is the record's once a skill has `minDays` of baseline, the rules are Westgard's, and
 * each one carries the false alarm it costs, so "no alarm" is a statement a reader can trust.
 */
export function controlChart({ rows = [], sigma = null, minDays = 10, fleet = 0, runWindow = 7 } = {}) {
  const skills = rows.map((row) => {
    const values = measuredValues(row.series);
    // The baseline keeps at least `minDays` days once they exist, and the days after it are the ones under
    // judgement: a chart that judged a day against a mean it helped set would halve its own evidence.
    const judgedCount = Math.min(runWindow, Math.max(1, values.length - minDays));
    const baseline = values.slice(0, Math.max(0, values.length - judgedCount));
    const judged = values.slice(-judgedCount);
    const center = baseline.length ? round1(mean(baseline)) : values.length ? round1(mean(values)) : null;
    // The sigma is the skill's own once its baseline is long enough to have one; before that it is the
    // record's, which is the only honest yardstick a two-day history has.
    const own = baseline.length >= minDays ? sd(baseline) : null;
    // A record with no spread at all (a fixture that climbs in equal steps) has no yardstick, and saying so
    // beats dividing by zero.
    const used = own ?? (sigma !== null && sigma > 0 ? sigma : null);
    const fired = rulesFired(judged.length > 1 ? judged : values, center, used);
    const rejections = fired.filter((key) => ruleOf(key)?.kind === "reject");
    const latest = judged.length ? judged[judged.length - 1] : null;
    return {
      name: row.name,
      series: row.series ?? [],
      center,
      latest,
      days: values.length,
      baselineDays: baseline.length,
      judgedDays: judged.length,
      sigma: used === null ? null : round1(used),
      source: own !== null ? "own" : used !== null ? "pooled" : "none",
      limits: used === null || center === null ? null : { one: round1(used), two: round1(2 * used), three: round1(3 * used) },
      z: used === null || center === null || latest === null ? null : round1((latest - center) / used),
      fired,
      rejections,
      alarming: rejections.length > 0,
      warned: fired.includes("1_2s"),
    };
  });
  return {
    sigma: sigma === null ? null : round1(sigma),
    minDays,
    fleet,
    // What a fleet of this size should expect to see by chance alone: the reason a 2s rule is not usable here.
    expectedAt2s: round2(fleet * 2 * TAIL[2]),
    expectedAt3s: round2(fleet * 2 * TAIL[3]),
    alarming: skills.filter((skill) => skill.alarming).length,
    warned: skills.filter((skill) => skill.warned && !skill.alarming).length,
    skills: skills.sort(
      (a, b) => Number(b.alarming) - Number(a.alarming) || Number(b.warned) - Number(a.warned) || Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0)
    ),
  };
}

/**
 * The interval a score earns, from the denominators its axes were measured over.
 *
 * Every axis is a rate over a count, so its variance is `r(1−r)/n`, and the score's is those variances
 * combined by the weights it renormalizes over. The point is not precision: it is that a day at n=3 and a day
 * at n=40 do not produce the same number of *digits*, and the panel currently prints them the same way.
 */
export function scoreInterval({ dimensions = {}, denominators = {}, weights = {} } = {}) {
  const used = Object.keys(weights).filter((name) => dimensions[name] !== null && dimensions[name] !== undefined);
  const total = used.reduce((sum, name) => sum + weights[name], 0);
  if (!total) return { se: null, used, coverage: 0 };
  const variance =
    used.reduce((sum, name) => {
      const denominator = denominators[name] ?? 0;
      if (denominator <= 0) return sum;
      const rate = dimensions[name];
      return sum + weights[name] ** 2 * ((rate * (1 - rate)) / denominator);
    }, 0) / total ** 2;
  return { se: Math.sqrt(variance) * 100, used, coverage: total };
}

/** One row per skill: the score, the interval it earns, and the score the evidence alone supports. */
export function intervalRows({ rows = [], latest = new Map(), weights = {}, fallbackSigma = null, z = 1.96 } = {}) {
  const skills = rows.map((row) => {
    const day = latest.get(row.name) ?? null;
    const found = day ? scoreInterval({ dimensions: day.dimensions, denominators: day.denominators, weights }) : { se: null, used: [] };
    const score = day ? round1(day.score) : row.latestScore === null ? null : round1(row.latestScore);
    // No tally for the day (or no denominator anywhere) falls back to the record's own noise, so a skill is
    // never interval-free just because one pack is missing.
    const se = found.se === null || found.se === 0 ? fallbackSigma : found.se;
    const half = se === null || score === null ? null : round1(z * se);
    return {
      name: row.name,
      n: day?.n ?? null,
      named: day?.named ?? null,
      score,
      axes: found.used.length,
      se: se === null ? null : round1(se),
      half,
      low: half === null ? null : round1(Math.max(0, score - half)),
      high: half === null ? null : round1(Math.min(100, score + half)),
      conservative: se === null || score === null ? null : round1(Math.max(0, score - 3 * se)),
      source: day ? "day" : "record",
      needsSessions: day?.n ? day.n * 4 : null,
      widest: half === null ? -1 : half,
    };
  });
  return {
    z,
    fallbackSigma: fallbackSigma === null ? null : round1(fallbackSigma),
    skills: skills.sort((a, b) => b.widest - a.widest),
  };
}

/** The evidence behind an axis, in the counters it was measured from. */
function evidenceFor(axis, tally) {
  const checks = tally.checks ?? {};
  const graphs = tally.graphs ?? {};
  if (axis === "conformance") {
    const failed = checks.fails ?? 0;
    const refused = checks.refusals ?? 0;
    return `${checks.passes ?? 0} of ${(checks.passes ?? 0) + failed} checks passed${refused ? `, ${refused} refused` : ""}`;
  }
  if (axis === "adherence") {
    return `${graphs.calls ?? 0} graph calls, ${(graphs.illegalMoves ?? 0) + (graphs.prematureTransitions ?? 0)} illegal`;
  }
  if (axis === "trigger") {
    const named = tally.named ?? 0;
    const loaded = tally.loaded ?? 0;
    return `${loaded} of ${named} sessions loaded it; ${Math.max(0, named - loaded)} named it and never did`;
  }
  if (axis === "rework") return `${tally.repeats ?? 0} repeated calls out of ${tally.toolCalls ?? 0}`;
  return `${tally.panels ?? 0} panels and ${tally.proseQuestions ?? 0} prose questions in the sessions it sat in`;
}

/**
 * Why a score is what it is, in points.
 *
 * The score is a weighted mean of the measured axes, so the gap from 100 decomposes exactly:
 * `100·Σw(1−r)/Σw`, and each axis's share is the points it is costing. That is the credit-scoring shape
 * (reason codes priced in points), and it is checkable by hand — which is what makes it arguable rather than
 * authoritative. `pooled` is context only: the fleet's own rate for an axis is a fact about how these CLIs
 * name skills, not a target to reach.
 */
export function factorCodes({ name, dimensions = {}, denominators = {}, tally = {}, weights = {}, pooled = {} } = {}) {
  const used = Object.keys(weights).filter((axis) => dimensions[axis] !== null && dimensions[axis] !== undefined);
  const total = used.reduce((sum, axis) => sum + weights[axis], 0);
  if (!total) return { name, score: null, gap: null, codes: [], top: null };
  const score = round1((used.reduce((sum, axis) => sum + weights[axis] * dimensions[axis], 0) / total) * 100);
  const codes = used
    .map((axis) => {
      const rate = dimensions[axis];
      const costs = round1(((weights[axis] * (1 - rate)) / total) * 100);
      return {
        axis,
        rate: round2(rate),
        denominator: denominators[axis] ?? 0,
        costs,
        weight: weights[axis],
        evidence: evidenceFor(axis, tally),
        pooled: pooled[axis] === undefined || pooled[axis] === null ? null : round2(pooled[axis]),
        at100: round1(score + costs),
      };
    })
    .sort((a, b) => b.costs - a.costs);
  return { name, score, gap: round1(100 - score), codes, top: codes[0] ?? null };
}

/**
 * The score under a target, given one axis moved to it. The simulator the reason codes belong with.
 *
 * The target is a rate the reader chooses, never the fleet's average: on this record moving a skill's trigger
 * rate *down* to the fleet's would lose points, because the fleet's rate is low for a reason (those CLIs name
 * far more skills than they load).
 */
export function simulate({ dimensions = {}, weights = {}, axis, target }) {
  const used = Object.keys(weights).filter((name) => dimensions[name] !== null && dimensions[name] !== undefined);
  const total = used.reduce((sum, name) => sum + weights[name], 0);
  if (!total || !used.includes(axis)) return null;
  const lifted = used.reduce((sum, name) => sum + weights[name] * (name === axis ? target : dimensions[name]), 0) / total;
  return round1(lifted * 100);
}

/**
 * The fleet's own rate per axis, for context beside a reason code.
 *
 * The two readers arrive as arguments so this file keeps no dependency on the scanner: `metrics.mjs` owns what
 * a tally means, and this owns what to do with one.
 */
export function pooledRates(tallies = [], { dimensionsOf = () => ({}), denominatorsOf = () => ({}) } = {}) {
  const sums = {};
  for (const tally of tallies) {
    const dimensions = dimensionsOf(tally);
    const denominators = denominatorsOf(tally);
    for (const [axis, rate] of Object.entries(dimensions)) {
      if (rate === null || rate === undefined) continue;
      const weight = denominators[axis] ?? 0;
      if (!weight) continue;
      sums[axis] ??= { weighted: 0, count: 0 };
      sums[axis].weighted += rate * weight;
      sums[axis].count += weight;
    }
  }
  const out = {};
  for (const [axis, found] of Object.entries(sums)) out[axis] = found.count ? round2(found.weighted / found.count) : null;
  return out;
}

/**
 * The fixing process as a pipeline. Arrivals are what the digest proposes, and the bands are stages a fix
 * passes: proposed → kept → landed → closed. Little's law gives the wait from the queue and the rate, and the
 * constraint is the deepest stage work has reached and not left, which is the honest answer to "where is it
 * stuck" for a record too young to show a widening band.
 */
export function flowOf({ dates = [], arrivals = {}, kept = {}, landed = {}, closed = {}, open = [], today = null } = {}) {
  const running = { proposed: 0, kept: 0, landed: 0, closed: 0 };
  const perDay = dates.map((date) => {
    running.proposed += arrivals[date] ?? 0;
    running.kept += kept[date] ?? 0;
    running.landed += landed[date] ?? 0;
    running.closed += closed[date] ?? 0;
    return {
      date,
      arrivals: arrivals[date] ?? 0,
      kept: kept[date] ?? 0,
      landed: landed[date] ?? 0,
      closed: closed[date] ?? 0,
      cumulative: { ...running },
    };
  });
  const wip = open.length;
  const days = dates.length || 0;
  const arrivalsTotal = running.proposed;
  const closures = running.closed;
  const arrivalsPerDay = days ? round1(arrivalsTotal / days) : null;
  const closuresPerDay = days ? round1(closures / days) : null;
  const firsts = open.map((item) => item.first).filter(Boolean).sort();
  const oldestDays = firsts.length && today ? daysBetween(firsts[0], today) : null;
  const stages = [
    { key: "proposed", label: "proposed", count: running.proposed },
    { key: "kept", label: "kept", count: running.kept },
    { key: "landed", label: "landed", count: running.landed },
    { key: "closed", label: "closed", count: running.closed },
  ];
  const reached = stages.filter((stage) => stage.count > 0);
  return {
    today,
    dates,
    perDay,
    stages,
    wip,
    arrivals: arrivalsTotal,
    closures,
    arrivalsPerDay,
    closuresPerDay,
    oldestDays,
    // Little's law: the wait is the queue divided by the throughput. With no closures there is no throughput
    // to divide by, and the honest answer is the arrival rate instead.
    waitAtArrivals: arrivalsPerDay ? round1(wip / arrivalsPerDay) : null,
    waitAtClosures: closuresPerDay ? round1(wip / closuresPerDay) : null,
    constraint: reached.length > 1 ? reached[reached.length - 1].key : null,
    reached: reached.map((stage) => stage.key),
  };
}

/** SM-2's first two intervals, in days; beyond them the easiness factor multiplies. */
export const REVIEW_STEPS = [1, 6];

/** How long until the next check, from the step and the easiness factor. */
export function intervalOf({ step = 0, ef = 2.5 } = {}) {
  if (step <= 0) return REVIEW_STEPS[0];
  if (step === 1) return REVIEW_STEPS[1];
  return Math.round(REVIEW_STEPS[1] * ef ** (step - 1));
}

/**
 * The next state of one finding's schedule.
 *
 * SM-2's shape, in this domain: a check that holds doubles the wait (through the easiness factor), a finding
 * that comes back goes to a one-day interval again, and a finding that has lapsed twice is marked for
 * reformulation — Wozniak's own conclusion was that an item whose easiness factor bottoms out has a flaw in
 * how it was written, not in how often it is reviewed.
 */
export function applyOutcome(entry = null, outcome = "held", now = null) {
  const base = { step: 0, lapses: 0, ef: 2.5, at: null, outcome: null, reformulated: false, ...(entry ?? {}) };
  if (outcome === "came-back") {
    return { ...base, step: 0, lapses: base.lapses + 1, ef: round2(Math.max(1.3, base.ef - 0.2)), at: now, outcome, reformulated: base.lapses + 1 >= 2 };
  }
  if (outcome === "reformulate") return { ...base, at: now, outcome, reformulated: true };
  return { ...base, step: Math.min(base.step + 1, 6), at: now, outcome, reformulated: false };
}

/**
 * What is due for a re-check, from the findings that keep coming back and the reviews already recorded.
 *
 * A finding with no review is due one day after it was first seen, which is where the evidence is freshest. A
 * finding the scan has already caught coming back needs no human: `auto` says so, and the view asks only for
 * what the scanner cannot see.
 */
export function dueRows({ findings = [], reviews = {}, today = null, limit = 8 } = {}) {
  const rows = findings
    .filter((finding) => finding.path && finding.status !== "closed")
    .map((finding) => {
      const entry = reviews[finding.path] ?? null;
      const step = entry?.step ?? 0;
      const ef = entry?.ef ?? 2.5;
      const interval = intervalOf({ step, ef });
      const from = entry?.at ? String(entry.at).slice(0, 10) : finding.first;
      const due = shiftDays(from, interval);
      return {
        path: finding.path,
        klass: finding.klass,
        skill: finding.skill,
        severity: finding.severity,
        status: finding.status,
        first: finding.first,
        last: finding.last,
        days: finding.days,
        sessions: finding.sessions,
        step,
        ef,
        interval,
        due,
        overdueBy: today ? daysBetween(due, today) : null,
        lapses: entry?.lapses ?? 0,
        reviewedAt: entry?.at ?? null,
        reformulated: Boolean(entry?.reformulated),
        auto: finding.status === "came-back" ? "came-back" : null,
      };
    })
    .filter((row) => !row.reformulated)
    .sort(
      (a, b) =>
        (b.overdueBy ?? -1) - (a.overdueBy ?? -1) ||
        String(a.severity).localeCompare(String(b.severity)) ||
        b.days - a.days
    );
  const due = rows.filter((row) => (row.overdueBy ?? 0) >= 0);
  return {
    today,
    due: due.slice(0, limit),
    dueCount: due.length,
    open: rows.length,
    autoAnswered: due.slice(0, limit).filter((row) => row.auto).length,
    next: rows.filter((row) => (row.overdueBy ?? 0) < 0).slice(0, limit),
    steadyState: null,
  };
}
