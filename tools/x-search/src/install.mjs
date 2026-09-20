import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const SERVER_NAME = "x-search";
export const DEFAULT_COMMAND = ["npx", "-y", "@lleqsnoom/x-search", "mcp"];

export function serverCommand(env = process.env) {
  if (!env.X_SEARCH_BIN) return DEFAULT_COMMAND;
  return [env.X_SEARCH_BIN, "mcp"];
}

export class InstallError extends Error {
  constructor(message) {
    super(message);
    this.name = "InstallError";
    this.exitCode = 2;
  }
}

const home = (env) => env.HOME || os.homedir();

function which(binary, env) {
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function readJsonConfig(file) {
  const raw = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new InstallError(`${file} is not valid JSON: ${error.message}`);
  }
}

function writeJsonConfig(file, value) {
  const backup = `${file}.bak.${stamp()}`;
  fs.copyFileSync(file, backup);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
  return backup;
}

export function installTargets(env = process.env) {
  const config = home(env);
  return {
    claude: {
      kind: "cli",
      binary: "claude",
      configPath: path.join(config, ".claude", "settings.json"),
      command: ["mcp", "add", "--scope", "user", SERVER_NAME, "--", ...serverCommand(env)],
      remove: ["mcp", "remove", SERVER_NAME, "--scope", "user"],
      list: ["mcp", "list"],
    },
    codex: {
      kind: "cli",
      binary: "codex",
      configPath: path.join(config, ".codex", "config.toml"),
      command: ["mcp", "add", SERVER_NAME, "--", ...serverCommand(env)],
      remove: ["mcp", "remove", SERVER_NAME],
      list: ["mcp", "list"],
    },
    crush: {
      kind: "json",
      configPath: path.join(env.XDG_CONFIG_HOME || path.join(config, ".config"), "crush", "crush.json"),
      entry: () => ({ type: "stdio", command: serverCommand(env)[0], args: serverCommand(env).slice(1) }),
      container: "mcp",
    },
    opencode: {
      kind: "json",
      configPath: path.join(env.XDG_CONFIG_HOME || path.join(config, ".config"), "opencode", "opencode.json"),
      entry: () => ({ type: "local", command: serverCommand(env), enabled: true }),
      container: "mcp",
    },
  };
}

function runCli(binary, args, env) {
  return execFileSync(binary, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}

function tryRun(binary, args, env) {
  try {
    return runCli(binary, args, env);
  } catch {
    return "";
  }
}

function cliTarget(name, target, env, { remove, print }) {
  const binary = which(target.binary, env);
  if (!binary) return { name, action: "skipped not installed", path: target.configPath, backup: null };
  const args = remove ? target.remove : target.command;
  if (print) return { name, action: "printed", path: target.configPath, backup: null, command: `${path.basename(binary)} ${args.join(" ")}` };
  if (!remove && tryRun(binary, target.list, env).includes(SERVER_NAME)) {
    return { name, action: "unchanged", path: target.configPath, backup: null };
  }
  try {
    runCli(binary, args, env);
  } catch (error) {
    throw new InstallError(`${name}: ${path.basename(binary)} ${args.join(" ")} failed: ${String(error.message).split("\n")[0]}`);
  }
  return { name, action: remove ? "removed" : "added", path: target.configPath, backup: null, command: `${path.basename(binary)} ${args.join(" ")}` };
}

function jsonTarget(name, target, { remove, print, env }) {
  if (!fs.existsSync(target.configPath)) {
    if (print) return { name, action: "printed", path: target.configPath, backup: null, entry: target.entry() };
    if (remove) return { name, action: "not present", path: target.configPath, backup: null };
    fs.mkdirSync(path.dirname(target.configPath), { recursive: true });
    fs.writeFileSync(target.configPath, `${JSON.stringify({}, null, 2)}\n`);
    fs.copyFileSync(target.configPath, `${target.configPath}.bak.${stamp()}`);
  }
  const config = readJsonConfig(target.configPath);
  const container = config[target.container] || {};
  const present = Boolean(container[SERVER_NAME]);
  if (print) {
    return { name, action: "printed", path: target.configPath, backup: null, entry: present ? container[SERVER_NAME] : target.entry() };
  }
  if (remove) {
    if (!present) return { name, action: "not present", path: target.configPath, backup: null };
    delete container[SERVER_NAME];
    config[target.container] = container;
    return { name, action: "removed", path: target.configPath, backup: writeJsonConfig(target.configPath, config) };
  }
  const desired = target.entry();
  if (present && JSON.stringify(container[SERVER_NAME]) === JSON.stringify(desired)) {
    return { name, action: "unchanged", path: target.configPath, backup: null };
  }
  container[SERVER_NAME] = desired;
  config[target.container] = container;
  return { name, action: present ? "updated" : "added", path: target.configPath, backup: writeJsonConfig(target.configPath, config) };
}

export function install({ clis = [], remove = false, print = false, env = process.env, log = () => {} } = {}) {
  const targets = installTargets(env);
  const names = clis.length ? clis : Object.keys(targets);
  const unknown = names.filter((name) => !targets[name]);
  if (unknown.length) throw new InstallError(`unknown CLI: ${unknown.join(", ")} (known: ${Object.keys(targets).join(", ")})`);

  const results = names.map((name) => {
    const target = { ...targets[name], print };
    log(`x-search install: ${name}`);
    return target.kind === "cli" ? cliTarget(name, target, env, { remove, print }) : jsonTarget(name, target, { remove, print, env });
  });
  return { results, next: ["x-search index --all", "x-search watch"] };
}

export function formatReport({ results }) {
  const lines = results.map((result) => `${result.name.padEnd(9)} ${result.action.padEnd(20)} ${result.path}`);
  return [...lines, "", "next:", "  x-search index --all", "  x-search watch"].join("\n");
}
