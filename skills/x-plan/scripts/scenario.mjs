#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { formatStamp, resolveRunDir, resolveArtifact } from "./shared.js";

export const SKILL = "x-plan";
export const REPORT_ROOT = ".x-skills/runs";
export const START_NODE = "intake";
export const STOPS = ["handoff", "abandon"];

const ABANDON_EDGES = ["intake", "research", "clarify", "propose", "decide", "spec", "gate"].map(
  (from) => ({ from, to: "abandon", guards: [] })
);

export const GRAPH = {
  nodes: ["intake", "research", "clarify", "propose", "decide", "spec", "gate", "handoff", "abandon"],
  edges: [
    { from: "intake", to: "research", guards: [] },
    { from: "research", to: "clarify", guards: ["research_recorded"] },
    { from: "clarify", to: "clarify", guards: [] },
    { from: "clarify", to: "propose", guards: ["no_open_questions", "three_options"] },
    { from: "propose", to: "decide", guards: ["three_options"] },
    { from: "decide", to: "spec", guards: ["decision_made"] },
    { from: "spec", to: "gate", guards: ["spec_complete"] },
    { from: "gate", to: "handoff", guards: ["gate_approved"] },
    ...ABANDON_EDGES,
  ],
};

const SPEC_MARKERS = ["contract", "invariant", "test"];

function pad(value) {
  return String(value).padStart(2, "0");
}

export function stamp(now = new Date()) {
  return formatStamp(now);
}

function gate(pass, expected, actual) {
  return { actual, expected, pass };
}

function hasSpec(text) {
  return SPEC_MARKERS.every((marker) => text.includes(marker)) && text.includes("## Layers");
}

export function createState({ slug, goal = null, root = REPORT_ROOT, now = new Date(), fresh = false, run = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const when = now.toISOString();
  const runDirAbs = resolveRunDir(slug, { now, root, fresh, run });
  const planAbs = resolveArtifact(runDirAbs, "plan", "md");
  return {
    skill: SKILL,
    slug,
    goal,
    createdAt: when,
    updatedAt: when,
    node: START_NODE,
    stops: STOPS,
    graph: GRAPH,
    guards: {},
    openQuestions: [],
    options: [],
    decision: null,
    runDir: path.relative(process.cwd(), runDirAbs) || runDirAbs,
    report: path.basename(planAbs),
    events: [],
  };
}

export function computeGuards(state, { reportText = "" } = {}) {
  const research = state.events.filter((event) => event.kind === "research");
  const answered = state.openQuestions.every((question) => question.status === "answered");
  const approved = state.events.some((event) => event.kind === "approve");
  return {
    research_recorded: gate(research.some((event) => event.status !== "not-run"), ">=1 research event", `${research.length} research`),
    no_open_questions: gate(answered, "all answered", `${state.openQuestions.filter((q) => q.status !== "answered").length} open`),
    three_options: gate(state.options.length >= 3, 3, state.options.length),
    decision_made: gate(state.decision !== null, "a decision", state.decision ? "recorded" : "none"),
    spec_complete: gate(hasSpec(reportText), "contract, invariant, test, ## Layers", reportText.trim() ? `${reportText.length} bytes` : "empty"),
    gate_approved: gate(approved, "approval event", approved ? "recorded" : "none"),
  };
}

function answerQuestion(list, target, answer) {
  const index = target ? list.findIndex((question) => question.id === target) : list.findIndex((question) => question.status === "open");
  if (index < 0) return list;
  return list.map((question, i) => (i === index ? { ...question, status: "answered", answer } : question));
}

export function applyEvent(state, { kind, data = null, status = null, reason = null, target = null } = {}, now = new Date()) {
  const entry = { kind, data, status, reason, target, at: now.toISOString() };
  const base = { ...state, events: [...state.events, entry], updatedAt: entry.at };
  if (kind === "question") {
    return { ...base, openQuestions: [...state.openQuestions, { id: `Q${state.openQuestions.length + 1}`, text: data, status: "open", answer: null }] };
  }
  if (kind === "answer") {
    return { ...base, openQuestions: answerQuestion(state.openQuestions, target, data) };
  }
  if (kind === "option") {
    return { ...base, options: [...state.options, { id: `O${state.options.length + 1}`, summary: data, at: entry.at }] };
  }
  if (kind === "decide") {
    return { ...base, decision: { summary: data, at: entry.at } };
  }
  return base;
}

export function findEdge(state, to) {
  return state.graph.edges.find((edge) => edge.from === state.node && edge.to === to) || null;
}

/** Name the moves that are legal from here, so a refusal says how to proceed instead of only what failed. */
function noEdgeError(state, to) {
  const legal = [...new Set(state.graph.edges.filter((edge) => edge.from === state.node).map((edge) => edge.to))];
  return `no edge ${state.node} -> ${to}; from ${state.node} you can go to: ${legal.join(", ") || "nothing, this is a stop"}`;
}


export function transition(state, to, { reportText = "" } = {}) {
  const edge = findEdge(state, to);
  if (!edge) return { ok: false, error: noEdgeError(state, to), state };
  const guards = computeGuards(state, { reportText });
  const failed = edge.guards.filter((name) => !guards[name].pass);
  if (failed.length) return { ok: false, error: `${failed[0]} failed`, failed, guards, state };
  return { ok: true, state: { ...state, node: to, guards, updatedAt: new Date().toISOString() } };
}

export function verifyState(state, { reportText = "" } = {}) {
  const guards = computeGuards(state, { reportText });
  const isStop = STOPS.includes(state.node);
  const required = state.node === "handoff" ? Object.keys(guards) : [];
  const checks = required.map((name) => ({ name, ...guards[name] }));
  return {
    ok: isStop && checks.every((check) => check.pass),
    node: state.node,
    stop: isStop,
    checks,
    guards,
  };
}

export function renderGraphMermaid(state) {
  const lines = ["```mermaid", "graph LR"];
  for (const edge of state.graph.edges) {
    lines.push(edge.guards.length ? `  ${edge.from} -->|${edge.guards.join(",")}| ${edge.to}` : `  ${edge.from} --> ${edge.to}`);
  }
  lines.push(`  classDef current stroke-width:3px,stroke:#f60`);
  lines.push(`  class ${state.node} current`);
  lines.push("```");
  return lines.join("\n");
}

export function renderMemoryLine(entry) {
  const detail = [entry.kind, entry.data, entry.status, entry.reason].filter((part) => part !== null && part !== undefined && part !== "").join(": ");
  return `- [${entry.at}] ${detail}`;
}

export function upsertScenario(text, mermaid) {
  const section = `## Scenario\n\n${mermaid}\n`;
  const pattern = /## Scenario[\s\S]*?(?=\n## |\s*$)/;
  if (pattern.test(text)) return text.replace(pattern, section);
  return `${text.trimEnd()}\n\n${section}`;
}

function loadState(dir) {
  const file = path.join(dir, "state.json");
  if (!fs.existsSync(file)) throw new Error(`no state.json in ${dir}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The plan lives inside the run folder, so it is named, not located: `report` holds a file name and the
 * directory comes from the `--dir` the command was given. A cwd-relative path here made every command
 * depend on the directory it ran from, which is the one thing a run folder must not do.
 */
function reportTextFor(dir, state) {
  const file = path.join(dir, state.report);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function writeMemory(dir, state, fromIndex) {
  const file = path.join(dir, "memory.md");
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# Memory — ${state.slug}\n\n`);
  const lines = state.events.slice(fromIndex).map(renderMemoryLine).join("\n");
  if (lines) fs.appendFileSync(file, `${lines}\n`);
}

/**
 * The plan is written before the memory and the state, so a write that fails leaves the node where it
 * was. Committing the state first reported failure for a transition that had already happened.
 */
function persist(dir, state, { fromIndex, writeReport }) {
  fs.mkdirSync(dir, { recursive: true });
  if (writeReport) {
    const text = reportTextFor(dir, state);
    const body = upsertScenario(text || `# Plan — ${state.slug}\n`, renderGraphMermaid(state));
    fs.writeFileSync(path.join(dir, state.report), body);
  }
  writeMemory(dir, state, fromIndex);
  fs.writeFileSync(path.join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      out[key] = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : true;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function usage() {
  return [
    "x-plan scenario — graph-driven planning state machine.",
    "",
    "Usage:",
    "  node scenario.mjs start --slug <s> [--goal <text>] [--root <dir>]",
    "  node scenario.mjs status --dir <dir>",
    "  node scenario.mjs record --dir <dir> --event <kind> [--data <text>] [--target <id>] [--status <s>] [--reason <r>]",
    "  node scenario.mjs record --dir <dir> --to <node>",
    "  node scenario.mjs guard  --dir <dir> --gate <name>",
    "  node scenario.mjs verify --dir <dir>   # exit 0 iff the stop is justified",
    "",
  ].join("\n");
}

function commandStart(args) {
  if (!args.slug || args.slug === true) throw new Error("--slug is required");
  const root = args.root === true || !args.root ? REPORT_ROOT : args.root;
  const state = createState({
    slug: args.slug,
    goal: args.goal === true ? null : args.goal,
    root,
    fresh: args["new-run"] === true,
    run: args.run === undefined || args.run === true ? null : Number(args.run),
  });
  const dir = state.runDir;
  persist(dir, state, { fromIndex: 0, writeReport: true });
  return { dir, state, node: state.node };
}

function commandRecord(args) {
  if (!args.dir || args.dir === true) throw new Error("--dir is required");
  const before = loadState(args.dir);
  let state = before;
  if (args.event !== undefined) {
    state = applyEvent(state, {
      kind: args.event,
      data: args.data === true ? null : args.data ?? null,
      status: args.status === true ? null : args.status ?? null,
      reason: args.reason === true ? null : args.reason ?? null,
      target: args.target === true ? null : args.target ?? null,
    });
  }
  if (args.to !== undefined) {
    const result = transition(state, args.to, { reportText: reportTextFor(args.dir, state) });
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  persist(args.dir, state, { fromIndex: before.events.length, writeReport: true });
  return { dir: args.dir, state, node: state.node };
}

function commandGuard(args) {
  if (!args.dir || args.dir === true) throw new Error("--dir is required");
  const state = loadState(args.dir);
  const verdict = computeGuards(state, { reportText: reportTextFor(args.dir, state) })[args.gate];
  if (!verdict) throw new Error(`unknown gate "${args.gate}"`);
  process.stdout.write(`${JSON.stringify({ gate: args.gate, ...verdict }, null, 2)}\n`);
  process.exit(verdict.pass ? 0 : 1);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    if (!command || command === "--help" || command === "-h") {
      process.stdout.write(usage());
      return;
    }
    if (command === "start") {
      process.stdout.write(`${JSON.stringify(commandStart(args), null, 2)}\n`);
      return;
    }
    if (command === "status") {
      if (!args.dir || args.dir === true) throw new Error("--dir is required");
      const state = loadState(args.dir);
      process.stdout.write(`${JSON.stringify({ dir: args.dir, state, node: state.node }, null, 2)}\n`);
      return;
    }
    if (command === "record") {
      process.stdout.write(`${JSON.stringify(commandRecord(args), null, 2)}\n`);
      return;
    }
    if (command === "guard") {
      commandGuard(args);
      return;
    }
    if (command === "verify") {
      if (!args.dir || args.dir === true) throw new Error("--dir is required");
      const state = loadState(args.dir);
      const result = verifyState(state, { reportText: reportTextFor(args.dir, state) });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.ok ? 0 : 1);
    }
    throw new Error(`unknown command "${command}"`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
