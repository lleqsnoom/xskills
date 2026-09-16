#!/usr/bin/env node
/**
 * Goose — one SQLite store (`sessions/sessions.db`) under the Goose data dir, with a row per session
 * and a row per message. A message's blocks live in `content_json`, as JSON text.
 *
 * The schema below is the one this adapter was built against:
 *   sessions (id, name, working_dir, created_at, updated_at, archived_at, …)
 *   messages (id, message_id, session_id, role, content_json, created_timestamp, timestamp, …)
 *   content_json = [ {"type":"text","text"} | {"type":"thinking","thinking"}
 *                  | {"type":"toolRequest","id","toolCall":{"value":{"name","arguments"}}}
 *                  | {"type":"toolResponse","id","toolResult":{"value":{"content":[{"type":"text","text"}]}}}
 *                  | {"type":"systemNotification",…} ]
 *
 * Both TEXT timestamps are UTC, which matters: a 24h window read as local time is off by the offset.
 * `created_timestamp` is the same instant as Unix seconds, and is what the adapter trusts.
 */
import path from "node:path";
import { homeDir } from "./shared.mjs";
import { columnsOf, openReadOnly, tablesOf } from "./sqlite.mjs";

export function gooseDataDir(env = process.env) {
  if (env.GOOSE_DATA_DIR) return env.GOOSE_DATA_DIR;
  const share = env.XDG_DATA_HOME || path.join(homeDir(env), ".local", "share");
  return path.join(share, "goose");
}

export function sessionsDb(env = process.env) {
  return path.join(gooseDataDir(env), "sessions", "sessions.db");
}

/** Goose writes `YYYY-MM-DD HH:MM:SS` in UTC; without the Z, JS would read it as local time. */
export function parseUtc(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const ms = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function isoSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function toolCallPart(block, callNames) {
  const call = block.toolCall?.value ?? {};
  callNames.set(block.id, call.name ?? null);
  return { type: "tool_call", tool_call_id: block.id ?? null, name: call.name ?? "?", input: JSON.stringify(call.arguments ?? {}) };
}

/** The result carries only the call id, so its tool name comes from the request it answers. */
function toolResultPart(block, callNames) {
  const content = block.toolResult?.value?.content ?? [];
  return {
    type: "tool_result",
    tool_call_id: block.id ?? null,
    name: callNames.get(block.id) ?? null,
    content: content.map((item) => String(item?.text ?? "")).join("\n"),
  };
}

/** Goose block type -> the part the scanner reads. A block type not in here is skipped, not guessed. */
const BLOCK_PARTS = {
  text: (block) => ({ type: "text", text: String(block.text ?? "") }),
  thinking: (block) => ({ type: "reasoning", thinking: String(block.thinking ?? "") }),
  toolRequest: toolCallPart,
  toolResponse: toolResultPart,
};

function blocksToParts(blocks, callNames) {
  const parts = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const build = BLOCK_PARTS[block?.type];
    const part = build ? build(block, callNames) : null;
    if (part) parts.push(part);
  }
  return parts;
}

export function toMessages(rows) {
  const callNames = new Map();
  const messages = [];
  for (const row of rows) {
    let blocks;
    try {
      blocks = JSON.parse(row.content_json ?? "[]");
    } catch {
      // A block list this version cannot parse is skipped, not guessed at.
      continue;
    }
    const parts = blocksToParts(blocks, callNames);
    if (!parts.length) continue;
    messages.push({ role: row.role ?? "assistant", created: isoSeconds(row.created_timestamp), parts });
  }
  return messages;
}

export function readSession(db, id) {
  const rows = db.prepare("select role, content_json, created_timestamp from messages where session_id = ? order by id").all(id);
  return toMessages(rows);
}

function open(env) {
  return openReadOnly(sessionsDb(env));
}

export const goose = {
  id: "goose",
  label: "Goose",
  store: "<goose data dir>/sessions/sessions.db (SQLite, read with the node:sqlite built-in)",
  file: sessionsDb,

  detect(ctx) {
    return open(ctx.env).db !== undefined;
  },

  list(ctx) {
    const { db, reason } = open(ctx.env);
    if (!db) return { sessions: [], warnings: [{ scope: sessionsDb(ctx.env), reason }] };

    const tables = tablesOf(db);
    const columns = tables.includes("sessions") ? columnsOf(db, "sessions") : [];
    if (!columns.length) {
      return { sessions: [], warnings: [{ scope: sessionsDb(ctx.env), reason: "the store has no sessions table" }] };
    }
    // An archived chat is hidden on purpose, so it is not something to review.
    const rows = db.prepare("select id, name, working_dir, created_at, updated_at from sessions where archived_at is null").all();
    const sessions = rows.map((row) => ({
      id: String(row.id),
      uuid: String(row.id),
      title: row.name ?? null,
      project: row.working_dir ?? null,
      created: parseUtc(row.created_at),
      modified: parseUtc(row.updated_at),
    }));
    return { sessions, warnings: [] };
  },

  read(session, { env }) {
    const { db, reason } = open(env);
    if (!db) throw new Error(reason);
    return {
      meta: {
        host: "goose",
        id: session.id,
        uuid: session.id,
        title: session.title ?? null,
        created: session.created ?? null,
        modified: session.modified ?? null,
        skills: [],
      },
      messages: readSession(db, session.id),
    };
  },
};
