// Pure readability metrics — zero dependencies, Node built-ins only.
// Formulas are the published standards (Flesch, Flesch-Kincaid, Gunning Fog,
// SMOG, ARI, Coleman-Liau). Syllable counting is a documented English heuristic,
// not a pronunciation dictionary; scores are close, not bit-identical, to
// dictionary-based tools. See references/metrics.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAMILIAR_PATH = path.join(HERE, "..", "..", "references", "familiar-words.json");

// Thresholds used across the skill.
export const LONG_SENTENCE = 25; // words — flagged "hard"
export const LONG_SENTENCE_WARN = 20; // words — flagged "warn"
export const POLYSYLLABLE_MIN = 3; // 3+ syllables = "complex word" (Fog/SMOG)

// Subordinate / transition markers that tend to signal a hard sentence.
const CLAUSE_MARKERS = [
  "which", "that", "although", "though", "whereas", "however", "therefore",
  "moreover", "furthermore", "nevertheless", "notwithstanding", "whilst",
  "while", "since", "unless", "despite", "in order to", "as well as",
  "due to the fact", "in the event that", "for the purpose of",
  "with regard to", "in terms of", "prior to", "subsequent to",
];

// Noise: wordy or empty phrases that add no meaning. The rewrite must remove
// them, never introduce them.
export const FILLER_PHRASES = [
  "it is important to note that", "it should be noted that", "it is worth mentioning",
  "needless to say", "at the end of the day", "in today's world", "in the modern world",
  "when it comes to", "the fact that", "due to the fact that", "in order to",
  "at this point in time", "in the event that", "as a matter of fact",
  "for all intents and purposes", "in my opinion", "as we all know",
  "a wide range of", "a variety of", "in terms of", "with regard to",
];
const FILLER_WORDS = ["basically", "actually", "really", "very", "quite", "simply", "literally", "just"];

const PASSIVE_AUX = "am|is|are|was|were|be|been|being|get|gets|got";
const PASSIVE_RE = new RegExp(
  `\\b(?:${PASSIVE_AUX})\\s+(?:\\w+ly\\s+)?(\\w+ed|known|made|done|given|taken|seen|shown|found|kept|held|built|sent|left|put|written|drawn)\\b`,
  "gi",
);
const NOMINALIZATION_RE = /\b\w{4,}(?:tion|sion|ment|ance|ence|ency|ility|ness)\b/gi;

// CEFR target → maximum acceptable Flesch-Kincaid grade for that reader.
export const GRADE_TARGETS = { A2: 4, B1: 6.5, B2: 9, C1: 12 };
export const DEFAULT_TARGET = "B2";

let _familiar = null;

// Load and cache the familiar-word set (New Dale-Chall 1995, MIT).
export function loadFamiliarWords() {
  if (_familiar) return _familiar;
  const raw = fs.readFileSync(FAMILIAR_PATH, "utf8");
  _familiar = new Set(JSON.parse(raw));
  return _familiar;
}

// Strip code, URLs, and markup so metrics measure prose, not syntax.
export function maskNonProse(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // keep link text, drop target
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}\s*$/gm, " ") // horizontal rules
    .replace(/^\s*\|.*\|\s*$/gm, " "); // table rows
}

// English syllable heuristic: vowel groups + silent-e rule.
export function countSyllables(word) {
  let w = String(word ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

export function tokenizeWords(text) {
  return maskNonProse(text).match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
}

// Markdown-aware sentence/segment splitter. Headings, list items, and
// blockquotes each count as their own unit; running prose splits on . ! ? …
export function splitSentences(text) {
  const clean = maskNonProse(text).replace(/\r\n?/g, "\n");
  const units = [];
  for (const rawLine of clean.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const marker = line.match(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/);
    const body = marker ? line.slice(marker[0].length).trim() : line;
    if (!body) continue;
    if (marker) {
      units.push(body);
    } else {
      for (const piece of body.split(/(?<=[.!?…])[\s]+/)) {
        const t = piece.trim();
        if (t) units.push(t);
      }
    }
  }
  return units;
}

// Locate noise phrases (case-insensitive) in a block of prose.
export function findFiller(text) {
  const lower = String(text ?? "").toLowerCase();
  const phrases = FILLER_PHRASES.filter((p) => lower.includes(p));
  const words = FILLER_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(lower));
  return [...phrases, ...words];
}

function round(value, places = 1) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function buildSentence(rawText, index, familiar) {
  const words = tokenizeWords(rawText);
  const wordCount = words.length;
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  const polysyllables = words.filter((w) => countSyllables(w) >= POLYSYLLABLE_MIN).length;
  const lower = rawText.toLowerCase();
  const markers = CLAUSE_MARKERS.filter((m) => new RegExp(`\\b${m.replace(/ /g, "\\s+")}\\b`).test(lower));
  const passive = (rawText.match(PASSIVE_RE) ?? []).length;
  const nominalizations = [...new Set((rawText.match(NOMINALIZATION_RE) ?? []).map((w) => w.toLowerCase()))];
  const hardWords = [
    ...new Set(
      words
        .filter((w) => !familiar.has(w.toLowerCase().replace(/['’]s$/, "")) && w.length >= 5)
        .map((w) => w.toLowerCase()),
    ),
  ];
  const long = wordCount > LONG_SENTENCE ? "hard" : wordCount > LONG_SENTENCE_WARN ? "warn" : null;
  const filler = findFiller(rawText);

  // A transparent priority score: longer + denser + more subordination + noise = worse.
  const score = round(
    Math.max(0, wordCount - LONG_SENTENCE_WARN) * 1.0 +
      Math.max(0, polysyllables - 1) * 0.8 +
      markers.length * 1.5 +
      passive * 1.0 +
      nominalizations.length * 0.5 +
      hardWords.length * 0.3 +
      filler.length * 2.0,
    1,
  );

  return {
    index,
    text: rawText,
    words: wordCount,
    syllables,
    polysyllables,
    long,
    markers,
    passive,
    nominalizations,
    hardWords,
    filler,
    score,
  };
}

// ---- Published readability formulas -------------------------------------

export function fleschReadingEase(words, sentences, syllables) {
  if (!words || !sentences) return null;
  return round(206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words), 1);
}

export function fleschKincaidGrade(words, sentences, syllables) {
  if (!words || !sentences) return null;
  return round(0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59, 1);
}

export function gunningFog(words, sentences, complexWords) {
  if (!words || !sentences) return null;
  return round(0.4 * (words / sentences + 100 * (complexWords / words)), 1);
}

export function smogIndex(sentences, polysyllables) {
  if (sentences < 3) return null; // SMOG normed on ~30-sentence samples
  return round(1.043 * Math.sqrt(polysyllables * (30 / sentences)) + 3.1291, 1);
}

export function automatedReadabilityIndex(characters, words, sentences) {
  if (!words || !sentences) return null;
  return round(4.71 * (characters / words) + 0.5 * (words / sentences) - 21.43, 1);
}

export function colemanLiauIndex(characters, words, sentences) {
  if (!words || !sentences) return null;
  const L = (characters / words) * 100;
  const S = (sentences / words) * 100;
  return round(0.0588 * L - 0.296 * S - 15.8, 1);
}

// Coarse CEFR band from Flesch-Kincaid grade. Approximate by design.
export function cefrFromGrade(grade) {
  if (grade === null || grade === undefined) return null;
  if (grade < 5) return "A2";
  if (grade < 7) return "B1";
  if (grade < 10) return "B2";
  if (grade < 13) return "C1";
  return "C2";
}

export function analyzeText(text, { target = DEFAULT_TARGET } = {}) {
  const familiar = loadFamiliarWords();
  const units = splitSentences(text);
  const sentences = units.map((u, i) => buildSentence(u, i, familiar));

  const words = sentences.reduce((s, x) => s + x.words, 0);
  const sentenceCount = sentences.length;
  const syllables = sentences.reduce((s, x) => s + x.syllables, 0);
  const polysyllables = sentences.reduce((s, x) => s + x.polysyllables, 0);
  const characters = tokenizeWords(text).join("").length;
  const longSentences = sentences.filter((s) => s.long === "hard").length;

  const hardWordCounts = new Map();
  for (const s of sentences) for (const w of s.hardWords) hardWordCounts.set(w, (hardWordCounts.get(w) ?? 0) + 1);
  const hardWords = [...hardWordCounts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

  const fillerCounts = new Map();
  for (const s of sentences) for (const f of s.filler) fillerCounts.set(f, (fillerCounts.get(f) ?? 0) + 1);
  const filler = [...fillerCounts.entries()]
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));

  const fkGrade = fleschKincaidGrade(words, sentenceCount, syllables);

  return {
    metrics: {
      words,
      sentences: sentenceCount,
      syllables,
      characters,
      polysyllables,
      avgSentenceLength: sentenceCount ? round(words / sentenceCount, 1) : 0,
      maxSentenceLength: sentences.reduce((m, s) => Math.max(m, s.words), 0),
      avgSyllablesPerWord: words ? round(syllables / words, 2) : 0,
      longSentences,
      longSentenceRatio: sentenceCount ? round(longSentences / sentenceCount, 3) : 0,
      passive: sentences.reduce((s, x) => s + x.passive, 0),
      markedSentences: sentences.filter((s) => s.markers.length).length,
      filler: sentences.reduce((s, x) => s + x.filler.length, 0),
      unknownWords: hardWords.length,
    },
    formulas: {
      fleschReadingEase: fleschReadingEase(words, sentenceCount, syllables),
      fleschKincaidGrade: fkGrade,
      gunningFog: gunningFog(words, sentenceCount, polysyllables),
      smog: smogIndex(sentenceCount, polysyllables),
      automatedReadabilityIndex: automatedReadabilityIndex(characters, words, sentenceCount),
      colemanLiauIndex: colemanLiauIndex(characters, words, sentenceCount),
    },
    level: { cefr: cefrFromGrade(fkGrade), fkGrade },
    target: { level: target, maxGrade: GRADE_TARGETS[target] ?? GRADE_TARGETS[DEFAULT_TARGET] },
    sentences,
    hardWords,
    filler,
  };
}
