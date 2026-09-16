#!/usr/bin/env node
/**
 * Collect the sessions of the last window, scan each for x-skill friction, and write the evidence
 * pack a reflection run reviews.
 *
 * Sessions come from every AI coding CLI that keeps them on this machine, through the adapters in
 * `skills/x-autoreflection/scripts/hosts/` — the skill's own registry, so the sessions this pack lists
 * and the ones a reflection reads can never drift apart. Sessions are scoped per project directory and
 * per CLI, so discovery walks every detected host and unions what it finds by host and uuid. The scan
 * itself is x-autoreflection's scanner, imported for the same reason.
 *
 * Output: <repo>/.x-skills/daily/<YYYY-MM-DD>/{summary.json,summary.md,sessions/*}
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  HOSTS,
  HOUR_MS,
  defaultRun,
  firstLine,
  hostById,
  hostStatus,
  withinWindow,
} from "../../skills/x-autoreflection/scripts/hosts/index.mjs";
import { normalizeSession, parseArgs } from "../../skills/x-autoreflection/scripts/read-session.mjs";
import { scanSession, skillNamesOnDisk } from "../../skills/x-autoreflection/scripts/scan-session.mjs";
import { timestamp } from "../../skills/x-autoreflection/scripts/save-reflection.mjs";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_HOURS = 24;
export const DEFAULT_PROJECT_LOOKBACK_HOURS = 72;
export const DEFAULT_KEEP_DAYS = 14;
export const DEFAULT_MAX_SESSIONS = 40;
export const DAILY_ROOT = path.join(REPO_ROOT, ".x-skills", "daily");
/** Transcripts are megabytes each, so they live in the temp dir the skill already points at, not in
 * the pack. The name avoids the `x-` prefix on purpose: a directory called `x-something` reads as a
 * skill name to the scanner's mention regex. */
export const TRANSCRIPTS_ROOT = path.join(os.tmpdir(), "xskills-reflection");

const DAY_MS = 86400_000;

export function pad2(value) {
  return String(value).padStart(2, "0");
}

/** The local calendar day, which is the day the user reviews: the run is scheduled at 05:00 local. */
export function dayStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * What an adapter needs to answer: the window, the environment it reads, the runner it shells out
 * with, and the per-host overrides a CLI flag can set (silent when a host has no such option).
 */
export function hostContext({ now = new Date(), hours = DEFAULT_HOURS, projectLookbackHours = DEFAULT_PROJECT_LOOKBACK_HOURS, env = process.env, run = null, hostOptions = {} } = {}) {
  return { now, hours, projectLookbackHours, env, run: run ?? defaultRun(env), hostOptions };
}

/**
 * Union every detected host into one session list, newest first. A host is asked once and reports its
 * own warnings; the window rule is applied here, so every CLI is judged by the same cutoff. Sessions
 * are keyed by host and uuid: the same uuid under two CLIs is two sessions, not a duplicate.
 */
export function discoverSessions({ hosts = HOSTS, ctx, only = null }) {
  const warnings = [];
  const statuses = [];
  const found = new Map();

  for (const host of hosts) {
    if (only && !only.has(host.id)) continue;
    const status = hostStatus(host, ctx);
    const row = { id: host.id, label: host.label, store: host.store, status, sessions: 0 };
    statuses.push(row);
    if (status !== "ok") continue;

    let listed;
    try {
      listed = host.list(ctx);
    } catch (err) {
      row.status = "unreadable";
      warnings.push({ scope: host.id, reason: `${host.id} could not list sessions: ${firstLine(err.message)}` });
      continue;
    }
    for (const warning of listed.warnings ?? []) warnings.push(warning);
    const fresh = withinWindow(listed.sessions, { hours: ctx.hours, now: ctx.now });
    for (const session of fresh) {
      const key = `${host.id}:${session.uuid ?? session.id}`;
      if (!found.has(key)) found.set(key, { ...session, host: host.id });
    }
    row.sessions = fresh.length;
  }

  const sessions = [...found.values()].sort((a, b) => b.modifiedMs - a.modifiedMs);
  return { sessions, statuses, warnings };
}

/** Keep the newest `limit` sessions of the window; 0 means no cap. */
export function capSessions(sessions, limit) {
  if (limit > 0 && sessions.length > limit) return { chosen: sessions.slice(0, limit), dropped: sessions.length - limit };
  return { chosen: sessions, dropped: 0 };
}

function sessionFilePath(session, suffix) {
  const id = String(session.uuid ?? session.id).replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${id}.${suffix}.json`;
}

/** Read and scan one session. The transcript is clipped exactly as the skill clips it. */
export function scanOne({ session, adapter, ctx, skills, clip = 600 }) {
  const transcript = normalizeSession(adapter.read(session, ctx), { limit: clip });
  const scan = scanSession(transcript, { skillNames: skills.names, skillsSource: skills.dir });
  return { session, transcript, scan };
}

export function scanSessions({ sessions, adapters, ctx, skills, dirs, clip }) {
  const results = [];
  const warnings = [];
  for (const session of sessions) {
    try {
      const adapter = adapters.get(session.host);
      if (!adapter) throw new Error(`no adapter for host "${session.host}"`);
      const { transcript, scan } = scanOne({ session, adapter, ctx, skills, clip });
      let transcriptPath = null;
      let scanPath = null;
      if (dirs.write) {
        transcriptPath = path.join(dirs.transcripts, sessionFilePath(session, "transcript"));
        scanPath = path.join(dirs.sessions, sessionFilePath(session, "signals"));
        fs.writeFileSync(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`);
        fs.writeFileSync(scanPath, `${JSON.stringify(scan, null, 2)}\n`);
      }
      results.push({ session, scan, transcriptPath, scanPath });
    } catch (err) {
      warnings.push({ scope: `${session.host}:${session.id}`, reason: `read failed: ${firstLine(err.message)}` });
    }
  }
  return { results, warnings };
}

function usageRow(name) {
  return { name, sessions: 0, loaded: 0, used: 0, unused: 0, high: 0, medium: 0, low: 0 };
}

function seedRows(skillNames) {
  return new Map(skillNames.map((name) => [name, usageRow(name)]));
}

function rowFor(rows, name) {
  if (!rows.has(name)) rows.set(name, usageRow(name));
  return rows.get(name);
}

/** Loaded/used lists of one scan: a skill counts in the session it was loaded or mentioned in. */
function accumulateSkills(rows, scan) {
  const loaded = new Set(scan.skills?.loaded ?? []);
  const used = new Set(scan.skills?.used ?? []);
  for (const name of new Set([...loaded, ...used])) {
    const entry = rowFor(rows, name);
    entry.sessions++;
    if (loaded.has(name)) entry.loaded++;
    if (used.has(name)) entry.used++;
    if (loaded.has(name) && !used.has(name)) entry.unused++;
  }
}

/** Signal suspects are attributed to the skill each signal blames, not to the session. */
function accumulateSignals(rows, scan) {
  for (const signal of scan.signals ?? []) {
    for (const suspect of signal.suspects ?? []) {
      const entry = rowFor(rows, suspect);
      if (entry[signal.severity] !== undefined) entry[signal.severity]++;
    }
  }
}

/** Busiest first, then the ones a signal blames, then alphabetical. */
function byActivity(a, b) {
  return b.sessions - a.sessions || b.high - a.high || a.name.localeCompare(b.name);
}

/**
 * `idle` collects the skills the window never touched. A skill can be named by a signal without being
 * loaded (a failing command mentions it), and showing it with 0 sessions and its signal count is the
 * difference between "never used" and "blamed anyway".
 */
function partitionRows(rows) {
  const active = (entry) => entry.sessions > 0 || entry.high + entry.medium + entry.low > 0;
  const sorted = [...rows.values()].sort(byActivity);
  return { touched: sorted.filter(active), idle: sorted.filter((entry) => !active(entry)).map((entry) => entry.name) };
}

/** Per-skill usage across the window, from the scan's own loaded/used/unused lists. */
export function buildSkillUsage({ scans, skillNames = [] }) {
  const rows = seedRows(skillNames);
  for (const scan of scans) {
    accumulateSkills(rows, scan);
    accumulateSignals(rows, scan);
  }
  return partitionRows(rows);
}

export function buildSignals(results) {
  const rank = { high: 0, medium: 1, low: 2 };
  return results
    .flatMap(({ session, scan }) =>
      (scan.signals ?? []).map((signal) => ({
        ...signal,
        session: session.id,
        sessionTitle: session.title ?? null,
        project: session.project ?? null,
      }))
    )
    .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || b.count - a.count);
}

export function buildSummary({ results, window, hostStatuses = [], warnings, skillUsage, dirs, generatedAt, dropped = 0, failed = 0, notes = [] }) {
  const sessions = results.map(({ session, scan, transcriptPath, scanPath }) => ({
    id: session.id,
    host: session.host ?? null,
    uuid: session.uuid ?? null,
    title: session.title ?? null,
    project: session.project ?? null,
    modified: session.modified ?? null,
    transcript: transcriptPath,
    scan: scanPath ? path.relative(REPO_ROOT, scanPath) : null,
    stats: scan.stats,
    skills: scan.skills,
    runFolders: scan.runFolders ?? [],
    artifacts: scan.artifacts ?? [],
  }));

  const signals = buildSignals(results).map((signal) => ({
    id: signal.id,
    kind: signal.kind,
    severity: signal.severity,
    summary: signal.summary,
    count: signal.count,
    suspects: signal.suspects ?? [],
    session: signal.session,
    sessionTitle: signal.sessionTitle,
    evidence: signal.evidence ?? [],
  }));

  return {
    generatedAt: timestamp(generatedAt),
    window: { hours: window.hours, since: new Date(window.since).toISOString(), until: new Date(window.until).toISOString() },
    pack: path.relative(REPO_ROOT, dirs.out),
    transcripts: dirs.write ? dirs.transcripts : null,
    hosts: hostStatuses,
    counts: {
      discovered: results.length + dropped + failed,
      scanned: results.length,
      dropped,
      failed,
      hosts: hostStatuses.filter((entry) => entry.sessions > 0).length,
      touchedSkills: sessions.filter((session) => session.skills.loaded.length || session.skills.used.length).length,
      toolCalls: sessions.reduce((sum, session) => sum + (session.stats.toolCalls ?? 0), 0),
      toolFailures: sessions.reduce((sum, session) => sum + (session.stats.toolFailures ?? 0), 0),
      corrections: sessions.reduce((sum, session) => sum + (session.stats.corrections ?? 0), 0),
      highSignals: signals.filter((signal) => signal.severity === "high").length,
    },
    skills: skillUsage,
    sessions,
    signals,
    runFolders: [...new Set(results.flatMap(({ scan }) => scan.runFolders ?? []))].sort(),
    artifacts: [...new Set(results.flatMap(({ scan }) => scan.artifacts ?? []))].sort(),
    warnings,
    notes,
  };
}

/** A session title is user text and landed in a table cell: collapse whitespace, escape pipes, clip. */
export function cell(value, limit = 70) {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim();
  const clipped = flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
  return clipped.replace(/\|/g, "\\|") || "untitled";
}

function table(headers, rows) {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `|${headers.map(() => "---").join("|")}|`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

function renderHeader(summary) {
  return [
    `# x-skills daily scan — ${path.basename(summary.pack)}`,
    "",
    `**Window:** last ${summary.window.hours}h (${summary.window.since} → ${summary.window.until}) · ` +
      `**Sessions:** ${summary.counts.scanned} · **Hosts:** ${summary.counts.hosts} · ` +
      `**High signals:** ${summary.counts.highSignals}`,
    `**Generated:** ${summary.generatedAt} · **Pack:** \`${summary.pack}/\``,
    summary.transcripts ? `**Transcripts (temp):** \`${summary.transcripts}/\`` : "",
    "",
    "## Sessions",
    "",
  ];
}

/** Which CLIs were looked at, including the ones with nothing in the window. */
function renderHosts({ hosts }) {
  if (!hosts.length) return [];
  return [
    "",
    "## Hosts",
    "",
    table(
      ["Host", "Status", "Sessions", "Store"],
      hosts.map((host) => [`\`${host.id}\``, host.status, host.sessions, cell(host.store, 90)])
    ),
  ];
}

function renderSessions(summary) {
  return [
    table(
      ["Host", "Session", "Modified", "Tools", "Failures", "Corrected", "Skills loaded", "High"],
      summary.sessions.map((session) => [
        session.host ?? "?",
        `${cell(session.title)} (\`${session.id}\`)`,
        session.modified ?? "?",
        session.stats.toolCalls ?? 0,
        session.stats.toolFailures ?? 0,
        session.stats.corrections ?? 0,
        session.skills.loaded.length ? session.skills.loaded.join(", ") : "—",
        summary.signals.filter((signal) => signal.session === session.id && signal.severity === "high").length,
      ])
    ),
  ];
}

function renderUsage({ skills }) {
  const lines = ["", "## x-skills usage", ""];
  if (!skills.touched.length) {
    lines.push("No session loaded or mentioned an x-skill in this window.");
  } else {
    lines.push(
      table(
        ["Skill", "Sessions", "Loaded", "Used", "Loaded unused", "Signals h/m/l"],
        skills.touched.map((entry) => [
          `\`${entry.name}\``,
          entry.sessions,
          entry.loaded,
          entry.used,
          entry.unused,
          `${entry.high}/${entry.medium}/${entry.low}`,
        ])
      )
    );
  }
  if (skills.idle.length) {
    lines.push("", `Never loaded or mentioned: ${skills.idle.map((name) => `\`${name}\``).join(", ")}`);
  }
  return lines;
}

function renderArtifacts({ runFolders, artifacts }) {
  if (!runFolders.length && !artifacts.length) return [];
  const lines = ["", "## Run artifacts", ""];
  if (runFolders.length) lines.push(`- Run folders: ${runFolders.map((folder) => `\`${folder}\``).join(", ")}`);
  if (artifacts.length) lines.push(`- Artifacts: ${artifacts.map((artifact) => `\`${artifact}\``).join(", ")}`);
  return lines;
}

function renderSignals({ signals }) {
  const lines = ["", "## Signals to verify", ""];
  if (!signals.length) return [...lines, "No friction signals in this window."];
  for (const signal of signals) {
    const suspect = signal.suspects.length ? signal.suspects.join(", ") : "no skill named";
    const evidence = signal.evidence[0] ? ` — msg ${signal.evidence[0].message}: "${signal.evidence[0].excerpt}"` : "";
    lines.push(
      `- **${signal.severity}** \`${signal.id}\` ${signal.kind} (${suspect}) in \`${signal.session}\` ×${signal.count}: ${signal.summary}${evidence}`
    );
  }
  return lines;
}

function renderBullets(heading, rows) {
  if (!rows.length) return [];
  return ["", `## ${heading}`, "", ...rows.map((row) => `- ${row}`)];
}

export function renderSummaryMarkdown(summary) {
  return `${[
    ...renderHeader(summary),
    ...renderSessions(summary),
    ...renderHosts(summary),
    ...renderUsage(summary),
    ...renderArtifacts(summary),
    ...renderSignals(summary),
    ...renderBullets("Warnings", summary.warnings.map((warning) => `${warning.scope}: ${warning.reason}`)),
    ...renderBullets("Notes", summary.notes),
  ].join("\n")}\n`;
}

/**
 * A pack is labelled with a day and stays until that whole day has left the window, which is why the
 * comparison uses the day's last second rather than its first: today's pack is never pruned mid-run.
 */
function isExpiredPack(name, cutoff) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return false;
  const endOfDay = Date.parse(`${name}T23:59:59`);
  return Number.isFinite(endOfDay) && endOfDay < cutoff;
}

/** Keep the daily folders bounded; the pack is evidence for review, not an archive. */
export function pruneDaily(root, { keepDays = DEFAULT_KEEP_DAYS, now = new Date() } = {}) {
  if (!(keepDays > 0) || !fs.existsSync(root)) return [];
  const cutoff = now.getTime() - keepDays * DAY_MS;
  const removed = [];
  for (const name of fs.readdirSync(root)) {
    if (!isExpiredPack(name, cutoff)) continue;
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

export function collect({ ctx, only, adapters, skills, dirs, maxSessions: max, clip }) {
  const found = discoverSessions({ hosts: [...adapters.values()], ctx, only });
  const { chosen, dropped } = capSessions(found.sessions, max);
  const scanned = scanSessions({ sessions: chosen, adapters, ctx, skills, dirs, clip });
  const skillUsage = buildSkillUsage({ scans: scanned.results.map(({ scan }) => scan), skillNames: skills.names });
  const notes = [];
  if (dropped) notes.push(`${dropped} older session(s) inside the window were not scanned (--max-sessions ${max})`);

  const summary = buildSummary({
    results: scanned.results,
    window: { hours: ctx.hours, since: ctx.now.getTime() - ctx.hours * HOUR_MS, until: ctx.now },
    hostStatuses: found.statuses,
    warnings: [...found.warnings, ...scanned.warnings],
    skillUsage,
    dirs,
    generatedAt: ctx.now,
    dropped,
    failed: scanned.warnings.length,
    notes,
  });
  return { summary, results: scanned.results };
}

/**
 * One table for every flag, so `--help` and the parser cannot drift apart. A flag without `arg` is a
 * switch and never consumes the next argument.
 */
const FLAGS = [
  { flag: "hours", arg: "<n>", help: "Session window (default: 24)" },
  { flag: "host", arg: "<ids>", help: `Comma-separated hosts to read (default: every detected host; known: ${HOSTS.map((host) => host.id).join(", ")})` },
  { flag: "project-lookback-hours", arg: "<n>", help: "How far back a project counts as active (Crush only, default: 72)" },
  { flag: "projects-file", arg: "<path>", help: "Crush projects.json (Crush only, default: <crush data dir>/projects.json)" },
  { flag: "out", arg: "<dir>", help: "Pack directory (default: <repo>/.x-skills/daily/<date>)" },
  { flag: "skills-dir", arg: "<dir>", help: "Skill directories to attribute signals to (default: <repo>/skills)" },
  { flag: "clip", arg: "<n>", help: "Characters kept per transcript part (default: 600, 0 = all)" },
  { flag: "max-sessions", arg: "<n>", help: "Cap the scan (default: 40, 0 = no cap)" },
  { flag: "keep-days", arg: "<n>", help: "Days of packs to keep (default: 14, 0 = never prune)" },
  { flag: "check", help: "Probe only: write nothing; exit 1 = no x-skill, 3 = no host could be read" },
  { flag: "no-prune", help: "Skip pruning old packs" },
  { flag: "json", help: "Print summary.json instead of the human line" },
  { flag: "help", help: "Show this help" },
];

const FLAG_NAMES = FLAGS.map((entry) => entry.flag);
const FLAG_SWITCHES = FLAGS.filter((entry) => !entry.arg).map((entry) => entry.flag);

function usage() {
  return [
    "x-skills daily reflection — collect last window's sessions and scan them for x-skill friction.",
    "",
    "Usage:",
    "  node collect-sessions.mjs [--hours 24] [--out <dir>] [--check]",
    "",
    "Flags:",
    ...FLAGS.map((entry) => `  --${entry.flag}${entry.arg ? ` ${entry.arg}` : ""} `.padEnd(30) + entry.help),
    "",
  ].join("\n");
}

function numberFrom(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The values a run needs, parsed and validated once. Throws on an unknown flag or host. */
export function readOptions(argv, { now = new Date() } = {}) {
  const args = parseArgs(argv, { booleans: FLAG_SWITCHES, known: FLAG_NAMES });
  if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
  const hostIds = args.host ? String(args.host).split(",").map((id) => id.trim()).filter(Boolean) : null;
  for (const id of hostIds ?? []) {
    if (!hostById(id)) throw new Error(`Unknown host "${id}"; known hosts: ${HOSTS.map((host) => host.id).join(", ")}`);
  }
  return {
    now,
    hours: numberFrom(args.hours, DEFAULT_HOURS),
    check: args.check === true,
    json: args.json === true,
    prune: args["no-prune"] !== true,
    keepDays: numberFrom(args["keep-days"], DEFAULT_KEEP_DAYS),
    out: path.resolve(args.out || path.join(DAILY_ROOT, dayStamp(now))),
    skillsDir: args["skills-dir"] || path.join(REPO_ROOT, "skills"),
    hostIds,
    projectLookbackHours: numberFrom(args["project-lookback-hours"], DEFAULT_PROJECT_LOOKBACK_HOURS),
    maxSessions: numberFrom(args["max-sessions"], DEFAULT_MAX_SESSIONS),
    clip: args.clip === undefined ? 600 : numberFrom(args.clip, 600),
    // Options only one CLI can honour stay keyed by host id, so the shared context stays host-neutral.
    hostOptions: { crush: { projectsFile: args["projects-file"] || null } },
  };
}

/** A probe run writes nothing, so its directories are only created when the run writes. */
function prepareDirs({ out, now, write }) {
  const dirs = {
    out,
    sessions: path.join(out, "sessions"),
    transcripts: path.join(TRANSCRIPTS_ROOT, dayStamp(now)),
    write,
  };
  if (write) {
    fs.mkdirSync(dirs.sessions, { recursive: true });
    fs.mkdirSync(dirs.transcripts, { recursive: true });
  }
  return dirs;
}

/**
 * Probe mode. A quiet window and a broken one must not look the same, or the scheduler skips forever
 * on a machine where nothing is readable: exit 0 when an x-skill was used, 1 when the window was
 * simply empty, 3 when no host could be read at all or a read failed, with the host table as evidence.
 */
function reportCheck(summary, { hours }) {
  const touched = summary.counts.touchedSkills;
  if (touched) {
    process.stdout.write(
      `${JSON.stringify({ check: "ok", sessions: summary.counts.scanned, touchedSkills: touched, highSignals: summary.counts.highSignals })}\n`
    );
    return 0;
  }
  const readable = summary.hosts.filter((host) => host.status === "ok");
  if (!readable.length || summary.warnings.length) {
    process.stderr.write(
      `${JSON.stringify({
        check: "collection-failed",
        sessions: summary.counts.scanned,
        hours,
        hosts: summary.hosts.map(({ id, status, sessions }) => ({ id, status, sessions })),
        warnings: summary.warnings,
      })}\n`
    );
    return 3;
  }
  process.stderr.write(`${JSON.stringify({ check: "no-x-skill-usage", sessions: summary.counts.scanned, hours })}\n`);
  return 1;
}

function writePack(summary, { out, keepDays, prune, now }) {
  summary.pruned = prune ? pruneDaily(DAILY_ROOT, { keepDays, now }) : [];
  if (prune) pruneDaily(TRANSCRIPTS_ROOT, { keepDays, now });
  fs.writeFileSync(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "summary.md"), renderSummaryMarkdown(summary));
}

function reportRun(summary, { out, json }) {
  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      pack: summary.pack,
      summary: path.relative(REPO_ROOT, path.join(out, "summary.json")),
      sessions: summary.counts.scanned,
      hosts: summary.hosts.map(({ id, status, sessions }) => ({ id, status, sessions })),
      touchedSkills: summary.counts.touchedSkills,
      highSignals: summary.counts.highSignals,
      warnings: summary.warnings.length,
    })}\n`
  );
}

/** Collect the pack and hand it to a reporter. Returns the process exit code. */
export function run(options) {
  const skills = skillNamesOnDisk(options.skillsDir);
  if (!skills.names.length) throw new Error(`no x-* skills found in ${skills.dir ?? "skills/"}`);

  const { summary } = collect({
    ctx: hostContext({
      now: options.now,
      hours: options.hours,
      projectLookbackHours: options.projectLookbackHours,
      env: options.env,
      run: options.run,
      hostOptions: options.hostOptions,
    }),
    only: options.hostIds ? new Set(options.hostIds) : null,
    adapters: new Map(HOSTS.map((host) => [host.id, host])),
    skills,
    dirs: prepareDirs({ out: options.out, now: options.now, write: !options.check }),
    maxSessions: options.maxSessions,
    clip: options.clip,
  });

  if (options.check) return reportCheck(summary, options);
  writePack(summary, options);
  reportRun(summary, options);
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  try {
    // Help wins over validation so `--help` still prints usage beside a typo.
    if (argv.includes("--help")) {
      process.stdout.write(usage());
      return 0;
    }
    return run(readOptions(argv));
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  // exitCode rather than process.exit: a large --json payload must flush before the process ends.
  process.exitCode = main();
}
