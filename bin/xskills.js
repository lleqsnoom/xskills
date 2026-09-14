#!/usr/bin/env node
"use strict";

/**
 * xskills CLI — unified command interface for skill management.
 *
 * Commands:
 *   xskills --version          Show version from package.json
 *   xskills list               List available skills with descriptions
 *   xskills install <name>     Install skill locally into .agents/skills/
 *   xskills install <name> -g  Install skill globally into ~/.agents/skills/
 *
 * Usage:
 *   node bin/xskills.js [command] [args...]
 */

const { execSync } = require("node:child_process");
const path = require("node:path");

// ── Command Delegation ────────────────────────────────────────────────
// Delegate most commands to the existing install.js for compatibility.
// Only "--version"/"--help" are handled directly here.

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

  // Delegate everything else to existing install.js
  delegateToInstall(args);
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

Options:
  --version, -v         Show version
  --help, -h            Show this help\n`);
}

main();
