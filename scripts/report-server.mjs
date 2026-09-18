#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HISTORY_FILE, WEIGHTS_V1, compose, denominatorsOf, dimensionsOf, historyLine, readHistory, readProposals, scoresForSources, tallySessions, writeHistory } from "../skills/x-autoreflection/scripts/metrics.mjs";
import { band, loadHistory, movementPage, movement, recentDays, calendar, days as allDays } from "../skills/x-autoreflection/scripts/derive.mjs";
import { openReport, safePath } from "./report-open.mjs";
import { CONTROL_RULES, REVIEW_STEPS, applyOutcome, budgetState, classOf, controlChart, dueRows, factorCodes, flowOf, intervalRows, ledgerRows, pathOf, pooledDaySigma, pooledRates, rankCandidates, ratchetRows, recurrenceFindings, sessionsIn, shiftDays, windowMean } from "./report-views.mjs";

/**
 * `npm run report` — the local app: the JSON packs as a database, with the UI built from
 * `tools/report-app/`.
 *
 * The packs are the storage. This process reads them and answers questions about them; there is no
 * database engine, and nothing here writes except the to-do selection, which lands beside the packs so it
 * survives a restart.
 *
 * Routes are one of three kinds:
 *   - `/api/*` — the data the app renders. Pure reads, plus `POST /api/todos`.
 *   - the built app at `/` — `tools/report-app/dist`, or a page saying how to build it.
 *   - `/history.jsonl` — the raw record, so anything can read it without an API.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAILY_ROOT = path.join(REPO_ROOT, ".x-skills", "daily");

/** How often the server looks at the packs while it is running, to keep the panel's snapshot current. */
const PACK_POLL_MS = 5000;
const APP_DIST = path.join(REPO_ROOT, "tools", "report-app", "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** The newest pack on disk, or null when nothing has been collected yet. */
export function newestPack(root = DAILY_ROOT) {
  if (!fs.existsSync(root)) return null;
  const found = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return found.length ? found[found.length - 1] : null;
}

export function packFile(root, date) {
  return path.join(root, date, "summary.json");
}

/**
 * Re-bake whenever the record changes under us, so the panel a reader opens next is never older than the packs.
 *
 * Polling rather than `fs.watch`: recursive watching is not available on every platform Node 18 supports, a
 * pack arrives as several files, and one stat a few seconds apart costs less than chasing events. The interval,
 * the timer and the fingerprint are injectable so a test can drive the whole thing.
 *
 * The fingerprint is injected rather than owned: the same rule serves the plugin's worker, and it lives beside
 * the baker in `report-panel.mjs`. The first tick only learns what the record looks like.
 */
export function followPacks({
  root = DAILY_ROOT,
  rebake,
  fingerprint,
  intervalMs = PACK_POLL_MS,
  timer = setInterval,
  clear = clearInterval,
} = {}) {
  let seen = null;

  const tick = async () => {
    const current = await fingerprint(root);
    const changed = seen !== null && current !== seen;
    seen = current;
    if (!changed) return false;
    try {
      await rebake();
      return true;
    } catch (error) {
      process.stderr.write(`panel not baked: ${error?.message ?? error}\n`);
      return false;
    }
  };

  const handle = timer(tick, intervalMs);
  return { tick, stop: () => clear(handle) };
}

/** One day's pack, or null. Trimmed to what a UI reads: transcript paths are machine-local noise. */
export function readPack(root, date) {
  const file = packFile(root, date);
  if (!fs.existsSync(file)) return null;
  const pack = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    date,
    pack: pack.pack ?? null,
    generatedAt: pack.generatedAt ?? null,
    window: pack.window ?? null,
    hosts: pack.hosts ?? [],
    counts: pack.counts ?? {},
    skills: pack.skills ?? { touched: [], idle: [] },
    warnings: pack.warnings ?? [],
    notes: pack.notes ?? [],
    sessions: (pack.sessions ?? []).map((session) => ({
      id: session.id,
      host: session.host,
      uuid: session.uuid,
      title: session.title,
      project: session.project,
      modified: session.modified,
      stats: session.stats,
      skills: session.skills,
      checks: session.checks ?? [],
      graphs: session.graphs ?? [],
      runFolders: session.runFolders ?? [],
      artifacts: session.artifacts ?? [],
      high: (pack.signals ?? []).filter((signal) => signal.session === session.id && signal.severity === "high").length,
    })),
    signals: pack.signals ?? [],
    runFolders: pack.runFolders ?? [],
    artifacts: pack.artifacts ?? [],
    pruned: pack.pruned ?? [],
  };
}

/** The proposals a day's digest asks for, with the skill each one targets. */
export function readDayProposals(root, date) {
  return readProposals(path.join(root, date, "DIGEST.md"));
}

/** The selection a reader has made, and where it is kept. */
export function readTodos(root = DAILY_ROOT) {
  const file = path.join(root, "todos.json");
  if (!fs.existsSync(file)) return { updatedAt: null, items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { updatedAt: parsed.updatedAt ?? null, items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { updatedAt: null, items: [] };
  }
}

/**
 * Write the selection. This is the only write the server does, and it is deliberately a file beside the
 * packs: the to-do list is data, not server state, so nothing depends on this process staying alive.
 *
 * `day` is the storage discriminator, not a label: two days can each propose a `P1`, and the reader may keep
 * both, so the day is what tells them apart when one of them is dropped again.
 */
export function writeTodos(items, root = DAILY_ROOT) {
  if (!Array.isArray(items)) throw new Error("items must be an array");
  const clean = items
    .filter((item) => item && typeof item.id === "string")
    .map((item) => ({
      id: item.id,
      day: typeof item.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.day) ? item.day : null,
      skill: item.skill ?? null,
      change: item.change ?? null,
      reason: item.reason ?? null,
      expected: item.expected ?? null,
      target: item.target ?? null,
      route: item.route ?? null,
      signal: item.signal ?? null,
      note: item.note ?? null,
    }));
  const payload = { updatedAt: new Date().toISOString(), items: clean };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "todos.json"), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * Record the newest day in the history file, so the JSON on disk is current before the app reads it. The
 * daily line is that day's own pack, never a rolling window: a trend over aggregates would record the same
 * number under several dates.
 */
export function refresh({ root = DAILY_ROOT, days = 14 } = {}) {
  const day = newestPack(root);
  if (!day) return { ok: false, reason: `no pack under ${root}; run the collector first` };
  const dayScores = scoresForSources({ summaries: [packFile(root, day)] });
  const windowScores = scoresForSources({ days, root });
  writeHistory(historyLine(dayScores, day), { file: path.join(root, "history.jsonl") });
  return {
    ok: true,
    day,
    packs: windowScores.window?.packs ?? [],
    skills: windowScores.skills.length,
    inUse: windowScores.skills.filter((row) => row.status === "scored" && row.n > 0).length,
  };
}

/** Everything the default screen needs, in one payload. */
export function apiMovement({ root = DAILY_ROOT, maxDays = 14, recent = 5 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const newest = newestPack(root);
  return {
    ...movementPage(history, { maxDays, recent }),
    newest,
    hasPack: newest ? fs.existsSync(packFile(root, newest)) : false,
    todos: readTodos(root),
  };
}

export function apiDays({ root = DAILY_ROOT, maxDays = 14 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  return {
    dates: allDays(history).slice(-maxDays),
    recent: recentDays(history),
    calendar: calendar(history),
  };
}

/**
 * Is this proposal already kept?
 *
 * The work is the identity, not the digest's label: a proposal is named `P3` inside *every* digest, so the
 * same label means a different task on each day, while the same change text means the same task whenever it
 * was proposed. Comparing the text is what lets a proposal the reader already put on the list stop offering
 * itself again — and it is also what makes the two entries that predate this rule still count, because they
 * carry the text they were saved with.
 *
 * Only when neither side has text to compare does the label decide, and then it is scoped to its day.
 */
export function sameWork(item, proposal) {
  if (item.change && proposal.change && item.change === proposal.change) return true;
  return item.id === proposal.id && (item.day ?? null) === (proposal.day ?? null);
}

export function apiDay({ root = DAILY_ROOT, date } = {}) {
  const pack = readPack(root, date);
  if (!pack) return null;
  const { proposals, source } = readDayProposals(root, date);
  const history = loadHistory(path.join(root, "history.jsonl"));
  const line = history.get(date) ?? null;
  // The band travels with the score, so a UI never re-derives the rule and drifts from it.
  const scores = (line?.skills ?? []).map((skill) => ({ ...skill, band: band(skill.score) }));
  // Whether each proposal is already kept travels with it, for the same reason: one rule, decided once.
  const kept = readTodos(root).items;
  return {
    pack,
    proposals: proposals.map((proposal) => {
      const day = proposal.day ?? date;
      return { ...proposal, day, inTodo: kept.some((item) => sameWork(item, { ...proposal, day })) };
    }),
    digest: source,
    history: line,
    scores,
  };
}

export function apiSkill({ root = DAILY_ROOT, name, maxDays = 14 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const row = movement(history, { maxDays }).find((entry) => entry.name === name);
  if (!row) return null;
  const dates = allDays(history).slice(-maxDays);
  const perDay = dates.map((date) => {
    const skill = (history.get(date).skills ?? []).find((entry) => entry.name === name);
    const pack = readPack(root, date);
    const session = pack?.sessions?.find((entry) => (entry.skills?.loaded ?? []).includes(name)) ?? null;
    return {
      date,
      score: skill?.score ?? null,
      raw: skill?.raw ?? null,
      n: skill?.n ?? null,
      named: skill?.named ?? null,
      dimensions: skill?.dimensions ?? null,
      sample: session ? { id: session.id, host: session.host, title: session.title } : null,
    };
  });
  // Why it moved: the signals that blamed this skill and the proposals that target it, either of which is
  // the next thing a reader wants after seeing the line go up or down.
  const signals = [];
  const proposals = [];
  for (const date of dates) {
    const pack = readPack(root, date);
    if (pack) {
      for (const signal of pack.signals ?? []) {
        if ((signal.suspects ?? []).includes(name)) signals.push({ ...signal, date });
      }
    }
    for (const proposal of readDayProposals(root, date).proposals) {
      if (proposal.skill === name) proposals.push({ ...proposal, date });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  signals.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || (b.count ?? 0) - (a.count ?? 0));
  proposals.reverse(); // newest day first
  return { ...row, perDay, dimensions: row.series[row.series.length - 1]?.dimensions ?? null, signals, proposals };
}

export function apiTodos({ root = DAILY_ROOT } = {}) {
  return readTodos(root);
}

/** One session's own page: the session, and the signals blamed on it. Null when the pack does not hold it. */
export function apiSession({ root = DAILY_ROOT, date, id } = {}) {
  const pack = readPack(root, date);
  const session = pack?.sessions?.find((entry) => String(entry.id) === String(id));
  if (!session) return null;
  return { date, session, signals: (pack.signals ?? []).filter((signal) => signal.session === session.id) };
}

/**
 * The four views that answer "is this getting better?": the ledger of fixes, the ratchet, the bench, and the
 * findings that came back.
 *
 * They share three collectors, because they differ in what they ask rather than in what they know: the
 * proposals a window's digests hold, the kept selection joined to the proposal each item came from, and the
 * days a file was committed on. `report-views.mjs` owns the arithmetic; this file does the looking.
 */

/** How bad a proposal is, read from the digest's own words: `S21 (high, kept)`. */
export function severityOf(signal) {
  const text = String(signal ?? "").toLowerCase();
  if (/\bhigh\b/.test(text)) return "high";
  if (/\bmedium\b/.test(text)) return "medium";
  if (/\blow\b/.test(text)) return "low";
  return "unknown";
}

/**
 * The days a file was committed on. One `git log` per file, memoised, and injectable: this is the only place
 * the report shells out, and no rule in `report-views.mjs` may depend on a repository being there.
 */
export function makeCommitDates({ cwd = REPO_ROOT, run = gitLog } = {}) {
  const cache = new Map();
  return (file) => {
    if (!file) return [];
    if (!cache.has(file)) cache.set(file, run(file, cwd));
    return cache.get(file);
  };
}

function gitLog(file, cwd) {
  try {
    // `--` before the path, so a file named like an option is still a path, and argv rather than a shell, so
    // nothing in a digest's `Target:` line can become a command. A file git does not know is no commits.
    const out = execFileSync("git", ["log", "--format=%cI", "--", file], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** When a fix landed: the first commit to its file on or after the day the reader kept it. */
export function landedAt(commits, file, since, until) {
  if (!file) return null;
  return (
    commits(file)
      .map((stamp) => String(stamp).slice(0, 10))
      .filter((date) => date <= until && (!since || date >= since))
      .sort()[0] ?? null
  );
}

/** The last commit to a file at or before a day, for a row that has not landed: context, not a landing. */
export function committedBefore(commits, file, day) {
  if (!file) return null;
  return (
    commits(file)
      .map((stamp) => String(stamp).slice(0, 10))
      .filter((date) => !day || date <= day)
      .sort()
      .pop() ?? null
  );
}

/** The days a view reads, the last one, and the sample floor the day was scored against. */
function windowOf(history, maxDays) {
  const dates = allDays(history).slice(-maxDays);
  const last = dates[dates.length - 1] ?? null;
  return { dates, last, floor: history.get(last)?.floor ?? 5 };
}

/** Every proposal a window's digests ask for, as a sighting of the finding it describes. */
export function proposalSightings({ root = DAILY_ROOT, dates = [] } = {}) {
  const sightings = [];
  for (const date of dates) {
    const pack = readPack(root, date);
    const known = new Set((pack?.sessions ?? []).map((session) => String(session.id)));
    for (const proposal of readDayProposals(root, date).proposals) {
      sightings.push({
        date,
        id: proposal.id,
        klass: classOf(proposal.title),
        title: proposal.title,
        path: pathOf(proposal.target),
        target: proposal.target ?? null,
        skill: proposal.skill ?? null,
        change: proposal.change ?? null,
        reason: proposal.reason ?? null,
        expected: proposal.expected ?? null,
        route: proposal.route ?? null,
        signal: proposal.signal ?? null,
        severity: severityOf(proposal.signal),
        sessions: sessionsIn(proposal.signal, known),
      });
    }
  }
  return sightings;
}

/**
 * The kept selection, each item joined to the proposal it came from.
 *
 * The item carries what the reader decided (the change, the check, the note) and the proposal carries the
 * class of defect and the file it lives in. They are matched by the work rather than by the label, for the
 * same reason `sameWork` exists: an entry saved before the list recorded days has no day of its own, and `P1`
 * means a different task on every day.
 */
export function keptItems({ root = DAILY_ROOT, dates = [], todos = { items: [] } } = {}) {
  const proposals = proposalSightings({ root, dates });
  return todos.items.map((item) => {
    const match = proposals.find((proposal) => sameWork(item, proposal)) ?? null;
    return {
      id: item.id,
      day: item.day ?? match?.date ?? null,
      skill: item.skill ?? match?.skill ?? null,
      klass: match?.klass ?? classOf(null),
      title: match?.title ?? null,
      change: item.change ?? match?.change ?? null,
      target: item.target ?? match?.target ?? null,
      path: pathOf(item.target) ?? match?.path ?? null,
      check: item.expected ?? match?.expected ?? null,
      signal: item.signal ?? match?.signal ?? null,
      route: item.route ?? match?.route ?? null,
    };
  });
}

/**
 * Findings that keep coming back, which is the sharpest improvement metric the record holds.
 *
 * A finding is an improvement class at a file; its sightings are the days a digest proposed it, and a commit
 * to that file after a sighting is a fix attempt. A sighting after the last attempt is the finding coming
 * back — the one thing the panel can say that means "the fix did not work" — and it is derived entirely from
 * packs already on disk.
 */
export function apiRecurrence({ root = DAILY_ROOT, maxDays = 14, today = null, closedAfterDays = 7, commits = null } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const { dates, last } = windowOf(history, maxDays);
  const git = commits ?? makeCommitDates();
  const found = recurrenceFindings({
    sightings: proposalSightings({ root, dates }),
    commits: (file) => git(file),
    today: today ?? last ?? "",
    closedAfterDays,
  });
  return { ...found, from: dates[0] ?? null, to: last, days: dates.length, closedAfterDays };
}

/**
 * The ledger: of the fixes the reader kept, how many held.
 *
 * The window sits either side of the day the fix landed, and the verdict waits for the whole window, because
 * one day after a fix is a coin toss. `window` is a query knob and defaults to two: two measured days is the
 * honest minimum this record can pay for, and a repository with busier weeks can ask for more.
 */
export function apiLedger({ root = DAILY_ROOT, maxDays = 30, window = 2, today = null, commits = null, sampleFloor = null } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const { dates, last, floor } = windowOf(history, maxDays);
  const day = today ?? last ?? "";
  const git = commits ?? makeCommitDates();
  const todos = readTodos(root);
  const items = keptItems({ root, dates, todos });
  const seriesBySkill = new Map(movement(history, { maxDays }).map((row) => [row.name, row.series]));
  const findings = apiRecurrence({ root, maxDays, today: day, commits: git }).findings;
  const ledger = ledgerRows({
    items,
    seriesBySkill,
    applied: (file, since) => landedAt(git, file, since, day),
    lastCommit: (file, since) => committedBefore(git, file, since),
    today: day,
    windowDays: window,
    sampleFloor: sampleFloor ?? floor,
    cameBack: (klass, file) =>
      findings.some((finding) => finding.klass === klass && finding.path === file && finding.status === "came-back"),
  });
  return { ...ledger, from: dates[0] ?? null, to: last, days: dates.length, proposals: proposalSightings({ root, dates }).length };
}

/**
 * The ratchet: one floor per skill, and how far each skill has slipped below it.
 *
 * With no floor stored, the best sustained value stands in, so the view is loud about a regression without
 * anyone having to configure it. A stored floor is a commitment, and lowering one needs a reason — the rule
 * RuboCop's todo list needs, where re-baselining silently absorbs whatever went wrong.
 */
export function apiRatchet({ root = DAILY_ROOT, maxDays = 14, today = null, budget = 2, window = 3, sampleFloor = null } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const { dates, last, floor } = windowOf(history, maxDays);
  const stored = readFloors(root);
  const ratchet = ratchetRows({
    rows: movement(history, { maxDays }),
    floors: stored.skills,
    window,
    sampleFloor: sampleFloor ?? floor,
    windowScores: windowScoreByName({ root, maxDays }),
    today: today ?? last ?? "",
  });
  return { ...ratchet, budget, state: budgetState(ratchet.below, budget), updatedAt: stored.updatedAt, days: dates.length };
}

/**
 * Each skill's score over the whole window, which is the strongest evidence a short record has.
 *
 * A day can be under the sample floor while the window it sits in is not, so this is what a floor falls back
 * to when there is no run of solid days to hold. A record with no packs has no window, and that is not an
 * error — it is a repository where nothing has been collected yet.
 */
function windowScoreByName({ root = DAILY_ROOT, maxDays = 14 } = {}) {
  const scores = new Map();
  try {
    const window = scoresForSources({ days: maxDays, root });
    for (const skill of window.skills ?? []) {
      if (skill.status === "scored" && skill.score !== null) {
        scores.set(skill.name, { score: skill.score, n: skill.n ?? null, days: window.window?.days ?? maxDays });
      }
    }
  } catch {
    return scores;
  }
  return scores;
}

/** The floors a reader has committed to, beside the packs: like the selection, the data survives a restart. */
export function readFloors(root = DAILY_ROOT) {
  const file = path.join(root, "ratchet.json");
  if (!fs.existsSync(file)) return { updatedAt: null, skills: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const skills = {};
    for (const [name, entry] of Object.entries(parsed.skills ?? {})) {
      const value = Number(entry?.floor);
      if (!Number.isFinite(value)) continue;
      skills[name] = {
        floor: value,
        since: entry.since ?? null,
        basis: entry.basis ?? null,
        reason: entry.reason ?? null,
        at: entry.at ?? null,
      };
    }
    return { updatedAt: parsed.updatedAt ?? null, skills };
  } catch {
    return { updatedAt: null, skills: {} };
  }
}

export function writeFloors(skills, root = DAILY_ROOT) {
  const payload = { updatedAt: new Date().toISOString(), skills: skills ?? {} };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "ratchet.json"), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/** Hold a skill's floor in: commit to the best sustained value it has already reached. */
export function holdFloor({ root = DAILY_ROOT, skill, reason = null, maxDays = 14, window = 3 } = {}) {
  const view = apiRatchet({ root, maxDays, window });
  const row = view.skills.find((entry) => entry.name === skill);
  if (!row) return { ok: false, reason: `no movement recorded for ${skill}` };
  if (!row.floor) return { ok: false, reason: `${skill} has no run of measured days to hold yet` };
  const stored = readFloors(root);
  stored.skills[skill] = { floor: row.floor.value, since: row.floor.since, basis: row.floor.basis, reason, at: new Date().toISOString() };
  const written = writeFloors(stored.skills, root);
  return { ok: true, skill, floor: written.skills[skill] };
}

/**
 * Lower a floor, deliberately and on the record. A reason is required: a floor that can be moved in silence is
 * not a floor, and the reason is what lets the next reader judge the move.
 */
export function lowerFloor({ root = DAILY_ROOT, skill, value = null, reason = null, maxDays = 14, window = 3 } = {}) {
  if (!reason || !String(reason).trim()) return { ok: false, reason: "a floor can only be lowered with a reason" };
  const view = apiRatchet({ root, maxDays, window });
  const row = view.skills.find((entry) => entry.name === skill);
  if (!row) return { ok: false, reason: `no movement recorded for ${skill}` };
  const next = Number.isFinite(Number(value)) ? Number(value) : row.latestScore;
  if (!Number.isFinite(next)) return { ok: false, reason: `${skill} has no measured value to lower to` };
  const stored = readFloors(root);
  stored.skills[skill] = { floor: next, since: row.latest, basis: row.floor?.basis ?? null, reason: String(reason).trim(), at: new Date().toISOString() };
  const written = writeFloors(stored.skills, root);
  return { ok: true, skill, floor: written.skills[skill] };
}

/**
 * The bench: the one thing to fix now, what is in flight, and what is waiting on the scan.
 *
 * `now` is picked mechanically and says why: severity, how often the finding has been seen, and how cheap its
 * check is. `doing` is one card, because a bench with three open fixes is a bench where none gets finished,
 * and `queued` is what that limit costs. Everything landed but not yet measured is `waiting`, which is the
 * half of the loop nothing else in the app shows.
 */
export function apiBench({ root = DAILY_ROOT, maxDays = 14, today = null, window = 2, commits = null } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const { dates, last, floor } = windowOf(history, maxDays);
  const day = today ?? last ?? "";
  const git = commits ?? makeCommitDates();
  const todos = readTodos(root);
  const sightings = proposalSightings({ root, dates });
  const found = recurrenceFindings({ sightings, commits: (file) => git(file), today: day });
  const kept = keptItems({ root, dates, todos });
  const seriesBySkill = new Map(movement(history, { maxDays }).map((row) => [row.name, row.series]));
  const recurrenceOf = (sighting) =>
    found.findings.find((finding) => finding.klass === sighting.klass && finding.path === sighting.path)?.days ?? 1;

  const open = sightings
    .filter((sighting) => !todos.items.some((item) => sameWork(item, sighting)))
    .map((sighting) => ({ ...sighting, recurrence: recurrenceOf(sighting), from: sighting.date }));
  const ranked = rankCandidates(open);

  const landed = kept.map((item) => {
    const at = landedAt(git, item.path, item.day, day);
    const after = at ? windowMean(seriesBySkill.get(item.skill), shiftDays(at, 1), day) : { mean: null, days: 0, calls: 0, thin: 0, dates: [] };
    return { ...item, landed: at, after, left: Math.max(0, window - after.days) };
  });
  const inFlight = landed.filter((item) => !item.landed).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const waiting = landed
    .filter((item) => item.landed && item.left > 0)
    .sort((a, b) => String(b.landed).localeCompare(String(a.landed)));

  return {
    today: day,
    window,
    sampleFloor: floor,
    now: ranked[0] ?? null,
    next: ranked.slice(1, 4),
    candidates: ranked.length,
    doing: inFlight[0] ?? null,
    queued: inFlight.slice(1),
    waiting,
    counts: { open: ranked.length, kept: kept.length, inFlight: inFlight.length, waiting: waiting.length },
  };
}

/**
 * The five views that ask a *different* question about the same record.
 *
 * Where the first four measured the work, these measure the measurement: how much of a move is noise, how sure
 * a number is, why it is that number, whether the fixing process is keeping up, and when a believed-fixed
 * finding has to be re-checked. Each one borrows its rule from a field that already solved the same problem
 * (clinical QC, competitive rating, consumer credit, queueing, spaced repetition), and every rule is a pure
 * function in `report-views.mjs`.
 */

/** Every skill's tally for one day, which is where the axis denominators live. */
export function talliesFor({ root = DAILY_ROOT, date } = {}) {
  const pack = date ? readPack(root, date) : null;
  if (!pack) return new Map();
  return new Map(tallySessions(pack.sessions ?? []).map((tally) => [tally.name, tally]));
}

/** The newest day's tallies, as the maps the interval and reason-code views read. */
function latestDay({ root, history, maxDays }) {
  const { dates, last, floor } = windowOf(history, maxDays);
  const tallies = talliesFor({ root, date: last });
  const dims = new Map();
  for (const [name, tally] of tallies) {
    const dimensions = dimensionsOf(tally);
    dims.set(name, {
      dimensions,
      denominators: denominatorsOf(tally),
      score: compose(dimensions, WEIGHTS_V1).score,
      n: tally.loaded,
      named: tally.named,
    });
  }
  return { dates, last, floor, tallies, dims };
}

/**
 * The control chart: limits from the record's own variation, and the rule that fired.
 *
 * The sigma is pooled from the day-to-day differences of every skill until a skill has ten measured days of
 * its own, because two days cannot say what one skill's own spread is. The fleet's expected false alarms come
 * with it, since that is the number that decides which rules are usable: at 28 skills, a 2s rule rings about
 * once a day on nothing.
 */
export function apiControl({ root = DAILY_ROOT, maxDays = 14, minDays = 10, sigma = null } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const { dates, last } = windowOf(history, maxDays);
  const rows = movement(history, { maxDays });
  const pooled = pooledDaySigma(rows);
  const chart = controlChart({ rows, sigma: sigma ?? pooled.sigma, minDays, fleet: rows.length });
  return { ...chart, pooled, rules: CONTROL_RULES, from: dates[0] ?? null, to: last, days: dates.length };
}

/**
 * The interval a score earns, and where the next session buys the most certainty.
 *
 * `SE = σ/√n` is why this is a view and not a footnote: a score from three sessions and a score from forty have
 * the same number of digits today, and only one of them means anything. The conservative value is TrueSkill's
 * display rule (μ − 3σ) so a ranking is not held by whoever was measured luckiest.
 */
export function apiInterval({ root = DAILY_ROOT, maxDays = 14, z = 1.96 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const { dates, last, floor, tallies, dims } = latestDay({ root, history, maxDays });
  const rows = movement(history, { maxDays });
  const pooled = pooledDaySigma(rows);
  const view = intervalRows({ rows, latest: dims, weights: WEIGHTS_V1, fallbackSigma: pooled.sigma, z });
  return { ...view, pooled, sampleFloor: floor, from: dates[0] ?? null, to: last, days: dates.length, tallied: tallies.size };
}

/**
 * The reason codes: why a score is what it is, in points, and what a target on one axis would buy.
 *
 * The score is a weighted mean of measurable rates, so the gap from 100 decomposes exactly and every point is
 * attributable to an axis with the counters behind it. `pooled` is context, never a target: on this record the
 * fleet's trigger rate is 33% because those CLIs name far more skills than they load, and moving a skill
 * *down* to it would cost points.
 */
export function apiFactors({ root = DAILY_ROOT, maxDays = 14 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const { dates, last, dims, tallies } = latestDay({ root, history, maxDays });
  const pooled = pooledRates([...tallies.values()], { dimensionsOf, denominatorsOf });
  // Every skill the newest day's sessions named or loaded, not the movement table's rows: a skill that was
  // named three times and never loaded is the case the `trigger` reason code exists for, and the movement
  // table cannot list it because it has no loaded session to score.
  const skills = [...dims.entries()]
    .map(([name, day]) => {
      if (day.score === null) return null;
      return {
        ...factorCodes({
          name,
          dimensions: day.dimensions,
          denominators: day.denominators,
          tally: tallies.get(name) ?? {},
          weights: WEIGHTS_V1,
          pooled,
        }),
        n: day.n,
        named: day.named,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0));
  return { today: last, weights: WEIGHTS_V1, pooled, skills, from: dates[0] ?? null, to: last, days: dates.length };
}

/**
 * The flow of the fixing itself: what arrives, what closes, and how long the queue implies.
 *
 * Arrivals are the digest's proposals, kept and landed come from the selection and the commit dates, and a
 * closure is dated by the rule that produced it (the last fix plus the quiet week the recurrence board asks
 * for), which the view states rather than leaving as an unexplained bar.
 */
export function apiFlow({ root = DAILY_ROOT, maxDays = 14, commits = null, closedAfterDays = 7 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const { dates, last, floor } = windowOf(history, maxDays);
  const day = last ?? "";
  const git = commits ?? makeCommitDates();
  const kept = keptItems({ root, dates, todos: readTodos(root) });
  const findings = apiRecurrence({ root, maxDays, commits: git, closedAfterDays }).findings;
  const arrivals = {};
  const keptBy = {};
  const landedBy = {};
  const closedBy = {};
  for (const sighting of proposalSightings({ root, dates })) arrivals[sighting.date] = (arrivals[sighting.date] ?? 0) + 1;
  for (const item of kept) {
    if (item.day) keptBy[item.day] = (keptBy[item.day] ?? 0) + 1;
    const at = landedAt(git, item.path, item.day, day);
    if (at) landedBy[at] = (landedBy[at] ?? 0) + 1;
  }
  for (const finding of findings) {
    if (finding.status !== "closed" || !finding.lastFix) continue;
    const on = shiftDays(finding.lastFix, closedAfterDays);
    closedBy[on] = (closedBy[on] ?? 0) + 1;
  }
  const flow = flowOf({
    dates,
    arrivals,
    kept: keptBy,
    landed: landedBy,
    closed: closedBy,
    open: findings.filter((finding) => finding.status !== "closed").map((finding) => ({ first: finding.first, path: finding.path, status: finding.status })),
    today: day,
  });
  return { ...flow, floor, kept: kept.length, findings: findings.length, closedAfterDays, from: dates[0] ?? null, to: last };
}

/** The reviews a reader has recorded: one entry per finding, keyed by the file it is about. */
export function readReviews(root = DAILY_ROOT) {
  const file = path.join(root, "reviews.json");
  if (!fs.existsSync(file)) return { updatedAt: null, items: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const items = {};
    for (const [key, entry] of Object.entries(parsed.items ?? {})) {
      if (!key || !entry || typeof entry !== "object") continue;
      const step = Number(entry.step);
      const lapses = Number(entry.lapses);
      const ef = Number(entry.ef);
      items[key] = {
        step: Number.isFinite(step) ? Math.max(0, Math.min(6, Math.trunc(step))) : 0,
        lapses: Number.isFinite(lapses) ? Math.max(0, Math.trunc(lapses)) : 0,
        ef: Number.isFinite(ef) ? Math.min(2.5, Math.max(1.3, ef)) : 2.5,
        at: typeof entry.at === "string" ? entry.at : null,
        outcome: typeof entry.outcome === "string" ? entry.outcome : null,
        reformulated: entry.reformulated === true,
      };
    }
    return { updatedAt: parsed.updatedAt ?? null, items };
  } catch {
    return { updatedAt: null, items: {} };
  }
}

export function writeReviews(items, root = DAILY_ROOT) {
  const payload = { updatedAt: new Date().toISOString(), items: items ?? {} };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "reviews.json"), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/** Record one verdict on one finding. The only write the schedule needs. */
export function recordReview({ root = DAILY_ROOT, path: file, outcome = "held", at = null } = {}) {
  if (!file || typeof file !== "string") return { ok: false, reason: "a review needs the path of the finding it is about" };
  const allowed = ["held", "came-back", "reformulate"];
  if (!allowed.includes(outcome)) return { ok: false, reason: `unknown outcome "${outcome}"; expected one of ${allowed.join(", ")}` };
  const store = readReviews(root);
  store.items[file] = applyOutcome(store.items[file] ?? null, outcome, at ?? new Date().toISOString());
  const written = writeReviews(store.items, root);
  return { ok: true, path: file, review: written.items[file] };
}

/**
 * What is due for a re-check, on a schedule that widens.
 *
 * A finding the scanner has already caught coming back is answered for free (`auto`), so the list asks a human
 * only for what the scanner cannot see. The load is stated too: arrivals a day times the four checks a widening
 * schedule asks for, which is the number that decides whether the routine will survive.
 */
export function apiSchedule({ root = DAILY_ROOT, maxDays = 14, commits = null, limit = 8, closedAfterDays = 7 } = {}) {
  const history = loadHistory(path.join(root, "history.jsonl"));
  const { dates, last } = windowOf(history, maxDays);
  const git = commits ?? makeCommitDates();
  const findings = apiRecurrence({ root, maxDays, commits: git, closedAfterDays }).findings;
  const store = readReviews(root);
  const view = dueRows({ findings, reviews: store.items, today: last ?? "", limit });
  const arrivals = proposalSightings({ root, dates }).length;
  const perDay = dates.length ? Math.round((arrivals / dates.length) * 10) / 10 : null;
  return {
    ...view,
    updatedAt: store.updatedAt,
    steps: REVIEW_STEPS,
    perFindingChecks: 4,
    arrivals,
    perDay,
    load: perDay === null ? null : Math.round(perDay * 4 * 10) / 10,
    from: dates[0] ?? null,
    days: dates.length,
  };
}

/**
 * Resolve a request path inside a root, refusing anything that climbs out. The server is loopback-only, but
 * a path that escapes the directory is a bug even on a trusted machine.
 */
export function resolveWithin(urlPath, root) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.resolve(root, `.${decoded}`);
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null;
  return target;
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, `${JSON.stringify(value)}\n`, TYPES[".json"]);
}

function serveFile(res, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(fs.readFileSync(file));
  return true;
}

/** Shown when the app has not been built, so the failure says what to do instead of returning nothing. */
const NOT_BUILT = `<!doctype html>
<meta charset="utf-8"><title>Report app not built</title>
<style>body{font:15px/1.6 ui-sans-serif,system-ui;max-width:44rem;margin:4rem auto;padding:0 1.5rem}
code{background:#eef0f3;padding:.1em .35em;border-radius:4px}</style>
<h1>The app is not built yet</h1>
<p>Install and build it once:</p>
<pre><code>npm run report:build</code></pre>
<p>Then reload. The API is already answering — try
<a href="/api/movement"><code>/api/movement</code></a>.</p>
`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export function createServer({ root = DAILY_ROOT, maxDays = 14, appDist = APP_DIST, open = openReport, rebake = null } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const query = url.searchParams;
    const days = Number(query.get("days") ?? maxDays) || maxDays;

    try {
      if (url.pathname === "/api/movement") {
        return sendJson(res, 200, apiMovement({ root, maxDays, recent: Number(query.get("recent") ?? 5) || 5 }));
      }
      if (url.pathname === "/api/days") return sendJson(res, 200, apiDays({ root, maxDays }));
      if (url.pathname === "/api/ledger") {
        return sendJson(res, 200, apiLedger({ root, maxDays, window: Number(query.get("window") ?? 2) || 2 }));
      }
      if (url.pathname === "/api/bench") {
        return sendJson(res, 200, apiBench({ root, maxDays, window: Number(query.get("window") ?? 2) || 2 }));
      }
      if (url.pathname === "/api/recurrence") return sendJson(res, 200, apiRecurrence({ root, maxDays }));
      if (url.pathname === "/api/ratchet") {
        if (req.method === "POST") {
          const body = JSON.parse((await readBody(req)) || "{}");
          const args = { root, skill: body.skill, reason: body.reason ?? null };
          // Two decisions, one route: hold the floor in at what the skill already held, or lower it on the
          // record. Both answer 400 with the reason when the move is not allowed.
          const result = body.action === "lower" ? lowerFloor({ ...args, value: body.value ?? null }) : holdFloor(args);
          return sendJson(res, result.ok ? 200 : 400, result);
        }
        const budget = Number(query.get("budget"));
        return sendJson(res, 200, apiRatchet({ root, maxDays, budget: Number.isFinite(budget) ? budget : 2 }));
      }
      if (url.pathname === "/api/control") return sendJson(res, 200, apiControl({ root, maxDays }));
      if (url.pathname === "/api/interval") return sendJson(res, 200, apiInterval({ root, maxDays }));
      if (url.pathname === "/api/factors") return sendJson(res, 200, apiFactors({ root, maxDays }));
      if (url.pathname === "/api/flow") return sendJson(res, 200, apiFlow({ root, maxDays }));
      if (url.pathname === "/api/schedule") return sendJson(res, 200, apiSchedule({ root, maxDays }));
      if (url.pathname === "/api/reviews") {
        if (req.method === "POST") {
          const body = JSON.parse((await readBody(req)) || "{}");
          // One verdict on one finding: held (the wait grows), came back (the wait resets) or reformulate.
          const result = recordReview({ root, path: body.path, outcome: body.outcome });
          return sendJson(res, result.ok ? 200 : 400, result);
        }
        return sendJson(res, 200, readReviews(root));
      }
      if (url.pathname === "/api/todos") {
        if (req.method === "POST") {
          const body = await readBody(req);
          return sendJson(res, 200, writeTodos(JSON.parse(body || "{}").items ?? [], root));
        }
        return sendJson(res, 200, apiTodos({ root }));
      }
      if (url.pathname === "/api/refresh") {
        const result = refresh({ root, days });
        if (rebake) {
          // The panel the Orca plugin shows is a snapshot of this record, so a recording re-bakes it. A bake
          // that fails is a log line, never a failed refresh: the record is written either way.
          try {
            await rebake();
          } catch (error) {
            process.stderr.write(`panel not baked: ${error?.message ?? error}\n`);
          }
        }
        return sendJson(res, 200, result);
      }

      // `Run`: the page says which surface it wants and where it is, and the machine decides how to oblige.
      // The path is the only part a client contributes, and it is re-anchored to this server's own origin, so
      // a body can never point the opener at another host.
      if (url.pathname === "/api/open" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const port = req.socket.localPort;
        const result = open({ url: `http://127.0.0.1:${port}${safePath(body.path)}`, surface: body.surface });
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      const dayMatch = url.pathname.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})\/?$/);
      if (dayMatch) {
        const payload = apiDay({ root, date: dayMatch[1] });
        return payload ? sendJson(res, 200, payload) : sendJson(res, 404, { error: `no pack for ${dayMatch[1]}` });
      }

      const sessionMatch = url.pathname.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})\/session\/([^/]+)\/?$/);
      if (sessionMatch) {
        const payload = apiSession({ root, date: sessionMatch[1], id: decodeURIComponent(sessionMatch[2]) });
        if (!payload) {
          return sendJson(res, 404, { error: `no session ${decodeURIComponent(sessionMatch[2])} in ${sessionMatch[1]}` });
        }
        return sendJson(res, 200, payload);
      }

      const skillMatch = url.pathname.match(/^\/api\/skill\/([a-z0-9-]+)\/?$/);
      if (skillMatch) {
        const payload = apiSkill({ root, name: skillMatch[1], maxDays });
        return payload ? sendJson(res, 200, payload) : sendJson(res, 404, { error: `no movement for ${skillMatch[1]}` });
      }

      if (url.pathname === "/history.jsonl") {
        if (serveFile(res, path.join(root, "history.jsonl"))) return;
        return send(res, 404, "no history yet\n");
      }

      // The built app; any extension-less path is the shell, because the app routes client-side.
      if (url.pathname === "/" || !path.extname(url.pathname)) {
        if (serveFile(res, path.join(appDist, "index.html"))) return;
        return send(res, 200, NOT_BUILT, TYPES[".html"]);
      }
      const asset = resolveWithin(url.pathname, appDist);
      if (!asset) return send(res, 403, "path escapes the served directory\n");
      if (serveFile(res, asset)) return;

      const raw = resolveWithin(url.pathname, root);
      if (raw && serveFile(res, raw)) return;
      send(res, 404, `nothing at ${url.pathname}\n`);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}

function usage() {
  return [
    "xskills report — the local app over the JSON packs.",
    "",
    "Usage:",
    "  npm run report [-- --port 8787 --root .x-skills/daily --days 14]",
    "",
    "Flags:",
    "  --port <n>       Port to listen on (default 8787, or $PORT)",
    "  --days <n>       How many days of history the API reads (default 14)",
    "  --root <dir>     The daily root to serve (default .x-skills/daily)",
    "  --no-refresh     Answer from disk without recording the newest day first",
    "  --no-panel       Do not bake the Orca plugin's panel (default: bake it, and after every refresh)",
    "  --panel-out <p>  Where the panel is baked (default tools/orca-plugin/panel.html)",
    "  --help           Show this help",
    "",
    "API:",
    "  GET  /api/movement                    the default screen: movement, recent days, calendar, todos",
    "  GET  /api/days                        dates, recent days and the calendar",
    "  GET  /api/day/<date>                  one pack, its digest's proposals and its scores",
    "  GET  /api/day/<date>/session/<id>     one session and the signals blamed on it",
    "  GET  /api/skill/<name>                one skill's series, change and per-day detail",
    "  GET  /api/ledger                      the fixes the reader kept, with a before/after verdict",
    "  GET  /api/ratchet                     one floor per skill, and what slipped below it",
    "  GET  /api/bench                       the one fix to do now, what is in flight, what is waiting",
    "  GET  /api/recurrence                  findings that keep coming back, by class and file",
    "  GET  /api/control                     control limits from the record, and the rule that fired",
    "  GET  /api/interval                    each score with the interval its evidence earns",
    "  GET  /api/factors                     why a score is what it is, in points, per axis",
    "  GET  /api/flow                        arrivals, closures and the wait of the fixing process",
    "  GET  /api/schedule                    what is due for a re-check, on widening intervals",
    "  GET  /api/reviews  POST /api/reviews  the reviews recorded, and one verdict on one finding",
    "  GET  /api/refresh                     record the newest day, and report what changed",
    "  GET  /api/todos  POST /api/todos      the selection, and the one thing this server writes",
    "  GET  /api/ratchet  POST /api/ratchet  the floors; POST holds one in or lowers it, with a reason",
    "  POST /api/open                        open the report in an Orca tab, or in a window without browser controls",
    "  GET  /history.jsonl                   the raw day-by-day record",
    "",
    "Bound to 127.0.0.1: it serves this repository's own data to this machine.",
    "",
  ].join("\n");
}

function parseArgs(args) {
  const out = { _: [], unknown: [] };
  // `--no-panel` and `--panel-out` are in the usage text and in `main`, so they are flags here too: a server
  // that refuses its own documented flags is a server whose help page lies.
  const known = ["port", "days", "root", "no-refresh", "no-panel", "panel-out", "help"];
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
    out[key] = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
  return out;
}

/**
 * The panel baker, when the Orca plugin is here to bake for.
 *
 * Imported late on purpose: the baker imports this module's API functions, so a static import would be a
 * cycle — and a server that cannot bake a panel is still a working server. The baker carries the staleness
 * rule too, because the plugin's worker bakes by the same one.
 */
function loadPanelBake({ root, out, maxDays }) {
  const target = typeof out === "string" ? path.resolve(out) : path.join(REPO_ROOT, "tools", "orca-plugin", "panel.html");
  if (!fs.existsSync(path.dirname(target))) return null;
  const baker = () => import("./report-panel.mjs");
  return {
    target,
    rebake: async () => (await baker()).bake({ root, out: target, maxDays }),
    fingerprint: async () => (await baker()).packFingerprint(root),
  };
}

async function bakeQuietly(rebake, onDone = () => {}) {
  try {
    onDone(await rebake());
  } catch (error) {
    process.stderr.write(`panel not baked: ${error?.message ?? error}\n`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (args.unknown.length) {
    process.stderr.write(`Unknown argument "${args.unknown[0]}"\n\n${usage()}`);
    return 2;
  }
  const root = typeof args.root === "string" ? path.resolve(args.root) : DAILY_ROOT;
  const maxDays = Number(typeof args.days === "string" ? args.days : 14) || 14;
  const port = Number(typeof args.port === "string" ? args.port : process.env.PORT ?? 8787);
  const panel = args["no-panel"] === true ? null : loadPanelBake({ root, out: args["panel-out"], maxDays });
  const rebake = panel ? panel.rebake : null;

  if (args["no-refresh"] !== true) {
    const result = refresh({ root, days: maxDays });
    process.stdout.write(result.ok ? `recorded ${result.day} (${result.inUse} skills in use over ${result.packs.length} packs)\n` : `${result.reason}\n`);
  }

  const server = createServer({ root, maxDays, rebake });
  server.listen(port, "127.0.0.1", () => {
    const { port: actual } = server.address();
    const built = fs.existsSync(path.join(APP_DIST, "index.html"));
    process.stdout.write(
      [
        `xskills report on http://127.0.0.1:${actual}/`,
        built ? "  app built — open the URL above" : "  app not built yet: npm run report:build (the API answers now)",
        `  api       http://127.0.0.1:${actual}/api/movement`,
        `  raw data  http://127.0.0.1:${actual}/history.jsonl`,
        rebake ? "  panel     baked now, after every refresh, and when the packs change" : "  panel     not baked (--no-panel)",
        `  ctrl-c to stop`,
        "",
      ].join("\n")
    );
    if (panel) {
      void bakeQuietly(panel.rebake);
      followPacks({ root, rebake: panel.rebake, fingerprint: panel.fingerprint });
    }
  });
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exitCode = main();
}

export { APP_DIST, DAILY_ROOT, HISTORY_FILE, REPO_ROOT };
