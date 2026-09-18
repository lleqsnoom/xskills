#!/usr/bin/env node
/**
 * `npm run report:install`: the app's dependencies, installed with one setting of the parent left out.
 *
 * npm reads `allow-scripts` from the environment as if it had been passed on the command line, and refuses that
 * layer in a project-scoped install: a repository's script policy belongs in its own `package.json` or `.npmrc`
 * (`resolveAllowScripts` in npm 11.16 and later throws `EALLOWSCRIPTS`). `npm run` exports every config value it
 * read to the script it runs, so a machine that pins `allow-scripts` in its user npmrc (which this repository
 * needs for tree-sitter) installs the repository's root dependencies fine and then fails here, on a directory
 * that never set the value.
 *
 * Dropping that one key for this child is the whole fix: the reader's setting still governs the install they ran
 * by hand, and the app keeps npm's default for itself. Its one dependency with an install script is esbuild,
 * whose postinstall only verifies the binary its own platform package already installed, so nothing is lost when
 * it does not run and nothing is dropped that the app asked for.
 *
 * Usage: node scripts/report-install.mjs
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APP_DIR = path.join(REPO_ROOT, "tools", "report-app");
/** The key npm refuses when the environment carries it. npm's env vars are lower case, whatever the shell used. */
const ALLOW_SCRIPTS_ENV = "npm_config_allow_scripts";

export function installEnv(env = process.env) {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (key.toLowerCase() === ALLOW_SCRIPTS_ENV) delete out[key];
  }
  return out;
}

/** Install the app's dependencies, through a seam so a test can watch the call without making it. */
export function installApp({ env = process.env, cwd = APP_DIR, spawnImpl = spawn } = {}) {
  return spawnImpl("npm", ["install"], { cwd, stdio: "inherit", env: installEnv(env) });
}

function main() {
  const child = installApp();
  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : code ?? 1);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
