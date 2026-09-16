#!/usr/bin/env node
/**
 * Cursor — one JSONL transcript per agent session, under
 * `<cursor root>/projects/<project-slug>/agent-transcripts/<session-uuid>.jsonl`.
 *
 * Spec, read 2026-09-16: github.com/yigitkonur/cli-continues,
 * docs/parser-documentation/message-schema/07-cursor.md and storage-format/07-cursor.md, whose authors
 * sampled the files: lines are `{role, message:{content:[blocks]}}` with the same block vocabulary as
 * Anthropic's API. Two layouts are in the wild (`<uuid>.jsonl` and `<uuid>/transcript.jsonl`), and the
 * lines carry no timestamps, so the file's mtime is the session time.
 *
 * Built from that spec and not against a live install: no Cursor transcript was available on the
 * machine this adapter was written on. Cursor's own community threads report that the JSONL export is
 * partial — tool results may be missing — so a Cursor session can look quieter than it was.
 */
import fs from "node:fs";
import path from "node:path";
import { anthropicMessages, emptyListWarning, findFiles, homeDir, readDir, readJsonl } from "./shared.mjs";

export function cursorProjectsDir(env = process.env) {
  return path.join(homeDir(env), ".cursor", "projects");
}

function transcriptFiles(env) {
  const files = [];
  for (const project of readDir(cursorProjectsDir(env))) {
    if (!project.isDirectory) continue;
    files.push(...findFiles(path.join(project.path, "agent-transcripts"), { suffixes: [".jsonl"], depth: 2 }));
  }
  return files;
}

/** `<uuid>.jsonl` names itself; the nested layout names the directory instead. */
export function sessionIdOf(file) {
  const stem = path.basename(file, ".jsonl");
  return stem === "transcript" || stem === "session" ? path.basename(path.dirname(file)) : stem;
}

/** The project slug encodes the cwd; `repo.json` beside it is the authoritative answer when present. */
export function projectOf(file, env = process.env) {
  const parts = file.split(path.sep);
  const index = parts.indexOf("agent-transcripts");
  if (index < 0) return null;
  const projectDir = parts.slice(0, index - 1).join(path.sep);
  const repoJson = path.join(projectDir, "repo.json");
  try {
    const repo = JSON.parse(fs.readFileSync(repoJson, "utf8"));
    const root = repo?.rootPath ?? repo?.root ?? repo?.path ?? repo?.cwd;
    if (typeof root === "string") return root;
    if (Array.isArray(repo?.roots) && typeof repo.roots[0] === "string") return repo.roots[0];
  } catch {
    // No repo.json, or not JSON: fall back to the slug, which encodes the path with dashes.
  }
  return parts[index - 1] ?? null;
}

export function toMessages(records) {
  return anthropicMessages(records, (record) => {
    const turn = record?.message ?? (record?.role ? record : null);
    if (!turn) return null;
    const created = typeof record.timestamp === "string" ? record.timestamp : null;
    return { role: record.role ?? turn.role, content: turn.content, created };
  });
}

export const cursor = {
  id: "cursor",
  label: "Cursor",
  store: "<cursor home>/projects/<project-slug>/agent-transcripts/**/*.jsonl",
  file: cursorProjectsDir,

  detect(ctx) {
    return fs.existsSync(cursorProjectsDir(ctx.env));
  },

  list(ctx) {
    const warnings = [];
    const sessions = [];
    for (const file of transcriptFiles(ctx.env)) {
      let modified;
      try {
        modified = new Date(fs.statSync(file).mtimeMs).toISOString();
      } catch (err) {
        warnings.push({ scope: file, reason: `transcript is unreadable: ${err.message}` });
        continue;
      }
      const id = sessionIdOf(file);
      sessions.push({
        id,
        uuid: id,
        title: null,
        project: projectOf(file, ctx.env),
        created: null,
        modified,
        file,
      });
    }
    if (!sessions.length) warnings.push(emptyListWarning(cursorProjectsDir(ctx.env), "agent transcript"));
    return { sessions, warnings };
  },

  read(session, ctx) {
    return {
      meta: {
        host: "cursor",
        id: session.id,
        uuid: session.id,
        title: session.title ?? null,
        created: session.created ?? null,
        modified: session.modified ?? null,
        skills: [],
      },
      messages: toMessages(readJsonl(session.file)),
    };
  },
};
