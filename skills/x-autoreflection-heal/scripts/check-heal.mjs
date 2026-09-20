#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SCHEMA, AUTO_CLASSES, QUALITY_CLASSES, measuresOf } from "./heal.mjs";

const skillOf = (target) => String(target ?? "").match(/^skills\/(x-[a-z0-9-]+)\/(SKILL\.md|references\/)/)?.[1] ?? null;

/**
 * Plan-level: a detector or gate is never edited in the same plan as a skill it measures. The shared
 * detectors measure every skill; a skill's own `check-*` measures that skill.
 */
function separation(items) {
  const measured = items.map((item) => ({ item, skill: skillOf(item.target) })).filter((entry) => entry.skill);
  return items.flatMap((item) => {
    const scope = measuresOf(item.target);
    if (!scope) return [];
    const clash = measured.find((entry) => entry.item !== item && (scope === "*" || scope === entry.skill));
    return clash
      ? [{ rule: "measure-and-measured", item: item.id ?? "?", detail: `${item.target} measures ${clash.item.target}; land the measure on its own first` }]
      : [];
  });
}

/** The plan's shape: every item names its target and, for an `auto` item, a find and a check. */
export function lintHeal(plan) {
  const violations = [];
  const value = plan && typeof plan === "object" ? plan : {};

  if (!value.schema || value.schema !== SCHEMA) {
    violations.push({ rule: "bad-schema", detail: `expected schema "${SCHEMA}"` });
  }
  if (!value.analysis) violations.push({ rule: "no-analysis", detail: "the plan does not name its analysis report" });
  if (!Array.isArray(value.items) || value.items.length === 0) {
    violations.push({ rule: "empty-items", detail: "no items to heal" });
  }

  for (const item of value.items ?? []) {
    const id = item.id ?? "?";
    if (!item.id) violations.push({ rule: "item-id", detail: "an item has no id" });
    if (!item.target) violations.push({ rule: "item-target", item: id, detail: "no target file" });
    if (QUALITY_CLASSES.has(item.class) && !String(item.watch ?? "").trim()) {
      violations.push({ rule: "item-watch", item: id, detail: "a quality fix names the rate it should move: skill, model, anchor, window" });
    }
    if (item.target && item.check && String(item.check).includes(item.target)) {
      violations.push({ rule: "check-edits-itself", item: id, detail: `${item.target} is edited by the item and run by its own check` });
    }
    if (item.auto === true && measuresOf(item.target)) {
      violations.push({ rule: "auto-measure", item: id, detail: `${item.target} is a detector or a check; it is never edited unattended` });
    }
    if (item.auto === true) {
      if (!item.find) violations.push({ rule: "item-find", item: id, detail: "an auto item has no find" });
      if (!item.check) violations.push({ rule: "item-check", item: id, detail: "an auto item has no check" });
      if (item.class && !AUTO_CLASSES.has(item.class)) {
        violations.push({ rule: "auto-class", item: id, detail: `${item.class} is not an auto class (${[...AUTO_CLASSES].join(", ")})` });
      }
    }
  }

  violations.push(...separation(value.items ?? []));
  return { violations, items: (value.items ?? []).length };
}

function newestPlan(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith("-heal.json"))
    .map((name) => ({ file: name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(dir, files[0].file) : null;
}

function resolveFile(args) {
  if (typeof args.file === "string") return args.file;
  if (typeof args.dir === "string") return newestPlan(args.dir);
  throw new Error("--file <path> or --dir <run-dir> is required");
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

function usage() {
  return [
    "x-autoreflection-heal check-heal — fail while the plan is unshaped or an auto item is uncheckable.",
    "",
    "Usage:",
    "  node check-heal.mjs --file <plan.json>",
    "  node check-heal.mjs --dir <run-dir>",
    "",
    "Exit: 0 clean · 1 violations · 2 usage error",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  try {
    const file = resolveFile(args);
    if (!file || !fs.existsSync(file)) {
      process.stderr.write(`${JSON.stringify({ error: `no heal plan found${file ? `: ${file}` : ""}` })}\n`);
      process.exit(2);
    }
    const result = lintHeal(JSON.parse(fs.readFileSync(file, "utf8")));
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
