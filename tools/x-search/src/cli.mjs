#!/usr/bin/env node
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EmbedderUnreachable } from "./embed.mjs";
import { InterruptedError, StoreError, requestStop, runIndex } from "./index-cmd.mjs";
import { InstallError, formatReport, install } from "./install.mjs";
import { collectStatus, formatStatus, pruneStores } from "./status.mjs";
import { runMcp } from "./mcp.mjs";
import { resolveRoots } from "./roots.mjs";
import { runSearch } from "./search.mjs";
import { runWatch } from "./watch.mjs";

const FLAGS_WITH_VALUE = new Set(["--root", "--project", "--limit", "--mode", "--lang", "--path", "--cli"]);
const KNOWN_FLAGS = new Set([
  ...FLAGS_WITH_VALUE,
  "--json",
  "--force",
  "--allow-dirty",
  "--prune",
  "--dry-run",
  "--print",
  "--remove",
  "--debounce",
  "--all",
  "--help",
]);

const HELP = `x-search — local semantic search over a repository's artifacts and source code

  x-search index  [--root <path>]... [--all] [--project <name>] [--force] [--allow-dirty]
                  [--prune [--dry-run]] [--json]
  x-search search <query> [--root <path>]... [--project <name>] [--limit 8]
                          [--mode hybrid|keyword|vector] [--lang <lang>] [--path <substring>] [--json]
  x-search watch  [--root <path>]... [--debounce <ms>]
  x-search install --cli crush,claude,codex,opencode [--print | --remove]
  x-search mcp
  x-search status [--json]

Embeddings come from a local Ollama daemon (nomic-embed-text by default).
The store lives at <repo>/.x-skills/.index/index.db and never leaves it.
`;

export function parseArgs(argv) {
  const options = { roots: [], flags: {}, unknown: [] };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") {
      options.roots.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(token)) {
      options.flags[token.slice(2)] = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      if (!KNOWN_FLAGS.has(token)) options.unknown.push(token);
      options.flags[token.slice(2)] = true;
      continue;
    }
    rest.push(token);
  }
  options.command = rest.shift() || "help";
  options.args = rest;
  return options;
}

const jsonOut = (io, payload) => io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

function printIndex(io, report) {
  io.stdout.write(`indexed ${report.files} files, ${report.chunks} chunks (${report.unchanged} unchanged)\n`);
  io.stdout.write(`store: ${Array.isArray(report.store) ? report.store.join(", ") : report.store}\n`);
}

function printHits(io, payload) {
  if (payload.index.missing) {
    io.stdout.write("no index yet — run: x-search index --all\n");
    return;
  }
  if (!payload.hits.length) {
    io.stdout.write("no match\n");
    return;
  }
  for (const hit of payload.hits) {
    io.stdout.write(`${hit.score.toFixed(3)}  ${hit.project}/${hit.path}:${hit.lineStart}-${hit.lineEnd}${hit.symbol ? `  ${hit.symbol}` : ""}\n`);
  }
}

function pruneCommand({ argv, flags, env, io, log }) {
  const result = pruneStores({ roots: resolveRoots({ argv, env }), env, dryRun: flags["dry-run"] === true, log });
  if (flags.json) jsonOut(io, result);
  else if (!result.pruned.length) io.stdout.write("nothing to prune\n");
  else io.stdout.write(`${result.pruned.map((store) => `${result.dryRun ? "would prune" : "pruned"} ${store}`).join("\n")}\n`);
  return 0;
}

async function indexCommand({ argv, flags, env, io, log }) {
  if (flags.prune === true) return pruneCommand({ argv, flags, env, io, log });
  const roots = resolveRoots({ argv, env });
  const onSignal = () => {
    io.stderr.write("x-search: finishing the current batch and stopping\n");
    requestStop();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const report = await runIndex({ roots, force: flags.force === true, allowDirty: flags["allow-dirty"] === true, env, log });
  for (const warning of report.warnings) log(warning);
  if (flags.json) jsonOut(io, report);
  else printIndex(io, report);
  return 0;
}

async function searchCommand({ argv, args, flags, env, io, log }) {
  const query = args.join(" ").trim();
  if (!query) {
    io.stderr.write("usage: x-search search <query>\n");
    return 2;
  }
  const payload = await runSearch({
    query,
    roots: resolveRoots({ argv, env }),
    limit: flags.limit,
    mode: flags.mode,
    lang: flags.lang,
    pathFilter: flags.path,
    project: flags.project,
    env,
    log,
  });
  if (flags.json) jsonOut(io, payload);
  else printHits(io, payload);
  return 0;
}

function statusCommand({ argv, flags, env, io }) {
  const rows = collectStatus({ roots: resolveRoots({ argv, env }), env });
  if (flags.json) jsonOut(io, { stores: rows });
  else io.stdout.write(`${formatStatus(rows)}\n`);
  return 0;
}

function installCommand({ flags, env, io, log }) {
  const clis = String(flags.cli || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const report = install({ clis, remove: flags.remove === true, print: flags.print === true, env, log });
  if (flags.json) jsonOut(io, report);
  else io.stdout.write(`${formatReport(report)}\n`);
  return 0;
}

async function watchCommand({ argv, env, io, log }) {
  const roots = resolveRoots({ argv, env });
  if (!roots.length) {
    io.stderr.write("no repository to watch — add --root <path>, or list one in the Orca IDE\n");
    return 2;
  }
  return runWatch({ roots, env, log });
}

const COMMANDS = {
  index: indexCommand,
  search: searchCommand,
  status: statusCommand,
  install: installCommand,
  watch: watchCommand,
  mcp: ({ argv, env }) => runMcp({ roots: resolveRoots({ argv, env }), env }),
  help: ({ io }) => {
    io.stdout.write(HELP);
    return 0;
  },
};

const FAILURES = {
  StoreError: (error) => error.message,
  EmbedderUnreachable: (error) => `${error.message} — start it with: ollama serve`,
  InstallError: (error) => error.message,
  InterruptedError: (error) => `${error.message} — resume with: x-search index --root <path>`,
};

function reportError(error, io) {
  const format = FAILURES[error.name];
  if (!format) {
    io.stderr.write(`${error.stack || error.message}\n`);
    return 2;
  }
  io.stderr.write(`${format(error)}\n`);
  return error.exitCode ?? 2;
}

export async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr, env: process.env }) {
  const options = parseArgs(argv);
  const context = { argv, ...options, io, env: io.env, log: (message) => io.stderr.write(`${message}\n`) };
  const handler = COMMANDS[options.command];
  if (!handler) {
    io.stderr.write(`unknown command: ${options.command}\n${HELP}`);
    return 2;
  }
  try {
    return await handler(context);
  } catch (error) {
    return reportError(error, io);
  }
}

function invokedDirectly() {
  if (import.meta.main !== undefined) return Boolean(import.meta.main);
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = await main();
}
