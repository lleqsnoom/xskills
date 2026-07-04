import { execSync } from "node:child_process";

/**
 * Analyze staged git diff and suggest a conventional commit type + scope.
 * Usage: node scripts/suggest-type.mjs [--staged | --unstaged]
 */

const KNOWN_SCOPES = ["src", "lib", "app", "api", "ui", "auth", "db", "test", "docs", "config"];

function getDiff(mode) {
  const cmd = mode === "unstaged" ? "git diff" : "git diff --cached";
  try {
    return execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch {
    return "";
  }
}

function suggestScope(diff) {
  const files = diff
    .split("\n")
    .filter((l) => l.startsWith("diff --git"))
    .map((l) => l.replace('diff --git a/', "").replace(" b/", ""))
    .filter(Boolean);

  if (files.length === 0) return null;

  const scopes = new Set();
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length >= 2) scopes.add(parts[0]);
  }

  const known = [...scopes].filter((s) => KNOWN_SCOPES.includes(s));
  if (known.length === 1) return known[0];
  if (known.length > 1) return known[0];

  const allDirs = [...new Set(files.map((f) => f.split("/")[0]))];
  return allDirs.length === 1 ? allDirs[0] : null;
}

function suggestType(diff) {
  let added = 0;
  let removed = 0;
  let hasTestFile = false;
  let hasConfigFile = false;
  let hasDocFile = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++") && !line.startsWith("+++ ")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---") && !line.startsWith("--- ")) {
      removed++;
    }

    const filePathMatch = line.match(/diff --git a\/(.+?) b\//);
    if (filePathMatch) {
      const path = filePathMatch[1];
      if (/\/test\//.test(path) || /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(path)) {
        hasTestFile = true;
      }
      if (/^config\//.test(path) || /\.(config\.(ts|js|mjs))$/.test(path)) {
        hasConfigFile = true;
      }
      if (/\.(md|txt|rst)$/i.test(path) || /^docs\//.test(path)) {
        hasDocFile = true;
      }
    }
  }

  const netChange = added - removed;

  if (hasTestFile && netChange < 0) return "test";
  if (hasConfigFile && netChange < 50) return "build";
  if (hasDocFile && added < 30 && removed < 10) return "docs";
  if (removed > added * 2 && netChange < -50) return "refactor";

  const fixPatterns = [
    /\b(fix|bug|issue|crash|error handling)\b/i,
    /\b(null|undefined)\s*(check|guard|safe)/i,
    /!\s*at\s+/i,
  ];

  for (const pattern of fixPatterns) {
    if (pattern.test(diff)) return "fix";
  }

  if (added > 100 && netChange > 50) return "feat";
  if (added > 20 && netChange > 10) return "feat";
  if (netChange < 10 && removed < 20) return "chore";

  return "chore";
}

const mode = process.argv.includes("--unstaged") ? "unstaged" : "staged";
const diff = getDiff(mode);

if (!diff.trim()) {
  console.error("No changes detected. Stage some files first.");
  process.exit(1);
}

const type = suggestType(diff);
const scope = suggestScope(diff);

console.log(JSON.stringify({ type, scope }, null, 2));
