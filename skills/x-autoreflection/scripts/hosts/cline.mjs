#!/usr/bin/env node
/**
 * Cline, Roo Code and Kilo Code — VS Code extensions that keep one directory per task in the editor's
 * `globalStorage`. They share a lineage and a layout, so they share an adapter.
 *
 * Spec, read 2026-09-16: github.com/yigitkonur/cli-continues,
 * docs/parser-documentation/storage-format/{11-cline,12-roo-code,13-kilo-code}.md and
 * message-schema/11-cline.md, citing Cline's own `src/core/storage/disk.ts`:
 *   globalStorage/<extension-id>/tasks/<task-id>/api_conversation_history.json   (Anthropic messages)
 *   globalStorage/<extension-id>/tasks/<task-id>/ui_messages.json                (ClineMessage array)
 * `api_conversation_history.json` is the conversation in Anthropic's shape, so it is preferred: the UI
 * message stream carries no tool detail, and a task with only `ui_messages.json` is still read for its
 * text rather than dropped.
 *
 * Built from that spec and not against a live install: the editor storage on the machine this adapter
 * was written on had none of these three extensions installed.
 */
import fs from "node:fs";
import path from "node:path";
import { anthropicMessages, homeDir, readDir } from "./shared.mjs";

/** Where each editor keeps extension storage, per platform. `XDG_CONFIG_HOME` wins on Linux. */
export function editorRoots(env = process.env) {
  const home = homeDir(env);
  const config = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const mac = path.join(home, "Library", "Application Support");
  const roots = [];
  for (const base of [config, mac]) {
    for (const editor of ["Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf", "Code - OSS"]) {
      roots.push(path.join(base, editor, "User", "globalStorage"));
    }
  }
  if (env.APPDATA) {
    for (const editor of ["Code", "VSCodium", "Cursor"]) roots.push(path.join(env.APPDATA, editor, "User", "globalStorage"));
  }
  return roots;
}

/** The extension ids each vendor ships under; the first one that exists wins. */
const EXTENSIONS = {
  cline: ["saoudrizwan.claude-dev"],
  roo: ["rooveterinaryinc.roo-cline"],
  kilo: ["kilocode.kilo-code", "kilocode.kilo-code-nightly"],
};

export function tasksDir(env, ids) {
  for (const root of editorRoots(env)) {
    for (const id of ids) {
      const dir = path.join(root, id, "tasks");
      if (fs.existsSync(dir)) return dir;
    }
  }
  for (const root of editorRoots(env)) {
    for (const id of ids) {
      const dir = path.join(root, id);
      if (fs.existsSync(dir)) return path.join(dir, "tasks");
    }
  }
  return null;
}

export function historyFile(taskDir) {
  const anthropic = path.join(taskDir, "api_conversation_history.json");
  if (fs.existsSync(anthropic)) return { file: anthropic, format: "anthropic" };
  const ui = path.join(taskDir, "ui_messages.json");
  if (fs.existsSync(ui)) return { file: ui, format: "ui" };
  return null;
}

/**
 * `ui_messages.json` is a stream of `ClineMessage` entries: `say` is the assistant and arrives in
 * partial chunks that must be merged, `user_feedback` is the user. There is no role field to read.
 */
function uiMessages(records) {
  const messages = [];
  let pending = null;
  const flush = () => {
    if (pending) messages.push(pending);
    pending = null;
  };
  for (const record of Array.isArray(records) ? records : []) {
    const text = typeof record?.text === "string" ? record.text : "";
    if (!text.trim()) continue;
    const role = record?.say === "user_feedback" || record?.ask === "followup" ? "user" : "assistant";
    const created = Number.isFinite(record?.ts) ? new Date(record.ts).toISOString() : null;
    if (role === "assistant" && record?.partial === true && pending) {
      pending.parts[0].text += text;
      continue;
    }
    flush();
    pending = { role, created, parts: [{ type: "text", text }] };
  }
  flush();
  return messages;
}

export function toMessages(records, format) {
  if (format === "anthropic") return anthropicMessages(records, (entry) => (entry?.role ? { role: entry.role, content: entry.content } : null));
  return uiMessages(records);
}

/** One session row per task directory that has a history file; the rest are skipped, not counted. */
function listTasks(env, ids) {
  const dir = tasksDir(env, ids);
  if (!dir) {
    const roots = editorRoots(env).filter((root) => fs.existsSync(root));
    return {
      sessions: [],
      warnings: [
        roots.length
          ? { scope: ids[0], reason: `no tasks directory in any of the ${roots.length} editor storage roots that exist` }
          : { scope: ids[0], reason: "no VS Code-family editor storage on this machine" },
      ],
    };
  }

  const warnings = [];
  const sessions = [];
  for (const task of readDir(dir)) {
    if (!task.isDirectory) continue;
    const found = historyFile(task.path);
    if (!found) continue;
    let modified;
    try {
      modified = new Date(fs.statSync(found.file).mtimeMs).toISOString();
    } catch (err) {
      warnings.push({ scope: task.path, reason: `task history is unreadable: ${err.message}` });
      continue;
    }
    sessions.push({ id: task.name, uuid: task.name, title: null, project: null, created: null, modified, file: found.file, format: found.format });
  }
  if (!sessions.length) warnings.push({ scope: dir, reason: "the task directory is there but no task had a history file" });
  return { sessions, warnings };
}

function readTask(session, hostId) {
  let records;
  try {
    records = JSON.parse(fs.readFileSync(session.file, "utf8"));
  } catch (err) {
    throw new Error(`${session.file} is not readable JSON: ${err.message}`);
  }
  return {
    meta: {
      host: hostId,
      id: session.id,
      uuid: session.id,
      title: session.title ?? null,
      created: session.created ?? null,
      modified: session.modified ?? null,
      skills: [],
    },
    messages: toMessages(Array.isArray(records) ? records : [], session.format),
  };
}

function editorHost({ id, label, store, ids }) {
  return {
    id,
    label,
    store,
    file: (env) => tasksDir(env, ids),

    detect(ctx) {
      return tasksDir(ctx.env, ids) !== null;
    },

    list: (ctx) => listTasks(ctx.env, ids),

    read: (session) => readTask(session, id),
  };
}

export const cline = editorHost({
  id: "cline",
  label: "Cline",
  store: "<editor> User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/{api_conversation_history,ui_messages}.json",
  ids: EXTENSIONS.cline,
});

export const roo = editorHost({
  id: "roo",
  label: "Roo Code",
  store: "<editor> User/globalStorage/rooveterinaryinc.roo-cline/tasks/<task-id>/{api_conversation_history,ui_messages}.json",
  ids: EXTENSIONS.roo,
});

export const kilo = editorHost({
  id: "kilo",
  label: "Kilo Code",
  store: "<editor> User/globalStorage/kilocode.kilo-code/tasks/<task-id>/{api_conversation_history,ui_messages}.json",
  ids: EXTENSIONS.kilo,
});
