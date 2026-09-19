#!/usr/bin/env node
/**
 * Crush — sessions are scoped to the directory the CLI ran in, so the store is a project list, not a
 * session list. `projects.json` names every directory it has run in; each one has to be asked
 * separately, and the same session can appear under two projects after a move.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  store: "`crush session list|show --json`, one call per project in <crush data dir>/projects.json",
  file: projectsFile,

  detect(ctx) {
    return fs.existsSync(fileFor(ctx));
  },

  list(ctx) {
    const { run } = ctx;
    const warnings = [];
    const sessions = [];
    for (const project of recentProjects(readProjects(fileFor(ctx)), { hours: ctx.projectLookbackHours, now: ctx.now })) {
      let listed;
      try {
        listed = JSON.parse(run("crush", ["session", "list", "--json"], { cwd: project.path }));
      } catch (err) {
        warnings.push({ scope: project.path, reason: `crush session list failed: ${firstLine(err.message)}` });
        continue;
      }
      for (const session of Array.isArray(listed) ? listed : []) sessions.push({ ...session, project: project.path });
    }
    return { sessions, warnings };
  },

  read(session, { run }) {
    const raw = JSON.parse(run("crush", ["session", "show", String(session.id), "--json"], { cwd: session.project }));
    return { ...raw, meta: { ...raw.meta, host: "crush" } };
  },
};
