#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SCHEMA } from "./analyze.mjs";

export const PORTFOLIO_ACTIONS = ["create", "merge", "split", "delete"];

/** The report's shape: the sections it must have and the fields each item must carry. */
export function lintAnalysis(report) {
  const violations = [];
  const value = report && typeof report === "object" ? report : {};

  if (!value.schema || value.schema !== SCHEMA) {
    violations.push({ rule: "bad-schema", detail: `expected schema "${SCHEMA}"` });
  }
  if (!value.stats || !Number.isInteger(value.stats.sessions) || value.stats.sessions < 1) {
    violations.push({ rule: "no-evidence", detail: "the report claims no sessions, so it cannot be evidence of a window" });
  }
  if (!Array.isArray(value.findings)) violations.push({ rule: "missing-findings", detail: "no findings array" });
  if (!Array.isArray(value.portfolio)) violations.push({ rule: "missing-portfolio", detail: "no portfolio array" });

  for (const finding of value.findings ?? []) {
    const id = finding.id ?? "?";
    if (!finding.id || !/^F\d+$/.test(finding.id)) violations.push({ rule: "finding-id", detail: `${id} is not F<n>` });
    if (!finding.kind) violations.push({ rule: "finding-kind", finding: id, detail: "no kind" });
    if (!Number.isInteger(finding.recurrence) || finding.recurrence < 1) {
      violations.push({ rule: "finding-recurrence", finding: id, detail: "recurrence is missing or zero" });
    }
    if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
      violations.push({ rule: "finding-evidence", finding: id, detail: "a finding must cite evidence" });
    }
  }

  for (const item of value.portfolio ?? []) {
    const id = item.id ?? "?";
    if (!item.id || !/^PF\d+$/.test(item.id)) violations.push({ rule: "portfolio-id", detail: `${id} is not PF<n>` });
    if (!PORTFOLIO_ACTIONS.includes(item.action)) {
      violations.push({ rule: "portfolio-action", detail: `${item.action} is not one of ${PORTFOLIO_ACTIONS.join(", ")}` });
    }
    if (!Array.isArray(item.skills)) violations.push({ rule: "portfolio-skills", detail: `${id} has no skills array` });
    if (!item.reason) violations.push({ rule: "portfolio-reason", detail: `${id} has no reason` });
  }

  return { violations, findings: (value.findings ?? []).length, portfolio: (value.portfolio ?? []).length };
}

function newestAnalysis(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith("-analysis.json"))
    .map((name) => ({ file: name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(dir, files[0].file) : null;
}

function resolveFile(args) {
  if (typeof args.file === "string") return args.file;
  if (typeof args.dir === "string") return newestAnalysis(args.dir);
  throw new Error("--file <path> or --dir <run-dir> is required");
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
    "x-autoreflection-analysis check-analysis — fail while the report is unshaped.",
    "",
    "Usage:",
    "  node check-analysis.mjs --file <report.json>",
    "  node check-analysis.mjs --dir <run-dir>",
    "",
    "Exit: 0 clean · 1 violations · 2 usage error",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  try {
    const file = resolveFile(args);
    if (!file || !fs.existsSync(file)) {
      process.stderr.write(`${JSON.stringify({ error: `no analysis report found${file ? `: ${file}` : ""}` })}\n`);
      process.exit(2);
    }
    const result = lintAnalysis(JSON.parse(fs.readFileSync(file, "utf8")));
    process.stdout.write(`${JSON.stringify({ file, ...result }, null, 2)}\n`);
    process.exit(result.violations.length === 0 ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
