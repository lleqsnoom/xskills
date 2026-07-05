const fs = require("node:fs");
const path = require("node:path");

/**
 * Shared file discovery utilities for x-review scripts.
 */

const SOURCE_EXTENSIONS = /\.(js|ts|jsx|tsx|mjs|cjs|py|go|rs|java|rb|php|sh|bash|zsh)$/;
const SKIP_DIRS = [".git", "node_modules", "dist", "build", ".agents"];

/**
 * Recursively walk a directory, collecting files matching the source extensions.
 */
function walkDir(dir, out) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.includes(entry.name)) continue;
        walkDir(full, out);
      } else if (SOURCE_EXTENSIONS.test(entry.name)) {
        out.push(full);
      }
    }
  } catch { /* skip */ }
}

/**
 * Discover source files from command-line arguments.
 *
 * @param {string[]} fileArgs - CLI arguments (may include --all flag)
 * @param {string} [rootDir] - Optional root directory to scan
 * @returns {string[]} Resolved absolute file paths (deduplicated)
 */
function findSourceFiles(fileArgs, rootDir) {
  const files = [];

  for (const arg of fileArgs) {
    if (arg.startsWith("--")) continue;
    const resolved = path.resolve(arg);
    try {
      if (fs.statSync(resolved).isDirectory()) {
        walkDir(resolved, files);
      } else if (SOURCE_EXTENSIONS.test(resolved)) {
        files.push(resolved);
      }
    } catch { /* skip */ }
  }

  // --all flag without specific args → scan rootDir or cwd
  const hasSpecificArgs = fileArgs.some((a) => !a.startsWith("--"));
  if (!hasSpecificArgs && fileArgs.includes("--all")) {
    const root = rootDir || process.cwd();
    walkDir(root, files);
  }

  return [...new Set(files)];
}

module.exports = { findSourceFiles, walkDir };
