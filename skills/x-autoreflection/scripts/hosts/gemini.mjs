#!/usr/bin/env node
/**
 * Gemini CLI — one chat per session under `<gemini root>/tmp/<project-id>/chats/`, written as JSONL by
 * the current builds and as a single JSON object by older ones.
 *
 * Spec, read 2026-09-16:
 *   - Storage layout and env override: google-gemini/gemini-cli `packages/core/src/config/storage.ts`.
 *   - Record schema: `packages/core/src/services/chatRecordingTypes.ts` — `MessageRecord` is
 *     `{id, timestamp, content, type}` with `type: 'user' | 'gemini' | 'info' | 'error' | 'warning'`,
 *     and a `gemini` record may also carry `toolCalls[{id, name, args, result, status, timestamp}]`,
 *     `thoughts[{subject, description}]`, `tokens` and `model`. The JSONL also carries
 *     `PartialMetadataRecord` first, then `{$set: …}` metadata updates and `{$rewindTo: id}` markers.
 *     The legacy single-JSON file is a whole `ConversationRecord`
 *     `{sessionId, projectHash, startTime, lastUpdated, messages[], summary?}`.
 *   - `~/.gemini/projects.json` maps absolute project roots to the short ids used for `tmp/<id>/`.
 *
 * Known simplification: `$rewindTo` is not replayed, so a session that was rewound keeps the messages
 * the rewind discarded. That can only add friction from messages the user already left behind.
 *
 * Built from that spec and not against a live install: no Gemini CLI chat existed on the machine this
 * adapter was written on.
 */
import fs from "node:fs";
import path from "node:path";
import { emptyListWarning, findFiles, firstLine, homeDir, readHead, readJsonl, textOf } from "./shared.mjs";

const TURN_TYPES = { user: "user", gemini: "assistant" };

export function geminiRoot(env = process.env) {
  return env.GEMINI_CLI_HOME || path.join(homeDir(env), ".gemini");
}

export function chatsRoot(env = process.env) {
  return path.join(geminiRoot(env), "tmp");
}

function chatFiles(env) {
  return findFiles(chatsRoot(env), { suffixes: [".jsonl", ".json"], depth: 3 });
}

/** `<gemini root>/projects.json`: absolute project root -> the id its `tmp/<id>/` directory uses. */
export function projectNames(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(geminiRoot(env), "projects.json"), "utf8"));
    const map = new Map();
    for (const [root, id] of Object.entries(parsed?.projects ?? parsed ?? {})) {
      if (typeof id === "string") map.set(id, root);
    }
    return map;
  } catch {
    return new Map();
  }
}

function thoughtParts(thoughts) {
  return (thoughts ?? [])
    .map((thought) => [thought?.subject, thought?.description].filter(Boolean).join(": "))
    .filter(Boolean)
    .map((thinking) => ({ type: "reasoning", thinking }));
}

function contentParts(content) {
  if (typeof content === "string") return content.trim() ? [{ type: "text", text: content }] : [];
  return (Array.isArray(content) ? content : [])
    .filter((item) => typeof item?.text === "string" && item.text.trim())
    .map((item) => ({ type: "text", text: item.text }));
}

/** A tool call carries its own result in this host, so one record becomes two parts. */
function toolCallParts(toolCalls, callNames) {
  const parts = [];
  for (const call of toolCalls ?? []) {
    callNames.set(call?.id, call?.name ?? null);
    parts.push({ type: "tool_call", tool_call_id: call?.id ?? null, name: call?.name ?? "?", input: JSON.stringify(call?.args ?? {}) });
    if (call?.result !== undefined && call?.result !== null) {
      parts.push({ type: "tool_result", tool_call_id: call?.id ?? null, name: call?.name ?? null, content: textOf(call.result) });
    }
  }
  return parts;
}

export function recordsToMessages(records) {
  const callNames = new Map();
  const messages = [];
  for (const record of records) {
    const role = TURN_TYPES[record?.type];
    if (!role) continue;
    const parts = [...thoughtParts(record.thoughts), ...contentParts(record.content), ...toolCallParts(record.toolCalls, callNames)];
    if (!parts.length) continue;
    messages.push({ role, created: typeof record.timestamp === "string" ? record.timestamp : null, parts });
  }
  return messages;
}

/** A JSONL session: metadata and `$set` records carry the session's identity and window. */
export function describeJsonl(file, env) {
  const head = readHead(file, { maxLines: 200 });
  // Every `$set` record folds into the session metadata, exactly as the loader replays them.
  const meta = head.reduce((acc, record) => (record?.$set ? { ...acc, ...record.$set } : acc), head.find((record) => record && !record.type && record.sessionId) ?? {});
  const stamps = head.map((record) => record?.timestamp).filter((value) => typeof value === "string");
  return {
    id: String(meta.sessionId ?? path.basename(file).replace(/\.jsonl$/, "")),
    title: meta.summary ?? null,
    created: meta.startTime ?? stamps[0] ?? null,
    modified: meta.lastUpdated ?? stamps[stamps.length - 1] ?? null,
    project: projectNames(env).get(meta.projectHash) ?? null,
  };
}

/** The legacy JSON file is a whole ConversationRecord; its own fields are the session's. */
export function describeJson(file, env) {
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      id: String(record.sessionId ?? path.basename(file)),
      title: record.summary ?? null,
      created: record.startTime ?? null,
      modified: record.lastUpdated ?? null,
      project: projectNames(env).get(record.projectHash) ?? null,
      messages: record.messages ?? [],
    };
  } catch {
    return null;
  }
}

export const gemini = {
  id: "gemini",
  label: "Gemini CLI",
  store: "<gemini root>/tmp/<project-id>/chats/session-*.jsonl (or the legacy session-*.json)",
  file: chatsRoot,

  detect(ctx) {
    return fs.existsSync(chatsRoot(ctx.env));
  },

  list(ctx) {
    const warnings = [];
    const sessions = [];
    for (const file of chatFiles(ctx.env)) {
      const legacy = file.endsWith(".json");
      const described = legacy ? describeJson(file, ctx.env) : describeJsonl(file, ctx.env);
      if (!described) {
        warnings.push({ scope: file, reason: "the chat file could not be read as a conversation" });
        continue;
      }
      let modified = described.modified;
      try {
        if (!modified) modified = new Date(fs.statSync(file).mtimeMs).toISOString();
      } catch (err) {
        warnings.push({ scope: file, reason: `chat file is unreadable: ${firstLine(err.message)}` });
        continue;
      }
      sessions.push({ ...described, uuid: described.id, modified, file, legacy });
    }
    if (!sessions.length) warnings.push(emptyListWarning(chatsRoot(ctx.env), "chat file"));
    return { sessions, warnings };
  },

  read(session, ctx) {
    let messages;
    if (session.legacy) {
      messages = recordsToMessages(describeJson(session.file, ctx.env)?.messages ?? []);
    } else {
      messages = recordsToMessages(readJsonl(session.file));
    }
    return {
      meta: {
        host: "gemini",
        id: session.id,
        uuid: session.id,
        title: session.title ?? null,
        created: session.created ?? null,
        modified: session.modified ?? null,
        skills: [],
      },
      messages,
    };
  },
};

