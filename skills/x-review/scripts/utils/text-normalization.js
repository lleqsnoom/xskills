/**
 * Shared text normalization utilities for x-review scripts.
 */

/**
 * Strip comments from source code so duplication detection works across languages.
 * Handles C-style line/block, Python/Bash hash, SQL double-dash, and Haskell/Lua semicolons.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")       // block comments
    .replace(/\/\/.*$/gm, "")               // line comments
    .replace(/^#.*$/gm, "");                // hash comments (Python, Bash, etc.)
}

/**
 * Normalize source lines for comparison: strip comments, trim, collapse whitespace, remove empty lines.
 */
function normalizeLines(source) {
  const cleaned = stripComments(source);
  return cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[*]/.test(line))
    .map((line) => line.replace(/\s+/g, " ")); // collapse whitespace
}

module.exports = { stripComments, normalizeLines };
