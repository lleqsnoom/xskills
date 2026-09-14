"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHECKER = path.join(__dirname, "..", "skills", "x-roast", "scripts", "check-report.mjs");
const SAVE = path.join(__dirname, "..", "skills", "x-roast", "scripts", "save-report.mjs");

function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

const FILLED = `# Roast — demo

**Profile:** skill
**Total:** 53 / 100 — weak
**Completeness:** 100%

## Central claim
The skill scores reproducibly.

## Score
\`\`\`json
{ "profile": "skill", "total": 53 }
\`\`\`

## Findings
- **triggers (2/5)** — description omits skills.

## Creative alternatives
1. \`reframe\` — ledger of claims.

## Improvement proposals
1. Document the skill profile.

## Sources consulted
- no external claims; all checkable in-repo
`;

describe("x-roast check-report", () => {
  let cwd;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "x-roast-report-"));
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
    const res = await run(CHECKER, ["--file", file]);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout).violations, []);
  });

  it("flags an empty central claim and missing score", async () => {
    const file = path.join(cwd, "empty.md");
    fs.writeFileSync(file, "# Roast\n\n## Central claim\n\n## Score\n\n## Findings\n- a\n");
    const res = await run(CHECKER, ["--file", file]);
    assert.equal(res.code, 1);
    const rules = JSON.parse(res.stdout).violations.map((v) => v.rule);
    assert.ok(rules.includes("empty-central-claim"));
    assert.ok(rules.includes("empty-score"));
  });

  it("exits 2 when no report is found", async () => {
    const res = await run(CHECKER, ["--dir", path.join(cwd, "nope")]);
    assert.equal(res.code, 2);
  });

  it("picks the newest report in a directory", async () => {
    fs.writeFileSync(path.join(cwd, "a.md"), FILLED);
    const res = await run(CHECKER, ["--dir", cwd]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(JSON.parse(res.stdout).file, /a\.md$/);
  });
});