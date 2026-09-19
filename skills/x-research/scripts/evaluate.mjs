#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_TIMEOUT_MS = 60000;

// Accept the contract shape `{"pass": bool, "score": number}` (pass optional,
// absent counts as not passing) or a bare number/JSON number as the score.
export function normalizeEvalOutput(raw) {
  if (raw === null || raw === undefined) throw new Error("evaluator produced no output");
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new Error("evaluator output needs a numeric score");
    return { pass: false, score: raw };
  }
  if (typeof raw !== "object") throw new Error("evaluator output must be a JSON object or number");
  const score = Number(raw.score);
  if (!Number.isFinite(score)) throw new Error("evaluator output needs a numeric score");
  return { pass: raw.pass === true, score };
}

function parseFirstJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("evaluator produced no output");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("evaluator output is not valid JSON");
  }
}

// Runs the evaluator command through the platform shell with a hard timeout and
// returns the normalized `{ pass, score }` plus timing. Pure orchestration only:
// it never imports another skill's script and holds no state.
export function runEvaluator({ command, timeoutMs = DEFAULT_TIMEOUT_MS, cwd, env } = {}) {
  if (!command || typeof command !== "string") throw new Error("command is required");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive number");
  const startedAt = Date.now();
  const res = spawnSync(command, [], {
    shell: true,
    cwd,
    env: env || process.env,
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const timedOut = res.error && res.error.code === "ETIMEDOUT";
  if (timedOut) {
    return { ok: false, error: `evaluator timed out after ${timeoutMs} ms`, timedOut: true, durationMs, exitCode: res.status };
  }
  if (res.error) {
    return { ok: false, error: `evaluator failed to run: ${res.error.message}`, timedOut: false, durationMs, exitCode: res.status };
  }
  try {
    const parsed = normalizeEvalOutput(parseFirstJson(res.stdout));
    return { ok: true, pass: parsed.pass, score: parsed.score, exitCode: res.status, timedOut: false, durationMs };
  } catch (err) {
    return { ok: false, error: err.message, stdout: String(res.stdout || "").trim(), stderr: String(res.stderr || "").trim(), exitCode: res.status, timedOut: false, durationMs };
  }
}

// A guard is a boolean precondition: exit 0 = pass. A timeout or spawn failure is
// a failed guard, not a crash.
export function runGuard({ command, timeoutMs = DEFAULT_TIMEOUT_MS, cwd, env } = {}) {
  if (!command || typeof command !== "string") throw new Error("guard command is required");
  const res = spawnSync(command, [], { shell: true, cwd, env: env || process.env, timeout: timeoutMs, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const timedOut = res.error && res.error.code === "ETIMEDOUT";
  return { guardPass: !timedOut && !res.error && res.status === 0, exitCode: res.status, timedOut };
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

function usage() {
  return [
    "x-research evaluate — run the mechanical evaluator (and optional guard) with a timeout.",
    "",
    "Usage:",
    "  node evaluate.mjs --command <cmd> [--timeout <ms>] [--cwd <dir>] [--guard <cmd>]",
    "",
    "Prints one JSON object: { pass, score, guardPass?, exitCode, durationMs, timedOut }.",
    "Exit 0 when the evaluator produced a valid score, 1 otherwise (error to stderr).",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || args._[0] === "help") {
    process.stdout.write(usage());
    return;
  }
  try {
    const timeoutMs = args.timeout === undefined || args.timeout === true ? DEFAULT_TIMEOUT_MS : Number(args.timeout);
    const result = runEvaluator({ command: args.command === true ? undefined : args.command, timeoutMs, cwd: typeof args.cwd === "string" ? args.cwd : undefined });
    if (!result.ok) {
      process.stderr.write(`${JSON.stringify({ error: result.error, exitCode: result.exitCode ?? null, timedOut: result.timedOut, durationMs: result.durationMs }, null, 2)}\n`);
      process.exit(1);
    }
    const out = {
      pass: result.pass,
      score: result.score,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: false,
    };
    if (args.guard && args.guard !== true) {
      out.guardPass = runGuard({ command: args.guard, timeoutMs, cwd: typeof args.cwd === "string" ? args.cwd : undefined }).guardPass;
    }
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main();
}
