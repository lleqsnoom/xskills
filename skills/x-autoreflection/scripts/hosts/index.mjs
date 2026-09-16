#!/usr/bin/env node
/**
 * Host adapters — one per AI coding CLI, so reading a session is not tied to Crush.
 *
 * An adapter is an object with four jobs:
 *   id, label, store     identity, for `--host` and the summary
 *   detect(ctx)          true when that CLI keeps sessions on this machine
 *   list(ctx)            -> { sessions, warnings } — sessions of the window, any order
 *   read(session, ctx)   -> { meta, messages } — the raw transcript normalizeSession() clips
 *
 * `ctx` is { now, hours, projectLookbackHours, env, run }. `run(command, args, { cwd })` returns stdout
 * and throws when the command fails, so an adapter is only ever a mapping from a CLI's own output to
 * the normalized shape, and a test can drive one by stubbing `run` alone.
 */
import { crush } from "./crush.mjs";
import { codex } from "./codex.mjs";
import { opencode } from "./opencode.mjs";

export { defaultRun, findFiles, firstLine, HOUR_MS, homeDir, withinWindow } from "./shared.mjs";

export const HOSTS = [crush, codex, opencode];

export function hostById(id) {
  return HOSTS.find((host) => host.id === id) ?? null;
}

/**
 * `ok` when the CLI keeps sessions on this machine, `absent` when it does not, `unreadable` when
 * asking failed. Reporting `absent` rather than staying silent is the point: a window with nothing
 * in it should say which stores were looked at.
 */
export function hostStatus(host, ctx) {
  try {
    return host.detect(ctx) ? "ok" : "absent";
  } catch {
    return "unreadable";
  }
}
