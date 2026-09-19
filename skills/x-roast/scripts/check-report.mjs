#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RULE_NAMES = ["template-comment", "empty-central-claim", "empty-score", "empty-findings"];

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

export function lintReport(text) {
  const body = String(text || "");
  const parts = sections(body);
  const violations = [];
  if (body.split(/\r?\n/).some((line) => /^\s*<!--/.test(line))) {
    violations.push({ rule: "template-comment", detail: "report still contains template comments" });
  }
  if (contentLines(parts["central claim"]).length === 0) {
    violations.push({ rule: "empty-central-claim", detail: "central claim is not filled in" });
  }
  const score = parts.score || "";
  if (!score.includes("{") && !/```json/.test(score)) {
    violations.push({ rule: "empty-score", detail: "score JSON is missing" });
  }
  if (contentLines(parts.findings).length === 0) {
    violations.push({ rule: "empty-findings", detail: "no findings recorded" });
  }
  return { violations };
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
  try {
    const file = resolveFile(args);
    if (!file || !fs.existsSync(file)) {
      process.stderr.write(`${JSON.stringify({ error: `no report file found${file ? `: ${file}` : ""}` })}\n`);
      process.exit(2);
    }
    const result = lintReport(fs.readFileSync(file, "utf8"));
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