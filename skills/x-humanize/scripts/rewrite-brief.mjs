#!/usr/bin/env node
// x-humanize rewrite-brief — turn an analyze JSON report into a ranked,
// actionable edit list so the rewrite is targeted (and stays noise-free).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SWAPS_PATH = path.join(HERE, "..", "references", "simplifications.json");

export function loadSwaps() {
  return JSON.parse(fs.readFileSync(SWAPS_PATH, "utf8"));
}

function reasonsFor(sentence) {
  const reasons = [];
  if (sentence.long === "hard") reasons.push(`long (${sentence.words} words > 25)`);
  else if (sentence.long === "warn") reasons.push(`borderline length (${sentence.words} words)`);
  if (sentence.polysyllables >= 3) reasons.push(`${sentence.polysyllables} polysyllabic words`);
  if (sentence.markers.length) reasons.push(`subordinate markers: ${sentence.markers.join(", ")}`);
  if (sentence.passive) reasons.push(`${sentence.passive} passive construction(s)`);
  if (sentence.nominalizations.length) reasons.push(`nominalizations: ${sentence.nominalizations.join(", ")}`);
  if (sentence.filler.length) reasons.push(`noise: ${sentence.filler.join(", ")}`);
  if (sentence.hardWords.length) reasons.push(`hard words: ${sentence.hardWords.slice(0, 8).join(", ")}`);
  return reasons;
}

function actionFor(sentence) {
  if (sentence.filler.length) return "Delete the noise phrase(s); say the point directly.";
  if (sentence.long === "hard") return "Split into two or three short sentences; one idea each.";
  if (sentence.passive) return "Switch to active voice and name the actor.";
  if (sentence.nominalizations.length) return "Turn the nominalization back into a verb.";
  if (sentence.polysyllables >= 3) return "Swap complex words for plain ones (see wordSwaps).";
  if (sentence.markers.length) return "Break the clause chain; reduce connectors.";
  return "Minor tightening only.";
}

export function buildBrief(analysis) {
  const swaps = loadSwaps();
  const usedSwaps = {};
  for (const s of analysis.sentences) {
    for (const w of s.hardWords) if (swaps[w]) usedSwaps[w] = swaps[w];
  }
  const priorities = [...analysis.sentences]
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => ({
      index: s.index,
      words: s.words,
      score: s.score,
      text: s.text,
      reasons: reasonsFor(s),
      action: actionFor(s),
    }));

  return {
    headline: `Target ${analysis.target.level} (max Flesch-Kincaid grade ${analysis.target.maxGrade}). Current: ${analysis.level.cefr} (grade ${analysis.level.fkGrade}).`,
    mustFix: analysis.metrics.longSentences,
    noiseCount: analysis.metrics.filler,
    priorities,
    wordSwaps: usedSwaps,
    rules: [
      "Preserve every fact, number, name, URL, and code block exactly.",
      "Add NO new claims and NO filler. If a phrase carries no meaning, delete it.",
      "One idea per sentence; keep sentences under 20 words where possible.",
      "Prefer active voice and plain verbs over nominalizations.",
      "Explain a hard term only if dropping it would lose meaning; otherwise use the plain word.",
    ],
  };
}

function renderMarkdown(brief) {
  const lines = [`# Rewrite brief`, "", brief.headline, ""];
  lines.push(`- Long sentences to fix: **${brief.mustFix}**`);
  lines.push(`- Noise phrases to delete: **${brief.noiseCount}**`, "");
  lines.push("## Rules", "");
  for (const r of brief.rules) lines.push(`- ${r}`);
  lines.push("", "## Priority edits", "");
  brief.priorities.forEach((p, i) => {
    lines.push(`${i + 1}. (score ${p.score}, ${p.words}w) ${p.reasons.join("; ") || "tighten"}`);
    lines.push(`   > ${p.text}`);
    lines.push(`   → ${p.action}`);
  });
  const swapKeys = Object.keys(brief.wordSwaps);
  if (swapKeys.length) {
    lines.push("", "## Word swaps", "");
    for (const k of swapKeys) lines.push(`- ${k} → ${brief.wordSwaps[k]}`);
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return [
    "x-humanize rewrite-brief — ranked edit list from an analyze report.",
    "",
    "Usage:",
    "  node analyze.mjs draft.md | node rewrite-brief.mjs --stdin",
    "  node rewrite-brief.mjs --input analysis.json --format md",
    "",
    "Flags:",
    "  --input <file>    analyze JSON ('-' = stdin)",
    "  --stdin           Read analyze JSON from stdin",
    "  --format <fmt>    json | md (default: json)",
    "  --help            Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  let input = null;
  let useStdin = false;
  let format = "json";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(usage());
      return;
    } else if (a === "--input" && i + 1 < args.length) input = args[++i];
    else if (a === "--stdin") useStdin = true;
    else if (a === "--format" && i + 1 < args.length) format = args[++i];
    else {
      process.stderr.write(`${JSON.stringify({ error: `Unknown argument "${a}"` })}\n`);
      process.exit(1);
    }
  }

  try {
    const raw = useStdin || input === "-" ? fs.readFileSync(0, "utf8") : input ? fs.readFileSync(input, "utf8") : null;
    if (raw === null) throw new Error("Provide --input <file> or --stdin.");
    const analysis = JSON.parse(raw);
    const brief = buildBrief(analysis);
    process.stdout.write(format === "md" ? renderMarkdown(brief) : `${JSON.stringify(brief, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}

export { renderMarkdown };
