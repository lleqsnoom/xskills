#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./read-session.mjs";

export const VERDICTS = ["kept", "re-graded", "dropped"];
export const SEVERITIES = ["high", "medium", "low"];
export const PROPOSAL_FIELDS = ["Signal", "Target", "Change", "Check"];

/**
 * The anchors that say a session fell short without failing. A kept one is a claim about what the user
 * expected, so it must be quoted from the transcript and tied to a real skill line — not asserted.
 */
export const QUALITY_KINDS = new Set(["user-redo", "user-handoff", "tool-rejected", "skill-script-silent", "user-pushback"]);

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
    proposals.push({ id: head[1], title: head[2].trim(), signals, watch: /\*\*Watch:\*\*\s*\S/.test(block) });
    if (missing.length) violations.push({ rule: "proposal-shape", proposal: head[1], detail: `missing ${missing.join(", ")}` });
  });
  return { proposals, violations };
}

const QUOTE_RE = /"([^"]{3,})"|“([^”]{3,})”/g;
const REF_RE = /`([^`\s]+):(\d+)`/;

const quotesIn = (text) => [...String(text).matchAll(QUOTE_RE)].map((match) => match[1] ?? match[2]);

/**
 * Quality lines: `- **S5** — user: "<words from the transcript>" — skill: \`<path>:<line>\` "<words
 * from that line>"`. Quotes before the reference are the session's; the one after it is the skill's.
 */
export function parseQuality(body) {
  return contentLines(body)
    .map((line) => {
      const id = line.match(/\*\*\s*(S\d+|manual)\s*\*\*/i)?.[1] ?? null;
      const ref = line.match(REF_RE);
      const before = ref ? line.slice(0, ref.index) : line;
      const after = ref ? line.slice(ref.index + ref[0].length) : "";
      return { id, quotes: quotesIn(before), ref: ref ? { file: ref[1], line: Number(ref[2]) } : null, skillQuote: quotesIn(after)[0] ?? null };
    })
    .filter((entry) => entry.id);
}

const normalize = (text) => String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function transcriptText(transcript) {
  return normalize(
    (transcript?.messages ?? []).flatMap((message) => (message.parts ?? []).map((part) => [part.text, part.input, part.content].filter(Boolean).join(" "))).join(" ")
  );
}

function skillLineProblem(entry, root) {
  if (!entry.ref) return null;
  const file = path.resolve(root, entry.ref.file);
  if (!fs.existsSync(file)) return `${entry.ref.file} does not exist`;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  if (entry.ref.line < 1 || entry.ref.line > lines.length) return `${entry.ref.file} has ${lines.length} lines, not ${entry.ref.line}`;
  if (!entry.skillQuote) return null;
  const near = normalize(lines.slice(Math.max(0, entry.ref.line - 4), entry.ref.line + 3).join(" "));
  return near.includes(normalize(entry.skillQuote)) ? null : `"${entry.skillQuote}" is not within 3 lines of ${entry.ref.file}:${entry.ref.line}`;
}

/**
 * The truth check the shape rules cannot make: every kept quality anchor is quoted, the quote is in the
 * transcript, the skill line is where the reflection says, and the proposal names the rate it should move.
 */
function qualityCheck({ scan, gaps, proposals, quality, transcript, root }) {
  const violations = [];
  const kindOf = new Map((scan.signals ?? []).map((signal) => [signal.id, signal.kind]));
  const verdicts = new Map(gaps.map((gap) => [gap.id, gap.verdict]));
  const quoted = new Set(quality.map((entry) => entry.id));
  const kept = (scan.signals ?? []).filter((signal) => QUALITY_KINDS.has(signal.kind) && signal.severity === "high" && verdicts.get(signal.id) === "kept");
  for (const signal of kept) {
    if (!quoted.has(signal.id)) violations.push({ rule: "quality-unanchored", detail: `${signal.id} (${signal.kind}) was kept but no ## Quality line quotes its evidence` });
  }
  const text = transcript ? transcriptText(transcript) : null;
  for (const entry of quality) {
    if (!entry.quotes.length) violations.push({ rule: "quality-quote", detail: `${entry.id}'s Quality line quotes nothing from the session` });
    else if (text !== null && !entry.quotes.some((quote) => text.includes(normalize(quote)))) {
      violations.push({ rule: "quality-quote", detail: `no quote in ${entry.id}'s Quality line appears in the transcript` });
    }
    const problem = skillLineProblem(entry, root);
    if (problem) violations.push({ rule: "quality-skill-line", detail: `${entry.id}: ${problem}` });
  }
  for (const proposal of proposals) {
    if (proposal.signals.some((id) => QUALITY_KINDS.has(kindOf.get(id))) && !proposal.watch) {
      violations.push({ rule: "quality-watch", proposal: proposal.id, detail: `${proposal.id} answers a quality anchor but names no **Watch:** rate` });
    }
  }
  return violations;
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

  return { violations, parts, gaps: gaps.gaps, proposals: proposals.proposals, quality: parseQuality(parts.quality) };
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

export function lintReflection(text, scan = null, { transcript = null, root = process.cwd() } = {}) {
  const shape = lintShape(String(text || ""));
  const violations = [...shape.violations];

  if (!scan) {
    violations.push({ rule: "missing-scan", detail: "no scan JSON given; the reflection cannot be checked against its evidence" });
    return { violations, gaps: shape.gaps, proposals: shape.proposals, highSignals: [], checked: false };
  }

  const checked = crossCheck(scan, shape.gaps, shape.proposals);
  violations.push(...checked.violations);
  violations.push(...qualityCheck({ scan, gaps: shape.gaps, proposals: shape.proposals, quality: shape.quality, transcript, root }));
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
    "  --transcript <path>  The session export: every ## Quality quote must appear in it",
    "  --help          Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    known: ["file", "dir", "scan", "transcript", "help"],
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
    const transcript = typeof args.transcript === "string" ? JSON.parse(fs.readFileSync(args.transcript, "utf8")) : null;
    const result = lintReflection(fs.readFileSync(file, "utf8"), scan, { transcript });
    process.stdout.write(`${JSON.stringify({ file, scan: scanPath, ...result }, null, 2)}\n`);
    process.exit(result.violations.length === 0 ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
