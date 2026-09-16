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
import { goose } from "./goose.mjs";
import { claude } from "./claude.mjs";
import { gemini } from "./gemini.mjs";
import { qwen } from "./qwen.mjs";
import { cursor } from "./cursor.mjs";
import { copilot } from "./copilot.mjs";
import { cline, kilo, roo } from "./cline.mjs";

export {
  defaultRun,
  findFiles,
  firstLine,
  HOUR_MS,
  homeDir,
  withModifiedMs,
  withinWindow,
} from "./shared.mjs";

/** Every CLI this skill knows how to read, most-installed first. */
export const HOSTS = [opencode, claude, codex, gemini, cursor, cline, goose, crush, qwen, kilo, roo, copilot];

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
