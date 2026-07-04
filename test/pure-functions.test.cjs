"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Import the module under test
const lib = require("../lib/install");

// ── formatDescriptionFromHeading tests ──────────────────────────────

describe("formatDescriptionFromHeading", () => {
  it("strips a single # prefix and space", () => {
    assert.equal(lib.formatDescriptionFromHeading("# My Title"), "My Title");
  });

  it("strips multiple # prefixes (h1, h2, etc.)", () => {
    assert.equal(lib.formatDescriptionFromHeading("### Nested Heading"), "Nested Heading");
  });

  it("returns text unchanged when no heading marker present", () => {
    assert.equal(lib.formatDescriptionFromHeading("Plain text line"), "Plain text line");
  });

  it("handles # with no trailing space (edge case)", () => {
    assert.equal(lib.formatDescriptionFromHeading("#NoSpace"), "NoSpace");
  });

  it("preserves content after heading markers", () => {
    assert.equal(
      lib.formatDescriptionFromHeading("# Complex Title With Spaces"),
      "Complex Title With Spaces"
    );
  });

  it("handles empty string", () => {
    assert.equal(lib.formatDescriptionFromHeading(""), "");
  });

  it("preserves leading content before # (shouldn't happen but defensive)", () => {
    // Lines without # are returned as-is per the function logic
    assert.equal(lib.formatDescriptionFromHeading("no heading here"), "no heading here");
  });
});

// ── findContentAfterFrontmatter tests ───────────────────────────────

describe("findContentAfterFrontmatter", () => {
  it("returns first non-empty line after --- separator", () => {
    const content = "---\nname: test\n---\n# My Skill";
    assert.equal(lib.findContentAfterFrontmatter(content), "My Skill");
  });

  it("skips blank lines after separator", () => {
    const content = "---\nname: test\n---\n\n\n# Title After Blanks";
    assert.equal(
      lib.findContentAfterFrontmatter(content),
      "Title After Blanks"
    );
  });

  it("returns null when no --- separator exists", () => {
    const content = "Just plain text without frontmatter.";
    assert.equal(lib.findContentAfterFrontmatter(content), null);
  });

  it("returns null when nothing after separator (only blank lines)", () => {
    const content = "---\nname: test\n---\n\n\n";
    assert.equal(lib.findContentAfterFrontmatter(content), null);
  });

  it("handles empty string", () => {
    assert.equal(lib.findContentAfterFrontmatter(""), null);
  });

  it("handles content with --- but nothing after it", () => {
    const content = "---\nname: test\n---";
    assert.equal(lib.findContentAfterFrontmatter(content), null);
  });

  it("returns the formatted heading text (strips # prefix)", () => {
    const content = "---\nname: test\n---\n## Sub Title";
    // findContentAfterFrontmatter calls formatDescriptionFromHeading internally
    assert.equal(lib.findContentAfterFrontmatter(content), "Sub Title");
  });

  it("returns non-heading text after frontmatter as-is", () => {
    const content = "---\nname: test\n---\nThis is a plain description line.";
    assert.equal(
      lib.findContentAfterFrontmatter(content),
      "This is a plain description line."
    );
  });
});

// ── extractDescription edge cases ───────────────────────────────────

describe("extractDescription — edge cases", () => {
  it("falls back to heading when YAML has no description field", () => {
    const content = "---\nname: my-skill\nversion: 2.0\n---\n\n# Skill Heading";
    assert.equal(lib.extractDescription(content), "Skill Heading");
  });

  it("handles SKILL.md with only frontmatter and no body", () => {
    const content = "---\nname: empty\nversion: 1.0\n---\n";
    // No heading after frontmatter, so falls back to "(no description)"
    assert.equal(lib.extractDescription(content), "(no description)");
  });

  it("handles SKILL.md with only a heading (no frontmatter)", () => {
    const content = "# Just A Title";
    assert.equal(lib.extractDescription(content), "Just A Title");
  });

  it("prefers YAML description over heading when both exist", () => {
    const content = "---\nname: my-skill\ndescription: From frontmatter.\n---\n\n# Heading Text";
    assert.equal(lib.extractDescription(content), "From frontmatter.");
  });

  it("handles multiline description in YAML (only first line captured)", () => {
    const content = "---\ndescription: First line only.\nversion: 1.0\n---\n\n# Title";
    // Regex captures up to $ on the description line
    assert.equal(lib.extractDescription(content), "First line only.");
  });

  it("handles content with Windows-style line endings", () => {
    const content = "---\r\ndescription: Windows style.\r\n---\r\n\r\n# Title";
    // \r is part of the line before $, so trimming should handle it
    assert.equal(lib.extractDescription(content), "Windows style.");
  });

  it("handles SKILL.md with extra YAML fields and description", () => {
    const content = [
      "---",
      "name: full-skill",
      "version: 3.0",
      "author: Test Author",
      "tags: [test, demo]",
      "description: Full frontmatter skill.",
      "---",
      "",
      "# Full Skill Title",
    ].join("\n");
    assert.equal(lib.extractDescription(content), "Full frontmatter skill.");
  });

  it("handles content that is only the YAML separator (empty frontmatter)", () => {
    const content = "---\n---";
    // No description in YAML, no content after --- → "(no description)"
    assert.equal(lib.extractDescription(content), "(no description)");
  });

  it("skips frontmatter without description and finds heading later", () => {
    const content = [
      "---",
      "name: no-desc-skill",
      "---",
      "",
      "# Found This Heading",
      "",
      "Some body text below.",
    ].join("\n");
    assert.equal(lib.extractDescription(content), "Found This Heading");
  });
});
