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
 * Discover source files tracked by git in the current repository.
 * Respects .gitignore — only returns files that git knows about.
 *
 * @param {string[]} [exts] - Optional set of extensions to filter by (e.g. ['.js', '.ts']).
 *                            If omitted, all matching SOURCE_EXTENSIONS are used.
 * @returns {string[]} Resolved absolute file paths (deduplicated)
 */
function findTrackedSourceFiles(exts) {
  const cp = require("node:child_process");
  const files = [];

  try {
    // Only look at tracked files (not untracked, not in .gitignore, not submodules)
    const out = cp.execSync("git ls-files -z", { stdio: ["pipe", "pipe", "ignore"], cwd: process.cwd() }).toString();
    if (!out) return [];

    for (const file of out.split("\0").filter(Boolean)) {
      // Skip binary files and non-source extensions
      const ext = path.extname(file).toLowerCase();
      if (exts && !exts.includes(ext)) continue;
      if (!SOURCE_EXTENSIONS.test(file)) continue;
      try {
        // Verify the file still exists on disk (handles renames/deletes)
        fs.accessSync(path.join(process.cwd(), file));
        files.push(path.resolve(process.cwd(), file));
      } catch { /* skip — deleted or inaccessible */ }
    }
  } catch {
    // Not a git repo, or git command failed → return empty (caller falls back to walkDir)
  }

  return [...new Set(files)];
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

  // --all flag without specific args → use git-tracked source files when in a repo,
  // otherwise fall back to walking rootDir (preserves behavior for non-git projects)
  const hasSpecificArgs = fileArgs.some((a) => !a.startsWith("--"));
  if (!hasSpecificArgs && fileArgs.includes("--all")) {
    const tracked = findTrackedSourceFiles();
    if (tracked.length > 0) {
      return tracked;
    }
    const root = rootDir || process.cwd();
    walkDir(root, files);
  }

  return [...new Set(files)];
}

module.exports = { findSourceFiles, findTrackedSourceFiles, walkDir };
