#!/usr/bin/env node
/**
 * Crush — sessions are scoped to the directory the CLI ran in, so the store is a project list, not a
 * session list. `projects.json` names every directory it has run in; each one has to be asked
 * separately, and the same session can appear under two projects after a move. Each project is also
 * asked for the child sessions its own `session list` never reports.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { HOUR_MS, firstLine } from "./shared.mjs";

const DEFAULT_PROJECT_LOOKBACK_HOURS = 72;

/**
 * Where the daily collection runs its turn classifier through `crush run`. Crush registers every
 * directory it runs in as a project, so without this the classifier's own runs — prompts full of other
 * sessions' user turns — would be scanned the next morning as if a person had typed them.
 */
export const TURN_CLASSIFIER_DIR = path.join(".x-skills", "turn-classifier");

export function isTurnClassifierDir(dir) {
  return path.normalize(String(dir ?? "")).endsWith(path.sep + TURN_CLASSIFIER_DIR);
}

/** The store a project keeps for itself, beside the directory Crush ran in: transcripts live here. */
export function projectStore(projectPath) {
  return path.join(projectPath, ".crush", "crush.db");
}

/**
 * A child session's timestamps are Unix seconds in a column the schema itself calls milliseconds, so a
 * value large enough to be milliseconds is read as one rather than dropped as ancient history.
 */
function isoStamp(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return null;
  return new Date(value > 1e11 ? value : value * 1000).toISOString();
}

/** `node:sqlite` is built into Node, so this stays a zero-dependency skill. */
function openStore(file) {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  return new DatabaseSync(file, { readOnly: true });
}

/**
 * The sessions behind `agent` calls and worker runs. `crush session list` cannot report them: its own
 * query is `WHERE parent_session_id is NULL`, and no flag or command lifts that. Yet they are close to
 * half the transcripts on a machine that delegates, and a sub-agent is exactly where a handed-off skill
 * does its work. They stay readable through `crush session show`, so their ids are read from the
 * project's own store. A store that is absent, or a Node too old for `node:sqlite`, costs the children
 * and nothing else: the CLI's own answer still stands, and the warning says what was missed.
 */
export function childSessions(projectPath, { dbFile = projectStore(projectPath), open = openStore } = {}) {
  if (!fs.existsSync(dbFile)) return { sessions: [], warning: null };
  let store = null;
  try {
    const rows = (store = open(dbFile))
      .prepare("SELECT id, title, created_at, updated_at FROM sessions WHERE parent_session_id IS NOT NULL ORDER BY updated_at DESC")
      .all();
    return {
      sessions: rows.map((row) => ({
        id: String(row.id),
        uuid: String(row.id),
        title: row.title === null || row.title === undefined ? null : String(row.title),
        created: isoStamp(row.created_at),
        modified: isoStamp(row.updated_at),
        project: projectPath,
        child: true,
      })),
      warning: null,
    };
  } catch (err) {
    return { sessions: [], warning: { scope: projectPath, reason: `child sessions unreadable: ${firstLine(err.message)}` } };
  } finally {
    try {
      store?.close();
    } catch {}
  }
}

export function crushDataDir(env = process.env) {
  if (env.CRUSH_DATA_HOME) return env.CRUSH_DATA_HOME;
  const share = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(share, "crush");
}

/** Crush records every directory it has run in here, newest first. */
export function projectsFile(env = process.env) {
  return path.join(crushDataDir(env), "projects.json");
}

export function readProjects(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed?.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

/**
 * Projects whose directory still exists, newest first. A project with an unreadable `last_accessed`
 * is kept rather than dropped, unlike a session with an unreadable timestamp: the lookback only
 * widens the search, and the session window is what decides which sessions are scanned.
 */
export function recentProjects(projects, { hours = DEFAULT_PROJECT_LOOKBACK_HOURS, now = new Date() } = {}) {
  const cutoff = now.getTime() - hours * HOUR_MS;
  const accessedMs = (project) => Date.parse(project.last_accessed ?? "") || 0;
  const withinLookback = (project) => {
    const seen = Date.parse(project.last_accessed ?? "");
    return Number.isFinite(seen) ? seen >= cutoff : true;
  };

  return (Array.isArray(projects) ? projects : [])
    .filter((project) => typeof project?.path === "string" && !isTurnClassifierDir(project.path) && withinLookback(project) && fs.existsSync(project.path))
    .sort((a, b) => accessedMs(b) - accessedMs(a));
}

/** The project list in use: `--projects-file` wins, so a fixture can stand in for the real store. */
function fileFor(ctx) {
  return ctx.hostOptions?.crush?.projectsFile || projectsFile(ctx.env);
}

export const crush = {
  id: "crush",
  label: "Crush",
  store: "`crush session list|show --json` per project in <crush data dir>/projects.json, plus the child sessions only each project's own `.crush/crush.db` records",
  file: projectsFile,

  detect(ctx) {
    return fs.existsSync(fileFor(ctx));
  },

  list(ctx) {
    const { run } = ctx;
    const warnings = [];
    const sessions = [];
    for (const project of recentProjects(readProjects(fileFor(ctx)), { hours: ctx.projectLookbackHours, now: ctx.now })) {
      try {
        const listed = JSON.parse(run("crush", ["session", "list", "--json"], { cwd: project.path }));
        for (const session of Array.isArray(listed) ? listed : []) sessions.push({ ...session, project: project.path });
      } catch (err) {
        // One project failing to list is not the next project's problem: a store that cannot be listed
        // can still hand over its children.
        warnings.push({ scope: project.path, reason: `crush session list failed: ${firstLine(err.message)}` });
      }
      const children = childSessions(project.path);
      if (children.warning) warnings.push(children.warning);
      sessions.push(...children.sessions);
    }
    return { sessions, warnings };
  },

  read(session, { run }) {
    const raw = JSON.parse(run("crush", ["session", "show", String(session.id), "--json"], { cwd: session.project }));
    // A child session's "user" turns are a sub-agent prompt, not a person typing, so it is marked
    // headless: turn classification leaves it alone, and the scan still reads what it did.
    const child = session.child ? { headless: true } : {};
    return { ...raw, meta: { ...raw.meta, host: "crush", ...child } };
  },
};
