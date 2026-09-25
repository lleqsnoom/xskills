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
  triggers: {
    label: "Trigger clarity",
    weight: 3,
    question: "Does the skill say when to fire — explicit situations and phrases, not just a topic?",
  },
  procedure: {
    label: "Procedure soundness",
    weight: 3,
    question: "Are the steps ordered, each ending on a checkable completion criterion?",
  },
  verification: {
    label: "Verification",
    weight: 3,
    question: "Can completion be verified by a command or check, rather than by opinion?",
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

// A text with claims always has these: they can be scored low, never marked not applicable.
export const ALWAYS_APPLY = ["accuracy", "logic", "clarity", "completeness"];

export const PROFILES = {
  generic: COMMON,
  article: COMMON,
  analysis: COMMON,
  research: [...COMMON, "method", "recency"],
  epic: [...COMMON, "decomposition", "acceptance"],
  task: [...COMMON, "testability", "estimation"],
  spec: [...COMMON, "testability"],
  skill: [...COMMON, "triggers", "procedure", "verification"],
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
  // The anchors are whole levels, so 3.7 has no anchor behind it.
  if (!Number.isInteger(n)) return null;
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, n));
}

export function bandFor(total) {
  for (const band of BANDS) {
    if (total >= band.min) return band;
  }
  return BANDS[BANDS.length - 1];
}

// `na` maps a dimension that does not apply to this artifact to the reason it does not. It leaves the
// profile, so it is neither scored nor missing, and the total is not provisional because of it.
export function computeScore({ profile = "generic", scores = {}, na = {} } = {}) {
  const profileDims = dimensionsFor(profile);
  const naList = Object.entries(na).map(([dimension, reason]) => ({ dimension, reason: String(reason ?? "").trim() }));
  const unknownNa = naList.filter((entry) => !profileDims.includes(entry.dimension)).map((entry) => entry.dimension);
  const naWithoutReason = naList.filter((entry) => !entry.reason).map((entry) => entry.dimension);
  const naScored = naList.filter((entry) => entry.dimension in scores).map((entry) => entry.dimension);
  const naRequired = naList.filter((entry) => ALWAYS_APPLY.includes(entry.dimension)).map((entry) => entry.dimension);
  const naSet = new Set(naList.map((entry) => entry.dimension));
  const dims = profileDims.filter((key) => !naSet.has(key));
  const dimSet = new Set(dims);
  const unknown = Object.keys(scores).filter((key) => !dimSet.has(key) && !naSet.has(key));

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
    na: naList.filter((entry) => profileDims.includes(entry.dimension)),
    naErrors: [
      ...unknownNa.map((key) => `${key}: not a dimension of the ${profile} profile`),
      ...naWithoutReason.map((key) => `${key}: not applicable needs a reason`),
      ...naScored.map((key) => `${key}: both scored and marked not applicable`),
      ...naRequired.map((key) => `${key}: always applies; score it low instead`),
    ],
    requiredWeight,
    presentWeight,
  };
}

// The frozen artifacts of this skill's evals/calibration.json, without their reference scores.
export function calibrationCases(profile = null) {
  const file = new URL("../evals/calibration.json", import.meta.url);
  return JSON.parse(fs.readFileSync(file, "utf8")).cases.filter((entry) => !profile || entry.profile === profile);
}

// One case with its reference scores, which live apart in evals/calibration-answers.json so a reviewer
// can find a case without reading its answer.
export function calibrationCase(name) {
  const found = calibrationCases().find((entry) => entry.name === name);
  if (!found) throw new Error(`no calibration case "${name}"`);
  const answers = new URL("../evals/calibration-answers.json", import.meta.url);
  const reference = JSON.parse(fs.readFileSync(answers, "utf8")).references[name];
  if (!reference) throw new Error(`calibration case "${name}" has no reference in calibration-answers.json`);
  return { ...found, reference };
}

// The header line a report carries, so the gate can re-run the calibration it records.
export function calibrationLine(name, scores, drift) {
  const listed = Object.entries(scores).map(([dimension, value]) => `${dimension}=${value}`).join(", ");
  const verdict = drift.length ? `drift: ${drift.map((d) => d.detail.split(":")[0]).join(", ")}` : "no drift";
  return `**Calibration:** ${name} — ${listed} — ${verdict}`;
}

// How far the second reviewer's blind scores sit from the references, without printing either.
export function calibrationAgreement() {
  const answers = JSON.parse(fs.readFileSync(new URL("../evals/calibration-answers.json", import.meta.url), "utf8"));
  const pairs = Object.entries(answers.references).flatMap(([name, reference]) =>
    Object.entries(reference).map(([dimension, score]) => ({ at: `${name}.${dimension}`, gap: Math.abs(score - answers.second[name][dimension]) })));
  return {
    second: answers.reviewers.second.split(" ")[0],
    cases: Object.keys(answers.references).length,
    scores: pairs.length,
    within1: pairs.filter((pair) => pair.gap <= 1).length,
    equal: pairs.filter((pair) => pair.gap === 0).length,
    disputes: pairs.filter((pair) => pair.gap > 1).map((pair) => pair.at),
  };
}

// Every reference score the given scores miss by more than 1, or leave out.
export function checkCalibration(block, reference) {
  return Object.entries(reference)
    .filter(([dimension, expected]) => Math.abs(Number(block?.scores?.[dimension] ?? NaN) - expected) > 1 || !(dimension in (block?.scores ?? {})))
    .map(([dimension, expected]) => ({ rule: "calibration-drift", detail: `${dimension}: scored ${block?.scores?.[dimension] ?? "nothing"}, the reference is ${expected} (±1)` }));
}

// The compact block a report carries in its ## Score section. check-report.mjs recomputes the total
// from `profile`, `scores` and `na`, so this is all it needs.
export function reportBlock(result, na = {}) {
  return {
    profile: result.profile,
    scores: Object.fromEntries(result.breakdown.map((row) => [row.dimension, row.score])),
    ...(Object.keys(na).length ? { na } : {}),
    total: result.total,
    band: result.band?.key ?? null,
    completeness: result.completeness,
  };
}

export function parseScoreArgs(list) {
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

function parseNaArgs(list) {
  const out = {};
  for (const item of list) {
    const eq = item.indexOf("=");
    const key = (eq === -1 ? item : item.slice(0, eq)).trim();
    if (!key) throw new Error(`Invalid --na "${item}" (expected dimension=reason)`);
    out[key] = eq === -1 ? "" : item.slice(eq + 1).trim();
  }
  return out;
}

function readInput(inputPath) {
  const text = inputPath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(inputPath, "utf8");
  const data = JSON.parse(text);
  if (data && typeof data === "object" && data.scores && typeof data.scores === "object") {
    return { profile: typeof data.profile === "string" ? data.profile : null, scores: data.scores, na: data.na ?? {} };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Input JSON must be an object of dimension=score pairs");
  }
  return { profile: null, scores: data, na: {} };
}

function usage() {
  return [
    "x-roast score — weighted, consistent scoring for critiques: the same scores always give the same total.",
    "",
    "Usage:",
    "  node score.mjs --profile <type> --score accuracy=4 --score logic=3",
    '  node score.mjs --profile task --scores "testability=5,estimation=2"',
    "  node score.mjs --input scores.json",
    "",
    "Flags:",
    "  --profile <type>   Rubric profile: generic, article, analysis, research, epic, task, spec, skill",
    "  --type <type>      Alias for --profile",
    "  --input <file>     JSON file: either { profile, scores } or a bare scores object ('-' = stdin)",
    "  --score <k=v>      One dimension score (repeatable)",
    "  --scores <list>    Comma-separated key=value pairs",
    "  --na <k=reason>    A dimension that does not apply, and why (repeatable); it is dropped, not scored",
    "  --report           Print only the block for the report's ## Score section",
    "  --cases            List the calibration cases (with --profile, only that profile's), without their answers",
    "  --agreement        How many of the second reviewer's blind scores are within 1 of the references (no scores shown)",
    "  --calibrate <case> Compare the scores with a case's reference; exit 1 on a drift over 1, and print the report's **Calibration:** line",
    "  --help             Show this help",
    "",
    "Scores are whole numbers 1-5, anchored in references/rubric.md. Missing dimensions are",
    "reported, not invented. Weights are normalized over the dimensions supplied.",
    "",
    "Problems the output lists, and what to do — never fill a gap yourself:",
    "  missing     profile dimensions not scored: score them, or report the total as provisional",
    "  unknown     keys not in this profile: drop them (typo guard)",
    "  outOfRange  a value outside 1-5, clipped: re-read the anchor and re-score honestly",
    "  invalid     not a whole number: fix it and re-run",
    "  naErrors    an --na with no reason, not in the profile, also scored, or on a dimension that",
    "              always applies (accuracy, logic, clarity, completeness): fix it and re-run",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  let profile = null;
  let inputPath = null;
  let scoresInline = null;
  const scoresRaw = [];
  const naRaw = [];
  let reportOnly = false;
  let calibrate = null;
  let listCases = false;
  let agreement = false;

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
    } else if (args[i] === "--na" && i + 1 < args.length) {
      naRaw.push(args[++i]);
    } else if (args[i] === "--report") {
      reportOnly = true;
    } else if (args[i] === "--agreement") {
      agreement = true;
    } else if (args[i] === "--cases") {
      listCases = true;
    } else if (args[i] === "--calibrate" && i + 1 < args.length) {
      calibrate = args[++i];
    } else {
      process.stderr.write(`${JSON.stringify({ error: `Unknown argument "${args[i]}"` })}\n`);
      process.exit(1);
    }
  }

  try {
    if (agreement) {
      process.stdout.write(`${JSON.stringify(calibrationAgreement(), null, 2)}\n`);
      return;
    }
    if (listCases) {
      process.stdout.write(`${JSON.stringify(calibrationCases(profile), null, 2)}\n`);
      return;
    }
    const scores = {};
    const na = {};
    if (scoresInline) Object.assign(scores, parseScoreArgs(scoresInline.split(",")));
    if (inputPath) {
      const fromFile = readInput(inputPath);
      if (fromFile.profile && !profile) profile = fromFile.profile;
      Object.assign(scores, fromFile.scores);
      Object.assign(na, fromFile.na);
    }
    Object.assign(scores, parseScoreArgs(scoresRaw));
    Object.assign(na, parseNaArgs(naRaw));

    const reference = calibrate && calibrationCase(calibrate);
    if (reference && profile && profile !== reference.profile) {
      throw new Error(`calibration case "${calibrate}" is a ${reference.profile}, not a ${profile}`);
    }
    const result = computeScore({ profile: profile || reference?.profile || "generic", scores, na });
    if (result.naErrors.length) throw new Error(result.naErrors.join("; "));
    if (reference) {
      const drift = checkCalibration(reportBlock(result, na), reference.reference);
      const line = calibrationLine(calibrate, reportBlock(result, na).scores, drift);
      process.stdout.write(`${JSON.stringify({ case: calibrate, profile: result.profile, drift, line }, null, 2)}\n`);
      if (drift.length) process.exit(1);
      return;
    }
    process.stdout.write(`${JSON.stringify(reportOnly ? reportBlock(result, na) : result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
