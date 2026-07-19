"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { getBumpType, getReleaseType } = require("../lib/version-bump");

// ── getBumpType single-commit tests ────────────────────────────────

describe("getBumpType", () => {
  it('returns "major" for BREAKING CHANGE footer', () => {
    assert.equal(
      getBumpType(
        "feat: add new auth module\n\nBREAKING CHANGE: old API removed"
      ),
      "major"
    );
  });

  it('returns "major" for explicit breaking indicator (feat!:)', () => {
    assert.equal(getBumpType("feat!: remove deprecated config flag"), "major");
  });

  it('returns "minor" for standard feat: commit', () => {
    assert.equal(getBumpType("feat: add install-all command"), "minor");
  });

  it('returns "minor" for feat with scope', () => {
    assert.equal(
      getBumpType("feat(docs): add project manifesto"),
      "minor"
    );
  });

  it('returns "patch" for fix: commit', () => {
    assert.equal(getBumpType("fix: correct badge URL formatting"), "patch");
  });

  it('returns "patch" for fix with scope', () => {
    assert.equal(
      getBumpType("fix(install): handle missing skills directory"),
      "patch"
    );
  });

  it('returns "patch" for perf: commit', () => {
    assert.equal(getBumpType("perf: optimize skill copy loop"), "patch");
  });

  it('returns null for non-releasable chore:', () => {
    assert.equal(
      getBumpType("chore: bump version to 2.0.1"),
      null
    );
  });

  it('returns null for docs:', () => {
    assert.equal(getBumpType("docs: rewrite README with badges"), null);
  });

  it('returns null for refactor:', () => {
    assert.equal(
      getBumpType("refactor(docs): extract verbose content into references"),
      null
    );
  });

  it('returns null for merge commits', () => {
    assert.equal(getBumpType("Merge pull request #17 from fix/publish"), null);
  });

  it('returns null for free-text commit messages', () => {
    assert.equal(
      getBumpType("just some random text without convention"),
      null
    );
  });

  it('returns null for empty string', () => {
    assert.equal(getBumpType(""), null);
  });

  it('returns null for null input', () => {
    assert.equal(getBumpType(null), null);
  });

  it('handles fix! with breaking indicator as major', () => {
    assert.equal(
      getBumpType("fix!: change default port from 3000 to 8080"),
      "major"
    );
  });

  it('treats BREAKING CHANGE in body (not just footer) as major', () => {
    const msg = `feat: restructure skill directory layout

This changes the directory structure.

BREAKING CHANGE: skills/ now must be nested under .agents/skills/`;
    assert.equal(getBumpType(msg), "major");
  });
});

// ── getReleaseType multi-commit tests ──────────────────────────────

describe("getReleaseType", () => {
  it('returns "none" for empty array', () => {
    assert.equal(getReleaseType([]), "none");
  });

  it('returns "minor" when only feat: commits present', () => {
    const commits = [
      "feat: add install-all command",
      "feat(docs): add project manifesto",
    ];
    assert.equal(getReleaseType(commits), "minor");
  });

  it('returns "patch" when only fix: and chore: commits present', () => {
    const commits = [
      "fix: correct badge URL formatting",
      "chore: bump version to 2.0.1",
      "docs: rewrite README with badges",
    ];
    assert.equal(getReleaseType(commits), "patch");
  });

  it('returns "major" when any commit has BREAKING CHANGE', () => {
    const commits = [
      "fix: correct badge URL formatting",
      "chore: bump version to 2.0.1",
      "feat!: remove deprecated config flag",
    ];
    assert.equal(getReleaseType(commits), "major");
  });

  it('returns "major" when BREAKING CHANGE footer present', () => {
    const commits = [
      "fix: correct badge URL formatting",
      "feat: add new feature\n\nBREAKING CHANGE: old API removed",
    ];
    assert.equal(getReleaseType(commits), "major");
  });

  it('ignores non-releasable commits when determining bump', () => {
    const commits = [
      "chore: update deps",
      "docs: fix typo in README",
      "refactor: clean up utils",
    ];
    assert.equal(getReleaseType(commits), "none");
  });

  it('returns highest applicable bump (major > minor > patch)', () => {
    const commits = [
      "fix: small bug fix",
      "feat: add new feature",
      "chore: update deps",
    ];
    assert.equal(getReleaseType(commits), "minor");
  });

  it('handles mixed commits with breaking and regular', () => {
    const commits = [
      "fix: correct badge URL formatting",
      "feat: add new feature\n\nBREAKING CHANGE: old API removed",
      "docs: update docs",
    ];
    assert.equal(getReleaseType(commits), "major");
  });

  it('handles fix! as major even with other patch commits', () => {
    const commits = [
      "fix: small bug fix",
      "fix!: critical security fix",
    ];
    assert.equal(getReleaseType(commits), "major");
  });

  it('treats perf: as patch in multi-commit context', () => {
    const commits = ["perf: optimize install loop", "chore: cleanup"];
    assert.equal(getReleaseType(commits), "patch");
  });
});
