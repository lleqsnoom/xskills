#!/usr/bin/env node
"use strict";

/**
 * x-rollback — automated git revert with safety checks.
 *
 * Verifies clean working tree, validates commit exists in history,
 * shows impact analysis, requires explicit confirmation, then creates
 * properly formatted revert commit via x-commit integration.
 *
 * Usage:
 *   node revert.js --commit abc123def456 [--dry-run]
 *   node revert.js --last 1 [--dry-run]
 *
 * Output: JSON report to stdout (dry-run or actual revert), stderr for interactive prompts.
 */

const { execSync } = require("node:child_process");
const path = require("node:path");

// ── Argument Parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let commitSha = null;
  let lastN = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--commit" && i + 1 < args.length) {
      commitSha = args[++i];
    } else if (args[i] === "--last" && i + 1 < args.length) {
      lastN = parseInt(args[++i], 10);
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (!args[i].startsWith("--")) {
      commitSha = args[i]; // Allow positional arg as SHA
    }
  }

  return { commitSha, lastN, dryRun };
}

// ── Git Helpers ───────────────────────────────────────────────────────

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["pipe", "pipe", "ignore"] }).toString().trim();
  } catch (err) {
    throw new Error(`Git command failed: git ${args}\n${err.message}`);
  }
}

function isWorkingTreeClean() {
  const status = git("status --porcelain");
  return status.length === 0;
}

function getCommitMessage(sha) {
  try {
    return git(`log -1 --format=%s ${sha}`);
  } catch (err) {
    throw new Error(`Commit "${sha}" not found in history`);
  }
}

function getCommitFiles(sha) {
  const output = git(`diff-tree --no-commit-id --name-status -r ${sha}`);
  if (!output.trim()) return [];
  return output.split("\n").map((line) => {
    const [status, filePath] = line.split("\t");
    return { status: status.trim(), path: filePath.trim() };
  });
}

function getCommitStats(sha) {
  try {
    const output = git(`diff --stat ${sha}^..${sha}`);
    return output;
  } catch (err) {
    // First commit has no parent — use empty tree
    try {
      const output = git(`diff --stat 4b825dc642cb6eb9a060e54bf8d69288fbee4904..${sha}`);
      return output;
    } catch (err2) {
      return "N/A";
    }
  }
}

function verifyCommitExists(sha) {
  try {
    git(`cat-file -e ${sha}`);
    return true;
  } catch (err) {
    return false;
  }
}

// ── Impact Analysis ───────────────────────────────────────────────────

function analyzeImpact(sha) {
  const message = getCommitMessage(sha);
  const files = getCommitFiles(sha);
  const stats = getCommitStats(sha);

  return { sha, message, files, stats };
}

// ── Revert Logic ──────────────────────────────────────────────────────

function revertCommit(sha) {
  try {
    // Attempt revert with --no-commit so we can use x-commit for proper formatting
    git(`revert ${sha} --no-edit --no-commit`);

    // Build commit message following conventional commit format
    const originalMessage = getCommitMessage(sha);
    const revertMessage = `revert: "${originalMessage}"`;

    // Stage and commit via x-commit script if available
    git("add -A");

    // Try to use x-commit script; fall back to regular git commit
    const skillDir = path.dirname(__filename);
    const xCommitScript = path.join(skillDir, "..", "x-commit", "scripts", "commit.mjs");

    let commitSuccess = false;
    try {
      // Check if x-commit skill is installed
      require("node:fs").accessSync(xCommitScript);
      execSync(`node "${xCommitScript}" "${revertMessage}"`, { stdio: ["pipe", "pipe", "inherit"] });
      commitSuccess = true;
    } catch (err) {
      // Fallback to regular git commit if x-commit not available
      console.error("Warning: x-commit skill not found, using git commit directly");
      try {
        execSync(`git commit -m "${revertMessage}"`, { stdio: ["pipe", "inherit", "inherit"] });
        commitSuccess = true;
      } catch (err2) {
        throw new Error(`Revert failed: ${err2.message}`);
      }
    }

    return { success: commitSuccess, revertSha: git("rev-parse HEAD"), message: revertMessage };
  } catch (err) {
    // Clean up partial revert on failure
    try {
      git("revert --abort");
    } catch {}
    throw err;
  }
}

// ── Confirmation Flow ────────────────────────────────────────────────

function promptConfirmation(impact) {
  console.error("\n=== ROLLBACK CONFIRMATION ===\n");
  console.error(`Target commit: ${impact.sha}`);
  console.error(`Original message: "${impact.message}"`);
  console.error(`Files affected: ${impact.files.length}\n`);

  for (const file of impact.files) {
    const icons = { A: "🆕", M: "✏️", D: "❌", R: "➡️" };
    console.error(`  ${icons[file.status] || "?"} [${file.status}] ${file.path}`);
  }

  console.error("\n⚠️  This action cannot be easily undone.");
  process.stderr.write("Type 'REVERT' to confirm: ");

  // In non-interactive mode (e.g., CI), skip confirmation
  if (!process.stdin.isTTY) {
    console.error("\nNon-interactive mode detected — proceeding with revert");
    return true;
  }

  // Read user input synchronously
  const readline = require("node:readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    readline.question("", (answer) => {
      readline.close();
      const confirmed = answer.trim() === "REVERT";
      if (!confirmed) {
        console.error("\nRollback cancelled by user");
      }
      resolve(confirmed);
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const { commitSha, lastN, dryRun } = parseArgs(process.argv);

  if (!commitSha && lastN === null) {
    console.error("Error: --commit <sha> or --last N required");
    process.exit(1);
  }

  // Determine target SHA
  let sha;
  if (lastN !== null) {
    try {
      sha = git(`log -1 --format=%H HEAD~${lastN}`);
    } catch (err) {
      console.error(`Error: Cannot find commit ${lastN} commits back from HEAD`);
      process.exit(1);
    }
  } else if (commitSha) {
    sha = commitSha;
  }

  // Safety check 1: clean working tree
  if (!isWorkingTreeClean()) {
    console.error("Error: Working tree is not clean. Commit or stash changes before reverting.");
    process.exit(1);
  }

  // Safety check 2: verify commit exists
  if (!verifyCommitExists(sha)) {
    console.error(`Error: Commit "${sha}" not found in current branch history`);
    process.exit(1);
  }

  // Impact analysis
  const impact = analyzeImpact(sha);

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...impact }, null, 2));
    return;
  }

  // Confirmation
  const confirmed = await promptConfirmation(impact);
  if (!confirmed) {
    process.exit(0);
  }

  // Execute revert
  try {
    const result = revertCommit(sha);
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
  } catch (err) {
    console.error(`\nError during revert: ${err.message}`);
    process.exit(1);
  }
}

main();
