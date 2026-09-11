#!/usr/bin/env node
// x-humanize verify — re-measure the rewrite, prove the target is met, and
// guarantee no meaning was lost and no noise was added.
// Exit 0 = pass, exit 1 = fail (or error).

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { analyzeText, GRADE_TARGETS, DEFAULT_TARGET, findFiller, FILLER_PHRASES, tokenizeWords } from "./utils/metrics.mjs";
import { readTextInput } from "./utils/io.mjs";

const URL_RE = /https?:\/\/[^\s)>"']+/g;
const CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const NUMBER_RE = /\b\d[\d.,]*\b/g;

function collect(re, text) {
  return (String(text ?? "").match(re) ?? []).map((s) => s.trim()).sort();
}

function sameMultiset(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function contentWordOverlap(before, after) {
  const set = (t) => new Set(tokenizeWords(t).map((w) => w.toLowerCase()).filter((w) => w.length >= 4));
  const a = set(before);
  const b = set(after);
  if (a.size === 0) return 1;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit += 1;
  return Math.round((hit / a.size) * 1000) / 1000;
}

export function verify({ original, revised, target = DEFAULT_TARGET, minOverlap = 0.2 } = {}) {
  const before = analyzeText(original, { target });
  const after = analyzeText(revised, { target });
  const maxGrade = GRADE_TARGETS[target] ?? GRADE_TARGETS[DEFAULT_TARGET];

  const beforeFiller = new Set(findFiller(original));
  const afterFiller = findFiller(revised);
  const newFiller = afterFiller.filter((f) => !beforeFiller.has(f));
  const noisePhrases = afterFiller.filter((f) => FILLER_PHRASES.includes(f));
  const overlap = contentWordOverlap(original, revised);

  const checks = [    {
      id: "target-met",
      ok: after.level.fkGrade !== null && after.level.fkGrade <= maxGrade,
      detail: `Flesch-Kincaid grade ${after.level.fkGrade} vs max ${maxGrade} for ${target}`,
    },
    {
      id: "no-noise-added",
      ok: newFiller.length === 0,
      detail: newFiller.length ? `introduced noise: ${newFiller.join(", ")}` : "no new filler introduced",
    },
    {
      id: "no-noise-phrases",
      ok: noisePhrases.length === 0,
      detail: noisePhrases.length ? `noise phrases remain: ${noisePhrases.join(", ")}` : "no wordy noise phrases",
    },
    {
      id: "urls-preserved",
      ok: sameMultiset(collect(URL_RE, original), collect(URL_RE, revised)),
      detail: "every URL kept unchanged",
    },
    {
      id: "code-preserved",
      ok: sameMultiset(collect(CODE_RE, original), collect(CODE_RE, revised)),
      detail: "every code block kept unchanged",
    },
    {
      id: "numbers-preserved",
      ok: sameMultiset(collect(NUMBER_RE, original), collect(NUMBER_RE, revised)),
      detail: "every number kept unchanged",
    },
    {
      id: "meaning-retained",
      ok: overlap >= minOverlap,
      detail: `content-word overlap ${overlap} (floor ${minOverlap})`,
    },
  ];

  // Overlap is a floor, not proof: simplification legitimately swaps words.
  // Below this richer threshold, the agent must re-read the rewrite by hand.
  const warnings = overlap < 0.45 ? [`content-word overlap ${overlap} is low — re-read the rewrite to confirm meaning survived`] : [];

  const delta = (k) => {
    const a = before.metrics[k];
    const b = after.metrics[k];
    return b - a;
  };

  return {
    pass: checks.every((c) => c.ok),
    target: { level: target, maxGrade },
    checks,
    warnings,
    overlap,
    before: { metrics: before.metrics, formulas: before.formulas, level: before.level },
    after: { metrics: after.metrics, formulas: after.formulas, level: after.level },
    deltas: {
      fleschKincaidGrade: after.level.fkGrade !== null && before.level.fkGrade !== null ? Math.round((after.level.fkGrade - before.level.fkGrade) * 10) / 10 : null,
      avgSentenceLength: Math.round(delta("avgSentenceLength") * 10) / 10,
      longSentences: delta("longSentences"),
      filler: delta("filler"),
      unknownWords: delta("unknownWords"),
    },
  };
}

function usage() {
  return [
    "x-humanize verify — check the rewrite meets target, loses no meaning, adds no noise.",
    "",
    "Usage:",
    "  node verify.mjs --original draft.md --revised draft.humanized.md --level B2",
    "  node verify.mjs --original - --revised out.md   # original from stdin",
    "",
    "Flags:",
    "  --original <file|->  Source text (required)",
    "  --revised <file>     Rewritten text (required)",
    "  --level <lvl>        Target reader: A2 | B1 | B2 | C1 (default: B2)",
    "  --min-overlap <n>    Min content-word overlap 0..1 (default: 0.2, hard floor)",
    "  --help               Show this help",
    "",
    "Exit 0 = all checks pass; exit 1 = a check failed.",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const opts = { target: DEFAULT_TARGET, minOverlap: 0.2 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(usage());
      return;
    } else if (a === "--original" && i + 1 < args.length) opts.original = args[++i];
    else if (a === "--revised" && i + 1 < args.length) opts.revised = args[++i];
    else if (a === "--level" && i + 1 < args.length) opts.target = args[++i];
    else if (a === "--min-overlap" && i + 1 < args.length) opts.minOverlap = Number(args[++i]);
    else {
      process.stderr.write(`${JSON.stringify({ error: `Unknown argument "${a}"` })}\n`);
      process.exit(1);
    }
  }

  if (!opts.original || !opts.revised) {
    process.stderr.write(`${JSON.stringify({ error: "--original and --revised are required" })}\n`);
    process.exit(1);
  }
  if (!GRADE_TARGETS[opts.target]) {
    process.stderr.write(`${JSON.stringify({ error: `Unknown level "${opts.target}"` })}\n`);
    process.exit(1);
  }

  try {
    const read = (p) => readTextInput({ file: p === "-" ? "-" : p, useStdin: p === "-" }).text;
    const result = verify({ original: read(opts.original), revised: read(opts.revised), target: opts.target, minOverlap: opts.minOverlap });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.pass ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
