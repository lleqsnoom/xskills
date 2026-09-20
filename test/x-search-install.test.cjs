"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TOOL = path.resolve(__dirname, "..", "tools", "x-search", "src", "cli.mjs");

function sandbox({ stubClis = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-search-install-"));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(path.join(home, ".config", "crush"), { recursive: true });
  fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(root, "cli.log");
  if (stubClis) {
    for (const name of ["claude", "codex"]) {
      fs.writeFileSync(
        path.join(bin, name),
        `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst args = process.argv.slice(2);\nconst log = process.env.CLI_LOG + ".${name}";\nif (args[0] === "mcp" && args[1] === "list") {\n  const seen = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";\n  process.stdout.write(/mcp add[^\\n]*x-search/.test(seen) ? "x-search" : "");\n  process.exit(0);\n}\nfs.appendFileSync(log, args.join(" ") + "\\n");\n`,
        { mode: 0o755 },
      );
    }
  }
  return {
    root,
    home,
    bin,
    log,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      CLI_LOG: log,
      X_SEARCH_BIN: "/opt/x-search/src/cli.mjs",
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function run(args, env) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", env: { ...process.env, X_SEARCH_STATE: path.join(os.tmpdir(), `x-search-state-${process.pid}.json`), ...env } });
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const cliLog = (sandboxed) => {
  const dir = path.dirname(sandboxed.log);
  const base = path.basename(sandboxed.log);
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(base))
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("");
};

test("install: wires all four CLIs, twice, leaving one entry each", (t) => {
  const box = sandbox();
  t.after(box.cleanup);
  const crush = path.join(box.home, ".config", "crush", "crush.json");
  const opencode = path.join(box.home, ".config", "opencode", "opencode.json");
  fs.writeFileSync(crush, JSON.stringify({ mcp: { "chrome-devtools": { type: "stdio", command: "npx", args: ["-y", "chrome-devtools-mcp"] } } }, null, 2));
  fs.writeFileSync(opencode, JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2));

  const first = run(["install", "--cli", "crush,claude,codex,opencode", "--json"], box.env);
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.deepEqual(report.results.map((result) => `${result.name}:${result.action}`), ["crush:added", "claude:added", "codex:added", "opencode:added"]);

  const crushConfig = readJson(crush);
  assert.equal(crushConfig.mcp["x-search"].type, "stdio");
  assert.deepEqual(crushConfig.mcp["x-search"].args, ["mcp"]);
  assert.equal(crushConfig.mcp["chrome-devtools"].type, "stdio", "an existing entry is untouched");
  assert.equal(readJson(opencode).mcp["x-search"].type, "local");
  assert.deepEqual(readJson(opencode).mcp["x-search"].command, ["/opt/x-search/src/cli.mjs", "mcp"]);

  const commands = cliLog(box);
  assert.match(commands, /mcp add --scope user x-search -- \/opt\/x-search\/src\/cli\.mjs mcp/);
  assert.match(commands, /mcp add x-search -- \/opt\/x-search\/src\/cli\.mjs mcp/);

  const second = run(["install", "--cli", "crush,claude,codex,opencode", "--json"], box.env);
  assert.equal(second.status, 0, second.stderr);
  const secondReport = JSON.parse(second.stdout);
  assert.deepEqual(secondReport.results.map((result) => result.action), ["unchanged", "unchanged", "unchanged", "unchanged"]);
  assert.equal(Object.keys(readJson(crush).mcp).filter((key) => key === "x-search").length, 1);
});

test("install: --remove takes exactly that entry out and keeps a backup", (t) => {
  const box = sandbox();
  t.after(box.cleanup);
  const crush = path.join(box.home, ".config", "crush", "crush.json");
  const opencode = path.join(box.home, ".config", "opencode", "opencode.json");
  fs.writeFileSync(crush, JSON.stringify({ mcp: {} }, null, 2));
  fs.writeFileSync(opencode, JSON.stringify({ mcp: {} }, null, 2));

  assert.equal(run(["install", "--cli", "crush,opencode"], box.env).status, 0);
  const removed = run(["install", "--cli", "crush,opencode", "--remove", "--json"], box.env);
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(JSON.parse(removed.stdout).results.map((result) => result.action), ["removed", "removed"]);
  assert.deepEqual(readJson(crush).mcp, {});
  assert.deepEqual(readJson(opencode).mcp, {});
  assert.ok(fs.readdirSync(path.dirname(crush)).some((name) => name.startsWith("crush.json.bak.")), "the previous config was kept");
});

test("install: a corrupt config is refused and left alone", (t) => {
  const box = sandbox();
  t.after(box.cleanup);
  const crush = path.join(box.home, ".config", "crush", "crush.json");
  fs.writeFileSync(crush, '{ "mcp": { "x-search": } }');
  const before = fs.statSync(crush).mtimeMs;

  const result = run(["install", "--cli", "crush"], box.env);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not valid JSON/);
  assert.equal(fs.statSync(crush).mtimeMs, before, "the file was not written");
  assert.equal(fs.readdirSync(path.dirname(crush)).some((name) => name.startsWith(".")), false, "no temporary file was left behind");
});

test("install: --print writes nothing and shows the same commands", (t) => {
  const box = sandbox();
  t.after(box.cleanup);
  const crush = path.join(box.home, ".config", "crush", "crush.json");
  const opencode = path.join(box.home, ".config", "opencode", "opencode.json");
  fs.writeFileSync(crush, "{}\n");
  fs.writeFileSync(opencode, "{}\n");
  const stamps = [crush, opencode].map((file) => fs.statSync(file).mtimeMs);

  const result = run(["install", "--cli", "crush,claude,codex,opencode", "--print", "--json"], box.env);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.results.map((result) => result.action), ["printed", "printed", "printed", "printed"]);
  assert.equal(cliLog(box), "", "no CLI was invoked");
  assert.deepEqual([crush, opencode].map((file) => fs.statSync(file).mtimeMs), stamps);
  assert.deepEqual(readJson(crush), {});
});

test("install: a CLI that is not installed is skipped, not fatal", (t) => {
  const box = sandbox({ stubClis: false });
  t.after(box.cleanup);
  fs.writeFileSync(path.join(box.home, ".config", "crush", "crush.json"), "{}\n");
  fs.writeFileSync(path.join(box.home, ".config", "opencode", "opencode.json"), "{}\n");

  const result = run(["install", "--cli", "crush,claude,codex,opencode", "--json"], { ...box.env, PATH: `${box.bin}` });
  assert.equal(result.status, 0, result.stderr);
  const actions = Object.fromEntries(JSON.parse(result.stdout).results.map((entry) => [entry.name, entry.action]));
  assert.equal(actions.claude, "skipped not installed");
  assert.equal(actions.codex, "skipped not installed");
  assert.equal(actions.crush, "added");
});

test("install: an unknown CLI name is refused", (t) => {
  const box = sandbox();
  t.after(box.cleanup);
  const result = run(["install", "--cli", "vim"], box.env);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown CLI: vim/);
});

test("install: a read-only config directory fails without a partial write", (t) => {
  const box = sandbox();
  t.after(box.cleanup);
  const crushDir = path.join(box.home, ".config", "crush");
  fs.writeFileSync(path.join(crushDir, "crush.json"), "{}\n");
  fs.chmodSync(crushDir, 0o500);

  const result = run(["install", "--cli", "crush"], box.env);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /EACCES|permission denied/i);
  fs.chmodSync(crushDir, 0o700);
  assert.deepEqual(readJson(path.join(crushDir, "crush.json")), {});
});
