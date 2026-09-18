#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * x-autoreflection-heal — turn the analysis report into approved edits and apply them.
 *
 * The plan carries, per finding, the exact `find`/`replace`, the target file and a check command.
 * The agent opens each target to write those fields, marks the mechanical ones `auto: true`, and
 * proposes them as a multi-select panel. On approval, `heal.mjs --apply <ids>` applies each one,
 * runs its check, reverts on failure, and appends the ledger. A human always picks the fixes; the
 * script only does what was picked, and only the `auto` classes.
 */

export const SCHEMA = "x-autoreflection-heal/1";

/** The improvement classes a mechanical, verifiable, reversible edit may be applied unattended. */
export const AUTO_CLASSES = new Set(["doc-command-drift", "missing-gate", "panel-rule", "contract-drift"]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function timestamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
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

/** A plan skeleton: one item per finding, the edit fields left for the agent to fill after reading. */
export function mintPlan(analysis, { analysisPath = null, date = new Date() } = {}) {
  const items = (analysis.findings ?? []).map((finding) => ({
    id: finding.id,
    skill: finding.skill ?? null,
    class: finding.class ?? null,
    target: finding.skill ? `skills/${finding.skill}/SKILL.md` : "",
    find: "",
    replace: "",
    check: "",
    auto: false,
    change: finding.change ?? "",
    evidence: finding.evidence ?? [],
  }));
  return {
    schema: SCHEMA,
    analysis: analysisPath,
    generatedAt: timestamp(date),
    items,
  };
}

export function countOccurrences(text, find) {
  if (!find) return 0;
  return String(text).split(find).length - 1;
}

function runCheck(command, cwd) {
  if (!command) return { status: 0, stdout: "", stderr: "" };
  const result = spawnSync(command, { shell: true, cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * Apply one plan item and return what happened. Only `auto` items are applied; the rest are skipped.
 * `find` must occur exactly once — zero is stale, more than one is ambiguous, so neither is touched.
 */
export function applyItem(item, { cwd = process.cwd(), dryRun = false } = {}) {
  if (item.auto !== true) {
    return { id: item.id, status: "skipped", detail: "not marked auto" };
  }
  if (!item.target || !item.find) {
    return { id: item.id, status: "skipped", detail: "no target or find" };
  }
  const file = path.resolve(cwd, item.target);
  if (!fs.existsSync(file)) {
    return { id: item.id, status: "stale", detail: `target missing: ${item.target}` };
  }
  const original = fs.readFileSync(file, "utf8");
  const occurrences = countOccurrences(original, item.find);
  if (occurrences === 0) {
    return { id: item.id, status: "stale", detail: `"${item.find}" not found in ${item.target}` };
  }
  if (occurrences > 1) {
    return { id: item.id, status: "ambiguous", detail: `"${item.find}" occurs ${occurrences}x; make it unique` };
  }

  const edited = original.replace(item.find, item.replace ?? "");
  if (!dryRun) fs.writeFileSync(file, edited);

  const check = runCheck(item.check, cwd);
  if (check.status !== 0) {
    if (!dryRun) fs.writeFileSync(file, original);
    return { id: item.id, status: "reverted", detail: `check failed: ${check.stderr || check.stdout || item.check}`.slice(0, 200) };
  }
  return { id: item.id, status: dryRun ? "would-apply" : "applied", detail: item.target };
}

export function applyHeal(plan, ids, { cwd = process.cwd(), dryRun = false } = {}) {
  const wanted = new Set((ids ?? []).map(String));
  const results = [];
  for (const item of plan.items ?? []) {
    if (!wanted.has(String(item.id))) continue;
    results.push(applyItem(item, { cwd, dryRun }));
  }
  return results;
}

export function ledgerLine(result, at = new Date()) {
  return `${JSON.stringify({ at: at.toISOString(), ...result })}\n`;
}

export function renderResults(plan, results) {
  const lines = [];
  lines.push(`# Heal — ${plan.analysis ?? "report"}`);
  lines.push("");
  lines.push(`**Plan:** ${plan.generatedAt} · **Applied:** ${results.filter((r) => r.status === "applied").length} · **Reverted:** ${results.filter((r) => r.status === "reverted").length}`);
  lines.push("");
  for (const result of results) {
    lines.push(`- ${result.id}: ${result.status} — ${result.detail}`);
  }
  lines.push("");
  return lines.join("\n");
}

function usage() {
  return [
    "x-autoreflection-heal heal — mint a plan from an analysis report, then apply approved edits.",
    "",
    "Usage:",
    "  node heal.mjs --mint <analysis.json> --out <plan.json>",
    "  node heal.mjs --plan <plan.json> --apply F1,F3 [--dry-run] [--cwd <dir>]",
    "",
    "Flags:",
    "  --mint <file>   Create a plan skeleton from the analysis report",
    "  --plan <file>   The plan to apply (default: newest -heal.json in the run folder)",
    "  --apply <ids>   Comma-separated item ids to apply",
    "  --dry-run       Print what would change without writing or reverting",
    "  --cwd <dir>     Repo root the targets and checks are relative to (default: process.cwd())",
    "  --ledger <file> Ledger path (default: heal-ledger.jsonl beside the plan)",
    "  --help          Show this help",
    "",
  ].join("\n");
}

function parseArgs(args) {
  const out = { _: [], unknown: [] };
  const booleans = new Set(["dry-run", "help"]);
  const known = new Set(["mint", "plan", "apply", "dry-run", "cwd", "ledger", "out", "help"]);
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

function newestPlan(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith("-heal.json"))
    .map((name) => ({ file: name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(dir, files[0].file) : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();

    if (typeof args.mint === "string") {
      const analysisPath = path.resolve(args.mint);
      const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
      const plan = mintPlan(analysis, { analysisPath: args.mint });
      const out = args.out ? path.resolve(args.out) : null;
      const runDir = out ? path.dirname(out) : path.resolve(cwd, ".x-skills/runs");
      fs.mkdirSync(runDir, { recursive: true });
      const planPath = out ?? path.join(runDir, `${nextE(runDir)}-heal.json`);
      fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ plan: planPath, items: plan.items.length })}\n`);
      return;
    }

    const planPath = typeof args.plan === "string" ? path.resolve(args.plan) : newestPlan(path.resolve(cwd, ".x-skills/runs"));
    if (!planPath || !fs.existsSync(planPath)) {
      process.stderr.write(`${JSON.stringify({ error: `no heal plan found${planPath ? `: ${planPath}` : ""}` })}\n`);
      process.exit(2);
    }
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    const ids = String(args.apply ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (!ids.length) throw new Error("--apply <ids> is required");

    const dryRun = args["dry-run"] === true;
    const results = applyHeal(plan, ids, { cwd, dryRun });
    const ledgerPath = args.ledger ? path.resolve(args.ledger) : path.join(path.dirname(planPath), "heal-ledger.jsonl");
    const lines = results.map((result) => ledgerLine(result)).join("");
    if (!dryRun) fs.appendFileSync(ledgerPath, lines);

    process.stdout.write(`${JSON.stringify({ plan: planPath, results }, null, 2)}\n`);
    process.exit(results.every((r) => r.status !== "reverted") ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
