import fs from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Across sessions: the requests people asked twice, the few sessions a reflection should read, and the
 * one quiet session a day a human labels anyway. Pure functions over scan summaries — the collector and
 * the analysis feed them, and neither needs a transcript to do it.
 */

/** Share of a request that must reappear for a later session to count as asking it again. */
export const RETRY_MIN_OVERLAP = 0.5;
/** A re-ask after two days is a new task more often than a retry. */
export const RETRY_MAX_HOURS = 48;
/** An opener seen in this many sessions is an automation's prompt, not a person asking twice. */
export const TEMPLATE_MIN_SESSIONS = 3;
const TEMPLATE_PREFIX = 60;
const HOUR_MS = 3_600_000;

/**
 * Anchor kinds in the order a reflection reads them: the user giving up, the user asking again in a new
 * session, the user refusing the skill's step, the user asking again in the same session, a skill script
 * that silently did nothing. `user-pushback` is read by a model and joins only once labels validate it.
 */
export const SELECT_ORDER = [
  "user-handoff",
  "cross-session-retry",
  "tool-rejected",
  "user-redo",
  "user-handedit",
  "user-dissatisfied",
  "skill-script-silent",
  "user-pushback",
];
const FRICTION_KINDS = new Set(["tool-failure", "repeat-call", "user-correction", "user-reprompt", "prose-question"]);

/**
 * The weak implicit signals: each alone is noise (a finished one-shot looks like an abandonment, a
 * reprompt can be a pause), so none of them earns a reading on its own. Two or more on one session is
 * the composite `user-dissatisfied`, which does.
 */
export const WEAK_IMPLICIT_KINDS = new Set(["user-abandon", "user-handedit", "user-pushback", "user-reprompt"]);
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

export function shingles(text, size = 3) {
  const words = String(text ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return new Set(words.slice(0, Math.max(0, words.length - size + 1)).map((_, i) => words.slice(i, i + size).join(" ")));
}

/** How much of the shorter text the longer one repeats, 0 to 1. */
export function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  return [...small].filter((gram) => large.has(gram)).length / small.size;
}

const timeOf = (session) => Date.parse(session.request?.created ?? session.modified ?? "");

function templates(sessions) {
  const counts = sessions.reduce((acc, session) => {
    const prefix = session.request.text.slice(0, TEMPLATE_PREFIX);
    return { ...acc, [prefix]: (acc[prefix] ?? 0) + 1 };
  }, {});
  return new Set(Object.keys(counts).filter((prefix) => counts[prefix] >= TEMPLATE_MIN_SESSIONS));
}

/**
 * Pairs of sessions where the later one opens with most of the earlier one's request. The earlier
 * session is the one that fell short: its user came back and asked again, in this CLI or another.
 */
export function crossSessionRetries(sessions, { minOverlap = RETRY_MIN_OVERLAP, maxHours = RETRY_MAX_HOURS } = {}) {
  const asked = sessions.filter((session) => session.request?.text && Number.isFinite(timeOf(session)));
  const skip = templates(asked);
  const ordered = asked
    .filter((session) => !skip.has(session.request.text.slice(0, TEMPLATE_PREFIX)))
    .map((session) => ({ session, grams: shingles(session.request.text), time: timeOf(session) }))
    .sort((a, b) => a.time - b.time);
  return ordered.flatMap((later, j) =>
    ordered.slice(0, j).flatMap((earlier) => {
      const hours = (later.time - earlier.time) / HOUR_MS;
      const share = overlap(earlier.grams, later.grams);
      if (hours < 0 || hours > maxHours || share < minOverlap) return [];
      return [
        {
          earlier: earlier.session.key,
          later: later.session.key,
          hours: Math.round(hours * 10) / 10,
          overlap: Math.round(share * 100) / 100,
          excerpt: later.session.request.text.slice(0, 140),
        },
      ];
    })
  );
}

/** The anchors of one session: its own quality signals, the composite of its weak ones, plus being the earlier half of a retry. */
export function anchorsOf(session, { retries = [], validated = new Set() } = {}) {
  const own = (session.signals ?? [])
    .filter((signal) => SELECT_ORDER.includes(signal.kind) && (signal.kind !== "user-pushback" || validated.has("user-pushback")))
    .map((signal) => ({ kind: signal.kind, owner: signal.suspects?.[0] ?? null, message: signal.evidence?.[0]?.message ?? null }));
  const weak = (session.signals ?? []).filter((signal) => WEAK_IMPLICIT_KINDS.has(signal.kind));
  const kinds = new Set(weak.map((signal) => signal.kind));
  const composite =
    kinds.size >= 2
      ? [
          {
            kind: "user-dissatisfied",
            owner: session.lastOwner ?? weak.map((signal) => signal.suspects?.[0]).find(Boolean) ?? null,
            message: weak.map((signal) => signal.evidence?.[0]?.message).find((message) => message !== null && message !== undefined) ?? null,
          },
        ]
      : [];
  const retried = retries
    .filter((retry) => retry.earlier === session.key)
    .map((retry) => ({ kind: "cross-session-retry", owner: session.lastOwner ?? null, message: session.request?.message ?? null, retriedIn: retry.later }));
  return [...own, ...composite, ...retried].sort((a, b) => SELECT_ORDER.indexOf(a.kind) - SELECT_ORDER.indexOf(b.kind));
}

/**
 * Files a session wrote that were then modified by no session in the batch: the user's own hand is the
 * remaining writer. `mtime(path, session)` answers the file's last-modified time (any `Date.parse`-able
 * value), or null when the path is gone. One signal per session, however many files it lists.
 */
export function handEditSignals(sessions, { mtime } = {}) {
  if (typeof mtime !== "function") return new Map();
  const ordered = sessions.filter((session) => session.writes?.length && Number.isFinite(Date.parse(session.modified))).sort((a, b) => Date.parse(a.modified) - Date.parse(b.modified));
  const found = new Map();
  ordered.forEach((session, at) => {
    const later = ordered.slice(at + 1);
    const edited = session.writes.filter(({ path: file }) => {
      if (later.some((other) => other.writes.some((write) => write.path === file))) return false;
      const stamp = mtime(file, session);
      const when = typeof stamp === "number" ? stamp : Date.parse(stamp);
      return Number.isFinite(when) && when > Date.parse(session.modified);
    });
    if (!edited.length) return;
    found.set(session.key, [
      {
        kind: "user-handedit",
        severity: "medium",
        summary: `the user edited ${edited.length === 1 ? edited[0].path : `${edited.length} files`} after the agent wrote ${edited.length === 1 ? "it" : "them"}`,
        count: edited.length,
        suspects: session.lastOwner ? [session.lastOwner] : [],
        evidence: edited.slice(0, 3).map(({ path: file, message }) => ({ message, tool: null, excerpt: file })),
      },
    ]);
  });
  return found;
}

function frictionRank(session) {
  const friction = (session.signals ?? []).filter((signal) => FRICTION_KINDS.has(signal.kind));
  return friction.length ? Math.min(...friction.map((signal) => SEVERITY_RANK[signal.severity] ?? 3)) : null;
}

const recency = (a, b) => String(b.modified ?? "").localeCompare(String(a.modified ?? ""));

function anchoredChoices(sessions, options) {
  return sessions
    .map((session) => ({ session, anchors: anchorsOf(session, options) }))
    .filter((choice) => choice.anchors.length)
    .sort((a, b) => SELECT_ORDER.indexOf(a.anchors[0].kind) - SELECT_ORDER.indexOf(b.anchors[0].kind) || recency(a.session, b.session));
}

/** One reflection per owning skill; the owner's other sessions become one `Recurring` line. */
function onePerOwner(choices) {
  const byOwner = choices.reduce((groups, choice) => {
    const owner = choice.anchors[0].owner ?? `(no owner) ${choice.session.key}`;
    return { ...groups, [owner]: [...(groups[owner] ?? []), choice] };
  }, {});
  const lead = Object.values(byOwner).map((group) => group[0]);
  const recurring = Object.entries(byOwner)
    .filter(([, group]) => group.length > 1)
    .map(([owner, group]) => ({ owner, sessions: group.map((choice) => choice.session.key), reason: group[0].anchors[0].kind }));
  return { lead: choices.filter((choice) => lead.includes(choice)), recurring };
}

/**
 * The sessions a daily reflection reads, at most `cap`: anchored sessions in `SELECT_ORDER`, one per
 * owning skill, then friction-only sessions in today's order. A session with neither is not read.
 */
export function selectSessions(sessions, { cap = 4, retries = [], validated = new Set() } = {}) {
  const { lead, recurring } = onePerOwner(anchoredChoices(sessions, { retries, validated }));
  const anchored = lead.map(({ session, anchors }) => ({
    session: session.key,
    host: session.host ?? null,
    model: session.model ?? null,
    reason: anchors[0].kind,
    owner: anchors[0].owner,
    anchors,
  }));
  const taken = new Set(lead.map((choice) => choice.session.key));
  const friction = sessions
    .filter((session) => !taken.has(session.key) && frictionRank(session) !== null && frictionRank(session) < SEVERITY_RANK.low)
    .sort((a, b) => frictionRank(a) - frictionRank(b) || recency(a, b))
    .map((session) => ({ session: session.key, host: session.host ?? null, model: session.model ?? null, reason: "friction", owner: null, anchors: [] }));
  return { select: [...anchored, ...friction].slice(0, cap), recurring };
}

function seededOrder(key, date) {
  return [...`${date}|${key}`].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7);
}

/**
 * One interactive session a day with no anchor, for a human label. It is the only way to learn what the
 * anchors miss, and the date seed keeps the pick stable when the collector runs twice in a day.
 */
export function auditPick(sessions, { date, retries = [], validated = new Set(["user-pushback"]) } = {}) {
  const quiet = sessions
    .filter((session) => (session.stats?.userMessages ?? 0) >= 2 && !anchorsOf(session, { retries, validated }).length)
    .sort((a, b) => seededOrder(a.key, date) - seededOrder(b.key, date));
  if (!quiet.length) return null;
  const [pick] = quiet;
  return { session: pick.key, host: pick.host ?? null, model: pick.model ?? null, owner: pick.lastOwner ?? null };
}

/** A scan (scan-session output) as the entry the functions above compare. */
export function entryFromScan(scan) {
  const source = scan.source ?? {};
  return {
    key: `${source.host ?? "?"}:${source.uuid ?? source.id}`,
    id: source.id ?? null,
    host: source.host ?? null,
    model: source.model ?? null,
    modified: source.modified ?? null,
    request: scan.request ?? null,
    signals: scan.signals ?? [],
    stats: scan.stats ?? {},
    lastOwner: scan.lastOwner ?? null,
    writes: scan.writes ?? [],
  };
}

/** Retries, reading order and audit for a batch of scans — what the analysis skill shells out for. */
export function anchorsForScans(scans, { date, cap = 4, validated = new Set() } = {}) {
  const entries = scans.filter((scan) => scan.source?.headless !== true).map(entryFromScan);
  const retries = crossSessionRetries(entries);
  return { retries, ...selectSessions(entries, { cap, retries, validated }), audit: auditPick(entries, { date, retries }) };
}

function argValue(args, flag) {
  const at = args.indexOf(flag);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : null;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write("Usage: node anchors.mjs --input <scans.json> [--date YYYY-MM-DD] [--cap 4]\n");
    return;
  }
  const input = argValue(args, "--input");
  if (!input) {
    process.stderr.write(`${JSON.stringify({ error: "--input <scans.json> is required" })}\n`);
    process.exit(2);
  }
  const scans = JSON.parse(fs.readFileSync(input, "utf8"));
  const date = argValue(args, "--date") ?? new Date().toISOString().slice(0, 10);
  const cap = Number(argValue(args, "--cap") ?? 4) || 4;
  process.stdout.write(`${JSON.stringify(anchorsForScans(scans, { date, cap }), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
