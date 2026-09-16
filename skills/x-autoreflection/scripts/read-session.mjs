#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEFAULT_CLIP = 600;

/**
 * Keep both ends of an over-long part: a host prints a shell failure's exit code near the end of the
 * output, and the head carries the error that caused it. Prose is not clipped at all (see below).
 */
function clip(text, limit) {
  const value = String(text ?? "");
  if (!limit || value.length <= limit) return value;
  const head = Math.ceil(limit * 0.6);
  return `${value.slice(0, head)}…${value.slice(value.length - (limit - head))}`;
}

export function normalizePart(part, limit = DEFAULT_CLIP) {
  switch (part?.type) {
    case "text":
      // Kept whole, and not for sentiment: a transcript is ~1% prose by volume (77 KB of 1.8 MB in
      // the session this was built against), while an elided sentence both cites badly and feeds the
      // prose-question detector a fragment that is shorter than the line it came from.
      return { type: "text", text: String(part.text ?? "") };
    case "reasoning":
      return { type: "reasoning", text: clip(part.thinking, limit) };
    case "tool_call":
      // Kept whole: the scan parses this JSON to find the command and the target file.
      return { type: "tool_call", id: part.tool_call_id ?? null, name: part.name ?? "?", input: String(part.input ?? "") };
    case "tool_result":
      return { type: "tool_result", id: part.tool_call_id ?? null, name: part.name ?? "?", content: clip(part.content, limit) };
    case "binary":
      return { type: "binary", mimeType: part.mime_type ?? null, size: part.size ?? null };
    case "finish":
      return { type: "finish", reason: part.reason ?? null };
    default:
      return { type: String(part?.type ?? "unknown") };
  }
}

export function normalizeSession(raw, { limit = DEFAULT_CLIP } = {}) {
  const meta = raw?.meta ?? {};
  const messages = Array.isArray(raw?.messages) ? raw.messages : [];
  return {
    source: {
      host: meta.host ?? "crush",
      id: meta.id ?? null,
      uuid: meta.uuid ?? null,
      title: meta.title ?? null,
      created: meta.created ?? null,
      modified: meta.modified ?? null,
    },
    skills: (Array.isArray(meta.skills) ? meta.skills : []).map((skill) => ({
      name: skill?.name ?? "?",
      loadedAt: skill?.loaded_at ?? null,
    })),
    messages: messages.map((message, index) => ({
      index,
      role: message?.role ?? "?",
      created: message?.created ?? null,
      parts: (Array.isArray(message?.parts) ? message.parts : []).map((part) => normalizePart(part, limit)),
    })),
  };
}

export function isNormalized(value) {
  return Boolean(value?.source?.host) && Array.isArray(value?.messages);
}

function crush(args, cwd) {
  const options = { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 };
  if (cwd) options.cwd = cwd;
  return execFileSync("crush", args, options);
}

export function listSessions({ cwd = null } = {}) {
  const args = ["session", "list", "--json"];
  return JSON.parse(crush(args, cwd));
}

export function showSession(id, { cwd = null } = {}) {
  const args = id === "last" ? ["session", "last", "--json"] : ["session", "show", String(id), "--json"];
  return JSON.parse(crush(args, cwd));
}

export function loadSession({ session = null, file = null, cwd = null, limit = DEFAULT_CLIP } = {}) {
  if (file) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return isNormalized(raw) ? raw : normalizeSession(raw, { limit });
  }
  if (!session) throw new Error("--session <id|last> or --file <path> is required");
  return normalizeSession(showSession(session, { cwd }), { limit });
}

function usage() {
  return [
    "x-autoreflection read-session — export a session transcript as normalized JSON.",
    "",
    "Usage:",
    "  node read-session.mjs --list",
    "  node read-session.mjs --session last --out /tmp/session.json",
    "  node read-session.mjs --file <raw.json> --out /tmp/session.json",
    "",
    "Flags:",
    "  --list            List sessions (id, title, modified) and exit",
    "  --session <id>    Session id, hash prefix, or \"last\" (the current session)",
    "  --file <path>     Read a raw session dump instead of calling the host",
    "  --out <path>      Write the normalized JSON here (default: stdout)",
    "  --clip <n>        Characters kept per part (default: 600)",
    "  --cwd <dir>       Run the host command in this directory",
    "  --full            Keep every part whole (same as --clip 0)",
    "  --help            Show this help",
    "",
  ].join("\n");
}

/**
 * Read `--flag value` and `--flag` arguments. `booleans` names the flags that never take a value, so
 * `--out --list` reads as two flags rather than as `out` set to "--list". Anything the caller did not
 * declare lands in `unknown`, which is how a typo becomes an error instead of being ignored.
 */
export function parseArgs(args, { booleans = ["help"], known = null } = {}) {
  const out = { _: [], unknown: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (known && !known.includes(key)) {
      out.unknown.push(key);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) i++;
      continue;
    }
    if (booleans.includes(key)) out[key] = true;
    else if (i + 1 < args.length && !args[i + 1].startsWith("--")) out[key] = args[++i];
    else out[key] = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ["list", "full", "help"],
    known: ["list", "session", "file", "out", "clip", "cwd", "full", "help"],
  });
  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    if (args.help) {
      process.stdout.write(usage());
      return;
    }
    if (args.list) {
      const sessions = listSessions({ cwd: args.cwd || null });
      process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
      return;
    }
    const limit = args.full ? 0 : Number(args.clip ?? DEFAULT_CLIP);
    const session = loadSession({
      session: args.session || null,
      file: args.file || null,
      cwd: args.cwd || null,
      limit: Number.isFinite(limit) ? limit : DEFAULT_CLIP,
    });
    const json = `${JSON.stringify(session, null, 2)}\n`;
    if (typeof args.out === "string") {
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      fs.writeFileSync(args.out, json);
      process.stdout.write(
        `${JSON.stringify({ out: args.out, messages: session.messages.length, skills: session.skills.length, title: session.source.title })}\n`
      );
      return;
    }
    process.stdout.write(json);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
