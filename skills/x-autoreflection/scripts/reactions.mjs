/**
 * The quality anchors a session leaves when nothing fails: what the user did after a reply, and a skill
 * script that "succeeded" without saying anything. A clean-but-weak session produces no failed command,
 * but it does produce these, and each one names the moment a reflection should look at.
 *
 * Each detector here was measured precise on a week of real sessions; the broad "pushback" reading of
 * user turns needs a model and lives in `classify-turns.mjs`.
 */

/** A user asking for the same work again, in the words these sessions used for it. */
export const REDO_RE =
  /\b(once again|another (full )?(round|pass|go)|one more time|re-?do|start over|from scratch|do it (again|properly|right)|again check|check again|jeszcze raz|ponownie|od nowa)\b/i;

/** A user giving up on this agent: packaging the work for another one, or taking it back. */
export const HANDOFF_RE =
  /\b(another agent|other agent|pass it to|hand (it )?off|as (an? )?(llm )?prompt|i'?ll do it myself|i will do it myself|never ?mind|forget it|i give up)\b/i;

/** A host's own refusal notice opens the tool result; the same sentence quoted inside other output is not one. */
const REJECTED_RE = /^(The user doesn't want to proceed with this tool use|User (denied|rejected)|Permission denied by (the )?user)/i;
const INTERRUPT_TEXT_RE = /^\[Request interrupted by user/;
const SKILL_SCRIPT_RUN_RE = /\bnode\s+[^|;&]*?skills\/(x-[a-z0-9-]+)\/scripts\/([A-Za-z0-9._-]+\.(?:mjs|js|cjs))/;
/** Standard output sent to a file or `/dev/null`; `2>&1` and `2>` leave it on screen. */
const STDOUT_REDIRECT_RE = /(?:^|\s)(?:1?>|>>)\s*(?!&)\S+/;
const SILENT_OUTPUT_RE = /^(no output|exit(?:=| code )?0)?$/i;
const EXIT_MARKER_RE = /^(?:Exit code|exit status) [1-9]\d*\s*$/m;
const SKILL_BODY_RE = /^Base directory for this skill:\s*\S*\/skills\/([A-Za-z0-9._:-]+)/;
const INJECTED_RE =
  /^(Base directory for this skill:|<local-command|<command-name>|<command-message>|Caveat:|<system-reminder>|<environment_context>|<user_instructions>|<task-notification>|\[Request interrupted|\[Your previous response|\(Re-invocation of)/;

/** The model classes (`classify-turns.mjs`) that say the reply before the turn fell short. */
export const NEGATIVE_CLASSES = new Set(["pushback", "redo", "handoff", "verify-ask"]);

/** Enough words to tell one request from another when two sessions are compared. */
export const MIN_REQUEST_WORDS = 8;
const MAX_EVIDENCE = 3;

function excerpt(text, limit = 160) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function inputOf(part) {
  try {
    const parsed = JSON.parse(part.input ?? "");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function textOf(message) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ")
    .trim();
}

/** The user's own turns: what a host injects into the user role (skill bodies, caveats) is not the user. */
export function userTurns(messages) {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => ({ index: message.index, created: message.created ?? null, text: textOf(message) }))
    .filter((turn) => turn.text && !INJECTED_RE.test(turn.text));
}

/** The first real request: the opening user turn long enough to compare one session with another. */
export function requestOf(messages) {
  const turn = userTurns(messages).find((candidate) => candidate.text.split(/\s+/).length >= MIN_REQUEST_WORDS);
  return turn ? { message: turn.index, created: turn.created, text: excerpt(turn.text, 400) } : null;
}

/**
 * The fields of a tool call that say what it acts on. A written file's content or an edit's new text
 * can mention any skill's path without the session using that skill.
 */
function targetsOf(input) {
  const edits = Array.isArray(input.edits) ? input.edits.map((edit) => edit?.file_path) : [];
  return [input.command, input.file_path, input.path, ...edits].filter((value) => typeof value === "string");
}

function skillsActiveIn(message, keep) {
  return message.parts.flatMap((part) => {
    if (part.type === "tool_call") {
      const input = inputOf(part);
      const invoked = part.name === "Skill" && typeof input.skill === "string" ? [input.skill] : [];
      const touched = targetsOf(input).flatMap((target) => [...target.matchAll(/skills\/(x-[a-z0-9-]+)\//g)].map((match) => match[1]));
      return keep([...invoked, ...touched]);
    }
    if (message.role === "user" && part.type === "text") {
      const match = String(part.text ?? "").match(SKILL_BODY_RE);
      return match ? keep([match[1]]) : [];
    }
    return [];
  });
}

/**
 * Which skill was in charge at each point: every message that invoked a skill, injected its body, or
 * touched one of its files. A reaction belongs to the skill whose step produced the reply the user
 * reacted to, not to every skill the session happened to load.
 */
export function ownerTimeline(messages, keep = (names) => names) {
  return messages.flatMap((message) => skillsActiveIn(message, keep).map((skill) => ({ index: message.index, skill })));
}

export function ownerAt(timeline, index, fallback = null) {
  const before = timeline.filter((event) => event.index <= index);
  return before.length ? before[before.length - 1].skill : fallback;
}

function phraseReactions(turns, re) {
  return turns.filter((turn) => re.test(turn.text)).map((turn) => ({ message: turn.index, tool: null, excerpt: excerpt(turn.text) }));
}

function rejections(messages) {
  return messages.flatMap((message) =>
    message.parts
      .filter((part) => part.type === "tool_result" && REJECTED_RE.test(String(part.content ?? "").trim()))
      .map((part) => ({ message: message.index, tool: part.name ?? null, excerpt: excerpt(part.content, 120) }))
  );
}

function interrupts(messages) {
  return messages.flatMap((message) =>
    message.parts
      .filter(
        (part) =>
          (part.type === "finish" && part.reason === "canceled") ||
          (message.role === "user" && part.type === "text" && INTERRUPT_TEXT_RE.test(part.text ?? ""))
      )
      .map(() => ({ message: message.index, tool: null, excerpt: "the user stopped the turn" }))
  );
}

function resultsById(messages) {
  return new Map(
    messages.flatMap((message) => message.parts.filter((part) => part.type === "tool_result").map((part) => [part.id, part]))
  );
}

function isSilent(result) {
  const content = String(result?.content ?? "").replace(/<cwd>[^<]*<\/cwd>/g, "").trim();
  return !EXIT_MARKER_RE.test(content) && SILENT_OUTPUT_RE.test(content);
}

/**
 * A skill's own script that exited 0 and printed nothing, output not redirected. Every skill script
 * reports what it did, so silence means `main()` never ran — the symlinked-install bug — or a stale copy.
 */
function silentScripts(messages) {
  const results = resultsById(messages);
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== "tool_call") return [];
      const { command } = inputOf(part);
      const run = typeof command === "string" ? command.match(SKILL_SCRIPT_RUN_RE) : null;
      if (!run || STDOUT_REDIRECT_RE.test(command) || !results.has(part.id) || !isSilent(results.get(part.id))) return [];
      return [{ skill: run[1], script: run[2], message: message.index, tool: part.name ?? null, excerpt: excerpt(command, 120) }];
    })
  );
}

function ownersOf(evidence, timeline, fallback) {
  return [...new Set(evidence.map((entry) => ownerAt(timeline, entry.message, fallback)).filter(Boolean))];
}

/** An assistant turn that waits on nobody: no panel rendered, and its last line is not a question. */
function awaitsNobody(message) {
  if (message.parts.some((part) => part.type === "tool_call" && part.name === "question")) return false;
  const last = textOf(message).split(/\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "";
  return !last.endsWith("?");
}

/**
 * The session ended on the agent's answer and the user never came back: no follow-up, no thanks, no
 * new task. A weak signal on its own — a finished one-shot looks exactly the same — so it only earns
 * a reading when it combines with another weak signal (`user-dissatisfied` in anchors.mjs). A session
 * still waiting on the user (a question, a panel) or one where the user spoke last is not this.
 */
function abandonment(messages, request) {
  if (!request || !messages.length) return [];
  const last = messages[messages.length - 1];
  if (last.role !== "assistant") return [];
  const reply = textOf(last);
  if (!reply || !awaitsNobody(last)) return [];
  const worked = messages.some((message) => message.parts.some((part) => part.type === "tool_call"));
  const answers = messages.filter((message) => message.role === "assistant" && textOf(message)).length;
  if (!worked && answers < 2) return [];
  return [{ message: last.index, tool: null, excerpt: excerpt(reply) }];
}

function reactionPayload({ kind, found, timeline, fallback, severity, summary }) {
  if (!found.length) return [];
  const suspects = ownersOf(found, timeline, fallback);
  return [
    {
      kind,
      severity: typeof severity === "function" ? severity(suspects) : severity,
      summary: summary(found.length),
      count: found.length,
      suspects,
      evidence: found.slice(0, MAX_EVIDENCE),
    },
  ];
}

function silentPayloads(found) {
  const bySkillScript = found.reduce((groups, entry) => {
    const key = `${entry.skill}/${entry.script}`;
    return { ...groups, [key]: [...(groups[key] ?? []), entry] };
  }, {});
  return Object.entries(bySkillScript).map(([key, entries]) => ({
    kind: "skill-script-silent",
    severity: "high",
    summary: `skills/${key.replace("/", "/scripts/")} exited 0 and printed nothing ${entries.length}x`,
    count: entries.length,
    suspects: [entries[0].skill],
    evidence: entries.slice(0, MAX_EVIDENCE).map(({ message, tool, excerpt: text }) => ({ message, tool, excerpt: text })),
  }));
}

/**
 * The user's reactions and the silent scripts of one session, as scan signals plus their counts. Redo
 * and handoff are read only after the opening request, so a session that starts by re-asking earlier
 * work is not blamed for it — that is `cross-session-retry`, measured across sessions.
 */
/**
 * The turns a model read as falling short that no phrase detector already caught. They form their own
 * kind, `user-pushback`, because nothing has validated the model's reading yet: the review's labels do.
 */
function modelPushback(turns, messages, caught) {
  const byIndex = new Map(userTurns(messages).map((turn) => [turn.index, turn.text]));
  return (turns ?? [])
    .filter((turn) => NEGATIVE_CLASSES.has(turn.class) && byIndex.has(turn.message) && !caught.has(turn.message))
    .map((turn) => ({ message: turn.message, tool: null, excerpt: excerpt(`[${turn.class}] ${byIndex.get(turn.message)}`) }));
}

export function scanReactions(messages, { keep = (names) => names, loaded = [], turns = [] } = {}) {
  const timeline = ownerTimeline(messages, keep);
  const fallback = loaded.length === 1 ? loaded[0] : null;
  const request = requestOf(messages);
  const later = userTurns(messages).filter(
    (turn) => turn.index > (request?.message ?? -1) && turn.text.split(/\s+/).filter(Boolean).length > 3
  );
  const found = {
    redo: phraseReactions(later, REDO_RE),
    handoff: phraseReactions(later, HANDOFF_RE),
    rejected: rejections(messages),
    interrupted: interrupts(messages),
    silent: silentScripts(messages).filter((entry) => keep([entry.skill]).length),
    abandoned: abandonment(messages, request),
  };
  const caught = new Set([...found.redo, ...found.handoff].map((entry) => entry.message));
  found.pushback = modelPushback(turns, messages, caught);
  const payloads = [
    ...reactionPayload({ kind: "user-redo", found: found.redo, timeline, fallback, severity: "high", summary: (n) => `the user asked for the same work again ${n}x` }),
    ...reactionPayload({ kind: "user-handoff", found: found.handoff, timeline, fallback, severity: "high", summary: (n) => `the user handed the work to someone else ${n}x` }),
    ...reactionPayload({
      kind: "tool-rejected",
      found: found.rejected,
      timeline,
      fallback,
      severity: (suspects) => (suspects.length ? "high" : "medium"),
      summary: (n) => `the user refused a tool call ${n}x`,
    }),
    ...silentPayloads(found.silent),
    ...reactionPayload({
      kind: "user-pushback",
      found: found.pushback,
      timeline,
      fallback,
      severity: "medium",
      summary: (n) => `a model read ${n} user turn(s) as pushback on the reply before (unvalidated)`,
    }),
    ...reactionPayload({ kind: "interrupt", found: found.interrupted, timeline, fallback, severity: "low", summary: (n) => `the user stopped a turn ${n}x` }),
    ...reactionPayload({
      kind: "user-abandon",
      found: found.abandoned,
      timeline,
      fallback,
      severity: "low",
      summary: () => "the session ended on the agent's answer; the user never replied",
    }),
  ];
  return {
    request,
    timeline,
    lastOwner: timeline.length ? timeline[timeline.length - 1].skill : fallback,
    payloads,
    stats: {
      redoRequests: found.redo.length,
      handoffs: found.handoff.length,
      rejections: found.rejected.length,
      interrupts: found.interrupted.length,
      silentScripts: found.silent.length,
      pushback: found.pushback.length,
      abandons: found.abandoned.length,
    },
  };
}
