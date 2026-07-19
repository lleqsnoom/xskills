"use strict";

/**
 * Determine the semver bump type from a set of conventional commits.
 *
 * Conventional Commits → SemVer:
 *   feat:     → minor
 *   fix:      → patch
 *   perf:     → patch (performance improvement treated as patch)
 *   BREAKING CHANGE / ! → major
 *   docs, chore, refactor, style, test, ci → no release
 *
 * The highest applicable bump wins. Returns "none" when there are no releasable commits.
 */

const CONVENTIONAL_TYPES = {
  feat: "minor",
  fix: "patch",
  perf: "patch",
};

// Regex for conventional commit subject line: type(scope)!: description OR type(scope): description
const COMMIT_RE = /^(feat|fix|perf)(\(.+\))?(!)?[:.]\s+.+/;
const BREAKING_CHANGE_FOOTER_RE = /^BREAKING[ -]CHANGE:[\s\S]/im;

function getBumpType(commitMessage) {
  if (!commitMessage || typeof commitMessage !== "string") return null;

  const hasBreakingFooter = BREAKING_CHANGE_FOOTER_RE.test(commitMessage);
  const subjectMatch = COMMIT_RE.exec(commitMessage.split("\n")[0]);

  // Breaking change in footer always wins
  if (hasBreakingFooter) return "major";

  if (!subjectMatch) return null;

  const type = subjectMatch[1];
  const bang = subjectMatch[3];

  // Explicit breaking indicator: feat!: or fix!: etc.
  if (bang === "!") return "major";

  return CONVENTIONAL_TYPES[type] || null;
}

function getReleaseType(commits) {
  let highest = "none";

  for (const msg of commits) {
    const bump = getBumpType(msg);
    if (!bump) continue;

    // major > minor > patch > none
    if (bump === "major") return "major";
    if (bump === "minor" && highest !== "major") highest = "minor";
    else if (bump === "patch" && !highest.includes("minor")) {
      if (!highest || highest === "none") highest = "patch";
    }
  }

  return highest;
}

module.exports = { getBumpType, getReleaseType };
