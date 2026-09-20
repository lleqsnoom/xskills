"use strict";

const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCENARIO = path.join(__dirname, "..", "skills", "x-analyze", "scripts", "scenario.mjs");

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCENARIO, ...args], { stdio: ["ignore", "pipe", "pipe"], cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "x-analyze-scenario-"));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function start(cwd) {
  const res = await run(["start", "--slug", "demo"], cwd);
  assert.equal(res.code, 0, res.stderr);
  return JSON.parse(res.stdout).dir;
}

function record(cwd, dir, args) {
  return run(["record", "--dir", path.join(cwd, dir), ...args], cwd);
}

function evidence(cwd, dir) {
  return record(cwd, dir, ["--event", "evidence", "--data", "thread count grows", "--target", "src/pool.js:42"]);
}

describe("x-analyze scenario — pure", async () => {
  const m = await import(SCENARIO);

  const pureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "x-analyze-pure-"));
  const state = (slug) => m.createState({ slug, root: path.join(pureRoot, ".x-skills", "runs") });

  after(() => fs.rmSync(pureRoot, { recursive: true, force: true }));

  it("reports the analysis file name inside a run folder", () => {
    const s = state("leak");
    assert.equal(s.report, "E00-analysis.md", "a file name, so the run folder stays portable");
    assert.match(s.runDir, /-leak$/);
    assert.equal(s.node, "intake");
  });

  it("intent_confirmed gates confirm_intent -> research", () => {
    let s = state("a");
    const refused = m.transition(s, "research");
    assert.equal(refused.ok, false);
    assert.match(refused.error, /no edge intake -> research/, "names the node it is at and the one asked for");
    assert.match(refused.error, /from intake you can go to: \w+/, "names the moves that are legal instead");
    s = m.applyEvent(s, { kind: "confirm", data: "yes" });
    s = m.transition(s, "confirm_intent").state;
    assert.equal(m.transition(s, "research").ok, true);
  });

  it("evidence_cited needs a source", () => {
    let s = state("a");
    s = m.applyEvent(s, { kind: "evidence", data: "claim", target: "" });
    assert.equal(m.computeGuards(s).evidence_cited.pass, false);
    s = m.applyEvent(s, { kind: "evidence", data: "claim", target: "src/a.js:1" });
    assert.equal(m.computeGuards(s).evidence_cited.pass, true);
  });

  it("a not-run research lowers confidence", () => {
    let s = state("a");
    assert.equal(s.confidence, "low");
    s = m.applyEvent(s, { kind: "confidence", data: "high" });
    s = m.applyEvent(s, { kind: "research", status: "not-run", reason: "no web access" });
    assert.equal(s.confidence, "low");
    assert.equal(m.computeGuards(s).research_recorded.pass, false);
  });

  it("check_recorded accepts not-run only with a reason", () => {
    let s = state("a");
    s = m.applyEvent(s, { kind: "check", data: "repro.js", status: "not-run" });
    assert.equal(m.computeGuards(s).check_recorded.pass, false);
    s = m.applyEvent(s, { kind: "check", data: "repro.js", status: "not-run", reason: "no shell" });
    assert.equal(m.computeGuards(s).check_recorded.pass, true);
  });
});

describe("x-analyze scenario — CLI", () => {
  let cwd;
  beforeEach(() => {
    cwd = tmp();
  });

  it("start writes the run folder and the analysis report", async () => {
    const dir = await start(cwd);
    assert.ok(fs.existsSync(path.join(cwd, dir, "state.json")));
    assert.ok(fs.existsSync(path.join(cwd, dir, "memory.md")));
    assert.ok(fs.existsSync(path.join(cwd, dir, "E00-analysis.md")));
  });

  it("rejects thesis without evidence and leaves state unchanged", async () => {
    const dir = await start(cwd);
    await record(cwd, dir, ["--event", "confirm", "--data", "yes"]);
    await record(cwd, dir, ["--to", "confirm_intent"]);
    await record(cwd, dir, ["--event", "research", "--data", "looked"]);
    await record(cwd, dir, ["--to", "research"]);
    await record(cwd, dir, ["--to", "clarify"]);
    const file = path.join(cwd, dir, "state.json");
    const before = fs.readFileSync(file, "utf8");
    const res = await record(cwd, dir, ["--to", "thesis"]);
    assert.equal(res.code, 1);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });

  it("reaches a route stop and verify exits 0", async () => {
    const dir = await start(cwd);
    await record(cwd, dir, ["--event", "confirm", "--data", "yes"]);
    await record(cwd, dir, ["--to", "confirm_intent"]);
    await record(cwd, dir, ["--event", "research", "--data", "found the leak"]);
    await record(cwd, dir, ["--to", "research"]);
    await record(cwd, dir, ["--to", "clarify"]);
    await evidence(cwd, dir);
    await record(cwd, dir, ["--to", "thesis"]);
    await record(cwd, dir, ["--event", "check", "--data", "node repro.js", "--reason", "exit 1"]);
    await record(cwd, dir, ["--to", "mechanical_check"]);
    await record(cwd, dir, ["--to", "confidence_gate"]);
    await record(cwd, dir, ["--event", "confidence", "--data", "high"]);
    for (const n of ["A", "B", "C"]) {
      await record(cwd, dir, ["--event", "option", "--data", n]);
    }
    let res = await record(cwd, dir, ["--to", "propose"]);
    assert.equal(res.code, 0, res.stderr);
    await record(cwd, dir, ["--event", "decide", "--data", "A"]);
    res = await record(cwd, dir, ["--to", "route"]);
    assert.equal(res.code, 0, res.stderr);
    await record(cwd, dir, ["--event", "route", "--data", "fix"]);
    const report = path.join(cwd, dir, "E00-analysis.md");
    fs.appendFileSync(report, "\n## Thesis\nleak\n");
    res = await record(cwd, dir, ["--to", "fix"]);
    assert.equal(res.code, 0, res.stderr);
    res = await run(["verify", "--dir", path.join(cwd, dir)], cwd);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).ok, true);
  });

  it("low confidence cannot advance to propose", async () => {
    const dir = await start(cwd);
    await record(cwd, dir, ["--event", "confirm", "--data", "yes"]);
    const state = readJson(path.join(cwd, dir, "state.json"));
    assert.equal(state.report, "E00-analysis.md");
    const res = await record(cwd, dir, ["--to", "propose"]);
    assert.equal(res.code, 1);
  });

  it("advances from a directory other than the one that started the run", async () => {
    const home = await start(cwd);
    const elsewhere = tmp();
    const res = await run(["record", "--dir", path.join(cwd, home), "--event", "confirm", "--data", "yes"], elsewhere);
    assert.equal(res.code, 0, res.stderr);
    const moved = await run(["record", "--dir", path.join(cwd, home), "--to", "confirm_intent"], elsewhere);
    assert.equal(moved.code, 0, moved.stderr);

    const state = readJson(path.join(cwd, home, "state.json"));
    assert.equal(state.node, "confirm_intent", "the node moved");
    const report = path.join(cwd, home, state.report);
    assert.ok(fs.existsSync(report), "the report is still inside the run folder");
    assert.equal(fs.readFileSync(report, "utf8").split("```mermaid").length - 1, 1);
    assert.deepEqual(fs.readdirSync(elsewhere), [], "nothing was written where the command ran");
  });

  it("leaves the node where it was when the report cannot be written", async () => {
    const dir = await start(cwd);
    const file = path.join(cwd, dir, "state.json");
    const state = readJson(file);
    state.report = "E99-nope/deep/E00-analysis.md";
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);

    const res = await record(cwd, dir, ["--event", "evidence", "--data", "lost", "--target", "a:1"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /ENOENT/);

    const after = readJson(file);
    assert.equal(after.events.length, state.events.length, "the state did not advance");
  });
});

describe("x-analyze scenario — the SKILL.md agrees with the script", () => {
  const SKILL_MD = path.join(__dirname, "..", "skills", "x-analyze", "SKILL.md");

  const kindsInSource = () => {
    const source = fs.readFileSync(SCENARIO, "utf8");
    const kinds = new Set();
    for (const match of source.matchAll(/if \(kind === "([a-z]+)"/g)) kinds.add(match[1]);
    for (const match of source.matchAll(/event\.kind === "([a-z]+)"/g)) kinds.add(match[1]);
    return [...kinds].sort();
  };

  it("names every event kind the guards and applyEvent read", () => {
    const kinds = kindsInSource();
    assert.equal(kinds.length, 10, "the source scan found the kinds");
    const skill = fs.readFileSync(SKILL_MD, "utf8");
    const missing = kinds.filter((kind) => !new RegExp("`[^`]*\\b" + kind + "\\b[^`]*`").test(skill));
    assert.deepEqual(missing, [], "a kind the script accepts is not documented, so the gate it feeds will fail");
  });

  it("verify exits 1 with stop false while the run is mid-graph", async () => {
    const cwd = tmp();
    const dir = await start(cwd);
    const res = await run(["verify", "--dir", path.join(cwd, dir)], cwd);
    assert.equal(res.code, 1, "a mid-run verify is not a failure and not a success");
    const out = JSON.parse(res.stdout);
    assert.equal(out.stop, false);
    assert.equal(out.ok, false);
    assert.ok(out.checks.length === 0, "no stop checks apply mid-run");
    assert.ok(Object.values(out.guards).some((guard) => guard.pass), "guards can pass while verify still exits 1");

    const skill = fs.readFileSync(SKILL_MD, "utf8");
    assert.match(skill, /mid-run `verify` exits 1/, "the SKILL.md says so, rather than promising exit 0");
  });
});
