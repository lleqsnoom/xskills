#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PHASES = ["draft", "revise", "humanize", "final-check", "done", "escalate"];
export const STOP_PHASES = new Set(["done", "escalate"]);
export const DEFAULT_MIN_SCORE = 75; // x-roast `strong` band
export const DEFAULT_CAP = 3;
export const DEFAULT_COVERAGE_GATE = 1; // all facts/markers must survive

function round(value, places = 1) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function startState({
  slug,
  type = "article",
  minScore = DEFAULT_MIN_SCORE,
  cap = DEFAULT_CAP,
  coverageGate = DEFAULT_COVERAGE_GATE,
  now = new Date(),
} = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  if (!Number.isFinite(minScore)) throw new Error("minScore must be a number");
  if (!Number.isInteger(cap) || cap < 1) throw new Error("cap must be a positive integer");
  if (!Number.isFinite(coverageGate) || coverageGate < 0 || coverageGate > 1) {
    throw new Error("coverageGate must be a number between 0 and 1");
  }
  return {
    slug,
    type,
    profile: type === "paper" ? "research" : "article",
    gates: { minScore, coverageGate, cap },
    minScore,
    cap,
    coverageGate,
    iteration: 1,
    phase: "draft",
    history: [],
    stopReason: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function bandKey(band) {
  if (band && typeof band === "object") return band.key ?? null;
  return band ?? null;
}

function lastEntry(state) {
  return state.history[state.history.length - 1] ?? null;
}

// Every backward edge is a numeric comparison; crossing `cap` escalates.
function advanceOrEscalate(state, reason) {
  if (state.iteration >= state.cap) {
    state.phase = "escalate";
    state.stopReason = `${reason}; cap ${state.cap} reached`;
  } else {
    state.iteration += 1;
    state.phase = "revise";
  }
  return state;
}

export function recordRoast(state, roast = {}) {
  if (STOP_PHASES.has(state.phase)) throw new Error(`loop already stopped (${state.phase})`);
  if (!Number.isFinite(roast.total)) throw new Error("roast.total must be a number");
  const prev = lastEntry(state);
  const entry = {
    iteration: state.iteration,
    roastTotal: roast.total,
    band: bandKey(roast.band),
    completeness: Number.isFinite(roast.completeness) ? roast.completeness : null,
    scoreDelta: prev && Number.isFinite(prev.roastTotal) ? round(roast.total - prev.roastTotal) : null,
  };
  // Decision = a number comparison, recorded in the entry itself.
  entry.roastGate = { actual: roast.total, expected: state.minScore, pass: roast.total >= state.minScore };
  state.history.push(entry);
  if (entry.roastGate.pass) {
    state.phase = "humanize";
  } else {
    advanceOrEscalate(state, `roast ${roast.total} < gate ${state.minScore}`);
  }
  return touch(state);
}

export function recordHumanize(state, { exit: exitCode, gradeBefore, gradeAfter } = {}) {
  if (state.phase !== "humanize") throw new Error(`not awaiting humanize (phase "${state.phase}")`);
  if (!Number.isFinite(exitCode)) throw new Error("humanize exit must be a number");
  const entry = lastEntry(state);
  entry.humanizeExit = exitCode;
  if (Number.isFinite(gradeBefore)) entry.gradeBefore = gradeBefore;
  if (Number.isFinite(gradeAfter)) entry.gradeAfter = gradeAfter;
  entry.humanizeGate = { actual: exitCode, expected: 0, pass: exitCode === 0 };
  if (entry.humanizeGate.pass) {
    state.phase = "final-check";
  } else {
    advanceOrEscalate(state, `x-humanize verify exit ${exitCode} != 0`);
  }
  return touch(state);
}

export function recordFinalCheck(state, { kept, total, coverage } = {}) {
  if (state.phase !== "final-check") throw new Error(`not awaiting final-check (phase "${state.phase}")`);
  let cov = coverage;
  if (!Number.isFinite(cov)) {
    if (!Number.isFinite(kept) || !Number.isFinite(total) || total <= 0) {
      throw new Error("final-check needs --coverage or --facts-kept with --facts-total");
    }
    cov = round(kept / total, 3);
  }
  const entry = lastEntry(state);
  entry.factsKept = Number.isFinite(kept) ? kept : null;
  entry.factsTotal = Number.isFinite(total) ? total : null;
  entry.coverage = cov;
  entry.coverageGate = { actual: cov, expected: state.coverageGate, pass: cov >= state.coverageGate };
  if (entry.coverageGate.pass) {
    state.phase = "done";
  } else {
    advanceOrEscalate(state, `facts survived ${cov} < gate ${state.coverageGate}`);
  }
  return touch(state);
}

export function nextAction(state) {
  return state.phase;
}

export function isStopped(state) {
  return STOP_PHASES.has(state.phase);
}

export function summarize(state) {
  const totals = state.history.map((h) => h.roastTotal).filter(Number.isFinite);
  const first = totals.length ? totals[0] : null;
  const best = totals.length ? Math.max(...totals) : null;
  const last = lastEntry(state);
  return {
    slug: state.slug,
    phase: state.phase,
    iteration: state.iteration,
    iterations: state.history.length,
    gates: state.gates,
    firstRoastTotal: first,
    bestRoastTotal: best,
    scoreGain: first !== null && best !== null ? round(best - first) : null,
    lastCoverage: last && Number.isFinite(last.coverage) ? last.coverage : null,
    stopReason: state.stopReason,
  };
}

// Re-derive the stop decision from the recorded numbers alone.
export function verify(state) {
  const last = lastEntry(state);
  const checks = [];
  const add = (name, actual, expected, comparator) => {
    checks.push({ name, actual, expected, pass: comparator(actual, expected) });
  };
  if (state.phase === "done") {
    if (!last || !last.roastGate) throw new Error("cannot verify: no roast recorded");
    add("roast >= gate", last.roastTotal, state.minScore, (a, b) => a >= b);
    add("humanize exit == 0", last.humanizeExit, 0, (a, b) => a === b);
    add("coverage >= gate", last.coverage, state.coverageGate, (a, b) => a >= b);
  }
  const stats = summarize(state);
  const ok = state.phase === "done" ? checks.every((c) => c.pass) : false;
  return { ok, phase: state.phase, checks, stats, reason: state.stopReason };
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

function usage() {
  return [
    "x-essay state — fully numeric, bounded loop state machine for the article pipeline.",
    "",
    "Usage:",
    '  node state.mjs start --slug my-article [--type article|paper] [--min-score 75] [--cap 3] [--coverage-gate 1] [--root <dir>]',
    "  node state.mjs record --dir <dir> --roast <score.json>          # x-roast score JSON ('-' = stdin)",
    "  node state.mjs record --dir <dir> --humanize-exit <0|1> [--grade-before <n> --grade-after <n>]",
    "  node state.mjs record --dir <dir> --final-check <kept>/<total> | --coverage <r> | pass | fail",
    "  node state.mjs status --dir <dir>                               # state + numeric summary",
    "  node state.mjs verify --dir <dir>                               # re-derive the stop from stats",
    "",
  ].join("\n");
}

function loadState(dir) {
  const file = path.join(dir, "state.json");
  if (!fs.existsSync(file)) throw new Error(`no state.json in ${dir}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
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

function num(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  return n;
}

// "12/12" | "pass" | "fail" | "0.917" -> {kept,total} | {coverage}
function parseFinalCheck(spec) {
  if (spec === "pass" || spec === "true") return { kept: 1, total: 1 };
  if (spec === "fail" || spec === "false") return { kept: 0, total: 1 };
  if (typeof spec === "string" && spec.includes("/")) {
    const [k, t] = spec.split("/");
    return { kept: Number(k), total: Number(t) };
  }
  return { coverage: Number(spec) };
}

function readJson(source) {
  const text = source === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(source, "utf8");
  return JSON.parse(text);
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
      const root = !args.root || args.root === true ? RUNS_ROOT : args.root;
      const runDir = resolveRunDir(args.slug, { root });
      const dir = path.join(runDir, `${nextE(runDir)}-article`);
      const state = startState({
        slug: args.slug,
        type: args.type === true ? "article" : args.type || "article",
        minScore: args["min-score"] === undefined ? DEFAULT_MIN_SCORE : num(args["min-score"], "--min-score"),
        cap: args.cap === undefined ? DEFAULT_CAP : num(args.cap, "--cap"),
        coverageGate:
          args["coverage-gate"] === undefined ? DEFAULT_COVERAGE_GATE : num(args["coverage-gate"], "--coverage-gate"),
      });
      saveState(dir, state);
      process.stdout.write(`${JSON.stringify({ dir, state, ...decision(state) }, null, 2)}\n`);
      return;
    }
    if (command === "record") {
      if (!args.dir || args.dir === true) throw new Error("--dir is required");
      const state = loadState(args.dir);
      if (args.roast !== undefined) {
        recordRoast(state, readJson(args.roast === true ? "-" : args.roast));
      } else if (args["humanize-exit"] !== undefined) {
        recordHumanize(state, {
          exit: num(args["humanize-exit"], "--humanize-exit"),
          gradeBefore: args["grade-before"] === undefined ? undefined : num(args["grade-before"], "--grade-before"),
          gradeAfter: args["grade-after"] === undefined ? undefined : num(args["grade-after"], "--grade-after"),
        });
      } else if (args["final-check"] !== undefined) {
        if (args["final-check"] === true) throw new Error("--final-check needs a value (k/t, coverage, pass, fail)");
        recordFinalCheck(state, parseFinalCheck(args["final-check"]));
      } else {
        throw new Error("record needs one of --roast, --humanize-exit, --final-check");
      }
      saveState(args.dir, state);
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
