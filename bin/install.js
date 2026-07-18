#!/usr/bin/env node

"use strict";

const { spawn } = require("node:child_process");
const path = require("path");
const fsp = require("node:fs/promises");
const { install, listSkills, globalInstall, listSkillNames } = require("../lib/install");

const commands = {
  install: handleInstall,
  "install-all": handleInstallAll,
  "mcp-server": handleMcpServer,
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

/**
 * Start the MCP server — spawns lib/mcp-server.js as a child process.
 */
function handleMcpServer() {
  const mcpServerPath = path.resolve(path.dirname(__filename), '..', 'lib', 'mcp-server.js');

  try {
    fsp.accessSync(mcpServerPath);
  } catch (err) {
    console.error(`MCP server not found at ${mcpServerPath}`);
    console.error("Make sure @lleqsnoom/x-skills is installed properly.");
    process.exit(1);
  }

  const child = spawn(process.execPath, [mcpServerPath], {
    stdio: ["inherit", "inherit", "inherit"],
  });

  child.on("error", (err) => {
    console.error(`Failed to start MCP server: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.exit(code || 1);
    }
  });
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
  xskills mcp-server                 Start MCP server (requires installed skills)
  xskills list                       List all available skills
  xskills help                       Show this help

Examples:
  npx @lleqsnoom/x-skills install-all --global    # Install all skills globally
  npx @lleqsnoom/x-skills mcp-server              # Start MCP server for client use
  npx xskills list                                # List available skills

Skills are installed into .agents/skills/ (Agent Skills open standard).
MCP server exposes skills as tools for editors with native MCP support.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
