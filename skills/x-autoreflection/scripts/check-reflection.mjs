#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./read-session.mjs";

export const VERDICTS = ["kept", "re-graded", "dropped"];
export const SEVERITIES = ["high", "medium", "low"];
export const PROPOSAL_FIELDS = ["Signal", "Target", "Change", "Check"];

/** A finding the scanner could not see: it carries no S id, only a judgement. */
export const MANUAL = "manual";
/** Several signals answered together. Never satisfies a high signal, which needs its own verdict. */
export const GROUP = "group";

function sections(text) {
  const out = {};
  const matches = [...String(text || "").matchAll(/^##\s+(.+?)\s*$/gm)];
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    out[match[1].trim().toLowerCase()] = text.slice(start, end);
  });
  return out;
}

function withoutFences(body) {
  return String(body || "").replace(/```[\s\S]*?```/g, "");
}

function contentLines(body) {
  return withoutFences(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--"));
}

/** Gap bullets: `- **S1 (high, kept)** — why`. */
export function parseGaps(body) {
  const gaps = [];
  const violations = [];
  for (const line of contentLines(body)) {
    if (!line.startsWith("-") && !line.startsWith("*")) {
      violations.push({ rule: "unparsed-gap", detail: line.slice(0, 120) });
      continue;
    }
    const match = line.match(/\*\*\s*(S\d+|manual|group)\s*\(([^)]*)\)\s*\*\*/i);
    if (!match) {
      violations.push({ rule: "unparsed-gap", detail: line.slice(0, 120) });
      continue;
    }
    const [severity, verdict] = match[2].split(",").map((part) => part.trim().toLowerCase());
    if (!SEVERITIES.includes(severity)) violations.push({ rule: "bad-severity", detail: `expected one of ${SEVERITIES.join(", ")} in "${match[2]}"` });
    if (!VERDICTS.includes(verdict)) violations.push({ rule: "bad-verdict", detail: `expected one of ${VERDICTS.join(", ")} in "${match[2]}"` });
    gaps.push({ id: match[1], severity, verdict });
  }
  return { gaps, violations };
}

/** Proposal blocks: `### P1 — kind: change` followed by the four fields. */
export function parseProposals(body) {
  const text = withoutFences(body);
  const heads = [...text.matchAll(/^###\s+(P\d+)\s*(.*)$/gm)];
  const proposals = [];
  const violations = [];
  heads.forEach((head, index) => {
    const start = head.index + head[0].length;
    const end = index + 1 < heads.length ? heads[index + 1].index : text.length;
    const block = text.slice(start, end);
    const missing = PROPOSAL_FIELDS.filter((field) => !new RegExp(`\\*\\*${field}:\\*\\*\\s*\\S`).test(block));
    const signal = block.match(/\*\*Signal:\*\*\s*([^\n]*)/);
    const signals = signal ? signal[1].match(/S\d+|manual/gi) || [] : [];
    proposals.push({ id: head[1], title: head[2].trim(), signals });
    if (missing.length) violations.push({ rule: "proposal-shape", proposal: head[1], detail: `missing ${missing.join(", ")}` });
  });
  return { proposals, violations };
}

/** The artifact's shape: the sections it must have, and the format of each bullet and block. */
export function lintShape(body) {
  const parts = sections(body);
  const violations = [];

  if (body.split(/\r?\n/).some((line) => /^\s*<!--/.test(line))) {
    violations.push({ rule: "template-comment", detail: "the reflection still contains template comments" });
  }

  const session = body.match(/^\*\*Session:\*\*\s*(.*)$/m);
  if (!session || !session[1].trim() || session[1].includes("<id>")) {
    violations.push({ rule: "no-source", detail: "the Session line does not name a session" });
  }

  const signals = parts.signals || "";
  if (!/```json/.test(signals) || !signals.includes("{")) {
    violations.push({ rule: "no-signals", detail: "the Signals section has no scan JSON" });
  }

  const gaps = parseGaps(parts.gaps);
  violations.push(...gaps.violations);
  if (!gaps.gaps.length) violations.push({ rule: "empty-gaps", detail: "no signal was checked" });

  const proposals = parseProposals(parts.proposals);
  violations.push(...proposals.violations);
  if (!proposals.proposals.length) violations.push({ rule: "empty-proposals", detail: "no proposal written" });

  if (!contentLines(parts.routes).length) {
    violations.push({ rule: "empty-routes", detail: "no route chosen" });
  }

  return { violations, parts, gaps: gaps.gaps, proposals: proposals.proposals };
}

/** The scan the shape claims: is it a transcript at all, and every high signal answered? */
function crossCheck(scan, gaps, proposals) {
  const violations = [];
  const signals = scan.signals || [];
  const stats = scan.stats || {};

  if (!stats.messages || !stats.toolCalls) {
    violations.push({
      rule: "scan-not-evidence",
      detail: `the scan reports ${stats.messages ?? 0} message(s) and ${stats.toolCalls ?? 0} tool call(s), so it cannot be evidence of a session`,
    });
  }

  const highSignals = signals.filter((signal) => signal.severity === "high").map((signal) => signal.id);
  const known = new Set(signals.map((signal) => signal.id));
  const cited = new Set(proposals.flatMap((proposal) => proposal.signals));
  const verdicts = new Map(gaps.map((gap) => [gap.id, gap.verdict]));

  for (const id of cited) {
    if (id.toLowerCase() !== MANUAL && !known.has(id)) {
      violations.push({ rule: "unknown-signal", detail: `${id} is not in the scan` });
    }
  }
  for (const id of highSignals) {
    if (!verdicts.has(id)) {
      violations.push({ rule: "unanswered-high", detail: `${id} (high) has no keep / re-grade / drop verdict` });
    }
    if (verdicts.get(id) === "kept" && !cited.has(id)) {
      violations.push({ rule: "kept-without-proposal", detail: `${id} was kept but no proposal cites it` });
    }
  }

  return { violations, highSignals };
}

export function lintReflection(text, scan = null) {
  const shape = lintShape(String(text || ""));
  const violations = [...shape.violations];

  if (!scan) {
    violations.push({ rule: "missing-scan", detail: "no scan JSON given; the reflection cannot be checked against its evidence" });
    return { violations, gaps: shape.gaps, proposals: shape.proposals, highSignals: [], checked: false };
  }

  const checked = crossCheck(scan, shape.gaps, shape.proposals);
  violations.push(...checked.violations);
  return { violations, gaps: shape.gaps, proposals: shape.proposals, highSignals: checked.highSignals, checked: true };
}

export function newestReflection(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith("-reflection.md"))
    .map((file) => ({ file, mtime: fs.statSync(path.join(dir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(dir, files[0].file) : null;
}

export function newestAcrossRuns(root = ".x-skills/runs") {
  if (!fs.existsSync(root)) return null;
  const found = fs
    .readdirSync(root)
    .map((name) => newestReflection(path.join(root, name)))
    .filter(Boolean);
  if (!found.length) return null;
  return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function findScan(explicit, file) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const dir = path.dirname(file);
  const candidates = ["signals.json", "scan.json"];
  const extra = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith("-signals.json")) : [];
  for (const name of [...candidates, ...extra]) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return explicit && !fs.existsSync(explicit) ? explicit : null;
}

function resolveFile(args) {
  if (typeof args.file === "string") return args.file;
  if (typeof args.dir === "string") return newestReflection(args.dir);
  return newestAcrossRuns();
}

function usage() {
  return [
    "x-autoreflection check-reflection — fail while the reflection is unshaped or a signal is unanswered.",
    "",
    "Usage:",
    "  node check-reflection.mjs --file <reflection.md> --scan /tmp/signals.json",
    "  node check-reflection.mjs --dir <run-dir>",
    "",
    "Flags:",
    "  --file <path>   The reflection artifact (default: newest in the run folder)",
    "  --dir <path>    A run folder to look in",
    "  --scan <path>   Scan JSON from scan-session.mjs (default: signals.json beside the reflection)",
    "  --help          Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    known: ["file", "dir", "scan", "help"],
  });
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    const file = resolveFile(args);
    if (!file || !fs.existsSync(file)) {
      process.stderr.write(`${JSON.stringify({ error: `no reflection file found${file ? `: ${file}` : ""}` })}\n`);
      process.exit(2);
    }
    const scanPath = findScan(typeof args.scan === "string" ? args.scan : null, file);
    if (scanPath && !fs.existsSync(scanPath)) {
      process.stderr.write(`${JSON.stringify({ error: `no scan file at ${scanPath}` })}\n`);
      process.exit(2);
    }
    const scan = scanPath ? JSON.parse(fs.readFileSync(scanPath, "utf8")) : null;
    const result = lintReflection(fs.readFileSync(file, "utf8"), scan);
    process.stdout.write(`${JSON.stringify({ file, scan: scanPath, ...result }, null, 2)}\n`);
    process.exit(result.violations.length === 0 ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
