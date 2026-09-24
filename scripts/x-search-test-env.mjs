#!/usr/bin/env node
/**
 * The x-search suite needs two things a bare checkout does not have: the search tool's own
 * dependencies (the sqlite-vec binary among them, plus the tree-sitter grammars this repository
 * keeps as devDependencies) and the Ollama embedder its tests call. The release workflow installs
 * both before `npm test`; this does the same locally, and only what is missing, so `npm test`
 * passes on a fresh clone instead of failing 22 tests with a reason that reads as broken code.
 *
 * It installs npm packages and starts/pulls with a local Ollama. It does not install Ollama
 * itself: that is a system package, so the run ends naming the one command that does. A runtime too
 * old to have `node:sqlite` ends the same way, rather than as 22 failures that read as broken code.
 *
 * Usage: node scripts/x-search-test-env.mjs   (also `pretest`, so `npm test` provisions itself)
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EmbedderUnreachable, embedBatch, embedderConfig } from "../tools/x-search/src/embed.mjs";
import { installEnv } from "./report-install.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TOOL_DIR = path.join(REPO_ROOT, "tools", "x-search");
export const OLLAMA_LOG = path.join(os.tmpdir(), "x-skills-ollama.log");
const START_TIMEOUT_MS = 60000;
const POLL_MS = 500;
/** A live embedder answers this in milliseconds; a dead one must not hold the run for the suite's 30s. */
const PROBE_TIMEOUT_MS = 10000;

/** Every dependency the directory declares, so a new one is provisioned without touching this file. */
export function declaredModules(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const groups = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies];
  return [...new Set(groups.flatMap((group) => Object.keys(group || {})))];
}

export function missingModules(dir) {
  const resolve = createRequire(path.join(dir, "package.json"));
  return declaredModules(dir).filter((name) => {
    try {
      resolve.resolve(name);
      return false;
    } catch {
      return true;
    }
  });
}

/** Install one directory's dependencies, through a seam so a test can watch the call without making it. */
export function installDependencies({ dir, label, env = process.env, spawnImpl = spawnSync, log = console.log }) {
  const missing = missingModules(dir);
  if (!missing.length) return { installed: false, missing };
  log(`${label}: installing ${missing.join(", ")}`);
  const result = spawnImpl("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit", env: installEnv(env) });
  if (result.status !== 0) {
    fail(`\`npm install\` failed in ${dir} (exit ${result.status})`);
  }
  return { installed: true, missing };
}

export function isLocalEmbedder(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * `node:sqlite`, which the tool's store is built on, sat behind `--experimental-sqlite` before
 * 23.4 / 22.13 (Node's own history table), so those runtimes install the tool and then fail on the
 * import. A version check here names that instead of letting the suite report it as 22 broken tests.
 */
export function nodeHasSqlite(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  if (major === 22) return minor >= 13;
  if (major === 23) return minor >= 4;
  return major > 23;
}

async function embeds({ url, model, fetchImpl }) {
  try {
    const [vector] = await embedBatch(["probe"], { url, model, fetchImpl, timeoutMs: PROBE_TIMEOUT_MS });
    return vector.length;
  } catch (error) {
    if (error instanceof EmbedderUnreachable) return null;
    throw error;
  }
}

async function servedModels({ url, fetchImpl }) {
  try {
    const response = await fetchImpl(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload.models) ? payload.models.map((entry) => entry.name) : [];
  } catch {
    return null;
  }
}

function hasModel(names, model) {
  return names.some((name) => name === model || name.startsWith(`${model}:`));
}

async function poll(check, timeoutMs, intervalMs = POLL_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function startOllama({ spawnImpl, log }) {
  const out = fs.openSync(OLLAMA_LOG, "a");
  const child = spawnImpl("ollama", ["serve"], { detached: true, stdio: ["ignore", out, out] });
  child.unref();
  log(`the embedder was not answering, so \`ollama serve\` is up (log: ${OLLAMA_LOG})`);
}

export async function ensureEmbedder({
  env = process.env,
  fetchImpl = fetch,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  log = console.log,
} = {}) {
  const { url, model } = embedderConfig(env);
  const ready = async () => embeds({ url, model, fetchImpl });
  if (await ready()) return { url, model, started: false };

  if (!isLocalEmbedder(url)) {
    fail(`no embedder at ${url} and it is not a local one to start\n  start it there, or unset OLLAMA_URL\n  or run the rest of the suite: node --test test/*.test.cjs`);
  }
  if (spawnSyncImpl("ollama", ["--version"], { stdio: "ignore" }).status !== 0) {
    fail(`no embedder at ${url} and no \`ollama\` on PATH\n  install: https://ollama.com/download\n  or point OLLAMA_URL at a running embedder\n  or run the rest of the suite: node --test test/*.test.cjs`);
  }

  startOllama({ spawnImpl, log });
  const names = await poll(() => servedModels({ url, fetchImpl }), START_TIMEOUT_MS);
  if (!names) fail(`ollama did not answer at ${url} within ${START_TIMEOUT_MS / 1000}s; see ${OLLAMA_LOG}`);

  if (!hasModel(names, model)) {
    log(`pulling the embedding model ${model} (once per machine)`);
    if (spawnSyncImpl("ollama", ["pull", model], { stdio: "inherit" }).status !== 0) {
      fail(`\`ollama pull ${model}\` failed`);
    }
  }

  if (!(await poll(ready, START_TIMEOUT_MS))) {
    fail(`the embedder at ${url} cannot embed with ${model}`);
  }
  log(`the embedder answers at ${url} (${model})`);
  return { url, model, started: true };
}

export async function ensureTestEnv({ root = REPO_ROOT, tool = TOOL_DIR, ...seams } = {}) {
  if (!nodeHasSqlite()) {
    fail(`the x-search suite needs Node 22.13+ or 23.4+, where node:sqlite is available without a flag; this is ${process.versions.node}\n  or run the rest of the suite: node --test test/*.test.cjs`);
  }
  installDependencies({ dir: root, label: "the repository's dev dependencies", ...seams });
  installDependencies({ dir: tool, label: "the search tool's dependencies", ...seams });
  return ensureEmbedder(seams);
}

function fail(message) {
  console.error(`x-search test env: ${message}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await ensureTestEnv({ log: (message) => console.log(`x-search test env: ${message}`) });
}
