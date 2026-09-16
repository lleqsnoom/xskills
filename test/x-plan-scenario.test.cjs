"use strict";

const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-plan");
const SCENARIO = path.join(SKILL, "scripts", "scenario.mjs");

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCENARIO, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "x-plan-scenario-"));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function start(cwd, slug = "demo") {
  const res = await run(["start", "--slug", slug], cwd);
  assert.equal(res.code, 0, res.stderr);
  const { dir } = JSON.parse(res.stdout);
  return dir;
}

async function record(cwd, dir, args) {
  return run(["record", "--dir", path.join(cwd, dir), ...args], cwd);
}

describe("x-plan scenario — pure", async () => {
  const m = await import(SCENARIO);

  const pureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "x-plan-pure-"));
  const state = (slug) => m.createState({ slug, root: path.join(pureRoot, ".x-skills", "runs") });

  after(() => fs.rmSync(pureRoot, { recursive: true, force: true }));

  it("createState starts at intake with the full graph", () => {
    const s = state("a");
    assert.equal(s.node, "intake");
    assert.ok(s.graph.nodes.includes("handoff"));
    assert.ok(s.graph.edges.some((e) => e.to === "propose"));
  });

  it("three_options gate flips at the third option", () => {
    let s = state("a");
    s = m.applyEvent(s, { kind: "option", data: "one" });
    s = m.applyEvent(s, { kind: "option", data: "two" });
    assert.equal(m.computeGuards(s).three_options.pass, false);
    s = m.applyEvent(s, { kind: "option", data: "three" });
    assert.equal(m.computeGuards(s).three_options.pass, true);
  });

  it("answer closes the matching open question", () => {
    let s = state("a");
    s = m.applyEvent(s, { kind: "question", data: "Which db?" });
    assert.equal(m.computeGuards(s).no_open_questions.pass, false);
    s = m.applyEvent(s, { kind: "answer", target: "Q1", data: "Postgres" });
    assert.equal(m.computeGuards(s).no_open_questions.pass, true);
    assert.equal(s.openQuestions[0].answer, "Postgres");
  });

  it("transition refuses an edge whose guard fails", () => {
    const s = state("a");
    const res = m.transition(s, "clarify");
    assert.equal(res.ok, false);
    assert.equal(res.state.node, "intake");
    assert.match(res.error, /from intake you can go to: \w+/, "a refusal says how to proceed");
  });

  it("renderGraphMermaid emits one line per edge plus the current class", () => {
    const s = state("a");
    const out = m.renderGraphMermaid(s);
    assert.match(out, /```mermaid/);
    assert.match(out, /classDef current/);
    const edgeLines = out.split("\n").filter((l) => l.includes("-->"));
    assert.equal(edgeLines.length, s.graph.edges.length);
  });
});

describe("x-plan scenario — CLI", () => {
  let cwd;
  beforeEach(() => {
    cwd = tmp();
  });

  it("start creates state.json, memory.md, and the report", async () => {
    const dir = await start(cwd);
    assert.ok(fs.existsSync(path.join(cwd, dir, "state.json")));
    assert.ok(fs.existsSync(path.join(cwd, dir, "memory.md")));
    const state = readJson(path.join(cwd, dir, "state.json"));
    assert.equal(state.node, "intake");
    assert.ok(fs.existsSync(path.join(cwd, state.report)));
  });

  it("exits 1 without --slug", async () => {
    const res = await run(["start"], cwd);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /slug/);
  });

  it("status exits 1 without a state.json", async () => {
    const res = await run(["status", "--dir", path.join(cwd, "nope")], cwd);
    assert.equal(res.code, 1);
  });

  it("research_recorded gates research -> clarify", async () => {
    const dir = await start(cwd);
    let res = await record(cwd, dir, ["--to", "research"]);
    assert.equal(res.code, 0, res.stderr);
    res = await record(cwd, dir, ["--to", "clarify"]);
    assert.equal(res.code, 1);
    res = await record(cwd, dir, ["--event", "research", "--data", "found it"]);
    assert.equal(res.code, 0, res.stderr);
    res = await record(cwd, dir, ["--to", "clarify"]);
    assert.equal(res.code, 0, res.stderr);
  });

  it("a rejected transition leaves state.json unchanged", async () => {
    const dir = await start(cwd);
    await record(cwd, dir, ["--to", "research"]);
    const file = path.join(cwd, dir, "state.json");
    const before = fs.readFileSync(file, "utf8");
    const res = await record(cwd, dir, ["--to", "propose"]);
    assert.equal(res.code, 1);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });

  it("memory.md gains one bullet per record", async () => {
    const dir = await start(cwd);
    const file = path.join(cwd, dir, "memory.md");
    const before = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length;
    await record(cwd, dir, ["--event", "note", "--data", "hello"]);
    await record(cwd, dir, ["--event", "note", "--data", "world"]);
    const after = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length;
    assert.equal(after, before + 2);
  });

  it("guard reports three_options and sets the exit code", async () => {
    const dir = await start(cwd);
    let res = await run(["guard", "--dir", path.join(cwd, dir), "--gate", "three_options"], cwd);
    assert.equal(res.code, 1);
    for (const n of ["one", "two", "three"]) {
      await record(cwd, dir, ["--event", "option", "--data", n]);
    }
    res = await run(["guard", "--dir", path.join(cwd, dir), "--gate", "three_options"], cwd);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).pass, true);
  });

  it("reaches handoff and verify exits 0", async () => {
    const dir = await start(cwd);
    const report = path.join(cwd, "report");
    await record(cwd, dir, ["--event", "research", "--data", "done"]);
    await record(cwd, dir, ["--to", "research"]);
    await record(cwd, dir, ["--to", "clarify"]);
    for (const n of ["A", "B", "C"]) {
      await record(cwd, dir, ["--event", "option", "--data", n]);
    }
    let res = await record(cwd, dir, ["--to", "propose"]);
    assert.equal(res.code, 0, res.stderr);
    await record(cwd, dir, ["--event", "decide", "--data", "A"]);
    res = await record(cwd, dir, ["--to", "decide"]);
    assert.equal(res.code, 0, res.stderr);
    res = await record(cwd, dir, ["--to", "spec"]);
    assert.equal(res.code, 0, res.stderr);

    const state = readJson(path.join(cwd, dir, "state.json"));
    fs.writeFileSync(
      path.join(cwd, state.report),
      "# Plan\ncontract: x\ninvariant: y\ntest: z\n## Layers\n- L0\n"
    );
    res = await record(cwd, dir, ["--to", "gate"]);
    assert.equal(res.code, 0, res.stderr);
    res = await record(cwd, dir, ["--to", "handoff"]);
    assert.equal(res.code, 1);
    await record(cwd, dir, ["--event", "approve", "--data", "yes"]);
    res = await record(cwd, dir, ["--to", "handoff"]);
    assert.equal(res.code, 0, res.stderr);
    res = await run(["verify", "--dir", path.join(cwd, dir)], cwd);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).ok, true);
    void report;
  });

  it("renders exactly one Mermaid block after several persists", async () => {
    const dir = await start(cwd);
    const state = readJson(path.join(cwd, dir, "state.json"));
    await record(cwd, dir, ["--event", "research", "--data", "x"]);
    await record(cwd, dir, ["--to", "research"]);
    await record(cwd, dir, ["--to", "clarify"]);
    const text = fs.readFileSync(path.join(cwd, state.report), "utf8");
    assert.equal(text.split("```mermaid").length - 1, 1);
  });
});
