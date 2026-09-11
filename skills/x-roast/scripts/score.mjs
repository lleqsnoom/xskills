#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const MIN_SCORE = 1;
export const MAX_SCORE = 5;

export const DIMENSIONS = {
  accuracy: {
    label: "Factual accuracy",
    weight: 3,
    question: "Are the factual claims true and verifiable against primary sources?",
  },
  logic: {
    label: "Logical validity",
    weight: 3,
    question: "Does the reasoning hold — no fallacies, conclusions actually follow?",
  },
  evidence: {
    label: "Evidence quality",
    weight: 2,
    question: "Are load-bearing claims backed by cited, authoritative sources?",
  },
  originality: {
    label: "Originality",
    weight: 2,
    question: "Does it add non-obvious insight beyond restating what is already known?",
  },
  clarity: {
    label: "Clarity & structure",
    weight: 2,
    question: "Is it organized, unambiguous, and easy to follow?",
  },
  completeness: {
    label: "Completeness",
    weight: 2,
    question: "Does it cover the question without major gaps or dangling threads?",
  },
  actionability: {
    label: "Actionability",
    weight: 1,
    question: "Does it enable a concrete decision or next step?",
  },
  balance: {
    label: "Balance & fairness",
    weight: 1,
    question: "Are counterarguments, limits, and uncertainty acknowledged?",
  },
  decomposition: {
    label: "Decomposition",
    weight: 3,
    question: "Are epics sliced into independent, valuable, estimable increments?",
  },
  acceptance: {
    label: "Acceptance criteria",
    weight: 3,
    question: "Are acceptance criteria / definition of done explicit and testable?",
  },
  testability: {
    label: "Testability",
    weight: 3,
    question: "Is the definition of done objectively verifiable by someone else?",
  },
  estimation: {
    label: "Estimation soundness",
    weight: 2,
    question: "Are effort and scope estimates justified and realistic?",
  },
  method: {
    label: "Method soundness",
    weight: 3,
    question: "Are the methods valid, appropriate, and reproducible?",
  },
  recency: {
    label: "Recency",
    weight: 1,
    question: "Are the sources current relative to the pace of the topic?",
  },
};

export const COMMON = [
  "accuracy",
  "logic",
  "evidence",
  "originality",
  "clarity",
  "completeness",
  "actionability",
  "balance",
];

export const PROFILES = {
  generic: COMMON,
  article: COMMON,
  analysis: COMMON,
  research: [...COMMON, "method", "recency"],
  epic: [...COMMON, "decomposition", "acceptance"],
  task: [...COMMON, "testability", "estimation"],
};

export const BANDS = [
  { min: 90, key: "exemplary", label: "Well done — barely worth roasting" },
  { min: 75, key: "strong", label: "Strong — minor touch-ups only" },
  { min: 60, key: "adequate", label: "Adequate — needs seasoning" },
  { min: 40, key: "weak", label: "Weak — half-baked" },
  { min: 0, key: "raw", label: "Raw — start over" },
];

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function dimensionsFor(profile) {
  const dims = PROFILES[profile];
  if (!dims) {
    const known = Object.keys(PROFILES).join(", ");
    throw new Error(`Unknown profile "${profile}". Known profiles: ${known}`);
  }
  return dims;
}

export function normalizeScore(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, n));
}

export function bandFor(total) {
  for (const band of BANDS) {
    if (total >= band.min) return band;
  }
  return BANDS[BANDS.length - 1];
}

export function computeScore({ profile = "generic", scores = {} } = {}) {
  const dims = dimensionsFor(profile);
  const dimSet = new Set(dims);
  const unknown = Object.keys(scores).filter((key) => !dimSet.has(key));

  const normalized = {};
  const invalid = [];
  const outOfRange = [];
  for (const key of dims) {
    if (!(key in scores)) continue;
    const n = normalizeScore(scores[key]);
    if (n === null) {
      invalid.push(key);
      continue;
    }
    if (n !== Number(scores[key])) outOfRange.push(key);
    normalized[key] = n;
  }

  const missing = dims.filter((key) => !(key in normalized));
  const requiredWeight = dims.reduce((sum, key) => sum + DIMENSIONS[key].weight, 0);

  let presentWeight = 0;
  let weighted = 0;
  const breakdown = [];
  for (const key of dims) {
    if (!(key in normalized)) continue;
    const def = DIMENSIONS[key];
    const scaled = ((normalized[key] - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100;
    presentWeight += def.weight;
    weighted += scaled * def.weight;
    breakdown.push({
      dimension: key,
      label: def.label,
      weight: def.weight,
      score: normalized[key],
      normalized: round(scaled, 1),
      contribution: round(scaled * def.weight, 1),
    });
  }

  const total = presentWeight > 0 ? round(weighted / presentWeight, 1) : null;
  const band = total === null ? null : bandFor(total);

  return {
    profile,
    total,
    band,
    completeness: requiredWeight > 0 ? round(presentWeight / requiredWeight, 3) : 0,
    breakdown,
    missing,
    unknown,
    outOfRange,
    invalid,
    requiredWeight,
    presentWeight,
  };
}

function parseScoreArgs(list) {
  const out = {};
  for (const item of list) {
    const eq = item.indexOf("=");
    if (eq === -1) {
      throw new Error(`Invalid score "${item}" (expected key=value)`);
    }
    const key = item.slice(0, eq).trim();
    const value = item.slice(eq + 1).trim();
    if (!key) throw new Error(`Invalid score "${item}" (empty key)`);
    out[key] = value;
  }
  return out;
}

function readInput(inputPath) {
  const text = inputPath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(inputPath, "utf8");
  const data = JSON.parse(text);
  if (data && typeof data === "object" && data.scores && typeof data.scores === "object") {
    return { profile: typeof data.profile === "string" ? data.profile : null, scores: data.scores };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Input JSON must be an object of dimension=score pairs");
  }
  return { profile: null, scores: data };
}

function usage() {
  return [
    "x-roast score — weighted, reproducible scoring for critiques.",
    "",
    "Usage:",
    "  node score.mjs --profile <type> --score accuracy=4 --score logic=3",
    '  node score.mjs --profile task --scores "testability=5,estimation=2"',
    "  node score.mjs --input scores.json",
    "",
    "Flags:",
    "  --profile <type>   Rubric profile: generic, article, analysis, research, epic, task",
    "  --type <type>      Alias for --profile",
    "  --input <file>     JSON file: either { profile, scores } or a bare scores object ('-' = stdin)",
    "  --score <k=v>      One dimension score (repeatable)",
    "  --scores <list>    Comma-separated key=value pairs",
    "  --help             Show this help",
    "",
    "Scores are anchored 1-5 (see references/rubric.md). Missing dimensions are",
    "reported, not invented. Weights are normalized over the dimensions supplied.",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  let profile = null;
  let inputPath = null;
  let scoresInline = null;
  const scoresRaw = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write(usage());
      return;
    } else if (args[i] === "--profile" && i + 1 < args.length) {
      profile = args[++i];
    } else if (args[i] === "--type" && i + 1 < args.length) {
      profile = args[++i];
    } else if (args[i] === "--input" && i + 1 < args.length) {
      inputPath = args[++i];
    } else if (args[i] === "--scores" && i + 1 < args.length) {
      scoresInline = args[++i];
    } else if (args[i] === "--score" && i + 1 < args.length) {
      scoresRaw.push(args[++i]);
    } else {
      process.stderr.write(`${JSON.stringify({ error: `Unknown argument "${args[i]}"` })}\n`);
      process.exit(1);
    }
  }

  try {
    const scores = {};
    if (scoresInline) Object.assign(scores, parseScoreArgs(scoresInline.split(",")));
    if (inputPath) {
      const fromFile = readInput(inputPath);
      if (fromFile.profile && !profile) profile = fromFile.profile;
      Object.assign(scores, fromFile.scores);
    }
    Object.assign(scores, parseScoreArgs(scoresRaw));

    const result = computeScore({ profile: profile || "generic", scores });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
