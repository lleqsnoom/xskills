#!/usr/bin/env node

"use strict";

const fsp = require("node:fs/promises");
const { install, listSkills, globalInstall, listSkillNames } = require("../lib/install");

const commands = {
  install: handleInstall,
  "install-all": handleInstallAll,
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

async function handleInstallAll(args) {
  const globalFlag = args.includes("--global") || args.includes("-g");
  console.log("Installing all skills...\n");

  let installedCount = 0;
  const skillNames = await listSkillNames();

  for (const skillName of skillNames) {
    try {
      if (globalFlag) {
        await globalInstall(skillName);
      } else {
        await install(skillName);
      }
      installedCount++;
    } catch (err) {
      console.error(`  Failed to install "${skillName}": ${err.message}`);
    }
  }

  console.log(`\nDone. Installed ${installedCount}/${skillNames.length} skills.`);
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
  xskills install-all                Install all available skills at once
  xskills list                       List all available skills
  xskills help                       Show this help

Examples:
  npx @lleqsnoom/x-skills install-all --global    # Install all skills globally
  npx xskills list                                # List available skills

Skills are installed into .agents/skills/ (Agent Skills open standard).
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
