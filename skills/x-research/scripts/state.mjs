#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PHASES = ["baseline", "iterate", "done", "escalate"];
export const STOP_PHASES = new Set(["done", "escalate"]);
export const DIRECTIONS = ["maximize", "minimize"];
export const POLICIES = ["score_improvement", "pass_only"];
export const DEFAULT_CAP = 10;
export const DEFAULT_MIN_DELTA = 0;
export const DEFAULT_NOISE_RUNS = 1;
export const DEFAULT_TIMEOUT_MS = 60000;
export const DEFAULT_ROOT = ".x-skills/research";

function round(value, places = 3) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function normalizeList(value) {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : String(value).split(",");
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

function normalizeSamples(value) {
  if (value === undefined || value === null) return null;
  const arr = Array.isArray(value) ? value : String(value).split(",");
  const nums = arr.map(Number).filter(Number.isFinite);
  return nums.length ? nums : null;
}

// Minimal glob: `**` crosses directories, `*` stays within one path segment.
export function matchesGlob(pattern, target) {
  const p = String(pattern).trim();
  if (!p) return false;
  const t = String(target).replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        re += ".*";
        i += 1;
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`).test(t);
}

// Constrained search: every changed path must match an `allowed` glob (when any
// are declared) and must not match any `forbidden` glob.
export function searchVerdict(search, changed) {
  const paths = normalizeList(changed);
  const allowed = normalizeList(search?.allowed);
  const forbidden = normalizeList(search?.forbidden);
  const forbiddenHits = paths.filter((p) => forbidden.some((f) => matchesGlob(f, p)));
  const outsideAllowed = allowed.length ? paths.filter((p) => !allowed.some((a) => matchesGlob(a, p))) : [];
  return { allowed, forbidden, paths, forbiddenHits, outsideAllowed, pass: forbiddenHits.length === 0 && outsideAllowed.length === 0 };
}

export function targetMet(state, value) {
  if (!Number.isFinite(value)) return false;
  return state.direction === "minimize" ? value <= state.target : value >= state.target;
}

export function startState({
  slug,
  goal,
  metric,
  direction = "maximize",
  target,
  policy = "score_improvement",
  evaluator,
  guard = null,
  allowed,
  forbidden,
  noiseRuns = DEFAULT_NOISE_RUNS,
  minDelta = DEFAULT_MIN_DELTA,
  cap = DEFAULT_CAP,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = new Date(),
} = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  if (!metric || typeof metric !== "string") throw new Error("metric is required");
  if (!DIRECTIONS.includes(direction)) throw new Error(`direction must be one of ${DIRECTIONS.join(", ")}`);
  if (!Number.isFinite(target)) throw new Error("target must be a number");
  if (!POLICIES.includes(policy)) throw new Error(`policy must be one of ${POLICIES.join(", ")}`);
  if (!evaluator || typeof evaluator !== "string") throw new Error("evaluator command is required");
  if (!Number.isInteger(cap) || cap < 1) throw new Error("cap must be a positive integer");
  if (!Number.isInteger(noiseRuns) || noiseRuns < 1) throw new Error("noiseRuns must be a positive integer");
  if (!Number.isFinite(minDelta) || minDelta < 0) throw new Error("minDelta must be a non-negative number");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive number");
  return {
    slug,
    goal: goal || null,
    metric,
    direction,
    target,
    policy,
    evaluator,
    guard: guard || null,
    search: { allowed: normalizeList(allowed), forbidden: normalizeList(forbidden) },
    noiseRuns,
    minDelta,
    cap,
    timeoutMs,
    iteration: 0,
    phase: "baseline",
    best: null,
    history: [],
    stopReason: null,
    stopGates: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function bestEntry(state) {
  const it = state.best ? state.best.iteration : null;
  return state.history.find((h) => h.iteration === it) || state.history[state.history.length - 1];
}

// Stop verdict recomputed from the numbers on the held best entry alone.
export function stopVerdict(state, best) {
  const metricGate = { actual: best.score, expected: state.target, pass: targetMet(state, best.score) };
  const evaluatorGate = best.gates.evaluator;
  const guardGate = state.guard ? best.gates.guard : null;
  const pass =
    metricGate.pass && (evaluatorGate ? evaluatorGate.pass : true) && (guardGate ? guardGate.pass : true);
  return { pass, gates: { metric: metricGate, evaluator: evaluatorGate, guard: guardGate } };
}

function commitStopOrAdvance(state) {
  const best = bestEntry(state);
  const stop = stopVerdict(state, best);
  state.stopGates = stop.gates;
  const dir = state.direction === "minimize" ? "<=" : ">=";
  if (stop.pass) {
    state.phase = "done";
    state.stopReason = `target met: ${state.metric} ${dir} ${state.target} (best ${best.score})`;
    return state;
  }
  if (state.iteration >= state.cap) {
    state.phase = "escalate";
    state.stopReason = `cap ${state.cap} reached; best ${state.metric}=${best.score} did not meet ${dir} ${state.target}`;
    return state;
  }
  state.iteration += 1;
  state.phase = "iterate";
  return state;
}

export function recordBaseline(state, { score, samples, pass } = {}) {
  if (state.phase !== "baseline") throw new Error(`not awaiting baseline (phase "${state.phase}")`);
  const nums = normalizeSamples(samples);
  const value = Number.isFinite(Number(score))
    ? Number(score)
    : nums
      ? round(nums.reduce((a, b) => a + b, 0) / nums.length)
      : null;
  if (!Number.isFinite(value)) throw new Error("baseline needs a numeric score (or samples)");
  const entry = {
    iteration: 0,
    kind: "baseline",
    score: value,
    samples: nums,
    pass: pass === undefined ? null : pass === true,
    guardPass: null,
    delta: null,
    decision: "baseline",
    change: null,
    gates: {
      metric: { actual: value, expected: state.target, pass: targetMet(state, value) },
      evaluator: pass === undefined ? null : { actual: pass === true ? 1 : 0, expected: 1, pass: pass === true },
      noise: nums ? { actual: nums.length, expected: state.noiseRuns, pass: nums.length >= state.noiseRuns } : null,
      guard: null,
      atomic: null,
      search: null,
      improvement: null,
    },
    ts: new Date().toISOString(),
  };
  state.history.push(entry);
  state.best = { score: value, iteration: 0 };
  state.iteration = 1;
  state.phase = "iterate";
  const stop = stopVerdict(state, bestEntry(state));
  state.stopGates = stop.gates;
  if (stop.pass) {
    state.phase = "done";
    state.stopReason = `target already met at baseline: ${state.metric} ${state.direction === "minimize" ? "<=" : ">="} ${state.target} (best ${value})`;
  }
  return touch(state);
}

export function recordCandidate(state, { pass, score, samples, guardPass, changed, change } = {}) {
  if (STOP_PHASES.has(state.phase)) throw new Error(`loop already stopped (${state.phase})`);
  if (state.phase !== "iterate") throw new Error(`not awaiting a candidate (phase "${state.phase}")`);
  if (pass === undefined) throw new Error("candidate needs pass (boolean) — pass the evaluator output");
  const nums = normalizeSamples(samples);
  const value = Number.isFinite(Number(score))
    ? Number(score)
    : nums
      ? round(nums.reduce((a, b) => a + b, 0) / nums.length)
      : null;
  if (!Number.isFinite(value)) throw new Error("candidate needs a numeric score (or samples)");
  const paths = normalizeList(changed);
  const search = paths.length ? searchVerdict(state.search, paths) : null;
  const atomicGate = paths.length ? { actual: paths.length, expected: 1, pass: paths.length === 1 } : null;
  const evaluatorGate = { actual: pass === true ? 1 : 0, expected: 1, pass: pass === true };
  const noiseGate = nums ? { actual: nums.length, expected: state.noiseRuns, pass: nums.length >= state.noiseRuns } : null;
  const guardGate = state.guard ? { actual: guardPass === true ? 1 : 0, expected: 1, pass: guardPass === true } : null;
  const prevBest = state.best.score;
  const improvement = state.direction === "minimize" ? prevBest - value : value - prevBest;
  const improvementGate = { actual: round(improvement), expected: state.minDelta, pass: improvement >= state.minDelta };
  const metricGate = { actual: value, expected: state.target, pass: targetMet(state, value) };

  let keep = evaluatorGate.pass;
  if (state.policy === "score_improvement") keep = keep && improvementGate.pass;
  if (noiseGate && !noiseGate.pass) keep = false;
  if (guardGate && !guardGate.pass) keep = false;
  if (atomicGate && !atomicGate.pass) keep = false;
  if (search && !search.pass) keep = false;

  const entry = {
    iteration: state.iteration,
    kind: "candidate",
    score: value,
    samples: nums,
    pass: pass === true,
    guardPass: state.guard ? guardPass === true : null,
    delta: round(improvement),
    decision: keep ? "keep" : "revert",
    change: change || null,
    gates: { metric: metricGate, evaluator: evaluatorGate, noise: noiseGate, guard: guardGate, atomic: atomicGate, search, improvement: improvementGate },
    ts: new Date().toISOString(),
  };
  state.history.push(entry);
  if (keep) state.best = { score: value, iteration: state.iteration };
  commitStopOrAdvance(state);
  return touch(state);
}

export function isStopped(state) {
  return STOP_PHASES.has(state.phase);
}

export function nextAction(state) {
  return state.phase;
}

export function summarize(state) {
  const cands = state.history.filter((h) => h.kind === "candidate");
  const base = state.history.find((h) => h.kind === "baseline");
  const best = state.best || { score: null, iteration: null };
  const gain =
    base && Number.isFinite(best.score)
      ? round(state.direction === "minimize" ? base.score - best.score : best.score - base.score)
      : null;
  return {
    slug: state.slug,
    metric: state.metric,
    direction: state.direction,
    target: state.target,
    policy: state.policy,
    phase: state.phase,
    iteration: state.iteration,
    experiments: cands.length,
    kept: cands.filter((h) => h.decision === "keep").length,
    baselineScore: base ? base.score : null,
    bestScore: best.score,
    bestIteration: best.iteration,
    gain,
    stopReason: state.stopReason,
  };
}

// Re-derive the stop decision from the recorded numbers alone.
export function verify(state) {
  const checks = [];
  let ok = false;
  const best = state.best ? bestEntry(state) : null;
  if (state.phase === "done" && best) {
    const sv = stopVerdict(state, best);
    checks.push({ name: "metric meets target", actual: sv.gates.metric.actual, expected: sv.gates.metric.expected, pass: sv.gates.metric.pass });
    if (sv.gates.evaluator) checks.push({ name: "evaluator pass", actual: sv.gates.evaluator.actual, expected: 1, pass: sv.gates.evaluator.pass });
    if (sv.gates.guard) checks.push({ name: "guard pass", actual: sv.gates.guard.actual, expected: 1, pass: sv.gates.guard.pass });
    ok = checks.every((c) => c.pass);
  }
  return {
    ok,
    phase: state.phase,
    metric: state.metric,
    direction: state.direction,
    target: state.target,
    bestScore: state.best ? state.best.score : null,
    checks,
    stopReason: state.stopReason,
    summary: summarize(state),
  };
}

function touch(state) {
  state.updatedAt = new Date().toISOString();
  return state;
}

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()}-${p(now.getHours())}:${p(now.getMinutes())}`;
}

function stampTime(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function cell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

// --- audit trail files -------------------------------------------------------

export function renderResearchMd(state) {
  const dir = state.direction === "minimize" ? "<=" : ">=";
  const lines = [
    `# Research — ${state.slug}`,
    "",
    `**Goal:** ${state.goal || "(not set)"}`,
    `**Metric:** ${state.metric} (${state.direction} → target ${dir} ${state.target})`,
    `**Policy:** ${state.policy}`,
    `**Evaluator:** \`${state.evaluator}\``,
    `**Guard:** ${state.guard ? `\`${state.guard}\`` : "none"}`,
    `**Search space:** allowed [${state.search.allowed.join(", ") || "any"}]; forbidden [${state.search.forbidden.join(", ") || "none"}]`,
    `**Noise:** noise_runs=${state.noiseRuns}, min_delta=${state.minDelta}`,
    `**Experiment timeout:** ${state.timeoutMs} ms`,
    `**Cap:** ${state.cap}`,
    "",
    "## History",
    "",
    "| # | kind | score | pass | guard | delta | decision | change |",
    "|---|------|-------|------|-------|-------|----------|--------|",
  ];
  for (const h of state.history) {
    lines.push(
      `| ${h.iteration} | ${h.kind} | ${h.score} | ${h.pass === null ? "—" : h.pass} | ${
        h.guardPass === null ? "—" : h.guardPass
      } | ${h.delta === null ? "—" : h.delta} | ${h.decision} | ${cell(h.change)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderResultsTsv(state) {
  const header = ["iteration", "kind", "score", "pass", "guard_pass", "delta", "decision", "change"].join("\t");
  const rows = state.history.map((h) =>
    [
      h.iteration,
      h.kind,
      h.score,
      h.pass === null ? "" : h.pass,
      h.guardPass === null ? "" : h.guardPass,
      h.delta === null ? "" : h.delta,
      h.decision,
      cell(h.change),
    ].join("\t")
  );
  return `${[header, ...rows].join("\n")}\n`;
}

export function logLineFor(entry) {
  return `- [${stampTime(new Date(entry.ts))}] iter ${entry.iteration} ${entry.kind} score=${entry.score} pass=${
    entry.pass === null ? "—" : entry.pass
  } guard=${entry.guardPass === null ? "—" : entry.guardPass} delta=${entry.delta === null ? "—" : entry.delta} ${
    entry.decision
  }${entry.change ? ` — ${cell(entry.change)}` : ""}`;
}

export function renderFinalReportMd(state) {
  const s = summarize(state);
  const v = verify(state);
  const dir = state.direction === "minimize" ? "<=" : ">=";
  const lines = [
    `# Final report — ${state.slug}`,
    "",
    `**Outcome:** ${state.phase === "done" ? "target met" : "escalated (cap reached without meeting target)"}`,
    `**Stop reason:** ${state.stopReason || "(none)"}`,
    "",
    "## Result",
    "",
    `- Metric: **${state.metric}** (${dir} ${state.target})`,
    `- Baseline: ${s.baselineScore}`,
    `- Best: ${s.bestScore} (iteration ${s.bestIteration})`,
    `- Gain: ${s.gain}`,
    `- Experiments: ${s.experiments} (${s.kept} kept)`,
    `- Verify: ${v.ok ? "justified (exit 0)" : "not justified (exit 1)"}`,
    "",
    "## Evidence",
    "",
    `- \`${state.evaluator}\``,
    state.guard ? `- guard: \`${state.guard}\`` : "- guard: none",
    "",
    "## History",
    "",
    "| # | kind | score | pass | guard | delta | decision | change |",
    "|---|------|-------|------|-------|-------|----------|--------|",
  ];
  for (const h of state.history) {
    lines.push(
      `| ${h.iteration} | ${h.kind} | ${h.score} | ${h.pass === null ? "—" : h.pass} | ${
        h.guardPass === null ? "—" : h.guardPass
      } | ${h.delta === null ? "—" : h.delta} | ${h.decision} | ${cell(h.change)} |`
    );
  }
  if (state.phase !== "done") {
    lines.push(
      "",
      "## Open findings",
      "",
      `The metric did not reach the target within the cap. Best held value ${s.bestScore} vs ${dir} ${state.target}.`,
      "Hand the remaining gap to `x-investigate` (root cause) or `x-plan` (a different approach), or raise the cap knowingly.",
      ""
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// --- CLI ---------------------------------------------------------------------

function usage() {
  return [
    "x-research state — numeric, bounded metric-iteration loop state machine.",
    "",
    "Usage:",
    "  node state.mjs start --slug <s> --metric <name> --target <n> --evaluator <cmd>",
    "        [--direction maximize|minimize] [--policy score_improvement|pass_only] [--goal <text>]",
    "        [--guard <cmd>] [--allow g1,g2] [--forbid g1,g2] [--noise-runs <n>] [--min-delta <n>]",
    "        [--cap <n>] [--timeout <ms>] [--root <dir>]",
    "  node state.mjs record --dir <dir> --baseline <n|file|-> [--samples a,b,c] [--pass true|false]",
    "  node state.mjs record --dir <dir> --candidate <file|->   # evaluator JSON: {\"pass\":bool,\"score\":number}",
    "        [--guard true|false] [--changed path1,path2] [--change <text>]",
    "  node state.mjs status --dir <dir>",
    "  node state.mjs verify --dir <dir>   # exit 0 iff the stop is justified",
    "",
  ].join("\n");
}

function loadState(dir) {
  const file = path.join(dir, "state.json");
  if (!fs.existsSync(file)) throw new Error(`no state.json in ${dir}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function persist(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "research.md"), renderResearchMd(state));
  fs.writeFileSync(path.join(dir, "results.tsv"), renderResultsTsv(state));
  if (STOP_PHASES.has(state.phase)) {
    fs.writeFileSync(path.join(dir, "final_report.md"), renderFinalReportMd(state));
  }
}

function appendLog(dir, line) {
  fs.appendFileSync(path.join(dir, "research_log.md"), `${line}\n`);
}

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : true;
      out[key] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function num(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  return n;
}

function int(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer`);
  return n;
}

function bool(value, label) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new Error(`${label} must be true or false`);
}

function readJsonSource(spec) {
  const text = spec === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(String(spec), "utf8");
  return JSON.parse(text);
}

// A numeric literal, a JSON file, or "-" (stdin).
function scoreSource(spec) {
  if (spec !== "-" && spec !== true && Number.isFinite(Number(spec))) return { score: Number(spec) };
  return readJsonSource(spec);
}

function decision(state) {
  return {
    next: nextAction(state),
    phase: state.phase,
    iteration: state.iteration,
    stop: isStopped(state),
    reason: state.stopReason,
    summary: summarize(state),
  };
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
      if (!args.slug || args.slug === true) throw new Error("--slug is required");
      const root = !args.root || args.root === true ? path.resolve(DEFAULT_ROOT) : path.resolve(args.root);
      const dir = path.join(root, `${stamp()}-${args.slug}`);
      const state = startState({
        slug: args.slug,
        goal: args.goal === true ? null : args.goal,
        metric: args.metric === true ? undefined : args.metric,
        direction: args.direction === true ? "maximize" : args.direction || "maximize",
        target: args.target === true ? undefined : args.target === undefined ? NaN : num(args.target, "--target"),
        policy: args.policy === true ? "score_improvement" : args.policy || "score_improvement",
        evaluator: args.evaluator === true ? undefined : args.evaluator,
        guard: args.guard === true ? null : args.guard || null,
        allowed: args.allow,
        forbidden: args.forbid,
        noiseRuns: args["noise-runs"] === undefined ? DEFAULT_NOISE_RUNS : int(args["noise-runs"], "--noise-runs"),
        minDelta: args["min-delta"] === undefined ? DEFAULT_MIN_DELTA : num(args["min-delta"], "--min-delta"),
        cap: args.cap === undefined ? DEFAULT_CAP : int(args.cap, "--cap"),
        timeoutMs: args.timeout === undefined ? DEFAULT_TIMEOUT_MS : num(args.timeout, "--timeout"),
      });
      persist(dir, state);
      fs.writeFileSync(path.join(dir, "research_log.md"), `# Research log — ${state.slug}\n\n`);
      appendLog(dir, `- [${stampTime()}] start: ${state.metric} ${state.direction} target ${state.target}`);
      process.stdout.write(`${JSON.stringify({ dir, state, ...decision(state) }, null, 2)}\n`);
      return;
    }
    if (command === "record") {
      if (!args.dir || args.dir === true) throw new Error("--dir is required");
      const state = loadState(args.dir);
      const before = state.history.length;
      if (args.baseline !== undefined) {
        if (args.baseline === true) throw new Error("--baseline needs a score, file, or -");
        const src = scoreSource(args.baseline);
        recordBaseline(state, {
          score: src.score,
          samples: args.samples,
          pass: src.pass === undefined ? undefined : src.pass === true,
        });
      } else if (args.candidate !== undefined) {
        if (args.candidate === true) throw new Error("--candidate needs a file or -");
        const src = readJsonSource(args.candidate);
        recordCandidate(state, {
          pass: src.pass,
          score: src.score,
          samples: args.samples,
          guardPass: args.guard === undefined ? undefined : bool(args.guard, "--guard"),
          changed: args.changed,
          change: args.change === true ? null : args.change,
        });
      } else {
        throw new Error("record needs --baseline or --candidate");
      }
      persist(args.dir, state);
      for (const entry of state.history.slice(before)) appendLog(args.dir, logLineFor(entry));
      process.stdout.write(`${JSON.stringify(decision(state), null, 2)}\n`);
      return;
    }
    if (command === "status") {
      if (!args.dir || args.dir === true) throw new Error("--dir is required");
      const state = loadState(args.dir);
      process.stdout.write(`${JSON.stringify({ state, ...decision(state) }, null, 2)}\n`);
      return;
    }
    if (command === "verify") {
      if (!args.dir || args.dir === true) throw new Error("--dir is required");
      const state = loadState(args.dir);
      const result = verify(state);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.ok ? 0 : 1);
    }
    throw new Error(`unknown command "${command}"`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
