import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ORCA_CONFIG_ENV = "ORCA_CONFIG_DIR";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function orcaConfigDir(env) {
  return env[ORCA_CONFIG_ENV] || path.join(os.homedir(), ".config", "orca");
}

function newestProfile(env) {
  const profiles = path.join(orcaConfigDir(env), "profiles");
  if (!fs.existsSync(profiles)) return null;
  const files = fs
    .readdirSync(profiles)
    .map((name) => path.join(profiles, name, "orca-data.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.file ?? null;
}

export function orcaRepos(env = process.env) {
  const file = newestProfile(env);
  if (!file) return [];
  const data = readJson(file) || {};
  return (data.repos || [])
    .filter((repo) => typeof repo?.path === "string")
    .map((repo) => ({
      id: repo.displayName || path.basename(repo.path),
      name: repo.displayName || path.basename(repo.path),
      root: repo.path,
      source: "orca",
    }));
}

function envRepos(env) {
  const raw = env.XSKILLS_ROOTS || "";
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((root) => ({ id: path.basename(root), name: path.basename(root), root, source: "env" }));
}

function flagRepos(argv) {
  const roots = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root" && argv[index + 1]) {
      roots.push(argv[index + 1]);
      index += 1;
    }
  }
  return roots.map((root) => ({ id: path.basename(root), name: path.basename(root), root, source: "flag" }));
}

const dedupeByRealpath = (repos) => {
  const seen = new Map();
  for (const repo of repos) {
    const key = fs.existsSync(repo.root) ? fs.realpathSync(repo.root) : path.resolve(repo.root);
    if (!seen.has(key)) seen.set(key, { ...repo, root: key });
  }
  return [...seen.values()];
};

export function resolveRoots({ argv = [], env = process.env } = {}) {
  const flagged = flagRepos(argv);
  if (flagged.length) {
    return dedupeByRealpath(flagged);
  }
  const fromEnv = envRepos(env);
  if (fromEnv.length) return dedupeByRealpath(fromEnv).filter((repo) => fs.existsSync(repo.root));
  return dedupeByRealpath(orcaRepos(env)).filter((repo) => fs.existsSync(repo.root));
}

export function storePathFor(root) {
  return path.join(root, ".x-skills", ".index", "index.db");
}
