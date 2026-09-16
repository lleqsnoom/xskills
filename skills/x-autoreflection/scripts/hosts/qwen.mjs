#!/usr/bin/env node
/**
 * Qwen Code — one chat per session under `<qwen root>/tmp/<project-id>/chats/*.jsonl`, a tree of
 * `ChatRecord`s linked by `parentUuid`.
 *
 * Spec, read 2026-09-16: QwenLM/qwen-code `packages/core/src/services/chatRecordingService.ts` and
 * `sessionService.ts` as documented by github.com/yigitkonur/cli-continues,
 * docs/parser-documentation/message-schema/16-qwen-code.md:
 *   {"uuid","parentUuid","sessionId","timestamp","type","cwd","version","gitBranch"?,"message"}
 *   with `type` in `user | assistant | tool_result | system` and `message` in the raw model `Content`
 *   form (`{role, parts:[{text}|{thought,text}|{functionCall:{name,args,id}}|{functionResponse:…}]}`).
 * The same doc records that the official path is `tmp/<project-id>/chats/` while older trees used
 * `projects/<project-id>/chats/`, so both are scanned.
 *
 * Known simplification: records form a tree, and this reads them in file order rather than walking
 * `parentUuid` back from the leaf. A branch that was abandoned mid-session is therefore included.
 *
 * Built from that spec and not against a live install: no Qwen Code store existed on the machine this
 * adapter was written on.
 */
import fs from "node:fs";
import path from "node:path";
import { emptyListWarning, findFiles, homeDir, readHead, readJsonl, textOf } from "./shared.mjs";

/** `system` records are compression markers, slash-command replays and UI telemetry, not turns. */
const TURN_TYPES = { user: "user", assistant: "assistant", tool_result: "assistant" };

export function qwenRoot(env = process.env) {
  return env.QWEN_HOME || path.join(homeDir(env), ".qwen");
}

export function chatsRoots(env = process.env) {
  return [path.join(qwenRoot(env), "tmp"), path.join(qwenRoot(env), "projects")];
}

function chatFiles(env) {
  const files = [];
  for (const root of chatsRoots(env)) files.push(...findFiles(root, { suffixes: [".jsonl"], depth: 3 }));
  return files;
}

function partOf(part) {
  if (typeof part?.text === "string") {
    return part.thought === true ? { type: "reasoning", thinking: part.text } : { type: "text", text: part.text };
  }
  if (part?.functionCall) {
    const call = part.functionCall;
    return { type: "tool_call", tool_call_id: call.id ?? null, name: call.name ?? "?", input: JSON.stringify(call.args ?? {}) };
  }
  if (part?.functionResponse) {
    const response = part.functionResponse;
    return { type: "tool_result", tool_call_id: response.id ?? null, name: response.name ?? null, content: textOf(response.response) };
  }
  return null;
}

export function recordsToMessages(records) {
  const callNames = new Map();
  const messages = [];
  for (const record of records) {
    const role = TURN_TYPES[record?.type];
    if (!role) continue;
    const parts = [];
    for (const raw of record.message?.parts ?? []) {
      const part = partOf(raw);
      if (!part) continue;
      if (part.type === "tool_call") callNames.set(part.tool_call_id, part.name);
      if (part.type === "tool_result" && !part.name) part.name = callNames.get(part.tool_call_id) ?? null;
      parts.push(part);
    }
    if (!parts.length) continue;
    messages.push({ role, created: typeof record.timestamp === "string" ? record.timestamp : null, parts });
  }
  return messages;
}

export function describe(file) {
  const head = readHead(file, { maxLines: 20 });
  const named = head.find((record) => record?.sessionId || record?.cwd) ?? {};
  const stamps = head.map((record) => record?.timestamp).filter((value) => typeof value === "string");
  return {
    id: String(named.sessionId ?? path.basename(file).replace(/\.jsonl$/, "")),
    title: null,
    created: stamps[0] ?? null,
    modified: stamps[stamps.length - 1] ?? null,
    project: typeof named.cwd === "string" ? named.cwd : null,
  };
}

export const qwen = {
  id: "qwen",
  label: "Qwen Code",
  store: "<qwen root>/tmp/<project-id>/chats/*.jsonl (older trees: projects/<project-id>/chats/)",
  file: (env) => chatsRoots(env)[0],

  detect(ctx) {
    return chatsRoots(ctx.env).some((root) => fs.existsSync(root));
  },

  list(ctx) {
    const warnings = [];
    const sessions = [];
    for (const file of chatFiles(ctx.env)) {
      const described = describe(file);
      let modified = described.modified;
      try {
        if (!modified) modified = new Date(fs.statSync(file).mtimeMs).toISOString();
      } catch (err) {
        warnings.push({ scope: file, reason: `chat file is unreadable: ${err.message}` });
        continue;
      }
      sessions.push({ ...described, uuid: described.id, modified, file });
    }
    if (!sessions.length) warnings.push(emptyListWarning(chatsRoots(ctx.env)[0], "chat file"));
    return { sessions, warnings };
  },

  read(session, ctx) {
    return {
      meta: {
        host: "qwen",
        id: session.id,
        uuid: session.id,
        title: session.title ?? null,
        created: session.created ?? null,
        modified: session.modified ?? null,
        skills: [],
      },
      messages: recordsToMessages(readJsonl(session.file)),
    };
  },
};
