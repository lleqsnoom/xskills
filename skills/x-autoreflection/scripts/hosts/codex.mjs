#!/usr/bin/env node
/**
 * Codex — one JSONL rollout per session, sharded by date under `sessions/YYYY/MM/DD/`. Every line is
 * one record: `session_meta` first (id and cwd), then `response_item` records for the transcript
 * itself. `session_index.jsonl` names the threads.
 *
 * The rollout line shapes below are the ones this adapter was built against:
 *   {"type":"session_meta","payload":{"session_id","cwd","timestamp"}}
 *   {"type":"response_item","payload":{"type":"message","role","content":[{"type":"input_text","text"}]}}
 *   {"type":"response_item","payload":{"type":"reasoning","summary":[{"text"}]}}
 *   {"type":"response_item","payload":{"type":"function_call","name","arguments","call_id"}}
 *   {"type":"response_item","payload":{"type":"function_call_output","call_id","output":[{"type":"input_text","text"}]}}
 *   {"type":"event_msg","payload":{"type":"user_message|agent_message","message"}}
 *
 * Newer builds write `custom_tool_call` / `custom_tool_call_output` instead of the `function_call`
 * pair, carrying the call as a script in `input` rather than as JSON in `arguments`; both are mapped.
 */
import fs from "node:fs";
import path from "node:path";
import { findFiles, firstLine, homeDir } from "./shared.mjs";

const ROLE = { user: "user", assistant: "assistant", developer: "system", system: "system" };
const CALL_TYPES = new Set(["function_call", "custom_tool_call"]);
const OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output"]);
const TEXT_ITEM_TYPES = new Set(["input_text", "output_text", "text"]);
const BINARY_ITEM_TYPES = new Set(["input_image", "output_image"]);
const EVENT_ROLES = { user_message: "user", agent_message: "assistant" };

export function codexHome(env = process.env) {
  return env.CODEX_HOME || path.join(homeDir(env), ".codex");
}

export function sessionsDir(env = process.env) {
  return path.join(codexHome(env), "sessions");
}

/** `<uuid>` at the end of `rollout-<timestamp>-<uuid>.jsonl`; the id Codex itself reports. */
export function idFromFile(file) {
  const match = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : path.basename(file, ".jsonl");
}

function readJsonl(file) {
  const text = fs.readFileSync(file, "utf8");
  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A rollout being written right now can end mid-line; the records before it are still good.
    }
  }
  return records;
}

/** Only the first record is needed to place a session, so a multi-megabyte rollout is not read whole. */
function firstRecord(file) {
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, chunk, 0, chunk.length, 0);
    const line = chunk.subarray(0, read).toString("utf8").split("\n")[0];
    return JSON.parse(line);
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** `thread_name` per session id, from the index Codex keeps beside its rollouts. */
function threadNames(env) {
  const file = path.join(codexHome(env), "session_index.jsonl");
  const names = new Map();
  if (!fs.existsSync(file)) return names;
  for (const record of readJsonl(file)) {
    if (record?.id) names.set(record.id, { title: record.thread_name ?? null, updated: record.updated_at ?? null });
  }
  return names;
}

function partOf(item) {
  if (TEXT_ITEM_TYPES.has(item?.type)) return { type: "text", text: String(item.text ?? "") };
  if (BINARY_ITEM_TYPES.has(item?.type)) return { type: "binary", mimeType: null, size: null };
  return null;
}

function textOf(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (typeof value === "string") return value;
  return String(value.text ?? "");
}

function roleOf(role) {
  return ROLE[role] ?? role ?? "assistant";
}

/** Null for any other record type, which is what lets the caller try the tool shapes next. */
function proseMessage(payload, created) {
  if (payload.type === "message") {
    const parts = (Array.isArray(payload.content) ? payload.content : []).map(partOf).filter(Boolean);
    return parts.length ? { role: roleOf(payload.role), created, parts } : null;
  }
  if (payload.type === "reasoning") {
    return { role: "assistant", created, parts: [{ type: "reasoning", thinking: textOf(payload.summary) }] };
  }
  return null;
}

/** A tool call or its output. The result inherits the name of the call it answers, so a failure can
 * be attributed to the tool that produced it. */
function toolMessage(payload, created, callNames) {
  if (CALL_TYPES.has(payload.type)) {
    callNames.set(payload.call_id, payload.name ?? null);
    const part = {
      type: "tool_call",
      tool_call_id: payload.call_id ?? null,
      name: payload.name ?? "?",
      input: String(payload.arguments ?? payload.input ?? ""),
    };
    return { role: "assistant", created, parts: [part] };
  }
  if (OUTPUT_TYPES.has(payload.type)) {
    const part = {
      type: "tool_result",
      tool_call_id: payload.call_id ?? null,
      name: callNames.get(payload.call_id) ?? null,
      content: textOf(payload.output ?? payload.content ?? payload.text),
    };
    return { role: "assistant", created, parts: [part] };
  }
  return null;
}

function responseItems(records) {
  const callNames = new Map();
  const messages = [];
  for (const record of records) {
    if (record?.type !== "response_item") continue;
    const payload = record.payload ?? {};
    const created = record.timestamp ?? null;
    const message = proseMessage(payload, created) ?? toolMessage(payload, created, callNames);
    if (message) messages.push(message);
  }
  return messages;
}

/** The fallback: rollouts that carry no response items at all still carry the exchange as events. */
function eventMessages(records) {
  const messages = [];
  for (const record of records) {
    const role = EVENT_ROLES[record?.payload?.type];
    if (record?.type !== "event_msg" || !role) continue;
    messages.push({ role, created: record.timestamp ?? null, parts: [{ type: "text", text: textOf(record.payload.message) }] });
  }
  return messages;
}

function toMessages(records) {
  const items = responseItems(records);
  return items.length ? items : eventMessages(records);
}

export function readRollout(file, { title = null, created = null, modified = null } = {}) {
  const records = readJsonl(file);
  const meta = records.find((record) => record?.type === "session_meta")?.payload ?? {};
  const id = meta.session_id ?? meta.id ?? idFromFile(file);
  return {
    meta: { host: "codex", id, uuid: id, title, created: meta.timestamp ?? created, modified, skills: [] },
    messages: toMessages(records),
  };
}

export const codex = {
  id: "codex",
  label: "Codex",
  store: "JSONL rollouts under <codex home>/sessions/YYYY/MM/DD/rollout-*.jsonl behind an optional <codex home>/session_index.jsonl",
  file: sessionsDir,
  readRollout,

  detect({ env }) {
    return fs.existsSync(sessionsDir(env));
  },

  list({ env }) {
    const root = sessionsDir(env);
    if (!fs.existsSync(root)) return { sessions: [], warnings: [] };
    const names = threadNames(env);
    const sessions = [];
    const warnings = [];
    for (const file of findFiles(root, { suffixes: [".jsonl"], depth: 3 })) {
      let stat;
      try {
        stat = fs.statSync(file);
      } catch (err) {
        warnings.push({ scope: file, reason: `rollout is unreadable: ${firstLine(err.message)}` });
        continue;
      }
      const head = firstRecord(file);
      const id = head?.payload?.session_id ?? idFromFile(file);
      const named = names.get(id);
      const modified = named?.updated ?? new Date(stat.mtimeMs).toISOString();
      sessions.push({
        id,
        uuid: id,
        title: named?.title ?? null,
        created: head?.payload?.timestamp ?? null,
        modified,
        project: head?.payload?.cwd ?? null,
        file,
      });
    }
    return { sessions, warnings };
  },

  read(session, { env }) {
    const named = threadNames(env).get(session.id);
    return readRollout(session.file, {
      title: named?.title ?? session.title ?? null,
      created: session.created ?? null,
      modified: session.modified ?? null,
    });
  },
};
