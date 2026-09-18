"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-autoreflection-heal");
const HEAL = path.join(SKILL, "scripts", "heal.mjs");
const CHECK = path.join(SKILL, "scripts", "check-heal.mjs");

async function withTmpDir(prefix, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function analysis(findings = []) {
  return { schema: "x-autoreflection-analysis/1", stats: { sessions: 1 }, findings, portfolio: [] };
}

function finding(id, over = {}) {
  return { id, kind: "tool-failure", class: "doc-command-drift", skill: "x-epic", change: "fix it", evidence: [], ...over };
}

describe("x-autoreflection-heal mint", async () => {
  const { mintPlan, SCHEMA } = await import(HEAL);

  it("mints one item per finding, with edit fields empty", () => {
    const plan = mintPlan(analysis([finding("F1"), finding("F2")]), { analysisPath: "E00-analysis.json" });
    assert.equal(plan.schema, SCHEMA);
    assert.equal(plan.analysis, "E00-analysis.json");
    assert.equal(plan.items.length, 2);
    assert.equal(plan.items[0].target, "skills/x-epic/SKILL.md");
    assert.equal(plan.items[0].find, "");
    assert.equal(plan.items[0].auto, false);
  });
});

describe("x-autoreflection-heal apply", async () => {
  const { countOccurrences, applyItem, applyHeal } = await import(HEAL);

  it("counts literal occurrences", () => {
    assert.equal(countOccurrences("a b a", "a"), 2);
    assert.equal(countOccurrences("none", "z"), 0);
    assert.equal(countOccurrences("x", ""), 0);
  });

  it("skips a non-auto item", () => {
    const item = { id: "F1", auto: false, target: "f", find: "x", replace: "y", check: "" };
    assert.equal(applyItem(item).status, "skipped");
  });

  it("applies a unique find and reports applied", async () => {
    await withTmpDir("heal", async (dir) => {
      const file = path.join(dir, "target.md");
      fs.writeFileSync(file, "run --topic now\n");
      const item = { id: "F1", auto: true, target: "target.md", find: "--topic", replace: "--slug", check: "true" };
      const result = applyItem(item, { cwd: dir });
      assert.equal(result.status, "applied");
      assert.equal(fs.readFileSync(file, "utf8"), "run --slug now\n");
    });
  });

  it("reverts when the check fails", async () => {
    await withTmpDir("heal", async (dir) => {
      const file = path.join(dir, "target.md");
      fs.writeFileSync(file, "run --topic now\n");
      const item = { id: "F1", auto: true, target: "target.md", find: "--topic", replace: "--slug", check: "node -e \"process.exit(1)\"" };
      const result = applyItem(item, { cwd: dir });
      assert.equal(result.status, "reverted");
      assert.equal(fs.readFileSync(file, "utf8"), "run --topic now\n");
    });
  });

  it("reports stale and ambiguous without writing", async () => {
    await withTmpDir("heal", async (dir) => {
      const file = path.join(dir, "target.md");
      fs.writeFileSync(file, "run --slug now --slug again\n");
      const ambiguous = applyItem({ id: "F1", auto: true, target: "target.md", find: "--slug", replace: "x", check: "true" }, { cwd: dir });
      assert.equal(ambiguous.status, "ambiguous");
      const stale = applyItem({ id: "F1", auto: true, target: "target.md", find: "missing", replace: "x", check: "true" }, { cwd: dir });
      assert.equal(stale.status, "stale");
      assert.equal(fs.readFileSync(file, "utf8"), "run --slug now --slug again\n");
    });
  });

  it("dry-run leaves the file untouched", async () => {
    await withTmpDir("heal", async (dir) => {
      const file = path.join(dir, "target.md");
      fs.writeFileSync(file, "run --topic now\n");
      const item = { id: "F1", auto: true, target: "target.md", find: "--topic", replace: "--slug", check: "true" };
      const result = applyItem(item, { cwd: dir, dryRun: true });
      assert.equal(result.status, "would-apply");
      assert.equal(fs.readFileSync(file, "utf8"), "run --topic now\n");
    });
  });

  it("applies only the picked ids", async () => {
    await withTmpDir("heal", async (dir) => {
      const a = path.join(dir, "a.md");
      const b = path.join(dir, "b.md");
      fs.writeFileSync(a, "one --topic\n");
      fs.writeFileSync(b, "two --topic\n");
      const plan = {
        schema: "x-autoreflection-heal/1",
        analysis: "E00-analysis.json",
        items: [
          { id: "F1", auto: true, target: "a.md", find: "--topic", replace: "--slug", check: "true" },
          { id: "F2", auto: true, target: "b.md", find: "--topic", replace: "--slug", check: "true" },
        ],
      };
      const results = applyHeal(plan, ["F1"], { cwd: dir });
      assert.equal(results.length, 1);
      assert.equal(fs.readFileSync(a, "utf8"), "one --slug\n");
      assert.equal(fs.readFileSync(b, "utf8"), "two --topic\n");
    });
  });
});

describe("x-autoreflection-heal check-heal", async () => {
  const { lintHeal } = await import(CHECK);

  it("accepts a well-shaped auto plan", () => {
    const plan = {
      schema: "x-autoreflection-heal/1",
      analysis: "E00-analysis.json",
      items: [{ id: "F1", skill: "x-epic", class: "doc-command-drift", target: "skills/x-epic/SKILL.md", find: "--topic", replace: "--slug", check: "node lint", auto: true }],
    };
    assert.deepEqual(lintHeal(plan).violations, []);
  });

  it("fails an auto item missing find or check, or naming a non-auto class", () => {
    const plan = {
      schema: "x-autoreflection-heal/1",
      analysis: "E00-analysis.json",
      items: [
        { id: "F1", target: "f", auto: true, check: "x" },
        { id: "F2", target: "f", auto: true, find: "x", check: "" },
        { id: "F3", target: "f", auto: true, find: "x", replace: "y", check: "x", class: "missing-check" },
      ],
    };
    const { violations } = lintHeal(plan);
    assert.ok(violations.some((v) => v.rule === "item-find"));
    assert.ok(violations.some((v) => v.rule === "item-check"));
    assert.ok(violations.some((v) => v.rule === "auto-class"));
  });
});
