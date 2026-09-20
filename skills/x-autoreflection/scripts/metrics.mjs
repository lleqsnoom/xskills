#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Per-skill scores for a collected pack.
 *
 * Every dimension is a rate with a named denominator, because a count without one cannot be compared
 * across skills: `x-commit` runs 174 times and `x-review` 66, and reading those as "x-commit has more
 * problems" is the mistake the old `high` signal made. A dimension whose denominator is zero is `null`
 * — not measured — and the weights renormalize around it, so a skill is never punished for a
 * denominator it never had.
 */

const DAILY_ROOT = path.join(".x-skills", "daily");

/** The published weights. A pack names the version it was scored with, so old packs still render. */
export const WEIGHTS_V1 = {
  conformance: 0.3,
  adherence: 0.2,
  trigger: 0.2,
  rework: 0.15,
  protocol: 0.15,
};

/**
 * Which counting rules produced a number. `v2`: a skill counts as used only in the session's own words,
 * scripts and files — never because a directory listing or an injected skill body named it — so
 * `trigger` and `unused` from before and after the change are not the same measurement.
 */
export const METRICS_DEFINITION = "v2";

/** Below this many loaded sessions a skill has no score, only a sample size. */
export const SAMPLE_FLOOR = 5;

/** Radar axis order, and table column order. */
export const DIMENSIONS = Object.keys(WEIGHTS_V1);

/** What each axis means, in the words the report shows beside it. */
export const DIMENSION_HELP = {
  conformance: "the skill's own checks accepted its work",
  adherence: "the run used the state graph legally",
  trigger: "the skill was loaded, not merely named",
  rework: "work was not redone",
  protocol: "questions were asked as panels",
};

/** A rate, or null when nothing could have been counted. Zero says "measured, and it is zero". */
function rate(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function emptyTally(name) {
  return {
    name,
    sessions: 0,
    loaded: 0,
    named: 0,
    toolCalls: 0,
    repeats: 0,
    panels: 0,
    proseQuestions: 0,
    checks: { declared: 0, calls: 0, passes: 0, refusals: 0, fails: 0 },
    graphs: { calls: 0, illegalMoves: 0, prematureTransitions: 0 },
  };
}

/** Sum the numeric keys of one counter object into another. */
function addCounts(target, source) {
  for (const key of Object.keys(target)) {
    if (typeof target[key] === "number" && Number.isFinite(source?.[key])) target[key] += source[key];
  }
  return target;
}

/**
 * Raw counters per skill. A skill enters the tally when a session loaded it or named it: a skill no
 * session mentions cannot be scored from that session, and inventing a zero for it would read as
 * "never triggered" when the truth is "not observed".
 */
export function tallySessions(sessions = []) {
  const rows = new Map();
  const tallyFor = (name) => {
    if (!rows.has(name)) rows.set(name, emptyTally(name));
    return rows.get(name);
  };

  for (const session of sessions) {
    const loaded = new Set(session.skills?.loaded ?? []);
    const named = new Set([...loaded, ...(session.skills?.used ?? [])]);
    for (const name of named) {
      const entry = tallyFor(name);
      entry.sessions++;
      entry.named++;
      if (loaded.has(name)) entry.loaded++;
      entry.toolCalls += session.stats?.toolCalls ?? 0;
      entry.repeats += session.stats?.repeats ?? 0;
      entry.panels += session.stats?.panels ?? 0;
      entry.proseQuestions += session.stats?.proseQuestions ?? 0;
    }
    for (const check of session.checks ?? []) {
      const entry = tallyFor(check.skill).checks;
      entry.declared = Math.max(entry.declared, 1);
      addCounts(entry, check);
    }
    for (const graph of session.graphs ?? []) addCounts(tallyFor(graph.skill).graphs, graph);
  }
  return [...rows.values()];
}

/** The five rates for one skill's tally. Each is `null` when its denominator is zero. */
export function dimensionsOf(tally) {
  const { checks, graphs } = tally;
  const passes = checks.passes ?? 0;
  const fails = checks.fails ?? 0;
  return {
    conformance: checks.declared ? rate(passes, passes + fails) : null,
    adherence: graphs.calls
      ? 1 - rate((graphs.illegalMoves ?? 0) + (graphs.prematureTransitions ?? 0), graphs.calls)
      : null,
    trigger: tally.named ? rate(tally.loaded, tally.named) : null,
    rework: tally.toolCalls ? 1 - rate(tally.repeats, tally.toolCalls) : null,
    protocol: tally.panels + tally.proseQuestions ? rate(tally.panels, tally.panels + tally.proseQuestions) : null,
  };
}

/**
 * The weighted mean over the measured dimensions only, so the weights renormalize. `coverage` is how
 * much of the total weight the score rests on, which is how a reader tells a thin score from a full one.
 */
export function compose(dimensions, weights = WEIGHTS_V1) {
  const used = DIMENSIONS.filter((name) => dimensions[name] !== null);
  const total = used.reduce((sum, name) => sum + weights[name], 0);
  if (!total) return { score: null, used, coverage: 0 };
  const score = used.reduce((sum, name) => sum + weights[name] * dimensions[name], 0) / total;
  return { score: score * 100, used, coverage: total };
}

function round(value, places = 1) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** One row per skill: the score, the sample it rests on, and the raw rates behind it. */
export function scoreSkills({ sessions = [], floor = SAMPLE_FLOOR, weights = WEIGHTS_V1 } = {}) {
  return tallySessions(sessions).map((tally) => {
    const raw = dimensionsOf(tally);
    const { score, used, coverage } = compose(raw, weights);
    const scored = tally.loaded >= floor;
    return {
      name: tally.name,
      n: tally.loaded,
      named: tally.named,
      sessions: tally.sessions,
      status: scored ? "scored" : "insufficient data",
      score: scored ? round(score) : null,
      rawScore: round(score),
      coverage: round(coverage, 3),
      measured: used,
      counters: {
        toolCalls: tally.toolCalls,
        repeats: tally.repeats,
        panels: tally.panels,
        proseQuestions: tally.proseQuestions,
        checks: { ...tally.checks },
        graphs: { ...tally.graphs },
      },
      dimensions: Object.fromEntries(DIMENSIONS.map((name) => [name, round(raw[name], 3)])),
    };
  });
}

/** Scored first, best first; an unmeasured skill last, by how much evidence it has. */
export function sortRows(rows) {
  const rank = (row) => (row.status === "scored" ? 0 : 1);
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || (b.score ?? 0) - (a.score ?? 0) || b.n - a.n || a.name.localeCompare(b.name)
  );
}

/** Skill names the pack knows about, which is how a proposal's target is tied to a skill. */
function skillNameFromTarget(target = "") {
  const match = String(target).match(/skills\/([a-z0-9-]+)\//);
  return match ? match[1] : null;
}

/**
 * A proposal lifted from a digest: the change it asks for, why, and the number that proves it landed.
 * `reason` is filled from the axis the change moves when the digest does not state one, and the source
 * is labelled so a reader can tell an authored reason from a derived one.
 */
export function proposalFromBlock(block) {
  const field = (label) => {
    const match = block.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*|\\n###|$)`));
    return match ? match[1].replace(/\s+/g, " ").trim() : null;
  };
  const heading = block.match(/^###\s+(P\d+)\s+—\s+(.+)$/m);
  if (!heading) return null;
  const target = field("Target");
  return {
    id: heading[1],
    title: heading[2].trim(),
    skill: skillNameFromTarget(target),
    target,
    signal: field("Signal"),
    change: field("Change"),
    reason: field("Reason"),
    expected: field("Check"),
    route: field("Proposed route"),
  };
}

/** Every proposal in a digest, in file order. A digest that is absent or unreadable yields none. */
export function readProposals(digestPath) {
  if (!digestPath || !fs.existsSync(digestPath)) return { proposals: [], source: null };
  const text = fs.readFileSync(digestPath, "utf8");
  const body = text.split(/\n## /).find((section) => /^## Proposals/m.test(`## ${section}`) || section.startsWith("Proposals"));
  const scope = body ?? text;
  const blocks = scope.split(/\n(?=### )/).filter((block) => /^###\s+P\d+/.test(block.trim()));
  return { proposals: blocks.map(proposalFromBlock).filter(Boolean), source: digestPath };
}

/** The three verdicts a reviewer can give an anchor, in the words the digest offers them. */
export const VERDICTS = ["good", "below", "not-a-skill-problem"];
const VERDICT_SEPARATOR = " — ";
const VERDICT_LINE_RE = /^- \[([ xX])\] (audit )?`([^`]+)` · (.+)$/;

/**
 * One line of the digest's `## Verdicts` section. The reviewer ticks it and keeps one of the three words
 * (or bolds it); the next collection reads the ticked lines back into `labels.jsonl`, which is how a
 * detector's precision gets measured against the only judgement that counts.
 */
export function renderVerdictLine({ session, anchor = null, owner = null, model = null, audit = false }) {
  const head = [`${audit ? "audit " : ""}\`${session}\``, anchor ?? "no anchor", owner ?? "no owner", model ?? "model unknown"].join(" · ");
  return `- [ ] ${head}${VERDICT_SEPARATOR}${VERDICTS.join(" / ")}${VERDICT_SEPARATOR}note:`;
}

/** The verdict a ticked line settles on: a bolded choice wins, else the only one of the three left. */
export function verdictIn(segment) {
  const bold = VERDICTS.filter((word) => segment.includes(`**${word}**`));
  if (bold.length === 1) return bold[0];
  const kept = VERDICTS.filter((word) => new RegExp(`(^|[^a-z-])${word}([^a-z-]|$)`).test(segment));
  return kept.length === 1 ? kept[0] : null;
}

const orNull = (value, placeholder) => (value && value !== placeholder ? value : null);

/** A ticked verdict line as a label; `verdict` is null when the reviewer ticked without choosing. */
export function parseVerdictLine(line) {
  const match = String(line).match(VERDICT_LINE_RE);
  if (!match || match[1] === " ") return null;
  const [head, segment = "", ...rest] = match[4].split(VERDICT_SEPARATOR);
  const [anchor, owner, model] = head.split(" · ").map((field) => field.trim());
  return {
    session: match[3],
    anchor: orNull(anchor, "no anchor"),
    owner: orNull(owner, "no owner"),
    model: orNull(model, "model unknown"),
    audit: Boolean(match[2]),
    verdict: verdictIn(segment),
    note: rest.join(VERDICT_SEPARATOR).replace(/^note:\s*/, "").trim(),
  };
}

function sectionLines(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** The ticked lines of one digest's `## Verdicts`, split into the decided and the undecided. */
export function readVerdicts(digestPath) {
  if (!digestPath || !fs.existsSync(digestPath)) return { verdicts: [], undecided: [] };
  const parsed = sectionLines(fs.readFileSync(digestPath, "utf8"), "Verdicts").map(parseVerdictLine).filter(Boolean);
  return { verdicts: parsed.filter((entry) => entry.verdict), undecided: parsed.filter((entry) => !entry.verdict) };
}

/** Every decided verdict in the digests still on disk, oldest day first. */
export function labelsFromDigests(root = DAILY_ROOT) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort()
    .flatMap((date) => readVerdicts(path.join(root, date, "DIGEST.md")).verdicts.map((verdict) => ({ date, ...verdict })));
}

export const LABELS_FILE = path.join(DAILY_ROOT, "labels.jsonl");

const labelKey = (label) => [label.date, label.session, label.anchor ?? "", label.audit ? "audit" : ""].join("|");

export function readLabels(file = LABELS_FILE) {
  if (!file || !fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/**
 * Merge freshly read verdicts into the label record. Packs are pruned after two weeks and their digests
 * with them, so the record keeps what it already holds; re-reading a day replaces that day's lines.
 */
export function writeLabels(labels, { file = LABELS_FILE } = {}) {
  const merged = new Map([...readLabels(file), ...labels].map((label) => [labelKey(label), label]));
  const rows = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || String(a.session).localeCompare(String(b.session)));
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "");
  return { file, labels: rows.length };
}

/** Labels a detector needs before its precision means anything: below 60 the interval is too wide. */
export const VALIDATION_MIN_LABELS = 60;
/** Share of a detector's labelled anchors the reviewer must call `below` before it may choose sessions. */
export const VALIDATION_MIN_PRECISION = 0.8;

const anchorKind = (label) => String(label.anchor ?? "").split(" ")[0];

/**
 * Each anchor kind's precision against the reviewer's verdicts: the share of its labelled anchors that
 * fell short because of the skill. `not-a-skill-problem` counts against it — the detector found a bad
 * session, but not one a skill edit can fix. Audit lines score no detector: they measure what all missed.
 */
export function detectorPrecision(labels, { min = VALIDATION_MIN_LABELS, bar = VALIDATION_MIN_PRECISION } = {}) {
  const counts = labels
    .filter((label) => !label.audit && label.anchor)
    .reduce((acc, label) => {
      const kind = anchorKind(label);
      const row = acc[kind] ?? { labelled: 0, below: 0 };
      return { ...acc, [kind]: { labelled: row.labelled + 1, below: row.below + (label.verdict === "below" ? 1 : 0) } };
    }, {});
  return Object.fromEntries(
    Object.entries(counts).map(([kind, row]) => {
      const precision = Math.round((row.below / row.labelled) * 1000) / 1000;
      return [kind, { ...row, precision, validated: row.labelled >= min && precision >= bar }];
    })
  );
}

export function validatedKinds(labels, options) {
  return new Set(
    Object.entries(detectorPrecision(labels, options))
      .filter(([, row]) => row.validated)
      .map(([kind]) => kind)
  );
}

/** The anchors that say a session fell short of what the user wanted, without anything failing. */
export const SHORTFALL_KINDS = new Set(["user-redo", "user-handoff", "tool-rejected", "user-pushback", "cross-session-retry"]);

const bump = (counts, key) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 });

/**
 * Per skill and per model: the sessions the skill was loaded or used in, and how many of them carry a
 * shortfall anchor it owns. Reported beside the composite, never inside it: a number heal could optimise
 * is a number that stops meaning anything, and within one skill it is the only fair model comparison.
 */
export function shortfallRates(summaries = []) {
  const sessions = unionSessions(summaries);
  const modelOf = new Map(sessions.map((session) => [String(session.id), session.model ?? "unknown"]));
  const byKey = new Map(sessions.map((session) => [`${session.host ?? "?"}:${session.uuid ?? session.id}`, session]));
  const retried = summaries
    .flatMap((summary) => summary?.retries ?? [])
    .map((retry) => byKey.get(retry.earlier))
    .filter((session) => session?.lastOwner)
    .map((session) => ({ skill: session.lastOwner, session: String(session.id), kind: "cross-session-retry" }));
  const owned = [
    ...summaries
      .flatMap((summary) => summary?.signals ?? [])
      .filter((signal) => SHORTFALL_KINDS.has(signal.kind))
      .flatMap((signal) => (signal.suspects ?? []).map((skill) => ({ skill, session: String(signal.session), kind: signal.kind }))),
    ...retried,
  ];
  const table = {};
  for (const session of sessions) {
    const model = session.model ?? "unknown";
    for (const skill of new Set([...(session.skills?.loaded ?? []), ...(session.skills?.used ?? [])])) {
      const row = table[skill]?.[model] ?? { sessions: 0, shortfall: 0, rate: 0, kinds: {} };
      const mine = owned.filter((entry) => entry.skill === skill && entry.session === String(session.id));
      const next = {
        sessions: row.sessions + 1,
        shortfall: row.shortfall + (mine.length ? 1 : 0),
        kinds: mine.reduce((kinds, entry) => bump(kinds, entry.kind), row.kinds),
      };
      table[skill] = { ...(table[skill] ?? {}), [model]: { ...next, rate: Math.round((next.shortfall / next.sessions) * 1000) / 1000 } };
    }
  }
  // A shortfall owned by a skill no session listed still belongs to its model's row.
  for (const entry of owned) {
    const model = modelOf.get(entry.session) ?? "unknown";
    if (!table[entry.skill]?.[model]) table[entry.skill] = { ...(table[entry.skill] ?? {}), [model]: { sessions: 0, shortfall: 1, rate: null, kinds: { [entry.kind]: 1 } } };
  }
  return table;
}

export function buildScores(summaryOrSummaries, { floor = SAMPLE_FLOOR, weights = WEIGHTS_V1, version = "v1" } = {}) {
  const summaries = Array.isArray(summaryOrSummaries) ? summaryOrSummaries : [summaryOrSummaries];
  const sessions = unionSessions(summaries);
  return {
    weights: version,
    definition: METRICS_DEFINITION,
    floor,
    sessions: sessions.length,
    skills: sortRows(scoreSkills({ sessions, floor, weights })),
    shortfall: shortfallRates(summaries),
  };
}

/**
 * One pack's sessions, or several packs' sessions as one window. A day is 21 sessions across 33 skills,
 * which leaves most skills under the sample floor and makes a per-skill number a coincidence; the window
 * accumulates the raw counters and divides once, rather than averaging daily scores, so a quiet day does
 * not weigh the same as a busy one.
 */
export function unionSessions(summaries = []) {
  const seen = new Map();
  for (const summary of summaries) {
    for (const session of summary?.sessions ?? []) {
      const key = `${session.host ?? "?"}:${session.id ?? session.uuid ?? seen.size}`;
      if (!seen.has(key)) seen.set(key, session);
    }
  }
  return [...seen.values()];
}

/** The daily packs under a root, newest first, as `{ date, summary }` where `summary` is the file path. */
export function discoverPacks(root, days) {
  if (!fs.existsSync(root)) return [];
  const packs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => ({ date: entry.name, summary: path.join(root, entry.name, "summary.json") }))
    .filter((pack) => fs.existsSync(pack.summary))
    .sort((a, b) => b.date.localeCompare(a.date));
  return days > 0 ? packs.slice(0, days) : packs;
}

/** Attach each skill's earlier score, delta and shape, so a gauge and a radar can show movement. */
export function withDelta(current, previous) {
  const before = new Map((previous?.skills ?? []).map((row) => [row.name, row]));
  return {
    ...current,
    skills: current.skills.map((row) => {
      const was = before.get(row.name);
      const comparable = was?.status === "scored" && row.status === "scored" ? was.score : null;
      return {
        ...row,
        previous: comparable,
        delta: comparable === null || row.score === null ? null : round(row.score - comparable, 1),
        previousShape: was ? was.dimensions : null,
      };
    }),
  };
}

function usage() {
  return [
    "x-autoreflection metrics — score each skill over a window of collected packs.",
    "",
    "Usage:",
    "  node metrics.mjs --days 7 [--root .x-skills/daily] [--out <path>]",
    "  node metrics.mjs --summary <summary.json> [--summary <summary.json> ...]",
    "",
    "Flags:",
    "  --days <n>         Read the newest n daily packs under --root (default 7)",
    "  --root <dir>       Where the daily packs live (default .x-skills/daily)",
    "  --summary <path>   One pack explicitly; repeatable, and it replaces --days",
    "  --previous <path>  An earlier pack for the delta; with --days the delta comes",
    "                     from the n packs before the window",
    "  --out <path>       Write the scores JSON here (default: stdout)",
    "  --help             Show this help",
    "",
    "The window accumulates raw counters and divides once, so a quiet day in it does",
    "not weigh the same as a busy one. A dimension with a zero denominator is null and",
    "its weight is redistributed, so a skill is never scored on an axis it never had.",
    "",
  ].join("\n");
}

function readJson(file, what) {
  if (!file || !fs.existsSync(file)) throw new Error(`no ${what} at ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${file} is not JSON: ${err.message}`);
  }
}

function parseArgs(args) {
  const out = { _: [], unknown: [], summary: [] };
  const known = ["summary", "days", "root", "previous", "out", "help"];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (!known.includes(key)) {
      out.unknown.push(key);
      continue;
    }
    const value = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : true;
    if (key === "summary") out.summary.push(value);
    else out[key] = value;
  }
  return out;
}


/**
 * The collection this script belongs to. Resolved from the script, not the cwd, because the same file
 * runs from the repository and from a global install, and a pack can be read from anywhere.
 */
export const DEFAULT_SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The skills this collection ships. A pack also carries whatever else the host had loaded — `api-calling`,
 * `project-wiki`, `crush-config` — and charting those in a report titled x-skills mixes two populations
 * and inflates every total. An absent directory means "cannot tell", so nothing is filtered out.
 */
export function collectionNames(skillsDir = DEFAULT_SKILLS_DIR) {
  if (!skillsDir || !fs.existsSync(skillsDir)) return null;
  const names = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^x-[a-z0-9-]+$/.test(entry.name))
    .map((entry) => entry.name);
  return names.length ? new Set(names) : null;
}

/** Split the scored rows into this collection and everything else the host happened to load. */
function partitionCollection(rows, names) {
  if (!names) return { skills: rows, hostSkills: [] };
  return {
    skills: rows.filter((row) => names.has(row.name)),
    hostSkills: rows.filter((row) => !names.has(row.name)),
  };
}

/** The window's summaries and the summaries it is compared with, from either flags or the pack directory. */
export function resolveWindow({ summaries = [], days = null, root = DAILY_ROOT, previous = null } = {}) {
  if (summaries.length) {
    return { current: summaries, previous: previous ? [previous] : [] };
  }
  const window = Number.isFinite(days) && days > 0 ? days : 7;
  const packs = discoverPacks(root, window * 2);
  return {
    current: packs.slice(0, window).map((pack) => pack.summary).reverse(),
    previous: packs.slice(window).map((pack) => pack.summary).reverse(),
  };
}

export function scoresForSources({ summaries = [], days = null, root = DAILY_ROOT, previous = null, skillsDir = DEFAULT_SKILLS_DIR } = {}) {
  const window = resolveWindow({ summaries, days, root, previous });
  if (!window.current.length) throw new Error(`no packs with a summary.json under ${root}`);
  const label = (file) => path.basename(path.dirname(file));
  const current = buildScores(window.current.map((file) => readJson(file, "summary")));
  const names = collectionNames(skillsDir);
  const { skills, hostSkills } = partitionCollection(current.skills, names);
  current.window = {
    days: window.current.length,
    packs: window.current.map(label),
    files: window.current,
    previousPacks: window.previous.map(label),
    skillsDir: names ? skillsDir : null,
  };
  const before = window.previous.map((file) => readJson(file, "summary"));
  return withDelta({ ...current, skills, hostSkills }, before.length ? buildScores(before) : null);
}

/** Kept for callers that already hold one pack: `scoresFor(path)` scores just that file. */
export function scoresFor(summaryFile, previousFile = null) {
  return scoresForSources({ summaries: [summaryFile], previous: previousFile });
}

/**
 * The record of a day, small enough to keep forever. A pack is 265 KB and is pruned after 14 days; this
 * line is 4 KB and is not, which is what makes a trend possible at all — without it every comparison
 * would be limited to the two weeks a pack survives.
 */
export const HISTORY_FILE = path.join(DAILY_ROOT, "history.jsonl");

export function historyLine(scores, date) {
  return {
    date,
    weights: scores.weights,
    definition: scores.definition ?? null,
    floor: scores.floor,
    sessions: scores.sessions ?? null,
    skills: scores.skills.map((row) => ({
      name: row.name,
      n: row.n,
      named: row.named,
      score: row.score,
      raw: row.rawScore ?? null,
      status: row.status,
      coverage: row.coverage,
      dimensions: row.dimensions,
    })),
  };
}

/** Read a history file into `{ date: line }`, skipping a line that does not parse rather than dying. */
export function readHistory(file = HISTORY_FILE) {
  const byDate = new Map();
  if (!file || !fs.existsSync(file)) return byDate;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.date) byDate.set(parsed.date, parsed);
  }
  return byDate;
}

/**
 * Record one day, replacing that day's earlier line rather than appending a second: a collector that runs
 * twice in a day corrects the day, it does not invent one.
 */
export function writeHistory(line, { file = HISTORY_FILE, keep = 0 } = {}) {
  if (!line?.date) throw new Error("a history line needs a date");
  const byDate = readHistory(file);
  byDate.set(line.date, line);
  const dates = [...byDate.keys()].sort();
  const kept = keep > 0 ? dates.slice(-keep) : dates;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${kept.map((date) => JSON.stringify(byDate.get(date))).join("\n")}\n`);
  return { file, dates: kept, kept: kept.length, dropped: dates.length - kept.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.help) {
      process.stdout.write(usage());
      return;
    }
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    if (!args.summary.length && args.days === true) throw new Error("--days needs a number");
    const scores = scoresForSources({
      summaries: args.summary,
      days: args.summary.length || args.days === true ? null : Number(args.days ?? 7),
      root: typeof args.root === "string" ? args.root : DAILY_ROOT,
      previous: typeof args.previous === "string" ? args.previous : null,
    });
    const json = `${JSON.stringify(scores, null, 2)}\n`;
    if (typeof args.out === "string") {
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      fs.writeFileSync(args.out, json);
      process.stdout.write(`${JSON.stringify({ out: args.out, skills: scores.skills.length, packs: scores.window.packs })}\n`);
      return;
    }
    process.stdout.write(json);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}