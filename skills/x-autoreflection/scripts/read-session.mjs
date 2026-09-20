#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { HOSTS, defaultRun, firstLine, hostById, hostStatus, withModifiedMs, withinWindow } from "./hosts/index.mjs";

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

/** The model and provider a host recorded for one message; a message that names neither gets neither. */
function modelFields(message) {
  return {
    ...(message?.model ? { model: String(message.model) } : {}),
    ...(message?.provider ? { provider: String(message.provider) } : {}),
  };
}

/**
 * How many replies each model gave, and the one that gave most. Without it "skill X works on one model
 * and falls short on another" cannot even be asked, and a host may switch models mid-session.
 */
export function sessionModels(messages) {
  const models = messages
    .filter((message) => message.role === "assistant" && message.model)
    .reduce((counts, message) => ({ ...counts, [message.model]: (counts[message.model] ?? 0) + 1 }), {});
  const [main] = Object.entries(models).sort((a, b) => b[1] - a[1])[0] ?? [null];
  return { model: main, models };
}

export function normalizeSession(raw, { limit = DEFAULT_CLIP } = {}) {
  const meta = raw?.meta ?? {};
  const messages = (Array.isArray(raw?.messages) ? raw.messages : []).map((message, index) => ({
    index,
    role: message?.role ?? "?",
    created: message?.created ?? null,
    ...modelFields(message),
    parts: (Array.isArray(message?.parts) ? message.parts : []).map((part) => normalizePart(part, limit)),
  }));
  return {
    source: {
      host: meta.host ?? "crush",
      id: meta.id ?? null,
      uuid: meta.uuid ?? null,
      title: meta.title ?? null,
      created: meta.created ?? null,
      modified: meta.modified ?? null,
      headless: meta.headless === true,
      ...sessionModels(messages),
    },
    skills: (Array.isArray(meta.skills) ? meta.skills : []).map((skill) => ({
      name: skill?.name ?? "?",
      loadedAt: skill?.loaded_at ?? null,
    })),
    messages,
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

function hostContext({ hours = 24, now = new Date(), env = process.env, run = null, hostOptions = {} } = {}) {
  return { hours, now, projectLookbackHours: hours, env, run: run ?? defaultRun(env), hostOptions };
}

/**
 * One host's sessions, plus the status row the listing reports for it. `all` skips the window: an id
 * lookup is asking for one named session, which may well be older than the last day's work.
 */
function listFromHost(host, ctx, { all = false } = {}) {
  const row = { id: host.id, label: host.label, status: hostStatus(host, ctx), sessions: 0 };
  if (row.status !== "ok") return { row, sessions: [] };

  let listed;
  try {
    listed = host.list(ctx);
  } catch (err) {
    row.status = "unreadable";
    row.reason = firstLine(err.message);
    return { row, sessions: [] };
  }
  const fresh = (all ? withModifiedMs(listed.sessions) : withinWindow(listed.sessions, { hours: ctx.hours, now: ctx.now })).sort(
    (a, b) => b.modifiedMs - a.modifiedMs
  );
  row.sessions = fresh.length;
  return { row, sessions: fresh };
}

/**
 * Every session of the window, from every CLI that keeps sessions on this machine. `only` narrows it
 * to named host ids. The list carries the host id each session came from, because the same session
 * id means different things to different CLIs.
 */
export function listHostSessions({ only = null, ctx = hostContext(), all = false } = {}) {
  const hosts = [];
  const sessions = [];
  for (const host of HOSTS) {
    if (only && !only.has(host.id)) continue;
    const listed = listFromHost(host, ctx, { all });
    hosts.push(listed.row);
    for (const session of listed.sessions) sessions.push({ host: host.id, ...session });
  }
  sessions.sort((a, b) => b.modifiedMs - a.modifiedMs);
  return { hosts, sessions };
}

/** Find one session by id, optionally pinned to a host. Throws when no host owns the id. */
export function findSession(id, { only = null, ctx = hostContext() } = {}) {
  const { sessions } = listHostSessions({ only, ctx, all: true });
  const match = sessions.find((session) => String(session.id) === String(id) || String(session.uuid) === String(id));
  if (!match) {
    const known = sessions.slice(0, 10).map((session) => `${session.host}:${session.id}`);
    const searched = known.length ? `known ids: ${known.join(", ")}` : "no session store had anything in it";
    throw new Error(`no session "${id}" (${searched})`);
  }
  return match;
}

export function listSessions({ cwd = null } = {}) {
  const args = ["session", "list", "--json"];
  return JSON.parse(crush(args, cwd));
}

export function showSession(id, { cwd = null } = {}) {
  const args = id === "last" ? ["session", "last", "--json"] : ["session", "show", String(id), "--json"];
  return JSON.parse(crush(args, cwd));
}

export function loadSession({ session = null, file = null, cwd = null, limit = DEFAULT_CLIP, only = null, ctx = null } = {}) {
  if (file) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return isNormalized(raw) ? raw : normalizeSession(raw, { limit });
  }
  if (!session) throw new Error("--session <id|last> or --file <path> is required");
  const context = ctx ?? hostContext();
  // `last` is Crush's own word for the session you are in, and no other CLI defines it.
  if (session === "last" && !only) return normalizeSession(showSession("last", { cwd }), { limit });
  const found = findSession(session, { only, ctx: context });
  const adapter = hostById(found.host);
  return normalizeSession(adapter.read(found, context), { limit });
}

function usage() {
  return [
    "x-autoreflection read-session — export a session transcript as normalized JSON.",
    "",
    "Usage:",
    "  node read-session.mjs --list [--host crush,codex]",
    "  node read-session.mjs --session last --out /tmp/session.json",
    "  node read-session.mjs --file <raw.json> --out /tmp/session.json",
    "",
    "Flags:",
    "  --list            List sessions of every detected host (id, host, title, modified) and exit",
    "  --session <id>    Session id, or \"last\" for the session you are in on Crush",
    "  --host <ids>      Comma-separated hosts to read: crush, codex, opencode, goose (default: all detected)",
    "  --hours <n>       How far back --list looks (default: 24; --session ignores it)",
    "  --file <path>     Read a raw session dump instead of calling a host",
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

/** `--host` as a set of ids, or null for "every detected host". Throws on an id no adapter claims. */
function selectedHosts(value) {
  const only = value ? new Set(String(value).split(",").map((id) => id.trim()).filter(Boolean)) : null;
  for (const id of only ?? []) {
    if (!hostById(id)) throw new Error(`Unknown host "${id}"; known hosts: ${HOSTS.map((host) => host.id).join(", ")}`);
  }
  return only;
}

function writeExport(session, out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(session, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ out, messages: session.messages.length, skills: session.skills.length, title: session.source.title })}\n`
  );
}

/** Load the one session the flags ask for, and either write it to `--out` or print it. */
function exportOrPrint(args, { only, ctx }) {
  const limit = args.full ? 0 : Number(args.clip ?? DEFAULT_CLIP);
  const session = loadSession({
    session: args.session || null,
    file: args.file || null,
    cwd: args.cwd || null,
    limit: Number.isFinite(limit) ? limit : DEFAULT_CLIP,
    only,
    ctx,
  });
  if (typeof args.out === "string") return writeExport(session, args.out);
  return process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}

function writeList({ only, ctx }) {
  return process.stdout.write(`${JSON.stringify(listHostSessions({ only, ctx }), null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ["list", "full", "help"],
    known: ["list", "session", "host", "hours", "file", "out", "clip", "cwd", "full", "help"],
  });
  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    if (args.help) return process.stdout.write(usage());
    const only = selectedHosts(args.host);
    const ctx = hostContext({ hours: Number(args.hours ?? 24) || 24 });
    return args.list ? writeList({ only, ctx }) : exportOrPrint(args, { only, ctx });
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
