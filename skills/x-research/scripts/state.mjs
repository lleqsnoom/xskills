#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PHASES = ["baseline", "iterate", "done", "escalate"];
export const STOP_PHASES = new Set(["done", "escalate"]);
export const DIRECTIONS = ["maximize", "minimize"];
export const POLICIES = ["score_improvement", "pass_only"];
export const EVALUATOR_KINDS = ["command", "agent"];
export const DEFAULT_CAP = 10;
export const DEFAULT_MIN_DELTA = 0;
export const DEFAULT_NOISE_RUNS = 1;
export const DEFAULT_TIMEOUT_MS = 60000;
export const DEFAULT_ROOT = ".x-skills/runs";

export const GRAPH = {
  nodes: ["baseline", "iterate", "done", "escalate"],
  edges: [
    { from: "baseline", to: "iterate", guard: null },
    { from: "iterate", to: "iterate", guard: "target_unmet" },
    { from: "iterate", to: "done", guard: "target_met_and_pass" },
    { from: "iterate", to: "escalate", guard: "cap_reached" },
  ],
};

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

// Criteria count from a checklist file: every non-empty line that is not a
// comment counts as one criterion (so a markdown bullet list is 1:1).
export function countCriteriaEntries(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")).length;
}

// An agent-judged per-iteration verdict, `k/n` met criteria, normalized to the same
// `{ pass, score }` shape a command evaluator emits. `pass` is all-met; `score` is
// the coverage ratio.
export function coverageVerdict(spec) {
  const m = String(spec).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) throw new Error("coverage must look like k/n (e.g. 2/3)");
  const met = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1) throw new Error("coverage denominator must be at least 1");
  if (met > total) throw new Error("coverage numerator cannot exceed the denominator");
  return { met, total, score: round(met / total), pass: met === total };
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
  evaluatorKind,
  criteria,
  guard = null,
  allowed,
  forbidden,
  noiseRuns = DEFAULT_NOISE_RUNS,
  minDelta = DEFAULT_MIN_DELTA,
  cap = DEFAULT_CAP,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  candidates = null,
  now = new Date(),
} = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  if (!metric || typeof metric !== "string") throw new Error("metric is required");
  if (!DIRECTIONS.includes(direction)) throw new Error(`direction must be one of ${DIRECTIONS.join(", ")}`);
  if (!POLICIES.includes(policy)) throw new Error(`policy must be one of ${POLICIES.join(", ")}`);
  if (!Number.isInteger(cap) || cap < 1) throw new Error("cap must be a positive integer");
  if (!Number.isInteger(noiseRuns) || noiseRuns < 1) throw new Error("noiseRuns must be a positive integer");
  if (!Number.isFinite(minDelta) || minDelta < 0) throw new Error("minDelta must be a non-negative number");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive number");

  const kind = evaluatorKind || (evaluator === "agent" ? "agent" : "command");
  if (!EVALUATOR_KINDS.includes(kind)) throw new Error(`evaluator kind must be one of ${EVALUATOR_KINDS.join(", ")}`);

  // The agent-judged mode needs a criteria count, an evaluator label, and a
  // coverage target (default: every criterion met → ratio 1).
  let label = evaluator;
  let resolvedCriteria = null;
  let resolvedTarget = target;
  if (kind === "agent") {
    if (!Number.isInteger(criteria) || criteria < 1) throw new Error("agent evaluator needs a positive --criteria count");
    resolvedCriteria = criteria;
    label = `agent (coverage of ${criteria} criteria)`;
    if (!Number.isFinite(resolvedTarget)) resolvedTarget = 1;
  }
  if (!label || typeof label !== "string") throw new Error("evaluator command is required");
  if (!Number.isFinite(resolvedTarget)) throw new Error("target must be a number");
  const candidateList = normalizeList(candidates);
  if (candidates !== null && candidateList.length < 3) {
    throw new Error("a run needs at least 3 candidate changes (--candidates)");
  }

  return {
    slug,
    goal: goal || null,
    metric,
    direction,
    target: resolvedTarget,
    policy,
    evaluator: label,
    evaluatorKind: kind,
    criteria: resolvedCriteria,
    guard: guard || null,
    search: { allowed: normalizeList(allowed), forbidden: normalizeList(forbidden) },
    graph: GRAPH,
    candidates: candidateList,
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
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

// #region run-folder
// Two digits, not more: a wider counter would sort E100 before E99.
const RUNS_ROOT = ".x-skills/runs";
const MAX_COUNTER = 99;

function padRunCounter(value) {
  return String(value).padStart(2, "0");
}

function runFolders(rootAbs, slug) {
  if (!fs.existsSync(rootAbs)) return [];
  return fs
    .readdirSync(rootAbs)
    .filter((name) => name.endsWith(`-${slug}`))
    .sort();
}

// Counts runs of this slug only, so R<nn> reads as "the nth run of this topic".
// Works together with `fresh`: a global counter would make the number depend on
// unrelated topics, and per-slug numbering alone could never reach 02 because
// resolveRunDir joins an existing run for the slug.
function highestRun(rootAbs, slug) {
  return runFolders(rootAbs, slug).reduce((max, name) => {
    const match = name.match(/-R(\d+)-/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function mintRunDir(rootAbs, slug, now) {
  const run = highestRun(rootAbs, slug) + 1;
  if (run > MAX_COUNTER) throw new Error(`run counter would exceed R${MAX_COUNTER}`);
  const stamp = `${now.getFullYear()}-${padRunCounter(now.getMonth() + 1)}-${padRunCounter(now.getDate())}-${padRunCounter(now.getHours())}${padRunCounter(now.getMinutes())}`;
  const dir = path.join(rootAbs, `${stamp}-R${padRunCounter(run)}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Return the run folder for a slug, choosing in this order:
 * `fresh` mints a new R<nn>, `run` selects that R number, `marker` selects the
 * folder holding that artifact, one match is returned, none mints, and more
 * than one without a selector throws rather than guessing.
 */
function resolveRunDir(slug, { root = RUNS_ROOT, now = new Date(), marker = null, fresh = false, run = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const rootAbs = path.resolve(root);
  fs.mkdirSync(rootAbs, { recursive: true });

  if (fresh) return mintRunDir(rootAbs, slug, now);

  const folders = runFolders(rootAbs, slug);
  if (run !== null) {
    const wanted = `-R${padRunCounter(run)}-`;
    const picked = folders.find((name) => name.includes(wanted));
    if (!picked) throw new Error(`no run R${padRunCounter(run)} for "${slug}"`);
    return path.join(rootAbs, picked);
  }
  if (marker) {
    const holding = folders.filter((name) => fs.existsSync(path.join(rootAbs, name, marker)));
    if (holding.length) return path.join(rootAbs, holding[holding.length - 1]);
  }
  if (folders.length > 1) {
    throw new Error(`${folders.length} runs match "${slug}"; pass --run <nn> to pick one, or --new-run to start another`);
  }
  if (folders.length) return path.join(rootAbs, folders[0]);
  return mintRunDir(rootAbs, slug, now);
}

function nextE(runDir) {
  const used = fs.existsSync(runDir)
    ? fs
        .readdirSync(runDir)
        .map((name) => {
          const match = name.match(/^E(\d{2})-/);
          return match ? Number(match[1]) : null;
        })
        .filter((value) => value !== null)
    : [];
  const next = used.length ? Math.max(...used) + 1 : 0;
  if (next > MAX_COUNTER) throw new Error(`artifact counter would exceed E${MAX_COUNTER}`);
  return `E${String(next).padStart(2, "0")}`;
}
// #endregion run-folder

function stampTime(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function cell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

// --- audit trail files -------------------------------------------------------

export function renderGraphMermaid(state) {
  const graph = state.graph || GRAPH;
  const lines = ["```mermaid", "graph LR"];
  for (const edge of graph.edges) {
    lines.push(edge.guard ? `  ${edge.from} -->|${edge.guard}| ${edge.to}` : `  ${edge.from} --> ${edge.to}`);
  }
  lines.push(`  classDef current stroke-width:3px,stroke:#f60`);
  lines.push(`  class ${state.phase} current`);
  lines.push("```");
  return lines.join("\n");
}

export function renderMemoryLine(entry) {
  const parts = [entry.kind, entry.score, entry.decision, entry.change].filter(
    (part) => part !== null && part !== undefined && part !== ""
  );
  return `- [${entry.ts}] ${parts.join(": ")}`;
}

export function renderResearchMd(state) {
  const dir = state.direction === "minimize" ? "<=" : ">=";
  const lines = [
    `# Research — ${state.slug}`,
    "",
    `**Goal:** ${state.goal || "(not set)"}`,
    `**Metric:** ${state.metric} (${state.direction} → target ${dir} ${state.target})`,
    `**Policy:** ${state.policy}`,
    `**Evaluator:** \`${state.evaluator}\`${state.evaluatorKind === "agent" ? " (agent-judged)" : ""}`,
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

export function renderResultsTsv(state) {  const header = ["iteration", "kind", "score", "pass", "guard_pass", "delta", "decision", "change"].join("\t");
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
    "## Scenario",
    "",
    renderGraphMermaid(state),
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
    "        [--cap <n>] [--timeout <ms>] [--root <dir>] [--candidates <file|a,b,c>]",
    "        # --candidates: at least 3 candidate changes proposed before the first experiment",
    "  node state.mjs start --slug <s> --metric <name> --evaluator agent --criteria <n|file>",
    "        # agent-judged: --target defaults to 1 (all criteria); no shell command runs",
    "  node state.mjs record --dir <dir> --baseline <n|file|-> [--samples a,b,c] [--pass true|false]",
    "  node state.mjs record --dir <dir> --baseline --coverage <k/n>",
    "  node state.mjs record --dir <dir> --candidate <file|->   # evaluator JSON: {\"pass\":bool,\"score\":number}",
    "  node state.mjs record --dir <dir> --candidate --coverage <k/n> [--changed path1,path2] [--change <text>]",
    "        [--guard true|false]",
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

function appendMemory(dir, line) {
  fs.appendFileSync(path.join(dir, "memory.md"), `${line}\n`);
}

function writeMemoryHeader(dir, state) {
  const lines = [`# Memory — ${state.slug}`, "", "- candidates:"];
  for (const candidate of state.candidates) lines.push(`  - ${candidate}`);
  fs.writeFileSync(path.join(dir, "memory.md"), `${lines.join("\n")}\n`);
}

function readCandidates(spec) {
  const text = fs.existsSync(String(spec)) ? fs.readFileSync(String(spec), "utf8") : String(spec).split(",").join("\n");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
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

// `--criteria` accepts a positive integer or a path to a checklist file (one
// criterion per non-empty, non-comment line).
function resolveCriteria(spec) {
  const s = String(spec).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n < 1) throw new Error("--criteria must be at least 1");
    return n;
  }
  if (fs.existsSync(s)) {
    const n = countCriteriaEntries(fs.readFileSync(s, "utf8"));
    if (n < 1) throw new Error(`--criteria file ${s} has no criteria`);
    return n;
  }
  throw new Error("--criteria must be a positive integer or a path to a criteria file");
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
      const runDir = resolveRunDir(args.slug, {
        root,
        fresh: args["new-run"] === true,
        run: args.run === undefined || args.run === true ? null : Number(args.run),
      });
      const dir = path.join(runDir, `${nextE(runDir)}-research`);
      const evaluatorKind = args.evaluator === "agent" || args["evaluator-kind"] === "agent" ? "agent" : undefined;
      const state = startState({
        slug: args.slug,
        goal: args.goal === true ? null : args.goal,
        metric: args.metric === true ? undefined : args.metric,
        direction: args.direction === true ? "maximize" : args.direction || "maximize",
        target: args.target === undefined || args.target === true ? undefined : num(args.target, "--target"),
        policy: args.policy === true ? "score_improvement" : args.policy || "score_improvement",
        evaluator: args.evaluator === true ? undefined : args.evaluator,
        evaluatorKind,
        criteria: args.criteria === undefined || args.criteria === true ? undefined : resolveCriteria(args.criteria),
        guard: args.guard === true ? null : args.guard || null,
        allowed: args.allow,
        forbidden: args.forbid,
        noiseRuns: args["noise-runs"] === undefined ? DEFAULT_NOISE_RUNS : int(args["noise-runs"], "--noise-runs"),
        minDelta: args["min-delta"] === undefined ? DEFAULT_MIN_DELTA : num(args["min-delta"], "--min-delta"),
        cap: args.cap === undefined ? DEFAULT_CAP : int(args.cap, "--cap"),
        timeoutMs: args.timeout === undefined ? DEFAULT_TIMEOUT_MS : num(args.timeout, "--timeout"),
        candidates: args.candidates === undefined || args.candidates === true ? null : readCandidates(args.candidates),
      });
      persist(dir, state);
      fs.writeFileSync(path.join(dir, "research_log.md"), `# Research log — ${state.slug}\n\n`);
      writeMemoryHeader(dir, state);
      appendLog(dir, `- [${stampTime()}] start: ${state.metric} ${state.direction} target ${state.target}`);
      process.stdout.write(`${JSON.stringify({ dir, state, ...decision(state) }, null, 2)}\n`);
      return;
    }
    if (command === "record") {
      if (!args.dir || args.dir === true) throw new Error("--dir is required");
      const state = loadState(args.dir);
      const before = state.history.length;
      const coverage = args.coverage === undefined || args.coverage === true ? null : coverageVerdict(args.coverage);
      if (coverage && args.baseline === undefined && args.candidate === undefined) {
        throw new Error("--coverage needs --baseline or --candidate");
      }
      if (args.baseline !== undefined) {
        if (!coverage && args.baseline === true) throw new Error("--baseline needs a score, file, or -");
        const src = coverage ? { score: coverage.score, pass: coverage.pass } : scoreSource(args.baseline);
        recordBaseline(state, {
          score: src.score,
          samples: args.samples,
          pass: src.pass === undefined ? undefined : src.pass === true,
        });
      } else if (args.candidate !== undefined) {
        if (!coverage && args.candidate === true) throw new Error("--candidate needs a file or -");
        const src = coverage ? { score: coverage.score, pass: coverage.pass } : readJsonSource(args.candidate);
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
      for (const entry of state.history.slice(before)) appendMemory(args.dir, renderMemoryLine(entry));
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
