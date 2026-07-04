#!/usr/bin/env node

"use strict";

const { install, listSkills, globalInstall } = require("../lib/install");

const commands = {
  install: handleInstall,
  list: () => listSkills(),
  ls: () => listSkills(),
  help: printHelp,
  "--help": printHelp,
  "-h": printHelp,
};

async function dispatch(command, args) {
  const handler = commands[command];
  if (handler) {
    await handler(args);
    return;
  }
  console.log(`Installing "${command}"...`);
  await install(command).catch((err) => {
    console.error(`Error installing "${command}": ${err.message}`);
    process.exit(1);
  });
}

async function handleInstall(args) {
  const skillName = args[0];
  if (!skillName) {
    console.error("Usage: xskills install <skill-name> [--global]");
    process.exit(1);
  }
  const globalFlag = args.includes("--global") || args.includes("-g");
  await (globalFlag ? globalInstall(skillName) : install(skillName));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) return printHelp();
  await dispatch(command, args);
}

function printHelp() {
  console.log(`
xskills — Cross-CLI agentic skills installer

Usage:
  xskills install <skill-name>       Install skill into current project
  xskills install <skill-name> -g    Install skill globally (~/.agents/skills/)
  xskills list                       List all available skills
  xskills <skill-name>               Shortcut for "xskills install <skill-name>"

Examples:
  xskills install x-commit
  xskills install solid-principles --global
  xskills list

Skills are installed into .agents/skills/ (Agent Skills open standard).
They work with 45+ compatible CLIs: Claude Code, Gemini CLI, Crush, OpenCode, Roo Code, etc.
`.trim());
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
