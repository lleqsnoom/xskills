#!/usr/bin/env node
/**
 * x-skill-lint — validate the xskills repo's own skills.
 *
 * Checks every skills/<name>/SKILL.md for: parseable frontmatter, name == folder,
 * a description, no stray template tokens, same-skill script/reference paths that
 * exist, and presence in the README skills table. Zero dependencies (node built-ins).
 *
 * Usage: node lint.mjs [--root <dir>] [--help]
 * Exit:  0 clean · 1 violations found · 2 usage error
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (mm) fields[mm[1]] = mm[2].trim();
  }
  return fields;
}

// Same-skill references of the form scripts/… or references/… . Lines that name a
// different x-… skill are skipped so cross-skill hops are not reported as local breakage.
export function refsForSkill(text, skillName) {
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    const names = line.match(/x-[a-z0-9-]+/g) || [];
    if (names.some((n) => n !== skillName)) continue;
    const re = /(?:^|[\s`"'([</])((?:scripts|references)\/[A-Za-z0-9_@./-]+\.[A-Za-z0-9]+)/g;
    let m;
    while ((m = re.exec(line))) out.add(m[1]);
  }
  return [...out];
}

export function readmeSkills(readmeText) {
  const set = new Set();
  const re = /^\|\s*`?(x-[a-z0-9-]+)`?\s*\|/gm;
  let m;
  while ((m = re.exec(readmeText))) set.add(m[1]);
  return set;
}

export function lintRepo(root = REPO_ROOT) {
  const skillsDir = path.join(root, "skills");
  const violations = [];
  if (!fs.existsSync(skillsDir)) {
    return { root, skills: 0, violations: [{ skill: "-", rule: "no-skills-dir", detail: `not found: ${skillsDir}` }] };
  }
  const readmePath = path.join(root, "README.md");
  const inReadme = fs.existsSync(readmePath) ? readmeSkills(fs.readFileSync(readmePath, "utf8")) : new Set();
  const names = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const name of names) {
    const dir = path.join(skillsDir, name);
    const skillPath = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      violations.push({ skill: name, rule: "missing-skill-md", detail: "no SKILL.md" });
      continue;
    }
    const text = fs.readFileSync(skillPath, "utf8");
    const fm = parseFrontmatter(text);
    if (!fm) {
      violations.push({ skill: name, rule: "frontmatter", detail: "no parseable --- frontmatter ---" });
    } else {
      if (fm.name !== name) {
        violations.push({ skill: name, rule: "name-mismatch", detail: `frontmatter name "${fm.name}" != folder "${name}"` });
      }
      if (!fm.description) violations.push({ skill: name, rule: "description", detail: "missing description" });
    }
    if (/<\/gate>/.test(text)) violations.push({ skill: name, rule: "stray-token", detail: "contains stray </gate>" });
    for (const ref of refsForSkill(text, name)) {
      if (!fs.existsSync(path.join(dir, ref))) {
        violations.push({ skill: name, rule: "missing-ref", detail: `referenced ${ref} does not exist` });
      }
    }
    if (!inReadme.has(name)) violations.push({ skill: name, rule: "readme", detail: "not listed in README skills table" });
  }

  return { root, skills: names.length, violations };
}

function usage() {
  return [
    "x-skill-lint — validate the repo's own skills.",
    "",
    "Usage:",
    "  node lint.mjs              # lint the repo this script lives in",
    "  node lint.mjs --root <dir> # lint a different repo root",
    "  node lint.mjs --help",
    "",
    "Exit: 0 clean · 1 violations · 2 usage error",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  let root = REPO_ROOT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write(usage());
      return;
    }
    if (args[i] === "--root" && i + 1 < args.length) {
      root = path.resolve(args[++i]);
    } else {
      process.stderr.write(`${JSON.stringify({ error: `Unknown argument "${args[i]}"` })}\n`);
      process.exit(2);
    }
  }
  const result = lintRepo(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.violations.length === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
