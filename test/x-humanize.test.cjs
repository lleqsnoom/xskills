"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-humanize");
const SCRIPTS = path.join(SKILL, "scripts");
const ANALYZE = path.join(SCRIPTS, "analyze.mjs");
const BRIEF = path.join(SCRIPTS, "rewrite-brief.mjs");
const VERIFY = path.join(SCRIPTS, "verify.mjs");
const SAVE = path.join(SCRIPTS, "save-report.mjs");
const METRICS = path.join(SCRIPTS, "utils", "metrics.mjs");

const HARD =
  "It is important to note that the implementation of the authentication module, which was undertaken by the engineering team in order to facilitate faster login, necessitates consideration of additional security measures.";
const EASY =
  "The engineering team built the authentication module to speed up login. It still needs more security work.";

function run(script, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], {
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      cwd: options.cwd,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    if (options.input) {
      child.stdin.end(options.input);
    }
  });
}

describe("x-humanize metrics — pure", async () => {
  const m = await import(METRICS);

  it("countSyllables uses the vowel-group heuristic", () => {
    assert.equal(m.countSyllables("cat"), 1);
    assert.equal(m.countSyllables("the"), 1);
    assert.equal(m.countSyllables("banana"), 3);
    assert.equal(m.countSyllables("engineering"), 4);
    assert.equal(m.countSyllables(""), 0);
    assert.equal(m.countSyllables("42"), 0);
  });

  it("splitSentences handles prose and markdown units", () => {
    assert.deepEqual(m.splitSentences("One. Two! Three?"), ["One.", "Two!", "Three?"]);
    assert.deepEqual(m.splitSentences("# Heading\n- item one\n\nA sentence here."), [
      "Heading",
      "item one",
      "A sentence here.",
    ]);
  });

  it("maskNonProse drops code and urls from word counts", () => {
    assert.equal(m.tokenizeWords("Use `code` and https://x.io now").join(" "), "Use and now");
  });

  it("cefrFromGrade bands grades", () => {
    assert.equal(m.cefrFromGrade(3), "A2");
    assert.equal(m.cefrFromGrade(6), "B1");
    assert.equal(m.cefrFromGrade(8), "B2");
    assert.equal(m.cefrFromGrade(11), "C1");
    assert.equal(m.cefrFromGrade(15), "C2");
    assert.equal(m.cefrFromGrade(null), null);
  });

  it("fleschReadingEase matches the closed form and guards empties", () => {
    assert.equal(m.fleschReadingEase(1, 1, 1), 121.2);
    assert.equal(m.fleschReadingEase(0, 0, 0), null);
  });

  it("smogIndex needs at least three sentences", () => {
    assert.equal(m.smogIndex(2, 5), null);
    assert.ok(m.smogIndex(30, 10) > 0);
  });

  it("findFiller finds noisy phrases and words", () => {
    const f = m.findFiller("It is important to note that this is basically very good");
    assert.ok(f.includes("it is important to note that"));
    assert.ok(f.includes("basically"));
    assert.ok(f.includes("very"));
  });

  it("analyzeText flags long sentences, noise, and a level", () => {
    const r = m.analyzeText(HARD, { target: "B2" });
    assert.ok(r.metrics.longSentences >= 1);
    assert.ok(r.metrics.filler >= 1);
    assert.equal(r.target.level, "B2");
    assert.equal(r.target.maxGrade, 9);
    assert.ok(["B2", "C1", "C2"].includes(r.level.cefr));
    assert.ok(r.hardWords.length > 0);
  });

  it("analyzeText scores hard text above easy text", () => {
    const hard = m.analyzeText(HARD, { target: "B2" });
    const easy = m.analyzeText(EASY, { target: "B2" });
    assert.ok(hard.level.fkGrade > easy.level.fkGrade);
    assert.equal(easy.metrics.longSentences, 0);
  });
});

describe("x-humanize rewrite-brief", async () => {
  const brief = await import(BRIEF);
  const m = await import(METRICS);

  it("buildBrief ranks priorities and carries the rules", () => {
    const analysis = m.analyzeText(HARD, { target: "B2" });
    const b = brief.buildBrief(analysis);
    assert.ok(b.priorities.length >= 1);
    assert.ok(b.priorities[0].reasons.length >= 1);
    assert.ok(b.rules.some((r) => /filler/i.test(r)));
    assert.equal(b.priorities[0].score >= b.priorities[b.priorities.length - 1].score, true);
  });

  it("renderMarkdown emits a titled brief", () => {
    const b = brief.buildBrief(m.analyzeText(HARD, { target: "B1" }));
    assert.match(brief.renderMarkdown(b), /# Rewrite brief/);
  });
});

describe("x-humanize save-report — pure helpers", async () => {
  const mod = await import(SAVE);

  it("slugify lowercases and hyphenates", () => {
    assert.equal(mod.slugify("My Great Article!"), "my-great-article");
    assert.equal(mod.slugify("///"), "document");
    assert.equal(mod.slugify(""), "document");
  });

  it("timestamp uses DD-MM-YYYY-hh:mm", () => {
    assert.equal(mod.timestamp(new Date(2026, 0, 5, 9, 7)), "05-01-2026-09:07");
  });

  it("reportPath combines directory, timestamp, and slug", () => {
    assert.equal(mod.reportPath("out", "My Doc", new Date(2026, 0, 5, 9, 7)), path.join("out", "05-01-2026-09:07-my-doc.md"));
  });

  it("createReport writes once and is idempotent", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-humanize-"));
    try {
      const date = new Date(2026, 0, 5, 9, 7);
      const first = mod.createReport({ dir, slug: "Doc One", level: "B2", date });
      assert.equal(first.created, true);
      const content = await fsp.readFile(first.path, "utf8");
      assert.match(content, /# Humanize — Doc One/);
      const second = mod.createReport({ dir, slug: "Doc One", level: "B2", date });
      assert.equal(second.created, false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("x-humanize verify — meaning and noise", async () => {
  const { verify } = await import(VERIFY);

  it("passes when the rewrite hits target and keeps facts", () => {
    const r = verify({ original: HARD, revised: EASY, target: "B2" });
    assert.equal(r.pass, true);
    assert.ok(r.after.level.fkGrade <= r.target.maxGrade);
    assert.ok(r.deltas.fleschKincaidGrade < 0);
    assert.ok(r.deltas.filler <= 0);
  });

  it("fails when noise is introduced", () => {
    const r = verify({ original: "The team shipped the feature.", revised: "It is important to note that the team shipped the feature.", target: "B2" });
    assert.equal(r.pass, false);
    assert.ok(r.checks.find((c) => c.id === "no-noise-phrases" && !c.ok));
  });

  it("fails when a number is dropped", () => {
    const r = verify({ original: "The API handles 500 requests per second.", revised: "The API handles many requests.", target: "B2" });
    assert.equal(r.pass, false);
    assert.ok(r.checks.find((c) => c.id === "numbers-preserved" && !c.ok));
  });

  it("fails when a url changes", () => {
    const r = verify({ original: "See https://a.example.com for details.", revised: "See https://b.example.com for details.", target: "B2" });
    assert.equal(r.pass, false);
    assert.ok(r.checks.find((c) => c.id === "urls-preserved" && !c.ok));
  });
});

describe("x-humanize CLI", async () => {
  it("analyze --help exits 0", async () => {
    const res = await run(ANALYZE, ["--help"]);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Usage:/);
  });

  it("analyze reads stdin and emits JSON", async () => {
    const res = await run(ANALYZE, ["--stdin", "--level", "B1"], { input: HARD });
    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.ok(parsed.metrics.words > 0);
    assert.equal(parsed.target.level, "B1");
  });

  it("analyze exits 1 on an unknown level", async () => {
    const res = await run(ANALYZE, ["--stdin", "--level", "Z9"], { input: "hi" });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Unknown level/);
  });

  it("rewrite-brief reads analyze JSON from stdin", async () => {
    const a = await run(ANALYZE, ["--stdin"], { input: HARD });
    const res = await run(BRIEF, ["--stdin", "--format", "md"], { input: a.stdout });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /the team|# Rewrite brief/);
  });

  it("verify exits 0 on a good rewrite and 1 on a bad one", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-humanize-cli-"));
    try {
      const orig = path.join(dir, "orig.md");
      const good = path.join(dir, "good.md");
      const bad = path.join(dir, "bad.md");
      await fsp.writeFile(orig, HARD);
      await fsp.writeFile(good, EASY);
      await fsp.writeFile(bad, "It is important to note that the team shipped it.");
      const ok = await run(VERIFY, ["--original", orig, "--revised", good, "--level", "B2"]);
      assert.equal(ok.code, 0);
      assert.equal(JSON.parse(ok.stdout).pass, true);
      const fail = await run(VERIFY, ["--original", orig, "--revised", bad, "--level", "B2"]);
      assert.equal(fail.code, 1);
      assert.equal(JSON.parse(fail.stdout).pass, false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("save-report writes a file and prints its path", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-humanize-save-"));
    try {
      const res = await run(SAVE, ["--slug", "CLI Doc", "--level", "B2", "--output", dir]);
      assert.equal(res.code, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.created, true);
      assert.match(parsed.path, /cli-doc\.md$/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("save-report exits 1 without --slug", async () => {
    const res = await run(SAVE, []);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--slug is required/);
  });
});
