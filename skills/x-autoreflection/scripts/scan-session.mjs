#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_CLIP, isNormalized, loadSession, normalizeSession, parseArgs } from "./read-session.mjs";

/** Commands whose non-zero exit is an answer rather than a failure. */
export const EXPECTED_NONZERO = ["diff", "cmp", "grep", "egrep", "fgrep", "test", "git diff", "git grep"];

/** Commands that neither fail nor decide anything; they only wrap the real one. */
export const NEUTRAL = ["cd", "echo", "export", "set", "true", "printf", "pwd"];

/** A user message starting with one of these corrects the agent. */
const CORRECTION_RE = /^(no|nope|wrong|not quite|actually|i said|i meant|that's not|thats not|stop|don't|dont|again|still)\b[,\s]/i;

/** A user message this short, and this bare, is a nudge: the agent stopped early. */
const REPROMPT_RE = /^(continue|go on|try again|retry|proceed|keep going|next|again)\b[.!]?$/i;

const REPROMPT_MAX_WORDS = 3;
const PROSE_QUESTION_MAX_CHARS = 120;
const CONTEXT_WINDOW = 3;
const MAX_EVIDENCE = 3;

const ARTIFACT_RE = /\bE(\d{2})-(?!\d)([a-z0-9][a-z0-9-]*)/g;
const RUN_FOLDER_RE = /\.x-skills\/runs\/([A-Za-z0-9:._-]+)/g;

function excerpt(text, limit = 160) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

/**
 * Remove fenced and inline code so a `?` inside a code sample is not read as a question.
 * Only inline removal is conditional: an odd number of backticks left after the fenced blocks means
 * one fence is unclosed, and `` `…` `` would then pair that opener with a later closer and delete
 * line between them. This is a guard, not a theory: a transcript whose prose was clipped produced
 * exactly that, and the shortened last line then passed the question detector.
 */
export function stripFences(text) {
  const withoutBlocks = String(text ?? "").replace(/```[\s\S]*?```/g, "");
  const backticks = (withoutBlocks.match(/`/g) || []).length;
  const withoutInline = backticks % 2 === 0 ? withoutBlocks.replace(/`[^`]*`/g, "") : withoutBlocks;
  return withoutInline.trim();
}

/** A tool call's input, decoded once. A host may send a string that is not JSON, or nothing. */
function parseToolInput(input) {
  if (typeof input !== "string") return null;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** The command a command-running tool call invokes, or "" for anything else. */
export function commandOf(input) {
  const parsed = parseToolInput(input);
  return typeof parsed?.command === "string" ? parsed.command : "";
}

/** The file a tool call works on, which is how a failing edit is attributed to its skill. */
export function targetOf(input) {
  const parsed = parseToolInput(input);
  if (typeof parsed?.file_path === "string") return parsed.file_path;
  if (typeof parsed?.path === "string") return parsed.path;
  if (Array.isArray(parsed?.edits) && typeof parsed.edits[0]?.file_path === "string") {
    return parsed.edits[0].file_path;
  }
  return "";
}

/**
 * The commands whose exit status the shell can report: one per `&&`/`;` chain, and for each chain
 * only the last stage of its pipeline. `cd x && diff a b` can report diff's 1, and so can
 * `cat f | diff - g`, because a pipeline's status is its last stage's — but `diff a b | tail -1`
 * reports tail's, not diff's.
 */
export function statusCommands(commandText) {
  return String(commandText ?? "")
    .split(/&&|\|\||;|\n/)
    .map((chain) => chain.trim())
    .filter((chain) => chain && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(chain))
    .map((chain) => {
      const stages = chain
        .split("|")
        .map((stage) => stage.trim())
        .filter(Boolean);
      return stages[stages.length - 1] ?? "";
    })
    .filter(Boolean);
}

function commandWord(segment) {
  const words = segment
    .split(/\s+/)
    .filter((word) => !/^\d?>/.test(word) && !/^&\d*$/.test(word));
  const first = words[0] ?? "";
  return first === "git" && words[1] ? `git ${words[1]}` : first;
}

/**
 * Whether a failing command is one whose non-zero exit carries the answer.
 * True only when every command that could have reported the status is such a command, so a `grep`
 * at the end of a long `&&` chain does not excuse a `node` script that failed before it.
 */
export function isExpectedExit(command) {
  const commands = statusCommands(command);
  if (!commands.length) return false;
  return commands.every((segment) => {
    const word = commandWord(segment);
    return NEUTRAL.includes(word) || EXPECTED_NONZERO.includes(word);
  });
}

export function skillMentions(text) {
  const value = String(text ?? "");
  const named = new Set(value.match(/\bx-[a-z0-9-]+\b/g) || []);
  for (const match of value.matchAll(/skills\/(x-[a-z0-9-]+)\//g)) named.add(match[1]);
  return [...named];
}

/**
 * A failed tool result, in the host's own words.
 * Crush reports a non-zero shell exit on its own line, and names an edit failure in prose.
 * A different host adds its markers here rather than guessing at them.
 */
export function failureOf(part, call) {
  const content = String(part.content ?? "");
  const command = commandOf(call?.input);
  const subject = command || targetOf(call?.input);
  const exit = content.match(/^(?:Exit code|exit status) ([1-9]\d*)\s*$/m);
  if (exit) {
    return isExpectedExit(command)
      ? { marker: "expected-exit", detail: `exited ${exit[1]}, which is the answer here`, command, subject }
      : { marker: "tool-failure", detail: `exited ${exit[1]}`, command, subject };
  }
  if ((part.name === "edit" || part.name === "multiedit") && /old_string not found in file/i.test(content)) {
    return { marker: "tool-failure", detail: "the edit text did not match the file", command, subject };
  }
  const first = content.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (/^(Error:|Error \[|fatal:|panic:)/.test(first)) {
    return { marker: "tool-failure", detail: excerpt(first, 80), command, subject };
  }
  return null;
}

function contextBefore(messages, index, window = CONTEXT_WINDOW) {
  for (let i = index - 1; i >= 0 && i >= index - window; i--) {
    if (messages[i]?.role !== "assistant") continue;
    const text = (messages[i].parts ?? []).map((part) => part.text ?? "").join(" ");
    if (text.trim()) return text;
  }
  return "";
}

function severityFor(marker, suspects, count) {
  if (marker === "expected-exit") return "low";
  if (suspects.length) return "high";
  return count > 1 ? "medium" : "low";
}

export function skillNamesOnDisk(dir = null) {
  const candidates = dir ? [dir] : ["skills", path.join(".agents", "skills")];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const names = fs
      .readdirSync(candidate, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^x-[a-z0-9-]+$/.test(entry.name))
      .map((entry) => entry.name);
    if (names.length) return { dir: candidate, names: names.sort() };
  }
  return { dir: null, names: [] };
}

function collectSkills(session, keep) {
  const loaded = session.skills.map((skill) => skill.name);
  const used = new Set();
  for (const message of session.messages) {
    for (const part of message.parts) {
      const blob = [part.name, part.input, part.text, part.content].filter(Boolean).join(" ");
      for (const name of keep(skillMentions(blob))) used.add(name);
    }
  }
  return { loaded, used: [...used].sort(), unused: loaded.filter((name) => !used.has(name)) };
}

function countRoles(messages) {
  return {
    messages: messages.length,
    userMessages: messages.filter((message) => message.role === "user").length,
    assistantMessages: messages.filter((message) => message.role === "assistant").length,
  };
}

/** One pass over every part: tool calls, their results, repeated calls, and the paths they mention. */
function scanParts(messages, keep) {
  const stats = { toolCalls: 0, toolResults: 0, toolFailures: 0, expectedExits: 0 };
  const calls = new Map();
  const callCounts = new Map();
  const failures = [];
  const runFolders = new Set();
  const artifacts = new Set();

  const notePaths = (text) => {
    for (const match of String(text ?? "").matchAll(RUN_FOLDER_RE)) runFolders.add(match[1]);
    for (const match of String(text ?? "").matchAll(ARTIFACT_RE)) artifacts.add(`E${match[1]}-${match[2]}`);
  };

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool_call") {
        stats.toolCalls++;
        calls.set(part.id, part);
        notePaths(part.input);
        const key = `${part.name}|${part.input ?? ""}`;
        const seen = callCounts.get(key);
        if (seen) seen.count++;
        else callCounts.set(key, { part, message: message.index, count: 1 });
        continue;
      }

      if (part.type === "tool_result") {
        stats.toolResults++;
        notePaths(part.content);
        const verdict = recordFailure(failures, { part, call: calls.get(part.id), messages, index: message.index, keep });
        if (verdict === "expected-exit") stats.expectedExits++;
        else if (verdict === "failure") stats.toolFailures++;
        continue;
      }

      if (part.type === "text" || part.type === "reasoning") notePaths(part.text);
    }
  }

  const repeats = [...callCounts.values()]
    .filter((entry) => entry.count > 1)
    .map((entry) => ({
      tool: entry.part.name,
      count: entry.count,
      message: entry.message,
      excerpt: excerpt(entry.part.input, 120),
    }));

  return { stats: { ...stats, repeats: repeats.length }, failures, repeats, runFolders: [...runFolders].sort(), artifacts: [...artifacts].sort() };
}

/**
 * Classify one tool result, attribute it to the skills its call and its context mention, and record it.
 * Returns the marker, so the caller can keep the counts without knowing how a failure is detected.
 */
function recordFailure(failures, { part, call, messages, index, keep }) {
  const failure = failureOf(part, call);
  if (!failure) return null;
  const near = contextBefore(messages, index);
  const suspects = keep(skillMentions([call?.input, near].filter(Boolean).join(" ")));
  addFailure(failures, { failure, part, call, index, suspects });
  return failure.marker === "expected-exit" ? "expected-exit" : "failure";
}

/** The same failing command is one finding, so the report reads as gaps rather than as attempts. */
function addFailure(failures, { failure, part, call, index, suspects }) {
  const key = `${failure.marker}|${failure.command || part.name}`;
  const evidence = { message: index, tool: part.name ?? call?.name ?? "?", excerpt: excerpt(part.content) };
  const known = failures.find((entry) => entry.key === key);
  if (known) {
    known.count++;
    if (known.evidence.length < MAX_EVIDENCE) known.evidence.push(evidence);
    return;
  }
  failures.push({
    key,
    marker: failure.marker,
    detail: failure.detail,
    command: failure.command,
    subject: failure.subject,
    tool: part.name ?? call?.name ?? "?",
    suspects,
    count: 1,
    evidence: [evidence],
  });
}

/** The two shapes a user message takes when something went wrong: a correction, or a bare nudge. */
function scanUserMessages(messages) {
  const corrections = [];
  const reprompts = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim();
    if (!text) continue;
    const words = text.split(/\s+/).filter(Boolean);
    if (CORRECTION_RE.test(text) && words.length > 2) {
      corrections.push({ message: message.index, tool: null, excerpt: excerpt(text) });
    } else if (words.length <= REPROMPT_MAX_WORDS && REPROMPT_RE.test(text)) {
      reprompts.push({ message: message.index, tool: null, excerpt: excerpt(text) });
    }
  }
  return { corrections, reprompts };
}

/** How an assistant turn ended: on a panel, on a question in prose, or neither. */
function scanAssistantTurns(messages) {
  const proseQuestions = [];
  let panels = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.parts.some((part) => part.type === "tool_call" && part.name === "question")) {
      panels++;
      continue;
    }
    const prose = stripFences(
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
    );
    const lines = prose
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    if (last.endsWith("?") && last.length <= PROSE_QUESTION_MAX_CHARS) {
      proseQuestions.push({ message: message.index, tool: null, excerpt: excerpt(last) });
    }
  }
  return { panels, proseQuestions };
}

function failurePayloads(failures) {
  return failures.map((failure) => ({
    kind: failure.marker,
    severity: severityFor(failure.marker, failure.suspects, failure.count),
    summary:
      failure.marker === "expected-exit"
        ? `${failure.tool} "${excerpt(failure.command, 80)}" ${failure.detail}`
        : `${failure.tool} failed (${failure.detail}): ${excerpt(failure.subject || failure.tool, 100)}`,
    count: failure.count,
    suspects: failure.suspects,
    evidence: failure.evidence,
  }));
}

function repeatPayloads(repeats, keep) {
  return repeats.map((repeat) => ({
    kind: "repeat-call",
    severity: repeat.count > 2 ? "medium" : "low",
    summary: `${repeat.tool} called ${repeat.count}x with identical input`,
    count: repeat.count,
    suspects: keep(skillMentions(repeat.excerpt)),
    evidence: [{ message: repeat.message, tool: repeat.tool, excerpt: repeat.excerpt }],
  }));
}

/** Corrections, nudges and prose questions: the user's own evidence, in one shape. */
function userPayloads({ users, turns, skills }) {
  const groups = [
    {
      found: users.corrections,
      kind: "user-correction",
      severity: "high",
      summary: (count) => `the user corrected the agent ${count}x`,
    },
    {
      found: users.reprompts,
      kind: "user-reprompt",
      severity: users.reprompts.length > 1 ? "medium" : "low",
      summary: (count) => `the user nudged the agent ${count}x ("continue", "go on")`,
    },
    {
      found: turns.proseQuestions,
      kind: "prose-question",
      severity: "medium",
      summary: (count) => `the agent ended its turn with a question in prose ${count}x instead of a panel`,
    },
  ];
  return groups
    .filter((group) => group.found.length)
    .map((group) => ({
      kind: group.kind,
      severity: group.severity,
      summary: group.summary(group.found.length),
      count: group.found.length,
      suspects: skills.loaded,
      evidence: group.found.slice(0, MAX_EVIDENCE),
    }));
}

function unusedPayload(skills) {
  if (!skills.unused.length) return [];
  return [
    {
      kind: "skill-unused",
      severity: "low",
      summary: `loaded but never used: ${skills.unused.join(", ")}`,
      count: skills.unused.length,
      suspects: skills.unused,
      evidence: [],
    },
  ];
}

function buildSignals({ partScan, users, turns, skills, keep }) {
  const payloads = [
    ...failurePayloads(partScan.failures),
    ...repeatPayloads(partScan.repeats, keep),
    ...userPayloads({ users, turns, skills }),
    ...unusedPayload(skills),
  ];
  return payloads.map((payload, index) => ({ id: `S${index + 1}`, ...payload }));
}

function buildNotes(stats) {
  const notes = [];
  if (!stats.messages) notes.push("the transcript has no messages");
  if (stats.messages && !stats.toolCalls) notes.push("no tool calls in this session; most friction signals come from tool use");
  if (stats.toolFailures > 10) {
    notes.push(`${stats.toolFailures} failures recorded; verify each one before proposing, most belong to the agent rather than the skills`);
  }
  notes.push("severity is mechanical: high means the failing call names a skill, not that the skill is at fault");
  return notes;
}

export function scanSession(session, { skillNames = [], skillsSource = null } = {}) {
  const messages = session.messages ?? [];
  const allowed = new Set([...skillNames, ...session.skills.map((skill) => skill.name)]);
  const keep = (names) => (skillNames.length ? names.filter((name) => allowed.has(name)) : names);

  const partScan = scanParts(messages, keep);
  const users = scanUserMessages(messages);
  const turns = scanAssistantTurns(messages);
  const skills = collectSkills(session, keep);
  const stats = {
    ...countRoles(messages),
    toolCalls: partScan.stats.toolCalls,
    toolResults: partScan.stats.toolResults,
    panels: turns.panels,
    toolFailures: partScan.stats.toolFailures,
    expectedExits: partScan.stats.expectedExits,
    repeats: partScan.stats.repeats,
    corrections: users.corrections.length,
    reprompts: users.reprompts.length,
    proseQuestions: turns.proseQuestions.length,
  };

  return {
    source: session.source ?? null,
    stats,
    skillsSource,
    skills,
    runFolders: partScan.runFolders,
    artifacts: partScan.artifacts,
    signals: buildSignals({ partScan, users, turns, skills, keep }),
    notes: buildNotes(stats),
  };
}

export function readInput({ input = null, file = null, session = null, cwd = null, limit = DEFAULT_CLIP } = {}) {
  if (input) {
    const raw = JSON.parse(fs.readFileSync(input, "utf8"));
    return isNormalized(raw) ? raw : normalizeSession(raw, { limit });
  }
  return loadSession({ file, session, cwd, limit });
}

function usage() {
  return [
    "x-autoreflection scan-session — extract friction signals from a session transcript.",
    "",
    "Usage:",
    "  node scan-session.mjs --input /tmp/session.json --out /tmp/signals.json",
    "  node scan-session.mjs --session last",
    "  node scan-session.mjs --file <raw-host-dump.json>",
    "",
    "Flags:",
    "  --input <path>    Normalized transcript from read-session.mjs (preferred)",
    "  --session <id>    Read the session straight from the host (id or \"last\")",
    "  --file <path>     Read a raw host dump, normalized on the way in",
    "  --out <path>      Write the scan JSON here (default: stdout)",
    "  --skills-dir <d>  Folder holding the skill directories (default: skills/, then .agents/skills/)",
    "  --cwd <dir>       Run the host command in this directory",
    "  --help            Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    known: ["input", "session", "file", "out", "skills-dir", "cwd", "help"],
  });
  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    if (args.help) {
      process.stdout.write(usage());
      return;
    }
    const session = readInput({
      input: args.input || null,
      file: args.file || null,
      session: args.session || null,
      cwd: args.cwd || null,
    });
    const found = skillNamesOnDisk(typeof args["skills-dir"] === "string" ? args["skills-dir"] : null);
    const result = scanSession(session, { skillNames: found.names, skillsSource: found.dir });
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (typeof args.out === "string") {
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      fs.writeFileSync(args.out, json);
      process.stdout.write(
        `${JSON.stringify({
          out: args.out,
          signals: result.signals.length,
          high: result.signals.filter((signal) => signal.severity === "high").length,
        })}\n`
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
