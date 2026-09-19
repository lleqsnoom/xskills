#!/usr/bin/env node
/**
 * Claude Code — one append-only JSONL transcript per session, under
 * `<claude root>/projects/<encoded-cwd>/<session-uuid>.jsonl`.
 *
 * Spec, read 2026-09-16:
 *   - Storage root and layout: https://code.claude.com/docs/en/claude-directory (`CLAUDE_CONFIG_DIR`
 *     relocates `~/.claude`).
 *   - Line shape, from the community parsers that read it:
 *     github.com/yigitkonur/cli-continues, docs/parser-documentation/message-schema/01-claude.md —
 *     `{type: "user"|"assistant"|"summary"|…, timestamp, sessionId, cwd, uuid, parentUuid, message}`
 *     where an assistant's `message.content` is a block list of `text`, `thinking` and `tool_use`, and
 *     a tool result arrives as a `type: "user"` line whose blocks carry `tool_result`.
 *
 * Built from that spec, then read against a live store on 2026-09-19. The line shape held, and the live
 * bytes carried three things the spec did not name: `entrypoint: "sdk-cli"` on a headless `claude -p`
 * run, `message.model` on each assistant line, and a loaded skill as a user line opening "Base directory
 * for this skill:". It fails loudly rather than silently: a project directory with no transcript in it
 * produces a warning, and the `hosts[]` table says what was read.
 */
import fs from "node:fs";
import path from "node:path";
import { anthropicMessages, emptyListWarning, findFiles, homeDir, readDir, readHead, readJsonl } from "./shared.mjs";

export function claudeRoot(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(homeDir(env), ".claude");
}

export function projectsDir(env = process.env) {
  return path.join(claudeRoot(env), "projects");
}

/** Transcripts sit directly in the project directory; `tool-results/` and subagents sit below it. */
function transcriptFiles(env) {
  const files = [];
  for (const entry of readDir(projectsDir(env))) {
    if (!entry.isDirectory) continue;
    for (const file of findFiles(entry.path, { suffixes: [".jsonl"], depth: 0 })) files.push(file);
  }
  return files;
}

/** The session's own words: `cwd` and `sessionId` on any line, or a `summary` line for the title. */
export function describe(file) {
  const head = readHead(file);
  const named = head.find((record) => record?.cwd || record?.sessionId || record?.type === "summary") ?? {};
  const cwd = head.find((record) => typeof record?.cwd === "string")?.cwd ?? null;
  const summary = head.find((record) => record?.type === "summary" && typeof record.summary === "string")?.summary ?? null;
  return {
    id: String(named.sessionId ?? path.basename(file, ".jsonl")),
    title: summary,
    created: typeof head[0]?.timestamp === "string" ? head[0].timestamp : null,
    project: cwd,
  };
}

export function toMessages(records) {
  return anthropicMessages(records, (record) =>
    record?.type === "user" || record?.type === "assistant"
      ? {
          role: record.message?.role ?? record.type,
          content: record.message?.content,
          created: record.timestamp ?? null,
          model: record.type === "assistant" ? record.message?.model ?? null : null,
        }
      : null
  );
}

/** Claude Code injects a loaded skill's body as a user message that starts with its directory. */
const SKILL_BODY_RE = /^Base directory for this skill:\s*\S*\/skills\/([A-Za-z0-9._:-]+)/;

function skillLoadsIn(record) {
  const blocks = [].concat(record?.message?.content ?? []);
  return blocks
    .flatMap((block) => {
      if (block?.type === "tool_use" && block.name === "Skill" && block.input?.skill) return [String(block.input.skill)];
      const text = typeof block === "string" ? block : block?.type === "text" ? String(block.text ?? "") : "";
      const match = text.match(SKILL_BODY_RE);
      return match ? [match[1]] : [];
    })
    .map((name) => ({ name, loaded_at: record.timestamp ?? null }));
}

/**
 * The skills a session loaded, first load first: the `Skill` tool's calls and the skill bodies the host
 * injects. Claude Code keeps no skill list of its own, so without this every one of its complaints is
 * blamed on no skill at all.
 */
export function loadedSkills(records) {
  const first = new Map();
  for (const load of records.flatMap(skillLoadsIn)) if (!first.has(load.name)) first.set(load.name, load);
  return [...first.values()];
}

/** `claude -p` records `entrypoint: "sdk-cli"`: a script ran the session, not a person at the prompt. */
export function isHeadless(records) {
  return records.some((record) => record?.entrypoint === "sdk-cli");
}

export function readTranscript(file, { id, title = null, created = null, modified = null } = {}) {
  const records = readJsonl(file);
  return {
    meta: { host: "claude", id, uuid: id, title, created, modified, headless: isHeadless(records), skills: loadedSkills(records) },
    messages: toMessages(records),
  };
}

export const claude = {
  id: "claude",
  label: "Claude Code",
  store: "<claude root>/projects/<encoded-cwd>/<session-uuid>.jsonl (CLAUDE_CONFIG_DIR moves the root)",
  file: projectsDir,

  detect(ctx) {
    return fs.existsSync(projectsDir(ctx.env));
  },

  list(ctx) {
    const warnings = [];
    const sessions = [];
    for (const file of transcriptFiles(ctx.env)) {
      const described = describe(file);
      let modified = null;
      try {
        modified = new Date(fs.statSync(file).mtimeMs).toISOString();
      } catch (err) {
        warnings.push({ scope: file, reason: `transcript is unreadable: ${err.message}` });
        continue;
      }
      sessions.push({ ...described, uuid: described.id, modified, file });
    }
    if (!sessions.length) warnings.push(emptyListWarning(projectsDir(ctx.env), "transcript"));
    return { sessions, warnings };
  },

  read(session, ctx) {
    return readTranscript(session.file, {
      id: session.id,
      title: session.title ?? null,
      created: session.created ?? null,
      modified: session.modified ?? null,
    });
  },
};
