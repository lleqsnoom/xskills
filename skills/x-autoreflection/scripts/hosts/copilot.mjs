#!/usr/bin/env node
/**
 * GitHub Copilot CLI — one directory per session under `<copilot home>/session-state/<session-id>/`,
 * holding an append-only `events.jsonl` (the raw stream) and a `workspace.yaml`.
 *
 * Spec, read 2026-09-16:
 *   - Paths and the fact that `events.jsonl` is the richer source: GitHub's Copilot CLI session docs
 *     (docs.github.com/en/copilot/concepts/agents/copilot-cli/chronicle and the CLI config dir
 *     reference), as summarised by github.com/yigitkonur/cli-continues,
 *     docs/parser-documentation/message-schema/03-copilot.md.
 *   - Events observed there: `user.message.data{content, transformedContent, source, …}`,
 *     `assistant.turn_start`, `assistant.message.data{content, toolRequests, reasoningText, …}`, and
 *     `tool.execution_start{toolName, arguments, toolCallId}`.
 *
 * Known gaps, from that same document: a session directory that has only `session.db` and no
 * `events.jsonl` is skipped, and there is a global `session-store.db` index this adapter does not read.
 * `workspace.yaml` is scanned for a `cwd:` line rather than parsed as YAML, since the package carries no
 * YAML dependency.
 *
 * Built from that spec and not against a live install: no Copilot session existed on the machine this
 * adapter was written on.
 */
import fs from "node:fs";
import path from "node:path";
import { emptyListWarning, homeDir, readDir, readHead, readJsonl, textOf } from "./shared.mjs";

export function copilotHome(env = process.env) {
  return env.COPILOT_HOME || path.join(homeDir(env), ".copilot");
}

export function sessionStateDir(env = process.env) {
  return path.join(copilotHome(env), "session-state");
}

/** `cwd:` out of `workspace.yaml`, without pretending to parse YAML. */
function workspaceCwd(dir) {
  try {
    const match = fs.readFileSync(path.join(dir, "workspace.yaml"), "utf8").match(/^\s*cwd:\s*["']?([^"'\n]+)/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function userMessage(data) {
  const text = textOf(data.content ?? data.transformedContent);
  return text.trim() ? { role: "user", parts: [{ type: "text", text }] } : null;
}

/** An assistant event carries the prose, the reasoning and the calls it asked for, in that order. */
function assistantMessage(data, callNames) {
  const parts = [];
  if (typeof data.reasoningText === "string" && data.reasoningText.trim()) parts.push({ type: "reasoning", thinking: data.reasoningText });
  const text = textOf(data.content);
  if (text.trim()) parts.push({ type: "text", text });
  for (const request of data.toolRequests ?? []) {
    const name = request?.name ?? request?.toolName ?? "?";
    const id = request?.toolCallId ?? request?.id ?? null;
    callNames.set(id, name);
    parts.push({ type: "tool_call", tool_call_id: id, name, input: JSON.stringify(request?.arguments ?? request?.input ?? {}) });
  }
  return parts.length ? { role: "assistant", parts } : null;
}

function toolStarted(data, callNames) {
  const id = data.toolCallId ?? null;
  const name = data.toolName ?? "?";
  callNames.set(id, name);
  return { role: "assistant", parts: [{ type: "tool_call", tool_call_id: id, name, input: JSON.stringify(data.arguments ?? {}) }] };
}

function toolCompleted(data, callNames) {
  const id = data.toolCallId ?? null;
  const content = textOf(data.result ?? data.output ?? "");
  return {
    role: "assistant",
    parts: [{ type: "tool_result", tool_call_id: id, name: callNames.get(id) ?? data.toolName ?? null, content }],
  };
}

/** Event type -> the turn it contributes. `assistant.turn_start` and the rest contribute nothing. */
function eventParts(event, callNames) {
  switch (event?.type) {
    case "user.message":
      return userMessage(event.data ?? {});
    case "assistant.message":
      return assistantMessage(event.data ?? {}, callNames);
    case "tool.execution_start":
      return toolStarted(event.data ?? {}, callNames);
    case "tool.execution_complete":
      return toolCompleted(event.data ?? {}, callNames);
    default:
      return null;
  }
}

export function eventsToMessages(records) {
  const callNames = new Map();
  const messages = [];
  for (const record of records) {
    const message = eventParts(record, callNames);
    if (!message) continue;
    const created = typeof record.timestamp === "string" ? record.timestamp : null;
    messages.push({ ...message, created });
  }
  return messages;
}

export const copilot = {
  id: "copilot",
  label: "GitHub Copilot CLI",
  store: "<copilot home>/session-state/<session-id>/events.jsonl",
  file: sessionStateDir,

  detect(ctx) {
    return fs.existsSync(sessionStateDir(ctx.env));
  },

  list(ctx) {
    const warnings = [];
    const sessions = [];
    for (const entry of readDir(sessionStateDir(ctx.env))) {
      if (!entry.isDirectory) continue;
      const events = path.join(entry.path, "events.jsonl");
      if (!fs.existsSync(events)) continue;
      let modified;
      try {
        modified = new Date(fs.statSync(events).mtimeMs).toISOString();
      } catch (err) {
        warnings.push({ scope: entry.path, reason: `session log is unreadable: ${err.message}` });
        continue;
      }
      const head = readHead(events, { maxLines: 5 });
      const stamps = head.map((record) => record?.timestamp).filter((value) => typeof value === "string");
      sessions.push({
        id: entry.name,
        uuid: entry.name,
        title: null,
        project: workspaceCwd(entry.path),
        created: stamps[0] ?? null,
        modified,
        file: events,
      });
    }
    if (!sessions.length) warnings.push(emptyListWarning(sessionStateDir(ctx.env), "session log"));
    return { sessions, warnings };
  },

  read(session, ctx) {
    return {
      meta: {
        host: "copilot",
        id: session.id,
        uuid: session.id,
        title: session.title ?? null,
        created: session.created ?? null,
        modified: session.modified ?? null,
        skills: [],
      },
      messages: eventsToMessages(readJsonl(session.file)),
    };
  },
};

