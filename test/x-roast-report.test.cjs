"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHECKER = path.join(__dirname, "..", "skills", "x-roast", "scripts", "check-report.mjs");
const SAVE = path.join(__dirname, "..", "skills", "x-roast", "scripts", "save-report.mjs");

function run(script, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

const ARTIFACT = [
  "---", "name: demo", "---", "# Demo",
  "The skill scores consistently.",
  "It uses a weighted rubric.",
  "Scores are anchored to levels.",
  ...Array.from({ length: 13 }, (_, i) => `Line ${i + 8}.`),
].join("\n");

const FILLED = `# Roast — demo

**Artifact:** skills/demo/SKILL.md
**Reviewer:** self — claude-opus-5-5
**Profile:** generic
**Total:** 50 / 100 — weak
**Completeness:** 100%
**Calibration:** skipped — a test fixture

## Central claim
The skill scores consistently.

## Claims
| # | Claim | Kind | Backs | Source | Result |
|---|-------|------|-------|--------|--------|
| C1 | "The skill scores consistently." | local | accuracy | \`SKILL.md:5\` | confirmed |
| C2 | "It uses a weighted rubric." | local | accuracy, logic | \`node score.mjs --help\` | confirmed |
| C3 | "Scores are anchored to levels." | external | \`accuracy\`, \`evidence\` | https://example.com/anchors | confirmed |

## Score
\`\`\`json
{ "profile": "generic", "scores": { "accuracy": 3, "logic": 3, "evidence": 3, "originality": 3, "clarity": 3, "completeness": 3, "actionability": 3, "balance": 3 }, "total": 50, "band": "weak", "completeness": 1 }
\`\`\`

## Findings
- **accuracy (3/5)**: \`SKILL.md:10\` shows it. Adequate, not strong.
- **logic (3/5)**: \`SKILL.md:11\` shows it. Adequate, not strong.
- **evidence (3/5)**: \`SKILL.md:12\` shows it. Adequate, not strong.
- **originality (3/5)**: \`SKILL.md:13\` shows it. Adequate, not strong.
- **clarity (3/5)**: \`SKILL.md:14\` shows it. Adequate, not strong.
- **completeness (3/5)**: \`SKILL.md:15\` shows it. Adequate, not strong.
- **actionability (3/5)**: \`SKILL.md:16\` shows it. Adequate, not strong.
- **balance (3/5)**: \`SKILL.md:17\` shows it. Adequate, not strong.

## Creative alternatives
1. \`reframe\`: a ledger of claims.
2. \`addition\`: a contradiction loop.
3. \`restructure\`: a thin contract plus references.

## Improvement proposals
1. Document the profile at \`SKILL.md:12\` → raises \`clarity\` 3→4
`;

const rulesOf = async (text, cwd) => {
  const file = path.join(cwd, "case.md");
  fs.writeFileSync(file, text);
  const res = await run(CHECKER, ["--file", file], cwd);
  return { code: res.code, rules: JSON.parse(res.stdout).violations.map((v) => v.rule) };
};

describe("x-roast check-report", () => {
  let cwd;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "x-roast-report-"));
    fs.mkdirSync(path.join(cwd, "skills", "demo"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "skills", "demo", "SKILL.md"), ARTIFACT);
  });

  it("fails on the freshly created template", async () => {
    const created = JSON.parse((await run(SAVE, ["--slug", "demo", "--type", "skill", "--output", cwd])).stdout);
    const res = await run(CHECKER, ["--file", created.path]);
    assert.equal(res.code, 1);
    const out = JSON.parse(res.stdout);
    assert.ok(out.violations.some((v) => v.rule === "template-comment"));
  });

  it("passes a filled report", async () => {
    const file = path.join(cwd, "filled.md");
    fs.writeFileSync(file, FILLED);
    const res = await run(CHECKER, ["--file", file], cwd);
    assert.equal(res.code, 0, res.stdout);
    assert.deepEqual(JSON.parse(res.stdout).violations, []);
  });

  it("fails a **Completeness:** line the scores do not give", async () => {
    const { rules } = await rulesOf(FILLED.replace("**Completeness:** 100%", "**Completeness:** ?"), cwd);
    assert.deepEqual(rules, ["score-mismatch"]);
  });

  it("writes a **Completeness:** line into a fresh template", async () => {
    const created = JSON.parse((await run(SAVE, ["--slug", "demo", "--type", "skill", "--output", cwd])).stdout);
    assert.match(fs.readFileSync(created.path, "utf8"), /^\*\*Completeness:\*\* \?$/m);
  });

  it("does not flag an inline mention of the template token", async () => {
    const file = path.join(cwd, "quoted.md");
    fs.writeFileSync(file, FILLED.replace("## Findings\n", "## Findings\n- add a rule that fails on `<!--` template comments\n"));
    const res = await run(CHECKER, ["--file", file], cwd);
    assert.equal(res.code, 0, res.stderr);
  });

  it("flags an empty central claim and missing score", async () => {
    const file = path.join(cwd, "empty.md");
    fs.writeFileSync(file, "# Roast\n\n## Central claim\n\n## Score\n\n## Findings\n- a\n");
    const res = await run(CHECKER, ["--file", file]);
    assert.equal(res.code, 1);
    const rules = JSON.parse(res.stdout).violations.map((v) => v.rule);
    assert.ok(rules.includes("empty-central-claim"));
    assert.ok(rules.includes("score-json"));
  });

  it("fails the four-line report the old gate passed", async () => {
    const { code, rules } = await rulesOf("# R\n\n## Central claim\nx\n\n## Score\n{}\n\n## Findings\n- great\n", cwd);
    assert.equal(code, 1);
    for (const rule of ["reviewer", "artifact-missing", "claims-count", "score-json", "alternatives", "proposal-delta"]) assert.ok(rules.includes(rule), rule);
  });

  it("re-computes the total and fails a block or header that disagrees", async () => {
    assert.deepEqual((await rulesOf(FILLED.replace('"total": 50', '"total": 60'), cwd)).rules, ["score-mismatch"]);
    assert.deepEqual((await rulesOf(FILLED.replace("**Total:** 50 /", "**Total:** 70 /"), cwd)).rules, ["score-mismatch"]);
  });

  it("ties each finding to its score and a citation", async () => {
    const { rules } = await rulesOf(FILLED
      .replace("- **logic (3/5)**", "- **logic (4/5)**")
      .replace("- **balance (3/5)**: `SKILL.md:17` shows it.", "- **balance (3/5)**: it is fine.")
      .replace(/- \*\*clarity.*\n/, ""), cwd);
    assert.deepEqual(rules.sort(), ["finding-mismatch", "finding-missing", "finding-uncited"]);
  });

  it("needs a provisional label for an unscored dimension, but not for one marked not applicable", async () => {
    const dropped = FILLED.replace('"evidence": 3, ', "").replace(/- \*\*evidence.*\n/, "").replace("**Completeness:** 100%", "**Completeness:** 88%");
    assert.deepEqual((await rulesOf(dropped, cwd)).rules, ["score-provisional"]);
    assert.equal((await rulesOf(dropped.replace("— weak", "— weak (provisional)"), cwd)).code, 0);
    const na = dropped.replace('"total": 50', '"na": { "evidence": "no factual claims" }, "total": 50').replace("**Completeness:** 88%", "**Completeness:** 100%");
    assert.equal((await rulesOf(na, cwd)).code, 0);
  });

  it("fails the report that gamed the old gate to 100/100", async () => {
    const gamed = FILLED
      .replace(/"scores": \{[^}]*\}/, '"scores": { "logic": 5, "evidence": 5, "originality": 5, "clarity": 5, "completeness": 5, "actionability": 5, "balance": 5 }, "na": { "accuracy": "x" }')
      .replace('"total": 50', '"total": 100').replace("**Total:** 50 /", "**Total:** 100 /")
      .replace(/- \*\*(\w+) \(3\/5\)\*\*: .*$/gm, '- **$1 (5/5)**: "looks great to me"')
      .replace(/- \*\*accuracy.*\n/, "")
      .replace("raises `clarity` 3→4", "x 5→5");
    const { code, rules } = await rulesOf(gamed, cwd);
    assert.equal(code, 1);
    for (const rule of ["score-mismatch", "finding-uncited", "proposal-delta"]) assert.ok(rules.includes(rule), rule);
  });

  it("checks every claim: count, kind, result, source and a quote found in the artifact", async () => {
    assert.deepEqual((await rulesOf(FILLED.replace(/\| C3 .*\n/, ""), cwd)).rules, ["claims-count"]);
    assert.deepEqual((await rulesOf(FILLED.replace("| local | accuracy | `SKILL.md:5` |", "| web | accuracy | `SKILL.md:5` |"), cwd)).rules, ["claims-row"]);
    assert.deepEqual((await rulesOf(FILLED.replace("| confirmed |\n| C2", "| true |\n| C2"), cwd)).rules, ["claims-row"]);
    assert.deepEqual((await rulesOf(FILLED.replace("https://example.com/anchors", "a paper I read"), cwd)).rules, ["claims-row"]);
    assert.deepEqual((await rulesOf(FILLED.replace('"It uses a weighted rubric."', '"It uses a secret formula."'), cwd)).rules, ["claims-quote"]);
    assert.deepEqual((await rulesOf(FILLED.replace('"It uses a weighted rubric."', "It uses a weighted rubric."), cwd)).rules, ["claims-quote"]);
  });

  it("asks every claim for the scored dimensions it backs", async () => {
    assert.deepEqual((await rulesOf(FILLED.replace("| local | accuracy | `SKILL.md:5` |", "| local |  | `SKILL.md:5` |"), cwd)).rules, ["claims-backs"]);
    assert.deepEqual((await rulesOf(FILLED.replace("| local | accuracy | `SKILL.md:5` |", "| local | accuracy, triggers | `SKILL.md:5` |"), cwd)).rules, ["claims-backs"]);
    const oldTable = FILLED.replace("| Kind | Backs | Source |", "| Kind | Source |").replace("|------|-------|--------|", "|------|--------|")
      .replace(/ \| (accuracy|accuracy, logic|`accuracy`, `evidence`) \| /g, " | ");
    assert.deepEqual((await rulesOf(oldTable, cwd)).rules, ["claims-backs", "claims-backs", "claims-backs"]);
  });

  it("counts a claim id only for a dimension its row backs", async () => {
    assert.equal((await rulesOf(FILLED.replace("- **logic (3/5)**: `SKILL.md:11` shows it.", "- **logic (3/5)**: see C2."), cwd)).code, 0);
    assert.deepEqual((await rulesOf(FILLED.replace("- **logic (3/5)**: `SKILL.md:11` shows it.", "- **logic (3/5)**: see C3."), cwd)).rules, ["finding-uncited"]);
    assert.deepEqual((await rulesOf(FILLED.replace("- **clarity (3/5)**: `SKILL.md:14` shows it.", "- **clarity (3/5)**: https://example.com/anchors says so."), cwd)).rules, ["finding-uncited"]);
    assert.equal((await rulesOf(FILLED.replace("- **evidence (3/5)**: `SKILL.md:12` shows it.", "- **evidence (3/5)**: https://example.com/anchors says so."), cwd)).code, 0);
  });

  it("caps accuracy at 2 with a contradicted claim and at 4 with an unverified one", async () => {
    const high = FILLED.replace('"accuracy": 3', '"accuracy": 5').replace("**accuracy (3/5)**", "**accuracy (5/5)**")
      .replace('"total": 50', '"total": 59.4').replace("**Total:** 50 /", "**Total:** 59.4 /");
    assert.equal((await rulesOf(high, cwd)).code, 0);
    assert.deepEqual((await rulesOf(high.replace("| confirmed |\n\n## Score", "| unverified |\n\n## Score"), cwd)).rules, ["accuracy-cap"]);
    assert.deepEqual((await rulesOf(FILLED.replace("| confirmed |\n\n## Score", "| contradicted |\n\n## Score"), cwd)).rules, ["accuracy-cap", "contradicted-unaddressed"]);
  });

  it("asks the accuracy finding to name a contradicted claim and say whether the conclusion rests on it", async () => {
    const low = FILLED.replace("| confirmed |\n\n## Score", "| contradicted |\n\n## Score")
      .replace('"accuracy": 3', '"accuracy": 2').replace('"total": 50, "band": "weak"', '"total": 45.3, "band": "weak"')
      .replace("**Total:** 50 /", "**Total:** 45.3 /");
    const finding = (text) => low.replace("**accuracy (3/5)**: `SKILL.md:10` shows it. Adequate, not strong.", `**accuracy (2/5)**: \`SKILL.md:10\` shows it. ${text}`);
    assert.deepEqual((await rulesOf(finding("Weak."), cwd)).rules, ["contradicted-unaddressed"]);
    assert.deepEqual((await rulesOf(finding("C3 is false."), cwd)).rules, ["contradicted-unaddressed"]);
    assert.equal((await rulesOf(finding("C3 is false, and the conclusion does not rest on it."), cwd)).code, 0);
  });

  it("accepts only citations it can check, and fails a file:line that does not exist", async () => {
    const quoted = FILLED.replace("`SKILL.md:10` shows it.", '"Scores are anchored to levels" shows it.');
    assert.equal((await rulesOf(quoted, cwd)).code, 0);
    assert.equal((await rulesOf(FILLED.replace("`SKILL.md:10` shows it.", "C2 shows it."), cwd)).code, 0);
    assert.deepEqual((await rulesOf(FILLED.replace("`SKILL.md:10` shows it.", '"a quote nobody wrote" shows it.'), cwd)).rules, ["finding-uncited"]);
    assert.deepEqual((await rulesOf(FILLED.replace("`SKILL.md:10` shows it.", "`made.up:1` shows it."), cwd)).rules.sort(), ["citation-broken", "finding-uncited"]);
    assert.deepEqual((await rulesOf(FILLED.replace("`SKILL.md:10` shows it.", "`SKILL.md:10` and `SKILL.md:999` show it."), cwd)).rules, ["citation-broken"]);
  });

  it("fails an invented quote even beside a real citation, unless the finding cites the file it is from", async () => {
    const mixed = FILLED.replace("`SKILL.md:10` shows it.", '`SKILL.md:10` and "a quote nobody wrote" show it.');
    assert.deepEqual((await rulesOf(mixed, cwd)).rules, ["finding-quote"]);
    fs.writeFileSync(path.join(cwd, "helper.txt"), "line one\nthe help text says so\n");
    const elsewhere = FILLED.replace("`SKILL.md:10` shows it.", '`helper.txt:2` says "the help text says so".');
    assert.equal((await rulesOf(elsewhere, cwd)).code, 0);
  });

  it("gives the same verdict wherever the checker runs", async () => {
    const file = path.join(cwd, "case.md");
    fs.writeFileSync(file, FILLED);
    assert.equal((await run(CHECKER, ["--file", file], os.tmpdir())).code, 0);
  });

  it("checks that a proposal raises a scored dimension from its current score", async () => {
    for (const bad of ["raises `bogus` 3→4", "raises `clarity` 4→4", "raises `clarity` 2→4", "makes it better"]) {
      assert.deepEqual((await rulesOf(FILLED.replace("raises `clarity` 3→4", bad), cwd)).rules, ["proposal-delta"], bad);
    }
    assert.equal((await rulesOf(FILLED.replace("raises `clarity` 3→4", "raises `clarity` 4→5"), cwd)).code, 0, "a chained proposal");
  });

  it("fails an artifact that is not on disk", async () => {
    assert.deepEqual((await rulesOf(FILLED.replace("skills/demo/SKILL.md", "pasted text"), cwd)).rules.includes("artifact-missing"), true);
  });

  it("names a dimension that rose by two or more on a closed line", async () => {
    const before = path.join(cwd, "before.md");
    fs.writeFileSync(before, FILLED.replace('"clarity": 3', '"clarity": 1'));
    const since = (line) => FILLED.replace("## Central claim", `## Since last roast\n\n**Previous:** ${before} — 40 / 100\n\n${line}\n\n## Central claim`);
    assert.deepEqual((await rulesOf(since("- closed — fixed the intro"), cwd)).rules, ["score-rise"]);
    assert.deepEqual((await rulesOf(since("- closed — defined the terms → raises `clarity` 1→3"), cwd)).rules, ["score-rise-proof"]);
    assert.equal((await rulesOf(since("- closed — defined the terms at `skills/demo/SKILL.md:12` → raises `clarity` 1→3"), cwd)).code, 0);
    assert.equal((await rulesOf(since("- closed — `node score.mjs --help` now defines them → raises `clarity` 1→3"), cwd)).code, 0);
    assert.deepEqual((await rulesOf(since("- closed — a missing file at `skills/demo/NOPE.md:1` → raises `clarity` 1→3"), cwd)).rules, ["score-rise-proof"]);
  });

  it("names on a closed line every dimension that rose, even by one", async () => {
    const before = path.join(cwd, "before.md");
    fs.writeFileSync(before, FILLED.replace('"logic": 3', '"logic": 2'));
    const since = (line) => FILLED.replace("## Central claim", `## Since last roast\n\n**Previous:** ${before} — 45 / 100\n\n${line}\n\n## Central claim`);
    assert.deepEqual((await rulesOf(since("- closed — tightened the argument"), cwd)).rules, ["score-rise"]);
    assert.equal((await rulesOf(since("- closed — tightened the argument → raises `logic` 2→3"), cwd)).code, 0);
  });

  it("--calibrate fails a score more than one away from the reference", async () => {
    const skill = path.join(__dirname, "..", "skills", "x-roast");
    const example = path.join(skill, "references", "example-roast.md");
    assert.equal((await run(CHECKER, ["--file", example, "--calibrate", "drop-jest"], skill)).code, 0);
    const drifted = path.join(cwd, "drifted.md");
    fs.mkdirSync(path.join(cwd, "evals", "calibration"), { recursive: true });
    fs.copyFileSync(path.join(skill, "evals", "calibration", "drop-jest.md"), path.join(cwd, "evals", "calibration", "drop-jest.md"));
    fs.writeFileSync(drifted, fs.readFileSync(example, "utf8").replace('"clarity": 4', '"clarity": 2').replace("**clarity (4/5)**", "**clarity (2/5)**")
      .replace(/"total": 18\.8/, '"total": 12.5').replace("**Total:** 18.8", "**Total:** 12.5"));
    const res = await run(CHECKER, ["--file", drifted, "--calibrate", "drop-jest"], cwd);
    assert.deepEqual(JSON.parse(res.stdout).violations.map((v) => v.rule), ["calibration-drift"]);
  });

  it("re-runs the **Calibration:** line of a profile that has a case", async () => {
    const skill = path.join(__dirname, "..", "skills", "x-roast");
    const example = fs.readFileSync(path.join(skill, "references", "example-roast.md"), "utf8");
    fs.mkdirSync(path.join(cwd, "evals", "calibration"), { recursive: true });
    fs.copyFileSync(path.join(skill, "evals", "calibration", "drop-jest.md"), path.join(cwd, "evals", "calibration", "drop-jest.md"));
    const withLine = (line) => example.replace(/^\*\*Calibration:\*\*.*$/m, line);
    const scores = "accuracy=1, logic=2, evidence=1, originality=2, clarity=4, completeness=2, actionability=3, balance=1";
    assert.equal((await rulesOf(withLine(`**Calibration:** drop-jest — ${scores} — no drift`), cwd)).code, 0);
    assert.equal((await rulesOf(withLine(`**Calibration:** drop-jest — ${scores.replace("clarity=4", "clarity=1")} — drift: clarity`), cwd)).code, 0);
    assert.deepEqual((await rulesOf(withLine(`**Calibration:** drop-jest — ${scores.replace("clarity=4", "clarity=1")} — no drift`), cwd)).rules, ["calibration-line"]);
    assert.deepEqual((await rulesOf(withLine(`**Calibration:** add-retry — ${scores} — no drift`), cwd)).rules, ["calibration-line"]);
    assert.deepEqual((await rulesOf(withLine("**Calibration:** skipped —"), cwd)).rules, ["calibration-line"]);
    assert.deepEqual((await rulesOf(withLine(""), cwd)).rules, ["calibration-line"]);
  });

  it("finds an ellipsis quote only when its pieces are real and in order", async () => {
    const claim = (quote) => FILLED.replace('"The skill scores consistently." | local', `"${quote}" | local`);
    assert.equal((await rulesOf(claim("The skill … consistently."), cwd)).code, 0);
    assert.deepEqual((await rulesOf(claim("zzz … qqq … www"), cwd)).rules, ["claims-quote"]);
    assert.deepEqual((await rulesOf(claim("consistently. … The skill scores"), cwd)).rules, ["claims-quote"]);
    const finding = FILLED.replace("- **logic (3/5)**: `SKILL.md:11` shows it.", '- **logic (3/5)**: "abc...xyz" shows it.');
    assert.deepEqual((await rulesOf(finding, cwd)).rules, ["finding-uncited"]);
  });

  it("asks an unverified claim for the reason it could not be checked", async () => {
    const unverified = (source) => FILLED.replace("https://example.com/anchors | confirmed", `${source} | unverified`);
    assert.deepEqual((await rulesOf(unverified("—"), cwd)).rules, ["claims-row"]);
    assert.equal((await rulesOf(unverified("web unavailable"), cwd)).code, 0);
  });

  it("names a dimension that fell by two or more on an open or regressed line", async () => {
    const before = path.join(cwd, "before.md");
    fs.writeFileSync(before, FILLED.replace('"clarity": 3', '"clarity": 5'));
    const since = (line) => FILLED.replace("## Central claim", `## Since last roast\n\n**Previous:** ${before} — 60 / 100\n\n${line}\n\n## Central claim`);
    assert.deepEqual((await rulesOf(since("- open — the intro"), cwd)).rules, ["score-drop"]);
    assert.equal((await rulesOf(since("- regressed — the rewrite undefined its terms, `clarity` 5→3"), cwd)).code, 0);
  });

  it("--rules prints every rule the gate enforces", async () => {
    const res = await run(CHECKER, ["--rules"]);
    assert.equal(res.code, 0);
    assert.equal(res.stdout.split("\n").length, 28);
  });

  it("fails a reviewer that is neither self nor independent, and an unmarked Since last roast line", async () => {
    const since = FILLED.replace("## Central claim", "## Since last roast\n\n- [ ] Document it\n- closed — done\n\n## Central claim");
    assert.deepEqual((await rulesOf(since.replace("**Reviewer:** self", "**Reviewer:** me"), cwd)).rules.sort(), ["reviewer", "since-unmarked"]);
  });

  it("names the reviewing model, and refuses an independent reviewer of the author's family", async () => {
    const as = (line) => FILLED.replace("**Reviewer:** self — claude-opus-5-5", line);
    assert.deepEqual((await rulesOf(as("**Reviewer:** self"), cwd)).rules, ["reviewer"]);
    assert.equal((await rulesOf(as("**Reviewer:** independent — gpt-5.2-codex\n**Author:** claude-opus-5-5"), cwd)).code, 0);
    assert.equal((await rulesOf(as("**Reviewer:** independent — human"), cwd)).code, 0);
    assert.deepEqual((await rulesOf(as("**Reviewer:** independent — claude-sonnet-5\n**Author:** claude-opus-5-5"), cwd)).rules, ["reviewer-family"]);
    assert.deepEqual((await rulesOf(as("**Reviewer:** independent — my-model"), cwd)).rules, ["reviewer-family"]);
  });

  it("writes the reviewer's model and the author into the header", async () => {
    const res = JSON.parse((await run(SAVE, ["--slug", "demo", "--artifact", "skills/demo/SKILL.md", "--reviewer", "independent", "--model", "gpt-5", "--author", "claude-opus-5-5"], cwd)).stdout);
    const text = fs.readFileSync(res.path, "utf8");
    assert.match(text, /^\*\*Reviewer:\*\* independent — gpt-5$/m);
    assert.match(text, /^\*\*Author:\*\* claude-opus-5-5$/m);
  });

  it("carries the last roast of the same artifact into a new report", async () => {
    const first = JSON.parse((await run(SAVE, ["--slug", "demo", "--artifact", "skills/demo/SKILL.md", "--reviewer", "self"], cwd)).stdout);
    fs.writeFileSync(first.path, FILLED);
    const second = JSON.parse((await run(SAVE, ["--slug", "demo-v2", "--artifact", "./skills/demo/SKILL.md", "--reviewer", "self"], cwd)).stdout);
    assert.equal(second.previous, first.path, "./a and a are one artifact");
    const text = fs.readFileSync(second.path, "utf8");
    assert.match(text, /\*\*Previous:\*\* .*E00-critique\.md — 50 \/ 100/);
    assert.match(text, /^- \[ \] Document the profile at `SKILL\.md:12` → raises `clarity` 3→4$/m);
    const other = JSON.parse((await run(SAVE, ["--slug", "else", "--artifact", "skills/else/SKILL.md"], cwd)).stdout);
    assert.equal(other.previous, null);
  });

  it("takes the newest finished roast by its date, not the newest file", async () => {
    const dated = (date) => FILLED.replace("**Artifact:**", `**Date:** ${date}\n**Artifact:**`);
    const first = JSON.parse((await run(SAVE, ["--slug", "demo", "--artifact", "skills/demo/SKILL.md"], cwd)).stdout);
    const second = JSON.parse((await run(SAVE, ["--slug", "demo-v2", "--artifact", "skills/demo/SKILL.md"], cwd)).stdout);
    fs.writeFileSync(second.path, dated("2026-01-02-1000"));
    fs.writeFileSync(first.path, dated("2026-01-01-1000")); // edited last, but older
    const folder = JSON.parse((await run(SAVE, ["--slug", "demo-v3", "--artifact", "skills/demo"], cwd)).stdout);
    assert.equal(folder.previous, second.path, "a skill's folder and its SKILL.md are one artifact");
    const next = JSON.parse((await run(SAVE, ["--slug", "demo-v4", "--artifact", "skills/demo"], cwd)).stdout);
    assert.equal(next.previous, second.path, "an unfinished report, with no total, is not the last roast");
  });

  it("takes the profile as --profile or --type", async () => {
    for (const flag of ["--profile", "--type"]) {
      const created = JSON.parse((await run(SAVE, ["--slug", `demo${flag}`, flag, "spec", "--output", path.join(cwd, flag)])).stdout);
      assert.match(fs.readFileSync(created.path, "utf8"), /^\*\*Profile:\*\* spec$/m, flag);
    }
  });

  it("exits 2 when no report is found", async () => {
    const res = await run(CHECKER, ["--dir", path.join(cwd, "nope")]);
    assert.equal(res.code, 2);
  });

  it("picks the newest report in a directory", async () => {
    fs.writeFileSync(path.join(cwd, "a.md"), FILLED);
    const res = await run(CHECKER, ["--dir", cwd], cwd);
    assert.equal(res.code, 0, res.stderr);
    assert.match(JSON.parse(res.stdout).file, /a\.md$/);
  });
});