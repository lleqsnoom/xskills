#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { calibrationCase, calibrationCases, calibrationLine, checkCalibration, computeScore, parseScoreArgs, PROFILES } from "./score.mjs";

// Every rule the gate enforces, and what it asks for. `--rules` prints this.
export const RULES = {
  "template-comment": "no <!-- template comment is left",
  "empty-central-claim": "## Central claim is filled in",
  reviewer: "**Reviewer:** is self or independent, then — and the model that judged (its id, or human)",
  "reviewer-family": "an independent reviewer is not of the model family named on **Author:**, and names a family the gate knows or human",
  "artifact-missing": "**Artifact:** names a file or folder on disk (save pasted text to a file first), so quotes can be checked",
  "claims-count": "## Claims is a table of 3-8 load-bearing claims",
  "claims-row": "each claim has a kind (local, external), a result (confirmed, contradicted, unverified), and a source: a URL for an external claim, a file:line or command for a local one, and for an unverified one the reason it could not be checked",
  "claims-backs": "each claim names in Backs the dimensions of the profile it bears on",
  "claims-quote": "each claim quotes the artifact, and the quote is found in one of its files; the pieces of a quote cut with an ellipsis are 4+ characters each and appear in that order",
  "score-json": "## Score has the ```json block score.mjs --report prints",
  "score-mismatch": "the block's total, the **Total:** line and the **Completeness:** line equal what the scores give",
  "score-provisional": "a total with an unscored dimension is labelled provisional",
  "accuracy-cap": "accuracy is at most 2 with a contradicted claim, at most 4 with an unverified one",
  "contradicted-unaddressed": "the accuracy finding names every contradicted claim by id and says whether the conclusion rests on it",
  "empty-findings": "## Findings is filled in",
  "finding-missing": "every scored dimension has a **name (n/5)** finding",
  "finding-mismatch": "a finding's n/5 equals its score",
  "finding-uncited": "a finding cites something checkable: a claim id or a URL from a ## Claims row that backs its dimension, a quote found in the artifact, or a file:line that exists",
  "finding-quote": "every quote in a finding is found in the artifact, or in a file the same finding cites by file:line",
  "citation-broken": "every file:line names a file that exists and has that line",
  alternatives: "three or more numbered alternatives, each tagged `reframe`, `addition` or `restructure`",
  "proposal-delta": "every proposal raises a scored dimension of the profile from its current score or above to a higher one (`logic` 3→4)",
  "since-unmarked": "every ## Since last roast line is marked closed, open or regressed",
  "score-rise": "a dimension that rose at all since the last roast is named on a closed line",
  "score-rise-proof": "a dimension that rose by 2 or more is named on a closed line that also shows the fix: a file:line that exists or a `command` in backticks",
  "score-drop": "a dimension that fell by 2 or more since the last roast is named on an open or regressed line",
  "calibration-line": "**Calibration:** is the line score.mjs --calibrate printed for a case of the report's profile (the gate re-runs it), or `skipped — <reason>`",
  "calibration-drift": "with --calibrate, every score is within 1 of the calibration case's reference",
};

const TAGS = /`(reframe|addition|restructure)`/;
const URLS = /https?:\/\/[^\s)`>|]+/g;
const HAS_URL = /https?:\/\//;
const FILE_LINE = /([\w.\/-]+\.\w+):(\d+)(?:-(\d+))?/g;
// `:40` or `:41-42` in backticks: a line of the artifact itself.
const OWN_LINE = /`:(\d+)(?:-(\d+))?`/g;
const QUOTE = /"([^"\n]{6,})"|“([^”\n]{6,})”/g;
const DELTA = /`?([a-z]+)`?\s+(\d)\s*→\s*(\d)/g;
const CLAIM_ID = /\bC\d+\b/g;
const TEXT_FILE = /\.(md|mdx|txt|mjs|cjs|js|ts|json|ya?ml)$/;

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

function contentLines(body) {
  return String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--") && !line.startsWith("```"));
}

// Top-level items of a list ("- " or "1. " at the start of a line), each with its continuation lines.
function items(body, marker) {
  const out = [];
  for (const line of String(body || "").split(/\r?\n/)) {
    if (marker.test(line)) out.push(line);
    else if (out.length && line.trim()) out[out.length - 1] += `\n${line}`;
  }
  return out;
}

function scoreBlock(body) {
  const json = String(body || "").match(/```json\s*([\s\S]*?)```/);
  try {
    const data = json && JSON.parse(json[1]);
    return data && typeof data.profile === "string" && data.scores && typeof data.scores === "object" ? data : null;
  } catch {
    return null;
  }
}

// Case, markdown emphasis, curly quotes and spacing do not change what a quote says.
function flatten(text) {
  return String(text).toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
}

// A quote cut with an ellipsis is found only when every piece is long enough to mean something and the
// pieces appear in order in one file: short pieces, or pieces taken from anywhere, can build any sentence.
function quoteFound(quote, texts) {
  const parts = quote.split(/…|\.\.\./).map(flatten).filter(Boolean);
  if (!parts.length || parts.some((part) => part.length < 4)) return false;
  return texts.some((text) => {
    let from = 0;
    return parts.every((part) => {
      const at = text.indexOf(part, from);
      from = at + part.length;
      return at !== -1;
    });
  });
}

function quotesIn(text) {
  return [...String(text).matchAll(QUOTE)].map((match) => match[1] ?? match[2]);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

// The artifact's text (a file, or every text file of a folder), or null when it is not on disk.
function readArtifact(named, root) {
  if (!named) return null;
  const full = path.resolve(root, named);
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  const files = stat.isDirectory() ? walk(full) : [full];
  return { file: stat.isDirectory() ? null : full, dir: stat.isDirectory() ? full : path.dirname(full), texts: files.map((file) => flatten(fs.readFileSync(file, "utf8"))) };
}

function lineCount(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).length;
}

// Each file:line (and `:n` of the artifact) in a piece of text, with whether it resolves.
function lineRefs(text, root, artifact) {
  const bare = String(text).replace(URLS, " ");
  const refs = [...bare.matchAll(FILE_LINE)].map((match) => {
    const last = Number(match[3] ?? match[2]);
    const file = [path.resolve(root, match[1]), artifact && path.resolve(artifact.dir, match[1])]
      .find((candidate) => candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return { ref: match[0], file, ok: Boolean(file) && lineCount(file) >= last };
  });
  for (const match of bare.matchAll(OWN_LINE)) {
    const last = Number(match[2] ?? match[1]);
    refs.push({ ref: match[0], file: artifact?.file, ok: Boolean(artifact?.file) && lineCount(artifact.file) >= last });
  }
  return refs;
}

const COLUMNS = ["#", "claim", "kind", "source", "result"];

// The rows of ## Claims, read by the header's column names so a column can sit anywhere.
function claimRows(body) {
  const table = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  const head = table.find((cells) => cells.some((cell) => /^claim$/i.test(cell)));
  const names = head ? head.map((cell) => cell.toLowerCase()) : COLUMNS;
  return table
    .filter((cells) => cells !== head)
    .map((cells) => {
      const cell = (name) => cells[names.indexOf(name)] ?? "";
      return {
        id: cell("#"),
        claim: cell("claim"),
        kind: cell("kind").toLowerCase(),
        source: cell("source"),
        result: cell("result").toLowerCase(),
        backs: cell("backs").toLowerCase().replace(/`/g, "").split(/[,\s]+/).filter(Boolean),
      };
    });
}

// Which dimensions a claim bears on is the reviewer's to declare, and the gate holds a finding to it.
function checkBacks(rows, block, violations) {
  const known = PROFILES[block?.profile];
  for (const row of rows) {
    const label = row.id || row.claim.slice(0, 40);
    if (!row.backs.length) violations.push({ rule: "claims-backs", detail: `${label}: name in Backs the dimensions this claim bears on (accuracy, evidence, …)` });
    for (const dimension of known ? row.backs.filter((d) => !known.includes(d)) : []) {
      violations.push({ rule: "claims-backs", detail: `${label}: ${dimension} is not a dimension of ${block.profile}` });
    }
  }
}

function checkClaims(body, artifact, violations) {
  const rows = claimRows(body);
  if (rows.length < 3 || rows.length > 8) {
    violations.push({ rule: "claims-count", detail: `## Claims has ${rows.length} rows; list the 3-8 claims the artifact depends on` });
  }
  for (const row of rows) {
    const label = row.id || row.claim.slice(0, 40);
    if (!["local", "external"].includes(row.kind)) violations.push({ rule: "claims-row", detail: `${label}: kind is local or external, not "${row.kind}"` });
    if (!["confirmed", "contradicted", "unverified"].includes(row.result)) {
      violations.push({ rule: "claims-row", detail: `${label}: result is confirmed, contradicted or unverified, not "${row.result}"` });
    } else if (row.result === "unverified") {
      if (!row.source.replace(/[-—\s]/g, "")) violations.push({ rule: "claims-row", detail: `${label}: an unverified claim says in Source why it could not be checked` });
    } else {
      if (row.kind === "external" && !HAS_URL.test(row.source)) violations.push({ rule: "claims-row", detail: `${label}: an external claim checked online names its URL` });
      if (row.kind === "local" && !row.source.replace(/[-—\s]/g, "")) violations.push({ rule: "claims-row", detail: `${label}: a local claim names the file:line or command that checked it` });
    }
    const quotes = quotesIn(row.claim);
    if (!quotes.length) violations.push({ rule: "claims-quote", detail: `${label}: quote the claim from the artifact` });
    else if (artifact) {
      for (const quote of quotes.filter((q) => !quoteFound(q, artifact.texts))) {
        violations.push({ rule: "claims-quote", detail: `${label}: "${quote.slice(0, 60)}" is not in the artifact` });
      }
    }
  }
  return rows;
}

function checkScore(body, header, rows, violations) {
  const block = scoreBlock(body);
  if (!block) {
    violations.push({ rule: "score-json", detail: "## Score needs a ```json block with profile and scores (score.mjs --report prints it)" });
    return null;
  }
  let result;
  try {
    result = computeScore({ profile: block.profile, scores: block.scores, na: block.na ?? {} });
  } catch (err) {
    violations.push({ rule: "score-mismatch", detail: err.message });
    return null;
  }
  const problems = [...result.naErrors, ...result.unknown.map((key) => `${key}: not a dimension of ${block.profile}`),
    ...result.invalid.map((key) => `${key}: not a whole number`), ...result.outOfRange.map((key) => `${key}: outside 1-5`)];
  if (Math.abs(Number(block.total) - result.total) > 0.05) problems.push(`total ${block.total} but the scores give ${result.total}`);
  const totalLine = header.match(/^\*\*Total:\*\*.*$/m)?.[0] ?? "";
  const headerTotal = Number(totalLine.match(/^\*\*Total:\*\*\s*([\d.]+)/)?.[1]);
  if (Math.abs(headerTotal - result.total) > 0.05 || Number.isNaN(headerTotal)) {
    problems.push(`the **Total:** line says ${Number.isNaN(headerTotal) ? "nothing" : headerTotal}, the scores give ${result.total}`);
  }
  const completenessLine = header.match(/^\*\*Completeness:\*\*.*$/m)?.[0];
  if (completenessLine) {
    const said = Number(completenessLine.match(/([\d.]+)\s*%/)?.[1]);
    const given = Math.round(result.completeness * 100);
    if (Number.isNaN(said) || Math.abs(said - given) > 0.5) {
      problems.push(`the **Completeness:** line says ${Number.isNaN(said) ? "nothing" : `${said}%`}, the scores give ${given}%`);
    }
  }
  for (const detail of problems) violations.push({ rule: "score-mismatch", detail });
  if (result.missing.length && !/provisional/i.test(totalLine)) {
    violations.push({ rule: "score-provisional", detail: `unscored ${result.missing.join(", ")}: label the total provisional, or mark them not applicable` });
  }
  const accuracy = Number(block.scores.accuracy);
  const cap = rows.some((row) => row.result === "contradicted") ? 2 : rows.some((row) => row.result === "unverified") ? 4 : 5;
  if (accuracy > cap) violations.push({ rule: "accuracy-cap", detail: `accuracy ${accuracy} with ${cap === 2 ? "a contradicted" : "an unverified"} claim; at most ${cap}` });
  return block;
}

// A claim id or a claim's URL counts only for a dimension its row backs: "see C1" is not evidence for
// every score, only for the ones C1 was declared to bear on.
function cited(bullet, dimension, rows, refs, artifact) {
  const backing = rows.filter((row) => row.backs.includes(dimension));
  const ids = new Set(backing.map((row) => row.id));
  const urls = backing.map((row) => row.source).join(" ");
  if ((bullet.match(CLAIM_ID) ?? []).some((id) => ids.has(id))) return true;
  if ((bullet.match(URLS) ?? []).some((url) => urls.includes(url))) return true;
  if (refs.some((ref) => ref.ok)) return true;
  return Boolean(artifact) && quotesIn(bullet).some((quote) => quoteFound(quote, artifact.texts));
}

// A finding's quotes that are neither in the artifact nor in a file the finding cites: one real quote
// must not carry an invented one.
function unfoundQuotes(bullet, refs, artifact) {
  const texts = [...artifact.texts, ...refs.filter((ref) => ref.ok).map((ref) => flatten(fs.readFileSync(ref.file, "utf8")))];
  return quotesIn(bullet).filter((quote) => !quoteFound(quote, texts));
}

// A contradicted claim changes what the artifact can conclude, so the accuracy finding has to deal with it.
function checkContradicted(rows, body, violations) {
  const finding = items(body, /^- /).find((item) => /^- \*\*accuracy \(/.test(item)) ?? "";
  for (const row of rows.filter((r) => r.result === "contradicted")) {
    if (!new RegExp(`\\b${row.id}\\b`).test(finding) || !/\brests?\b/.test(finding)) {
      violations.push({ rule: "contradicted-unaddressed", detail: `${row.id} is contradicted: name it in the accuracy finding and say whether the conclusion rests on it` });
    }
  }
}

function checkFindings(body, block, rows, root, artifact, violations) {
  const bullets = items(body, /^- /);
  if (!contentLines(body).length) {
    violations.push({ rule: "empty-findings", detail: "no findings recorded" });
    return;
  }
  for (const [dimension, score] of Object.entries(block?.scores ?? {})) {
    const bullet = bullets.find((item) => new RegExp(`^- \\*\\*${dimension} \\(`).test(item));
    if (!bullet) {
      violations.push({ rule: "finding-missing", detail: `${dimension}: no finding bullet "**${dimension} (${score}/5)**"` });
      continue;
    }
    const stated = Number(bullet.match(/\((\d+(?:\.\d+)?)\/5\)/)?.[1]);
    if (stated !== Number(score)) violations.push({ rule: "finding-mismatch", detail: `${dimension}: finding says ${stated}/5, score says ${score}/5` });
    const refs = lineRefs(bullet, root, artifact);
    // With no artifact on disk, artifact-missing already fails the report and no quote can be judged.
    if (!artifact) continue;
    if (!cited(bullet, dimension, rows, refs, artifact)) {
      violations.push({ rule: "finding-uncited", detail: `${dimension}: cite a claim whose Backs names ${dimension}, a quote found in the artifact, a file:line that exists, or a URL from such a claim` });
      continue;
    }
    for (const quote of unfoundQuotes(bullet, refs, artifact)) {
      violations.push({ rule: "finding-quote", detail: `${dimension}: "${quote.slice(0, 60)}" is not in the artifact or a file this finding cites` });
    }
  }
}

function checkProposals(body, block, violations) {
  const proposals = items(body, /^\d+\.\s/);
  if (!proposals.length) violations.push({ rule: "proposal-delta", detail: "no improvement proposals" });
  const scores = block?.scores ?? {};
  for (const item of proposals) {
    const head = item.split("\n")[0].slice(0, 80);
    const deltas = [...item.matchAll(DELTA)];
    const valid = deltas.filter(([, dimension, from, to]) => dimension in scores && Number(to) > Number(from) && Number(from) >= Number(scores[dimension]));
    if (!deltas.length) violations.push({ rule: "proposal-delta", detail: `name the dimension and its delta (\`logic\` 3→4): ${head}` });
    for (const [text, dimension, from, to] of deltas.filter((match) => !valid.includes(match))) {
      const why = !(dimension in scores) ? `${dimension} is not a scored dimension`
        : Number(to) <= Number(from) ? "it does not go up"
        : `it starts below the current ${dimension} score of ${scores[dimension]}`;
      violations.push({ rule: "proposal-delta", detail: `${text.trim()}: ${why}` });
    }
  }
}

function checkSince(body, block, root, violations, notes) {
  const lines = items(body, /^- /);
  for (const line of lines) {
    if (!/^- (closed|open|regressed)\b/.test(line)) {
      violations.push({ rule: "since-unmarked", detail: `mark as closed, open or regressed: ${line.split("\n")[0].slice(0, 80)}` });
    }
  }
  const previousFile = body.match(/^\*\*Previous:\*\*\s*(.+?)\s+—/m)?.[1];
  const previousPath = previousFile && path.resolve(root, previousFile);
  if (!previousPath || !fs.existsSync(previousPath)) {
    notes.push(`the previous roast${previousFile ? ` ${previousFile}` : ""} is not readable, so score rises were not checked`);
    return;
  }
  const before = scoreBlock(sections(fs.readFileSync(previousPath, "utf8")).score)?.scores ?? {};
  const closedLines = lines.filter((line) => line.startsWith("- closed"));
  const closed = closedLines.join("\n");
  const proven = (line) => lineRefs(line, root).some((ref) => ref.ok) || /`(node|npm|npx|git|bash|sh|python3?|make|pnpm|yarn)\s[^`]+`/.test(line);
  const unfixed = lines.filter((line) => /^- (open|regressed)\b/.test(line)).join("\n");
  for (const [dimension, score] of Object.entries(block?.scores ?? {})) {
    if (!(dimension in before)) continue;
    const moved = Number(score) - Number(before[dimension]);
    const named = (text) => new RegExp(`\\b${dimension}\\b`).test(text);
    if (moved >= 1 && !named(closed)) {
      violations.push({ rule: "score-rise", detail: `${dimension} rose ${before[dimension]}→${score}; name it on the closed line that earned it` });
    } else if (moved >= 2 && !closedLines.some((line) => named(line) && proven(line))) {
      violations.push({ rule: "score-rise-proof", detail: `${dimension} rose ${before[dimension]}→${score}; the closed line naming it must show the fix with a file:line or a \`command\`` });
    }
    if (moved <= -2 && !named(unfixed)) {
      violations.push({ rule: "score-drop", detail: `${dimension} fell ${before[dimension]}→${score}; name it on an open or regressed line that says why` });
    }
  }
}


// The directory a report's paths are relative to: the nearest folder above the report that holds its
// artifact, so a report gives the same verdict wherever the checker is run from; else the working directory.
export function reportRoot(file, named, fallback = process.cwd()) {
  if (file && named) {
    for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.resolve(dir, named))) return dir;
      if (dir === path.dirname(dir)) break;
    }
  }
  return fallback;
}

// The family a model id belongs to, for the self-preference rule: a fresh agent of the same family is not independent.
const FAMILIES = [
  ["anthropic", /claude|anthropic|opus|sonnet|haiku|fable/],
  ["openai", /\bgpt|openai|codex|\bo[1-9]\b|\bo[1-9]-/],
  ["google", /gemini|gemma|google|palm|bard/],
  ["meta", /llama|meta-/],
  ["alibaba", /qwen|alibaba/],
  ["mistral", /mistral|mixtral|codestral|devstral/],
  ["deepseek", /deepseek/],
  ["xai", /grok|xai/],
  ["moonshot", /kimi|moonshot/],
  ["zhipu", /glm|zhipu/],
  ["human", /^human\b/],
];
export function modelFamily(model) {
  const id = String(model || "").trim().toLowerCase();
  return FAMILIES.find(([, pattern]) => pattern.test(id))?.[0] ?? null;
}

function checkReviewer(header, violations) {
  const reviewer = header.match(/^\*\*Reviewer:\*\*\s*(self|independent)\s+—\s+(\S.*?)\s*$/m);
  if (!reviewer) {
    violations.push({ rule: "reviewer", detail: "write **Reviewer:** self — <model id> (your family wrote, edited or is judging it) or independent — <model id or human>" });
    return;
  }
  const [, kind, model] = reviewer;
  if (kind !== "independent") return;
  const family = modelFamily(model);
  const author = header.match(/^\*\*Author:\*\*\s*(.+?)\s*$/m)?.[1];
  if (!family) {
    violations.push({ rule: "reviewer-family", detail: `${model}: no known model family, so independence cannot be judged; name the model id, or human` });
  } else if (author && family === modelFamily(author)) {
    violations.push({ rule: "reviewer-family", detail: `${model} and the author ${author} are both ${family}: that review is self` });
  }
}

export function lintReport(text, { root: given, file } = {}) {
  const body = String(text || "");
  const parts = sections(body);
  const header = body.split(/^## /m)[0];
  const violations = [];
  const notes = [];
  if (body.split(/\r?\n/).some((line) => /^\s*<!--/.test(line))) {
    violations.push({ rule: "template-comment", detail: "report still contains template comments" });
  }
  if (contentLines(parts["central claim"]).length === 0) {
    violations.push({ rule: "empty-central-claim", detail: "central claim is not filled in" });
  }
  checkReviewer(header, violations);
  const named = header.match(/^\*\*Artifact:\*\*\s*(.+?)\s*$/m)?.[1];
  const root = given ?? reportRoot(file, named);
  const artifact = readArtifact(named, root);
  if (!artifact) violations.push({ rule: "artifact-missing", detail: `${named ?? "no **Artifact:** line"}: not on disk, so no quote can be checked` });

  const rows = checkClaims(parts.claims, artifact, violations);
  const block = checkScore(parts.score, header, rows, violations);
  checkBacks(rows, block, violations);
  checkCalibrationLine(header, block, violations);
  checkFindings(parts.findings, block, rows, root, artifact, violations);
  checkContradicted(rows, parts.findings, violations);
  for (const ref of lineRefs(`${parts.findings ?? ""}\n${parts.claims ?? ""}`, root, artifact).filter((r) => !r.ok)) {
    violations.push({ rule: "citation-broken", detail: `${ref.ref}: no such file, or it is shorter than that` });
  }

  const alternatives = items(parts["creative alternatives"], /^\d+\.\s/);
  if (alternatives.length < 3 || alternatives.some((item) => !TAGS.test(item))) {
    violations.push({ rule: "alternatives", detail: RULES.alternatives });
  }
  checkProposals(parts["improvement proposals"], block, violations);
  if (parts["since last roast"] !== undefined) checkSince(parts["since last roast"], block, root, violations, notes);
  return { violations, notes, block };
}

// A calibration the report says it ran is re-run here, so the line cannot claim a result the scores do not give.
function checkCalibrationLine(header, block, violations) {
  const profile = block?.profile;
  if (!profile) return;
  const line = header.match(/^\*\*Calibration:\*\*\s*(.+?)\s*$/m)?.[1];
  if (line && /^skipped\s+—\s+\S/.test(line)) return;
  const [name, listed = ""] = (line ?? "").split(/\s+—\s+/);
  let expected = null;
  try {
    const reference = calibrationCase(name);
    if (reference.profile === profile) {
      const scores = parseScoreArgs(listed.split(/,\s*/));
      expected = calibrationLine(name, scores, checkCalibration({ scores }, reference.reference));
    }
  } catch {
    expected = null;
  }
  if (expected !== `**Calibration:** ${line}`) {
    const cases = calibrationCases(profile).map((entry) => entry.name).join(", ");
    violations.push({ rule: "calibration-line", detail: `run score.mjs --calibrate on ${cases} and paste its line, or write **Calibration:** skipped — <reason>` });
  }
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) out[arg.slice(2)] = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
  return out;
}

function newestReport(dir, suffix = ".md") {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(suffix))
    .map((file) => ({ file, mtime: fs.statSync(path.join(dir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(dir, files[0].file) : null;
}

function newestAcrossRuns(root = ".x-skills/runs") {
  if (!fs.existsSync(root)) return null;
  const found = fs
    .readdirSync(root)
    .map((name) => newestReport(path.join(root, name), "-critique.md"))
    .filter(Boolean);
  if (!found.length) return null;
  return found.sort(
    (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
  )[0];
}

function resolveFile(args) {
  if (typeof args.file === "string") return args.file;
  if (typeof args.dir === "string") return newestReport(args.dir);
  return newestAcrossRuns();
}


function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.rules) {
    process.stdout.write(`${Object.entries(RULES).map(([rule, what]) => `${rule}: ${what}`).join("\n")}\n`);
    return;
  }
  try {
    const file = resolveFile(args);
    if (!file || !fs.existsSync(file)) {
      process.stderr.write(`${JSON.stringify({ error: `no report file found${file ? `: ${file}` : ""}` })}\n`);
      process.exit(2);
    }
    const { block, ...result } = lintReport(fs.readFileSync(file, "utf8"), { file });
    if (typeof args.calibrate === "string") result.violations.push(...checkCalibration(block, calibrationCase(args.calibrate).reference));
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