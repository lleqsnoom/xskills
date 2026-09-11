#!/usr/bin/env node
// x-humanize analyze — measure readability and flag hard sentences.
// Pure output: JSON to stdout. Nothing is rewritten here.

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { analyzeText, GRADE_TARGETS, DEFAULT_TARGET } from "./utils/metrics.mjs";
import { readTextInput } from "./utils/io.mjs";

export function runAnalyze({ text, source = "text", target = DEFAULT_TARGET } = {}) {
  return { source, ...analyzeText(text, { target }) };
}

function usage() {
  return [
    "x-humanize analyze — measure readability, flag hard sentences and noise.",
    "",
    "Usage:",
    "  node analyze.mjs <file> [--level B2] [--output out.json]",
    "  node analyze.mjs --stdin --level B1",
    "  node analyze.mjs --commit HEAD",
    "  node analyze.mjs --pr 42",
    "",
    "Flags:",
    "  --level <lvl>    Target reader: A2 | B1 | B2 | C1 (default: B2)",
    "  --commit [ref]   Analyze a git commit message (default ref: HEAD)",
    "  --pr [number]    Analyze a GitHub PR title+body via gh (default: current branch)",
    "  --stdin          Read prose from stdin",
    "  --output <file>  Also write the JSON report to a file",
    "  --top <n>        Include only the top n worst sentences in `sentences` (default: all)",
    "  --help           Show this help",
    "",
  ].join("\n");
}

function parseArgs(args) {
  const opts = { target: DEFAULT_TARGET, top: null, output: null, file: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--level" && i + 1 < args.length) opts.target = args[++i];
    else if (a === "--stdin") opts.useStdin = true;
    else if (a === "--commit") opts.commit = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "HEAD";
    else if (a === "--pr") opts.pr = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "";
    else if (a === "--output" && i + 1 < args.length) opts.output = args[++i];
    else if (a === "--top" && i + 1 < args.length) opts.top = Number(args[++i]);
    else if (a.startsWith("--")) throw new Error(`Unknown argument "${a}"`);
    else opts.file = a;
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
  if (opts.help) {
    process.stdout.write(usage());
    return;
  }
  if (!GRADE_TARGETS[opts.target]) {
    process.stderr.write(`${JSON.stringify({ error: `Unknown level "${opts.target}". Use ${Object.keys(GRADE_TARGETS).join(", ")}.` })}\n`);
    process.exit(1);
  }

  try {
    const { text, source } = readTextInput(opts);
    const result = runAnalyze({ text, source, target: opts.target });
    if (Number.isFinite(opts.top) && opts.top > 0) {
      result.sentences = [...result.sentences].sort((a, b) => b.score - a.score).slice(0, opts.top);
    }
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (opts.output) fs.writeFileSync(opts.output, json);
    process.stdout.write(json);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
