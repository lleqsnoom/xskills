#!/usr/bin/env node
"use strict";

/**
 * xskills CLI — unified command interface for skill management and MCP configuration.
 *
 * Commands:
 *   xskills --version          Show version from package.json
 *   xskills list               List available skills with descriptions
 *   xskills install <name>     Install skill locally into .agents/skills/
 *   xskills install <name> -g  Install skill globally into ~/.agents/skills/
 *   xskills mcp install <agent> Generate MCP config for specified agent
 *
 * Usage:
 *   node bin/xskills.js [command] [args...]
 */

const { execSync } = require("node:child_process");
const path = require("node:path");

// ── Command Delegation ────────────────────────────────────────────────
// Delegate most commands to the existing install.js for compatibility.
// Only "mcp" and "--version"/"--help" are handled directly here.

function delegateToInstall(args) {
  const installScript = path.join(__dirname, "install.js");
  return execSync(`node "${installScript}" ${args.join(" ")}`, { stdio: "inherit" });
}

// ── Main Dispatch ─────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  // Direct handlers for commands not handled by install.js
  if (command === "--version" || command === "-v") {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8"));
    console.log(`xskills v${pkg.version}`);
    return;
  }

  if (command === "mcp") {
    handleMCP(args.slice(1));
    return;
  }

  // Delegate everything else to existing install.js
  delegateToInstall(args);
}

// ── MCP Command Handler ───────────────────────────────────────────────

async function handleMCP(mcpArgs) {
  const subcommand = mcpArgs[0];

  if (subcommand === "install") {
    const agent = mcpArgs[1];
    if (!agent) {
      console.error("Error: Agent name required. Usage: xskills mcp install <claude|codex|cursor>");
      process.exit(1);
    }

    try {
      // Load MCP tools module dynamically to avoid circular dependency issues at startup
      const { generateMCPConfig } = require("../lib/mcp-tools");
      const config = generateMCPConfig(agent);
      console.log(config);
    } catch (err) {
      console.error(`Error generating MCP config for "${agent}": ${err.message}`);
      console.error("Supported agents: claude, codex, cursor");
      process.exit(1);
    }
  } else if (subcommand === "serve") {
    // Placeholder for future stdio MCP server implementation
    console.log("MCP server not yet implemented. See US06 task.");
  } else if (subcommand === "--help" || subcommand === "-h") {
    console.log("\nxskills mcp — MCP configuration commands\n");
    console.log("Commands:");
    console.log("  install <agent>   Generate MCP config for specified agent (claude, codex, cursor)");
    console.log("  serve             Start stdio MCP server (future)\n");
  } else {
    console.error(`Unknown mcp subcommand: "${subcommand}"`);
    console.error('Usage: xskills mcp install <agent>');
    process.exit(1);
  }
}

function printHelp() {
  const pkgPath = path.join(__dirname, "..", "package.json");
  let version = "?";
  try {
    version = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8")).version;
  } catch {}

  console.log(`\nxskills v${version}

Usage: xskills <command> [args]

Commands:
  install <name>        Install skill locally into .agents/skills/
  install <name> -g     Install skill globally into ~/.agents/skills/
  list                  List available skills with descriptions
  mcp install <agent>   Generate MCP config for agent (claude, codex, cursor)

Options:
  --version, -v         Show version
  --help, -h            Show this help\n`);
}

main();
