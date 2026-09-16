#!/usr/bin/env node
/**
 * Helpers every host adapter shares. They live apart from `index.mjs` on purpose: the registry
 * imports the adapters, so an adapter importing the registry back would be a cycle.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const HOUR_MS = 3600_000;

export function homeDir(env = process.env) {
  return env.HOME || os.homedir();
}

/** A CLI's error text arrives wrapped in its stack; the first line is the part worth reporting. */
export function firstLine(value, limit = 200) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, limit) ?? "unknown error";
}

/** The default command runner: stdout as text, and a non-zero exit throws. */
export function defaultRun(env = process.env) {
  return (command, args = [], { cwd = null } = {}) =>
    execFileSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}

/** Every listed session, with the timestamp the sort uses. An unreadable one counts as the epoch. */
export function withModifiedMs(sessions) {
  return (Array.isArray(sessions) ? sessions : []).map((session) => ({
    ...session,
    modifiedMs: Date.parse(session?.modified ?? "") || 0,
  }));
}

/**
 * The window rule, applied once for every host in the listing paths: a session with an unreadable
 * timestamp is dropped rather than counted, because guessing "recent" would scan last month's work
 * every day. Reading one session by id deliberately does not go through here.
 */
export function withinWindow(sessions, { hours, now }) {
  const cutoff = now.getTime() - hours * HOUR_MS;
  return withModifiedMs(sessions).filter(
    (session) => Number.isFinite(Date.parse(session?.modified ?? "")) && session.modifiedMs >= cutoff
  );
}

function readEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function matchesSuffix(name, suffixes) {
  return suffixes.some((suffix) => name.endsWith(suffix));
}

function walkFiles(dir, level, { suffixes, depth }, found) {
  for (const entry of readEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) {
      if (matchesSuffix(entry.name, suffixes)) found.push(full);
    } else if (level < depth) {
      walkFiles(full, level + 1, { suffixes, depth }, found);
    }
  }
}

/**
 * What a host says when its listing came back empty. The two cases must read differently: a store that
 * is not there is a CLI this machine does not use, while a store with nothing that matches its layout
 * is a format this adapter no longer understands — and that one is a bug report, not a quiet day.
 */
export function emptyListWarning(scope, what) {
  return fs.existsSync(scope)
    ? { scope, reason: `the store is there but no ${what} matched its layout` }
    : { scope, reason: `no store at ${scope}` };
}

/** Files under `root` whose name ends with one of `suffixes`, walking at most `depth` levels down. */
export function findFiles(root, { suffixes = [".jsonl"], depth = 4 } = {}) {
  const found = [];
  walkFiles(root, 0, { suffixes, depth }, found);
  return found;
}

/** Direct children of `dir`, as `{name, path, isDirectory}`; [] when the directory cannot be read. */
export function readDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.map((entry) => ({ name: entry.name, path: path.join(dir, entry.name), isDirectory: entry.isDirectory() }));
}

/**
 * A JSONL transcript as records. A line that does not parse is skipped: a session being written right
 * now ends mid-line, and the records before it are still good.
 */
export function readJsonl(file) {
  const records = [];
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return records;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {}
  }
  return records;
}

/**
 * The first complete records of a JSONL file, without reading all of it. Listing needs a session's id,
 * cwd and title, and a transcript can be megabytes; the last line of the chunk may be cut, so it stops
 * at the first line that does not parse.
 */
export function readHead(file, { bytes = 64 * 1024, maxLines = 40 } = {}) {
  const records = [];
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    for (const line of buffer.subarray(0, read).toString("utf8").split("\n").slice(0, maxLines)) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        break;
      }
    }
  } catch {
    return records;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return records;
}

/** Host text arrives as a string, as `{text}`, or as a list of either; flatten it to one string. */export function textOf(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (typeof value === "string") return value;
  if (typeof value.text === "string") return value.text;
  return JSON.stringify(value);
}

/**
 * Anthropic-shaped turns, the shape Claude Code, Cursor and Cline all store. Each host wraps it
 * differently — Claude Code writes `{type, message:{role, content}}` lines, Cursor writes
 * `{role, message:{content}}` lines, Cline writes bare `{role, content}` entries — so `pick` says which
 * of an entry's fields are the turn, and returns null for an entry that is not one.
 */
export function anthropicMessages(entries, pick) {
  const callNames = new Map();
  const messages = [];
  for (const entry of entries) {
    const turn = pick(entry);
    if (!turn) continue;
    const parts = anthropicParts(turn.content, callNames);
    if (parts.length) messages.push({ role: turn.role ?? "assistant", created: turn.created ?? null, parts });
  }
  return messages;
}

/**
 * Anthropic-shaped content blocks, which Claude Code, Cursor and Cline all store: a string, or a list
 * of `text`, `thinking`, `tool_use` and `tool_result` blocks. The tool name is remembered so a result
 * can be attributed to the tool that produced it.
 */
export function anthropicParts(content, callNames = new Map()) {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const parts = [];
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === "text") {
      if (block.text) parts.push({ type: "text", text: String(block.text) });
    } else if (block?.type === "thinking") {
      parts.push({ type: "reasoning", thinking: String(block.thinking ?? "") });
    } else if (block?.type === "tool_use") {
      callNames.set(block.id, block.name ?? null);
      parts.push({ type: "tool_call", tool_call_id: block.id ?? null, name: block.name ?? "?", input: JSON.stringify(block.input ?? {}) });
    } else if (block?.type === "tool_result") {
      parts.push({
        type: "tool_result",
        tool_call_id: block.tool_use_id ?? null,
        name: callNames.get(block.tool_use_id) ?? null,
        content: textOf(block.content),
      });
    }
  }
  return parts;
}
