#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mintPlan } from "./heal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * x-autoreflection improve — the one command a period needs.
 *
 * It runs the whole mechanical half of the skill: traverse the period across every CLI, write the
 * report (JSON truth + markdown read), gate it, and mint the fix plan beside it. What is left is the
 * part that needs a human: the agent reads each finding's target, fills the exact edit, asks whether
 * an auto-heal session is even wanted, then proposes the shaped fixes as one multi-select panel and
 * applies only what was picked.
 *
 * `improve.mjs` writes files and applies nothing. It prints one JSON line naming the artifacts, the
 * report's own numbers, and the plan's items — each carrying the issue, the rate it should move, the
 * method, any form of the scores the report already computed — so the panel can be rendered from it.
 */

const HOUR_MS = 3600_000;
const PERIOD_UNITS = { h: 1, d: 24, w: 168 };

/**
 * A period as the window's hours: `24`, `24h`, `7d`, `2w`. Minutes are deliberately unsupported —
 * a window shorter than an hour is a single session, which `--session last` already reads.
 */
export function parsePeriod(value, { fallback = 24 } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`period must be a positive number of hours, got "${value}"`);
    return value;
  }
  const text = String(value).trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([hdw])?$/);
  if (!match) throw new Error(`period must look like 24, 24h, 7d or 2w, got "${value}"`);
  const hours = Number(match[1]) * PERIOD_UNITS[match[2] ?? "h"];
  if (!(hours > 0)) throw new Error(`period must be more than zero hours, got "${value}"`);
  return hours;
}

export function describePeriod(hours) {
  const days = hours / 24;
  if (Number.isInteger(days) && days >= 1) return `${hours}h (${days}d)`;
  if (Number.isInteger(hours) && hours >= 1) return `${hours}h`;
  return `${hours}h`;
}

/** `E01-analysis.json` → `E02-heal.json`: the plan is the next artifact of the same run. */
export function planPathFor(analysisPath) {
  const dir = path.dirname(analysisPath);
  const match = path.basename(analysisPath).match(/^E(\d{2})-/);
  const next = match ? Number(match[1]) + 1 : 0;
  if (next > 99) throw new Error(`artifact counter would exceed E99 in ${dir}`);
  return path.join(dir, `E${String(next).padStart(2, "0")}-heal.json`);
}

/**
 * A sibling script's JSON, whether it printed one line (`analyze.mjs`) or pretty-printed an object
 * (`check-analysis.mjs`, `check-heal.mjs`). Both shapes are read here, so neither caller has to know.
 */
export function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const last = trimmed.split("\n").filter(Boolean).pop();
    try {
      return last ? JSON.parse(last) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Run a sibling script and read its JSON. `allowStatus` names the exits whose output is still an
 * answer: a checker exits 1 *with* its violations, and those violations are what the caller reports.
 */
export function runScript(script, args, { cwd = process.cwd(), allowStatus = [0] } = {}) {
  const result = spawnSync("node", [path.join(__dirname, script), ...args], { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  const parsed = parseJsonOutput(result.stdout);
  if (!allowStatus.includes(result.status ?? 1)) {
    const reason = parsed?.error ?? String(result.stderr ?? "").trim().split("\n").filter(Boolean).pop() ?? `exit ${result.status}`;
    throw new Error(`${script} failed: ${reason}`);
  }
  if (!parsed) throw new Error(`${script} printed no JSON`);
  return parsed;
}

/** The report's own numbers, as the panel's first line and the reason to open the markdown. */
export function summarizeReport(report) {
  const stats = report?.stats ?? {};
  const findings = (report?.findings ?? []).slice(0, 5).map((finding) => ({
    id: finding.id,
    skill: finding.skill ?? null,
    kind: finding.kind ?? null,
    class: finding.class ?? null,
    severity: finding.severity ?? null,
    recurrence: finding.recurrence ?? 0,
    count: finding.count ?? 0,
    summary: finding.summary ?? "",
  }));
  return {
    hours: report?.window?.hours ?? null,
    sessions: stats.sessions ?? 0,
    skillsTouched: stats.skillsTouched ?? 0,
    signals: stats.signals ?? 0,
    high: stats.high ?? 0,
    findings: stats.findings ?? 0,
    portfolio: stats.portfolio ?? 0,
    failed: stats.failed ?? 0,
    topFindings: findings,
  };
}

/**
 * The proposal cards the panel is built from: the issue, the rate it should move, the suggested edit
 * (`change`) and the skill's usage scores as they stand before the fix.
 */
export function proposalCards(plan) {
  return (plan?.items ?? []).map((item) => ({
    id: item.id,
    skill: item.skill,
    class: item.class,
    issue: item.issue,
    severity: item.severity,
    recurrence: item.recurrence,
    count: item.count,
    improvement: item.improvement,
    change: item.change,
    target: item.target,
    scores: item.scores,
    evidence: item.evidence,
  }));
}

/**
 * The whole mechanical half: analyze → gate → mint. `plan: false` stops after the report, for a
 * window the user wants to read before deciding whether healing is worth a session at all.
 */
export function improve({ period = "24h", plan = true, analyzeArgs = [], cwd = process.cwd() } = {}) {
  const hours = parsePeriod(period);
  const report = runScript("analyze.mjs", ["--hours", String(hours), ...analyzeArgs], { cwd });

  let checked = null;
  try {
    // Exit 1 is the checker's own answer: it prints the violations, and they are what this reports.
    checked = runScript("check-analysis.mjs", ["--file", report.json], { cwd, allowStatus: [0, 1] });
  } catch (err) {
    // A report that cannot be read is still evidence: say what is wrong and keep the artifacts.
    checked = { violations: [{ rule: "check-failed", detail: err.message.slice(0, 200) }] };
  }

  const analysis = JSON.parse(fs.readFileSync(report.json, "utf8"));
  const out = {
    period: describePeriod(hours),
    hours,
    run: path.dirname(report.json),
    analysis: report.json,
    report: report.md,
    summary: summarizeReport(analysis),
    violations: checked?.violations ?? [],
  };
  if (!plan) return out;

  const planPath = planPathFor(report.json);
  const minted = mintPlan(analysis, { analysisPath: report.json });
  fs.writeFileSync(planPath, `${JSON.stringify(minted, null, 2)}\n`);
  return { ...out, plan: planPath, items: proposalCards(minted) };
}

function usage() {
  return [
    "x-autoreflection improve — one period in, one report and one fix plan out.",
    "",
    "Usage:",
    "  node improve.mjs 24h [--host crush,codex] [--max 60] [--no-plan]",
    "  node improve.mjs 7d --new-run",
    "",
    "Flags:",
    "  <period>         Window to analyze: 24, 24h, 7d, 2w (default: 24h)",
    "  --host <ids>     Comma-separated hosts to read (default: every detected host)",
    "  --max <n>        Cap on sessions scanned (default: 60)",
    "  --skills-dir <d> Folder holding skill directories (default: skills/, then .agents/skills/)",
    "  --scans <dir>    Skip traversal and aggregate the *-signals.json files already in <dir>",
    "  --slug <s>       Run-folder slug (default: autoreflection)",
    "  --out <dir>      Write the artifacts here instead of the run folder",
    "  --new-run        Mint a fresh run instead of joining the existing one",
    "  --no-plan        Write the report only; skip minting the fix plan",
    "  --help           Show this help",
    "",
    "Next, in order: read each finding's target, fill the plan's find/replace/check, run check-heal.mjs,",
    "ask whether the user wants an auto-heal session, then apply the picked ids with heal.mjs --apply.",
    "",
  ].join("\n");
}

function parseArgs(args) {
  const out = { _: [], unknown: [] };
  const booleans = new Set(["new-run", "no-plan", "help"]);
  const known = new Set(["host", "max", "skills-dir", "scans", "slug", "out", "new-run", "no-plan", "help"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (!known.has(key)) {
      out.unknown.push(key);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) i++;
    } else if (booleans.has(key)) {
      out[key] = true;
    } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      out[key] = args[++i];
    } else {
      out[key] = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    const forwarded = [];
    for (const [flag, value] of [
      ["host", args.host],
      ["max", args.max],
      ["skills-dir", args["skills-dir"]],
      ["scans", args.scans],
      ["slug", args.slug],
      ["out", args.out],
    ]) {
      if (typeof value === "string") forwarded.push(`--${flag}`, value);
    }
    if (args["new-run"] === true) forwarded.push("--new-run");

    const result = improve({ period: args._[0] ?? "24h", plan: args["no-plan"] !== true, analyzeArgs: forwarded });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
