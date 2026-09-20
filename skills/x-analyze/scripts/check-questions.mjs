#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_WORDS = 20;
export const PANELS = ["single", "multi", "open", "confirm"];
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;

export function parseQuestions(text) {
  const blocks = [];
  const lines = String(text || "").split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^##\s*Q\d*\s*:\s*(.+?)\s*$/);
    if (heading) {
      if (current) blocks.push(current);
      current = { question: heading[1], why: null, panel: null, options: [] };
      continue;
    }
    if (!current) continue;
    const why = line.match(/^\*\*Why:\*\*\s*(.+?)\s*$/);
    if (why) {
      current.why = why[1];
      continue;
    }
    const panel = line.match(/^\*\*Panel:\*\*\s*(.+?)\s*$/);
    if (panel) {
      current.panel = panel[1].toLowerCase();
      continue;
    }
    const options = line.match(/^\*\*Options:\*\*\s*(.+?)\s*$/);
    if (options) {
      current.options = options[1]
        .split("|")
        .map((option) => option.trim())
        .filter(Boolean);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function panelViolations(question) {
  if (!question.panel) return [{ rule: "no-panel", detail: "missing **Panel:**" }];
  if (!PANELS.includes(question.panel)) return [{ rule: "bad-panel", detail: question.panel }];
  const counts = question.panel === "single" || question.panel === "multi";
  if (counts) {
    return question.options.length < MIN_OPTIONS || question.options.length > MAX_OPTIONS
      ? [{ rule: "no-options", detail: `${question.options.length} option(s)` }]
      : [];
  }
  return question.options.length > 0 ? [{ rule: "unexpected-options", detail: question.panel }] : [];
}

export function lintQuestions(text) {
  const questions = parseQuestions(text);
  const violations = [];
  questions.forEach((question, index) => {
    const id = `Q${index + 1}`;
    const words = wordCount(question.question);
    if (words > MAX_WORDS) violations.push({ question: id, rule: "too-long", detail: `${words} words` });
    if (/ and /i.test(question.question) || (question.question.match(/\?/g) || []).length > 1) {
      violations.push({ question: id, rule: "multi-idea", detail: question.question });
    }
    if (!question.why) violations.push({ question: id, rule: "no-why", detail: "missing **Why:**" });
    for (const violation of panelViolations(question)) violations.push({ question: id, ...violation });
  });
  if (questions.length === 0) violations.push({ question: null, rule: "empty", detail: "no ## Q blocks" });
  return { questions: questions.length, violations };
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

function resolveFile(args) {
  if (typeof args.file === "string") return args.file;
  if (typeof args.dir === "string") return path.join(args.dir, "questions.md");
  throw new Error("--file <path> or --dir <run-dir> is required");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const file = resolveFile(args);
    if (!fs.existsSync(file)) {
      process.stderr.write(`${JSON.stringify({ error: `no such file: ${file}` })}\n`);
      process.exit(2);
    }
    const result = lintQuestions(fs.readFileSync(file, "utf8"));
    process.stdout.write(`${JSON.stringify({ file, ...result }, null, 2)}\n`);
    process.exit(result.violations.length === 0 ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}