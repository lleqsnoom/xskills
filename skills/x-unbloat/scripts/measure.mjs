#!/usr/bin/env node
// Measures what an unbloat pass (or any change) did against a base ref: lines added and
// removed, files touched, and dependencies added or removed. Prints one JSON object;
// with --record it takes the base from an unbloat record and writes the summary back into it.
// Exit 0 = no dependency added, 1 = a dependency was added (the report must justify it),
// 2 = usage error or not a git repository.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const readAtBase = (base, file, cwd) => {
  try { return git(["show", `${base}:${file}`], cwd); } catch { return ""; }
};

const readNow = (file, cwd) => {
  try { return fs.readFileSync(path.join(cwd, file), "utf8"); } catch { return ""; }
};

const countLines = (text) => (text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0);

// Keys of every TOML table whose name matches `tables` (Cargo's and Poetry's dependency tables).
function tomlTableKeys(text, tables) {
  const names = [];
  let inside = false;
  for (const line of text.split("\n")) {
    const table = line.match(/^\s*\[([^\]]+)\]/);
    if (table) { inside = tables.test(table[1].trim()); continue; }
    const key = inside && line.match(/^\s*([\w.-]+)\s*=/);
    if (key) names.push(key[1]);
  }
  return names;
}

// Names in PEP 621 lists: `dependencies = [...]` under [project], and every list under
// [project.optional-dependencies]. A list may span lines, so strings are collected until its `]`.
function pep621Dependencies(text) {
  const names = [];
  let table = "";
  let inList = false;
  for (const line of text.split("\n")) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header && !inList) { table = header[1].trim(); continue; }
    const opens = (table === "project" && /^\s*dependencies\s*=\s*\[/.test(line))
      || (table === "project.optional-dependencies" && /^\s*[\w-]+\s*=\s*\[/.test(line));
    if (!inList && !opens) continue;
    inList = true;
    for (const m of line.matchAll(/"([A-Za-z0-9][\w.-]*)/g)) names.push(m[1].toLowerCase());
    if (line.replace(/"[^"]*"/g, "").includes("]")) inList = false;
  }
  return names;
}

function gradleDependencies(text) {
  const configurations = "implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|kapt|ksp|annotationProcessor";
  const pattern = new RegExp(`^\\s*(?:${configurations})\\s*\\(?\\s*["']([^:"']+:[^:"']+)`, "gm");
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

const PACKAGE_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

// Each manifest maps its text to the set of dependency names it declares.
const MANIFESTS = {
  "package.json": (text) => {
    try {
      const pkg = JSON.parse(text);
      return PACKAGE_FIELDS.flatMap((field) => Object.keys(pkg[field] ?? {}));
    } catch { return []; }
  },
  "requirements.txt": (text) => text.split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line && !line.startsWith("-"))
    .map((line) => line.split(/[\s<>=!~;[]/)[0].toLowerCase()),
  "go.mod": (text) => [...text.matchAll(/^\s*(?:require\s+)?([\w.\-]+\/[\w.\-/]+)\s+v\S+/gm)].map((m) => m[1]),
  "Cargo.toml": (text) => tomlTableKeys(text, /(^|\.)(dev-|build-)?dependencies$/),
  "pyproject.toml": (text) => [
    ...tomlTableKeys(text, /^tool\.poetry\.(group\.[\w-]+\.)?(dev-)?dependencies$/).filter((name) => name !== "python"),
    ...pep621Dependencies(text),
  ],
  "Gemfile": (text) => [...text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1]),
  "pom.xml": (text) => [...text.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<\/dependency>/g)]
    .map((m) => `${m[1].trim()}:${m[2].trim()}`),
  "build.gradle": gradleDependencies,
  "build.gradle.kts": gradleDependencies,
};

export function parseNumstat(text) {
  return text.split("\n").filter(Boolean).map((line) => {
    const [added, removed, file] = line.split("\t");
    const binary = added === "-";
    return { file, added: binary ? 0 : Number(added), removed: binary ? 0 : Number(removed), binary };
  });
}

export function dependencyDelta(manifest, before, after) {
  const parse = MANIFESTS[path.basename(manifest)];
  const was = new Set(parse(before));
  const now = new Set(parse(after));
  return {
    added: [...now].filter((name) => !was.has(name)).map((name) => `${manifest}: ${name}`),
    removed: [...was].filter((name) => !now.has(name)).map((name) => `${manifest}: ${name}`),
  };
}

export function measure({ base = "HEAD", cwd = process.cwd() } = {}) {
  const tracked = parseNumstat(git(["diff", "--numstat", base, "--"], cwd));
  const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd).split("\n").filter(Boolean)
    .map((file) => ({ file, added: countLines(readNow(file, cwd)), removed: 0, binary: false }));
  // The skills' own records are not part of the change being measured.
  const files = [...tracked, ...untracked].filter((f) => !f.file.startsWith(".x-skills/"));

  const deltas = files.map((f) => f.file)
    .filter((file) => MANIFESTS[path.basename(file)])
    .map((file) => dependencyDelta(file, readAtBase(base, file, cwd), readNow(file, cwd)));

  const linesAdded = files.reduce((sum, f) => sum + f.added, 0);
  const linesRemoved = files.reduce((sum, f) => sum + f.removed, 0);
  return {
    base,
    filesTouched: files.length,
    linesAdded,
    linesRemoved,
    netLines: linesAdded - linesRemoved,
    depsAdded: deltas.flatMap((d) => d.added),
    depsRemoved: deltas.flatMap((d) => d.removed),
    files,
  };
}

// Reads the base from an unbloat record and writes the result into its `## Measure` section.
export function measureRecord(file, cwd = process.cwd()) {
  const text = fs.readFileSync(file, "utf8");
  const base = text.match(/^\*\*Base:\*\* ([0-9a-f]{7,40})\s*$/m)?.[1];
  if (!base) throw new Error(`${file} has no **Base:** commit hash`);
  const result = measure({ base, cwd });
  const { files, ...summary } = result;
  const block = `## Measure\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\n`;
  fs.writeFileSync(file, text.replace(/^## Measure\n[\s\S]*?(?=^## |(?![\s\S]))/m, block));
  return result;
}

const USAGE = "usage: measure.mjs [--base <git ref>] | --record <Enn-unbloat.md>   (default: --base HEAD)";

function main(argv) {
  const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] || null : undefined);
  const record = value("--record");
  const base = value("--base");
  if (record === null || base === null) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    const result = record ? measureRecord(record) : measure({ base: base ?? "HEAD" });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.depsAdded.length ? 1 : 0);
  } catch (error) {
    console.error(`measure.mjs: ${error.stderr?.toString().trim() || error.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2));
}
