"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-autoreflection");
const SCRIPTS = path.join(SKILL, "scripts");
const READ = path.join(SCRIPTS, "read-session.mjs");
const SCAN = path.join(SCRIPTS, "scan-session.mjs");
const SAVE = path.join(SCRIPTS, "save-reflection.mjs");
const CHECK = path.join(SCRIPTS, "check-reflection.mjs");

function run(script, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], { stdio: ["ignore", "pipe", "pipe"], cwd: options.cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function withTmpDir(prefix, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const text = (value) => ({ type: "text", text: value });
const call = (id, name, input) => ({ type: "tool_call", tool_call_id: id, name, input: JSON.stringify(input) });
const result = (id, name, content) => ({ type: "tool_result", tool_call_id: id, name, content });
const think = (value) => ({ type: "reasoning", thinking: value });

function transcript(messages, skills = []) {
  return {
    meta: { id: "abc123", uuid: "uuid-1", title: "Test Session", created: "2026-01-01T00:00:00Z", modified: "2026-01-01T01:00:00Z", skills },
    messages,
  };
}

describe("x-autoreflection read-session", async () => {
  const mod = await import(READ);

  it("normalizes every part type into the scan shape", () => {
    assert.deepEqual(mod.normalizePart(text("hi")), { type: "text", text: "hi" });
    assert.deepEqual(mod.normalizePart(think("why")), { type: "reasoning", text: "why" });
    assert.deepEqual(mod.normalizePart(call("c1", "bash", { command: "ls" })), {
      type: "tool_call",
      id: "c1",
      name: "bash",
      input: '{"command":"ls"}',
    });
    assert.deepEqual(mod.normalizePart(result("c1", "bash", "done")), {
      type: "tool_result",
      id: "c1",
      name: "bash",
      content: "done",
    });
    assert.deepEqual(mod.normalizePart({ type: "binary", mime_type: "text/markdown", size: 12 }), {
      type: "binary",
      mimeType: "text/markdown",
      size: 12,
    });
    assert.deepEqual(mod.normalizePart({ type: "finish", reason: "stop" }), { type: "finish", reason: "stop" });
    assert.deepEqual(mod.normalizePart({ type: "mystery" }), { type: "mystery" }, "an unknown host part keeps its name");
  });

  it("clips an over-long tool result from both ends", () => {
    const long = `${"a".repeat(2000)}THE-END`;
    const { content } = mod.normalizePart(result("c1", "bash", long), 600);
    assert.ok(content.length <= 601, "clipped to the limit");
    assert.ok(content.startsWith("aaa"), "keeps the head, where the error is");
    assert.ok(content.endsWith("THE-END"), "keeps the tail, where the exit code is");
  });

  it("never clips prose, so a detector sees the whole sentence", () => {
    const long = `${"a".repeat(2000)}${"?".repeat(200)}`;
    assert.equal(mod.normalizePart(text(long), 600).text, long);
  });

  it("never clips a tool_call input, because the scan parses it", () => {
    const input = JSON.stringify({ command: `x${"y".repeat(2000)}` });
    assert.equal(mod.normalizePart(call("c1", "bash", { command: `x${"y".repeat(2000)}` }), 100).input, input);
  });

  it("normalizes a whole session and indexes its messages", () => {
    const session = mod.normalizeSession(
      transcript(
        [
          { role: "user", created: "t0", parts: [text("do it")] },
          { role: "assistant", created: "t1", parts: [text("ok"), call("c1", "bash", { command: "ls" })] },
        ],
        [{ name: "x-plan", description: "plan", loaded_at: "t0" }]
      )
    );
    assert.equal(session.source.host, "crush");
    assert.equal(session.source.id, "abc123");
    assert.deepEqual(session.skills, [{ name: "x-plan", loadedAt: "t0" }]);
    assert.deepEqual(
      session.messages.map((message) => message.index),
      [0, 1]
    );
    assert.equal(session.messages[1].parts[1].name, "bash");
  });

  it("keeps each message's model and provider, and names the session's main model", () => {
    const session = mod.normalizeSession(
      transcript([
        { role: "user", parts: [text("go")] },
        { role: "assistant", model: "deepseek-v4-pro", provider: "Deepseek", parts: [text("a")] },
        { role: "assistant", model: "deepseek-v4-pro", provider: "Deepseek", parts: [text("b")] },
        { role: "assistant", model: "deepseek-v4.1-flash", provider: "hyper-B", parts: [text("title")] },
      ])
    );
    assert.equal(session.messages[1].model, "deepseek-v4-pro");
    assert.equal(session.messages[1].provider, "Deepseek");
    assert.equal("model" in session.messages[0], false, "a message that names no model gets none");
    assert.equal(session.source.model, "deepseek-v4-pro");
    assert.deepEqual(session.source.models, { "deepseek-v4-pro": 2, "deepseek-v4.1-flash": 1 });
  });

  it("carries a host's headless flag, so an automation run is not read as a person", () => {
    const raw = transcript([{ role: "user", parts: [text("classify")] }]);
    assert.equal(mod.normalizeSession({ ...raw, meta: { ...raw.meta, headless: true } }).source.headless, true);
    assert.equal(mod.normalizeSession(raw).source.headless, false);
  });

  it("reports no model when no message names one", () => {
    const session = mod.normalizeSession(transcript([{ role: "assistant", parts: [text("a")] }]));
    assert.equal(session.source.model, null);
    assert.deepEqual(session.source.models, {});
  });

  it("isNormalized tells an export apart from a raw host dump", () => {
    assert.equal(mod.isNormalized(mod.normalizeSession(transcript([]))), true);
    assert.equal(mod.isNormalized(transcript([])), false);
  });

  it("parseArgs reads values, booleans, and drops positions", () => {
    const spec = { booleans: ["list", "full", "help"], known: ["list", "session", "out", "full", "help"] };
    assert.deepEqual(mod.parseArgs(["--session", "last", "--out", "/tmp/x.json"], spec), {
      _: [],
      unknown: [],
      session: "last",
      out: "/tmp/x.json",
    });
    assert.deepEqual(mod.parseArgs(["--list", "--full"], spec), { _: [], unknown: [], list: true, full: true });
    assert.deepEqual(mod.parseArgs(["--out", "--list"], spec), { _: [], unknown: [], out: true, list: true });
    assert.deepEqual(mod.parseArgs(["--nope", "x"], spec), { _: [], unknown: ["nope"] }, "a typo is reported, not ignored");
    assert.deepEqual(mod.parseArgs(["--anything"], {}), { _: [], unknown: [], anything: true }, "no spec means no whitelist");
  });

  it("exports a raw dump to a file and reports what it wrote", async () => {
    await withTmpDir("autoref-read", async (dir) => {
      const raw = path.join(dir, "raw.json");
      const out = path.join(dir, "out.json");
      fs.writeFileSync(raw, JSON.stringify(transcript([{ role: "user", parts: [text("hello")] }])));
      const res = await run(READ, ["--file", raw, "--out", out]);
      assert.equal(res.code, 0, res.stderr);
      const summary = JSON.parse(res.stdout);
      assert.equal(summary.messages, 1);
      assert.equal(summary.title, "Test Session");
      const written = JSON.parse(fs.readFileSync(out, "utf8"));
      assert.equal(written.messages[0].parts[0].text, "hello");
    });
  });

  it("exits 2 with a usage error when no source is given", async () => {
    const res = await run(READ, []);
    assert.equal(res.code, 2);
    assert.match(JSON.parse(res.stderr).error, /--session .* or --file/);
  });
});

describe("x-autoreflection scan-session", async () => {
  const mod = await import(SCAN);
  const read = await import(READ);

  it("strips code but refuses to strip an unclosed fence", () => {
    assert.equal(mod.stripFences("ask `x?` now?"), "ask  now?");
    assert.equal(mod.stripFences("```\nwhy?\n```\nreal?"), "real?");
    const unclosed = "review done. the fix is in `x-fix/SKILL.md:16 and `x-refactor` plus `x-comments` first?";
    assert.equal((unclosed.match(/`/g) || []).length % 2, 1, "this fixture has an unclosed fence");
    assert.equal(mod.stripFences(unclosed), unclosed, "unbalanced fences are left alone");
  });

  it("reads a command and a target out of a tool call", () => {
    assert.equal(mod.commandOf(JSON.stringify({ command: "npm test" })), "npm test");
    assert.equal(mod.commandOf(JSON.stringify({ file_path: "/a.js" })), "");
    assert.equal(mod.commandOf("not json"), "");
    assert.equal(mod.targetOf(JSON.stringify({ file_path: "/a.js" })), "/a.js");
    assert.equal(mod.targetOf(JSON.stringify({ edits: [{ file_path: "/b.js" }] })), "/b.js");
    assert.equal(mod.targetOf(JSON.stringify({ command: "ls" })), "");
  });

  it("treats only a wholly expected-exit command line as expected", () => {
    assert.equal(mod.isExpectedExit("diff a b"), true);
    assert.equal(mod.isExpectedExit("cd /tmp && diff a b"), true);
    assert.equal(mod.isExpectedExit("grep -c x file"), true);
    assert.equal(mod.isExpectedExit("cd /tmp && node run.js"), false);
    assert.equal(mod.isExpectedExit('cd /tmp && D="x" && node run.js'), false);
    assert.equal(mod.isExpectedExit("git diff --stat"), true);
    assert.equal(mod.isExpectedExit(""), false);
  });

  it("judges a pipeline by the stage that reports its status", () => {
    assert.equal(mod.isExpectedExit("cat f | diff - g"), true, "the pipeline reports diff, not cat");
    assert.equal(mod.isExpectedExit("diff a b | tail -1"), false, "the pipeline reports tail here");
    assert.equal(mod.isExpectedExit("diff a b && echo same"), true);
    assert.equal(mod.isExpectedExit("node run.js && grep -c x f"), false, "node could be the one that failed");
    assert.deepEqual(mod.statusCommands("cd /tmp && cat a | diff - b"), ["cd /tmp", "diff - b"]);
  });

  it("finds raw skill mentions, and leaves the filtering to the on-disk names", () => {
    const found = mod.skillMentions("run skills/x-review/scripts/a.js next to x-review and x-reviewer, not x-");
    assert.deepEqual(found.sort(), ["x-review", "x-reviewer"]);
  });

  it("classifies a failed tool result from the host's markers", () => {
    const fail = mod.failureOf(result("c1", "bash", "boom\n\nExit code 1\n<cwd>/tmp</cwd>"), call("c1", "bash", { command: "node x.js" }));
    assert.equal(fail.marker, "tool-failure");
    const expected = mod.failureOf(result("c2", "bash", "1c1\n---\n\nExit code 1\n<cwd>/tmp</cwd>"), call("c2", "bash", { command: "diff a b" }));
    assert.equal(expected.marker, "expected-exit");
    const edit = mod.failureOf(result("c3", "edit", "old_string not found in file. Make sure it matches exactly"), call("c3", "edit", { file_path: "/a.js" }));
    assert.equal(edit.marker, "tool-failure");
    assert.equal(edit.subject, "/a.js");
    assert.equal(mod.failureOf(result("c4", "bash", "all good\n<cwd>/tmp</cwd>"), call("c4", "bash", { command: "ls" })), null);
    assert.equal(mod.failureOf(result("c5", "view", "<file>\nError: not a failure\n</file>"), { type: "tool_call", name: "view", input: "{}" }), null);
  });

  it("flags failures that name a skill, and stays quiet about its own", () => {
    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("make it work")] },
        { role: "assistant", parts: [text("running the skill script"), call("c1", "bash", { command: "node skills/x-example/scripts/save.js --topic a" })] },
        { role: "tool", parts: [result("c1", "bash", "boom\n\nExit code 1\n<cwd>/tmp</cwd>")] },
        { role: "assistant", parts: [text("retrying"), call("c2", "bash", { command: "node skills/x-example/scripts/save.js --topic a" })] },
        { role: "tool", parts: [result("c2", "bash", "boom\n\nExit code 1\n<cwd>/tmp</cwd>")] },
        { role: "assistant", parts: [text("unrelated"), call("c3", "bash", { command: "node scripts/probe.js" })] },
        { role: "tool", parts: [result("c3", "bash", "nope\n\nExit code 1\n<cwd>/tmp</cwd>")] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    const failure = scan.signals.find((signal) => signal.kind === "tool-failure" && signal.summary.includes("x-example"));
    assert.equal(failure.severity, "high");
    assert.deepEqual(failure.suspects, ["x-example"]);
    assert.equal(failure.count, 2, "the same failing command is one signal");
    assert.equal(failure.evidence.length, 2);
    const own = scan.signals.find((signal) => signal.summary.includes("probe.js"));
    assert.equal(own.severity, "low", "no skill named, one attempt");
    assert.equal(own.suspects.length, 0);
    assert.equal(scan.stats.toolFailures, 3);
    assert.equal(scan.stats.repeats, 1);
  });

  it("catches nudges, corrections, prose questions, and unused skills", () => {
    const session = read.normalizeSession(
      transcript(
        [
          { role: "user", parts: [text("build the thing with x-plan")] },
          { role: "assistant", parts: [text("Working on it.\n\nWant me to continue?")] },
          { role: "user", parts: [text("continue")] },
          { role: "assistant", parts: [text("Done.\n\nShould I commit?")] },
          { role: "user", parts: [text("no, that is not what I asked")] },
          { role: "user", parts: [text("again")] },
        ],
        [{ name: "x-plan", loaded_at: "t0" }, { name: "x-ghost", loaded_at: "t0" }]
      )
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    const kinds = scan.signals.map((signal) => signal.kind);
    assert.ok(kinds.includes("user-reprompt"));
    assert.ok(kinds.includes("user-correction"));
    assert.ok(kinds.includes("prose-question"));
    assert.ok(kinds.includes("skill-unused"));
    assert.equal(scan.stats.reprompts, 2);
    assert.equal(scan.stats.corrections, 1);
    assert.equal(scan.stats.proseQuestions, 2);
    assert.deepEqual(scan.skills.unused, ["x-ghost"]);
    const prose = scan.signals.find((signal) => signal.kind === "prose-question");
    assert.equal(prose.evidence[0].message, 1);
    assert.match(prose.evidence[0].excerpt, /Want me to continue\?/);
  });

  it("does not count a skill as used because a listing or an injected skill body names it", () => {
    const session = read.normalizeSession(
      transcript(
        [
          { role: "user", parts: [text("improve the reflection")] },
          { role: "assistant", parts: [text("looking around"), call("c1", "bash", { command: "ls skills/" })] },
          { role: "tool", parts: [result("c1", "bash", "x-anal\nx-plan\nx-review\n<cwd>/repo</cwd>")] },
          { role: "user", parts: [text("Base directory for this skill: /home/u/.claude/skills/x-anal\n\n# X-Anal\nroute to x-fix or x-plan")] },
          { role: "assistant", parts: [text("using x-anal now"), call("c2", "bash", { command: "node skills/x-anal/scripts/scenario.mjs start" })] },
        ],
        [{ name: "x-anal", loaded_at: "t0" }, { name: "x-review", loaded_at: "t0" }]
      )
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    assert.deepEqual(scan.skills.used, ["x-anal"]);
    assert.deepEqual(scan.skills.unused, ["x-review"], "a directory listing is not use");
    assert.deepEqual(scan.skills.mentioned, ["x-anal", "x-fix", "x-plan", "x-review"]);
  });

  it("hears a redo request and a handoff, and a skill script that exits 0 and prints nothing", () => {
    const session = read.normalizeSession(
      transcript(
        [
          { role: "user", parts: [text("I am not happy, do a deep research with online sources in multiple loops")] },
          { role: "assistant", model: "deepseek-v4-pro", parts: [text("loading"), call("c1", "view", { file_path: "/home/u/.claude/skills/x-research/SKILL.md" })] },
          { role: "tool", parts: [result("c1", "view", "# X-Research")] },
          { role: "assistant", model: "deepseek-v4-pro", parts: [call("c2", "bash", { command: "node /home/u/.claude/skills/x-research/scripts/state.mjs start --slug a" })] },
          { role: "tool", parts: [result("c2", "bash", "\n<cwd>/repo</cwd>")] },
          { role: "assistant", model: "deepseek-v4-pro", parts: [call("c3", "bash", { command: "node /home/u/.claude/skills/x-research/scripts/state.mjs start --slug b" })] },
          { role: "tool", parts: [result("c3", "bash", "no output")] },
          { role: "assistant", model: "deepseek-v4-pro", parts: [text("Done. Deep research complete.")] },
          { role: "user", parts: [text("Do another full round for that analysis, read internet sources, again check the article")] },
          { role: "assistant", model: "deepseek-v4-pro", parts: [text("Round two done.")] },
          { role: "user", parts: [text("make it as LLM prompt so i can pass it to another agent")] },
        ],
        [{ name: "x-research", loaded_at: "t0" }]
      )
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    const byKind = Object.fromEntries(scan.signals.map((signal) => [signal.kind, signal]));
    assert.deepEqual(byKind["user-redo"].suspects, ["x-research"], "owned by the skill active before the turn");
    assert.equal(byKind["user-redo"].severity, "high");
    assert.equal(byKind["user-redo"].evidence[0].message, 8);
    assert.deepEqual(byKind["user-handoff"].suspects, ["x-research"]);
    assert.equal(byKind["user-handoff"].evidence[0].message, 10);
    assert.equal(byKind["skill-script-silent"].count, 2, "the same silent script is one signal");
    assert.deepEqual(byKind["skill-script-silent"].suspects, ["x-research"]);
    assert.equal(byKind["user-correction"], undefined, "none of these starts with a correction word");
    assert.deepEqual(scan.request, { message: 0, created: null, text: "I am not happy, do a deep research with online sources in multiple loops" });
    assert.equal(scan.source.model, "deepseek-v4-pro");
  });

  it("hears a rejected tool call and an interrupt, and blames the skill that asked", () => {
    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("do an analysis of the source file, the prompt is attached")] },
        { role: "assistant", parts: [call("c1", "Skill", { skill: "x-anal" })] },
        { role: "user", parts: [result("c1", "Skill", "Launching skill: x-anal")] },
        { role: "user", parts: [text("Base directory for this skill: /home/u/.claude/skills/x-anal\n\n# X-Anal")] },
        { role: "assistant", parts: [call("c2", "AskUserQuestion", { questions: [] })] },
        { role: "user", parts: [result("c2", "AskUserQuestion", "The user doesn't want to proceed with this tool use. The tool use was rejected.")] },
        { role: "user", parts: [text("[Request interrupted by user for tool use]")] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    const rejected = scan.signals.find((signal) => signal.kind === "tool-rejected");
    assert.equal(rejected.severity, "high");
    assert.deepEqual(rejected.suspects, ["x-anal"]);
    assert.equal(rejected.evidence[0].message, 5);
    const interrupt = scan.signals.find((signal) => signal.kind === "interrupt");
    assert.equal(interrupt.severity, "low", "an interrupt says the user stopped the agent, not why");
    assert.equal(scan.stats.rejections, 1);
    assert.equal(scan.stats.interrupts, 1);
  });

  it("does not hand ownership to a skill a written document merely mentions", () => {
    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("write the plan for the reflection skills please, in markdown")] },
        { role: "assistant", parts: [call("c1", "view", { file_path: "/home/u/.claude/skills/x-plan/SKILL.md" })] },
        { role: "tool", parts: [result("c1", "view", "# X-Plan")] },
        { role: "assistant", parts: [call("c2", "write", { file_path: "/repo/E01-plan.md", content: "edit skills/x-autoreflection/scripts/scan-session.mjs" })] },
        { role: "tool", parts: [result("c2", "write", "written")] },
        { role: "user", parts: [text("make it as LLM prompt so i can pass it to another agent")] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    assert.deepEqual(scan.signals.find((signal) => signal.kind === "user-handoff").suspects, ["x-plan"]);
  });

  it("does not count a rejection that a tool output only quotes", () => {
    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("show me what that session did before the interrupt please")] },
        { role: "assistant", parts: [call("c1", "bash", { command: "node inspect.mjs" })] },
        { role: "user", parts: [result("c1", "bash", "#47 RESULT \"The user doesn't want to proceed with this tool use.\"")] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    assert.equal(scan.signals.some((signal) => signal.kind === "tool-rejected"), false);
  });

  it("adds the model-read pushback as its own unvalidated kind, without counting a phrase-caught turn twice", () => {
    const session = read.normalizeSession(
      transcript(
        [
          { role: "user", parts: [text("build the dashboard with four variants of the same data please")] },
          { role: "assistant", parts: [text("Four variants are ready."), call("c1", "bash", { command: "node skills/x-ui/scripts/audit.mjs" })] },
          { role: "tool", parts: [result("c1", "bash", "ok")] },
          { role: "assistant", parts: [text("Done.")] },
          { role: "user", parts: [text("you just removed the original bio, i did not ask for it")] },
          { role: "assistant", parts: [text("Restored.")] },
          { role: "user", parts: [text("still too long, do it again from scratch")] },
        ],
        [{ name: "x-ui", loaded_at: "t0" }]
      )
    );
    const turns = [
      { message: 4, class: "pushback" },
      { message: 6, class: "redo" },
    ];
    const scan = mod.scanSession(session, { skillNames: [], turns });
    const pushback = scan.signals.find((signal) => signal.kind === "user-pushback");
    assert.equal(pushback.severity, "medium", "model-read and unvalidated");
    assert.deepEqual(pushback.evidence.map((entry) => entry.message), [4], "msg 6 is already a user-redo");
    assert.match(pushback.evidence[0].excerpt, /^\[pushback\]/);
    assert.deepEqual(pushback.suspects, ["x-ui"]);
    assert.equal(scan.stats.pushback, 1);
    assert.ok(scan.signals.some((signal) => signal.kind === "user-redo"));
  });

  it("reads the turns file from the command line", async () => {
    await withTmpDir("autoref-turns", async (dir) => {
      const raw = path.join(dir, "raw.json");
      const turnsFile = path.join(dir, "turns.json");
      fs.writeFileSync(
        raw,
        JSON.stringify(
          transcript([
            { role: "user", parts: [text("write the report for the skills with every detail please")] },
            { role: "assistant", parts: [text("Report written.")] },
            { role: "user", parts: [text("that is TOO long, ten seconds to scan is the max")] },
          ])
        )
      );
      fs.writeFileSync(turnsFile, JSON.stringify({ turns: [{ message: 2, class: "pushback" }] }));
      const res = await run(SCAN, ["--file", raw, "--turns", turnsFile], { cwd: dir });
      assert.equal(res.code, 0, res.stderr);
      assert.ok(JSON.parse(res.stdout).signals.some((signal) => signal.kind === "user-pushback"));
    });
  });

  it("marks a session that ends on the agent's answer as abandoned, and not one waiting on the user", () => {
    const abandoned = read.normalizeSession(
      transcript(
        [
          { role: "user", parts: [text("research the report app data flow and write up what you find")] },
          { role: "assistant", parts: [text("reading the server"), call("c1", "view", { file_path: "/repo/scripts/report-server.mjs" })] },
          { role: "tool", parts: [result("c1", "view", "server")] },
          { role: "assistant", parts: [text("reading the app"), call("c2", "view", { file_path: "/repo/tools/report-app/src/App.tsx" })] },
          { role: "tool", parts: [result("c2", "view", "app")] },
          { role: "assistant", parts: [text("The server reads the packs, the app fetches /api/day. Nothing caches across days.")] },
        ],
        [{ name: "x-anal", loaded_at: "t0" }]
      )
    );
    const scan = mod.scanSession(abandoned, { skillNames: [] });
    const abandon = scan.signals.find((signal) => signal.kind === "user-abandon");
    assert.ok(abandon, "a substantial request answered and never replied to");
    assert.equal(abandon.severity, "low", "a weak implicit signal; the composite decides");
    assert.deepEqual(abandon.suspects, ["x-anal"]);
    assert.equal(abandon.evidence[0].message, 5);

    const waiting = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("research the report app data flow and write up what you find")] },
        { role: "assistant", parts: [text("reading"), call("c1", "view", { file_path: "/repo/scripts/report-server.mjs" })] },
        { role: "tool", parts: [result("c1", "view", "server")] },
        { role: "assistant", parts: [text("I found two flows.\n\nWhich one should I trace first?")] },
      ])
    );
    assert.equal(
      mod.scanSession(waiting, { skillNames: [] }).signals.some((signal) => signal.kind === "user-abandon"),
      false,
      "an answer that ends on a question waits on the user"
    );

    const trivial = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("hi there")] },
        { role: "assistant", parts: [text("Hello! What are we working on today?")] },
      ])
    );
    assert.equal(
      mod.scanSession(trivial, { skillNames: [] }).signals.some((signal) => signal.kind === "user-abandon"),
      false,
      "no substantial request, no abandonment"
    );

    const userLast = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("research the report app data flow and write up what you find")] },
        { role: "assistant", parts: [text("reading"), call("c1", "view", { file_path: "/repo/scripts/report-server.mjs" })] },
        { role: "tool", parts: [result("c1", "view", "server")] },
        { role: "user", parts: [text("also check the panel while you are at it please")] },
      ])
    );
    assert.equal(
      mod.scanSession(userLast, { skillNames: [] }).signals.some((signal) => signal.kind === "user-abandon"),
      false,
      "the user speaking last is work in progress, not abandonment"
    );
  });

  it("counts a Crush turn the user canceled as an interrupt", () => {
    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("go")] },
        { role: "assistant", parts: [text("working"), { type: "finish", reason: "canceled" }] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    assert.equal(scan.signals.find((signal) => signal.kind === "interrupt").evidence[0].message, 1);
  });

  it("does not call a script silent when its output was sent to a file", () => {
    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("go")] },
        { role: "assistant", parts: [call("c1", "bash", { command: "node skills/x-roast/scripts/score.mjs --profile a > out/E00-critique.json" })] },
        { role: "tool", parts: [result("c1", "bash", "no output")] },
        { role: "assistant", parts: [call("c2", "bash", { command: "node skills/x-plan/scripts/scenario.mjs record --dir r >/dev/null || echo FAILED" })] },
        { role: "tool", parts: [result("c2", "bash", "")] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    assert.equal(scan.signals.some((signal) => signal.kind === "skill-script-silent"), false);
  });

  it("does not call a question in prose when a panel was rendered", () => {
    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("pick one")] },
        { role: "assistant", parts: [text("Which one?"), call("q1", "question", { questions: [] })] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    assert.equal(scan.stats.proseQuestions, 0);
    assert.equal(scan.stats.panels, 1);
  });

  it("reports no signals for a quiet session, and says why", () => {
    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("check the tests")] },
        { role: "assistant", parts: [call("c1", "bash", { command: "npm test" })] },
        { role: "tool", parts: [result("c1", "bash", "548 passing\n<cwd>/repo</cwd>")] },
        { role: "assistant", parts: [text("All green.")] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    assert.deepEqual(scan.signals, []);
    assert.equal(scan.stats.messages, 4);
    assert.ok(scan.notes.some((note) => note.includes("high means the failing call names a skill")));
  });

  it("only reports skill names that exist on disk", async () => {
    await withTmpDir("autoref-skills", async (dir) => {
      fs.mkdirSync(path.join(dir, "x-real"));
      fs.mkdirSync(path.join(dir, "not-a-skill"));
      assert.deepEqual(mod.skillNamesOnDisk(dir).names, ["x-real"]);
      const session = read.normalizeSession(
        transcript([
          { role: "user", parts: [text("go")] },
          { role: "assistant", parts: [text("x-real and x-made-up and x-gho"), call("c1", "bash", { command: "node skills/x-real/scripts/a.js" })] },
          { role: "tool", parts: [result("c1", "bash", "boom\n\nExit code 1\n<cwd>/tmp</cwd>")] },
        ])
      );
      const scan = mod.scanSession(session, { skillNames: mod.skillNamesOnDisk(dir).names, skillsSource: dir });
      assert.equal(scan.skillsSource, dir);
      assert.deepEqual(scan.skills.used, ["x-real"]);
      const failure = scan.signals.find((signal) => signal.kind === "tool-failure");
      assert.deepEqual(failure.suspects, ["x-real"], "the invented name is dropped");
    });
  });

  it("collects the files the session wrote, so hand-edits can be attributed later", () => {
    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("rename the setting in the config and the docs please")] },
        { role: "assistant", parts: [call("c1", "edit", { file_path: "/repo/config.json" })] },
        { role: "tool", parts: [result("c1", "edit", "ok")] },
        { role: "assistant", parts: [call("c2", "write", { file_path: "/repo/docs/config.md" })] },
        { role: "tool", parts: [result("c2", "write", "ok")] },
        { role: "assistant", parts: [call("c3", "view", { file_path: "/repo/src/app.ts" })] },
        { role: "tool", parts: [result("c3", "view", "code")] },
        { role: "assistant", parts: [call("c4", "edit", { file_path: "/repo/config.json" })] },
        { role: "tool", parts: [result("c4", "edit", "ok")] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    assert.deepEqual(scan.writes, [
      { path: "/repo/config.json", message: 1 },
      { path: "/repo/docs/config.md", message: 3 },
    ], "write tools only, each path once, at its first write");
  });

  it("collects the run folders and artifacts the session touched", () => {    const session = read.normalizeSession(
      transcript([
        { role: "user", parts: [text("go")] },
        {
          role: "assistant",
          parts: [
            text("Writing into .x-skills/runs/2026-01-01-0900-R01-my-topic/"),
            call("c1", "bash", { command: "ls .x-skills/runs/2026-01-01-0900-R01-my-topic/" }),
          ],
        },
        { role: "tool", parts: [result("c1", "bash", "E00-plan.md\nE01-epic.md\nstate.json\n<cwd>/repo</cwd>")] },
      ])
    );
    const scan = mod.scanSession(session, { skillNames: [] });
    assert.deepEqual(scan.runFolders, ["2026-01-01-0900-R01-my-topic"]);
    assert.deepEqual(scan.artifacts, ["E00-plan", "E01-epic"]);
  });

  it("scans from the CLI and writes the result", async () => {
    await withTmpDir("autoref-scan", async (dir) => {
      const raw = path.join(dir, "raw.json");
      const out = path.join(dir, "signals.json");
      fs.writeFileSync(
        raw,
        JSON.stringify(
          transcript([
            { role: "user", parts: [text("go")] },
            { role: "assistant", parts: [call("c1", "bash", { command: "npm test" })] },
            { role: "tool", parts: [result("c1", "bash", "boom\n\nExit code 1\n<cwd>/tmp</cwd>")] },
          ])
        )
      );
      const res = await run(SCAN, ["--file", raw, "--out", out], { cwd: dir });
      assert.equal(res.code, 0, res.stderr);
      assert.equal(JSON.parse(res.stdout).signals, 1);
      const written = JSON.parse(fs.readFileSync(out, "utf8"));
      assert.equal(written.stats.toolFailures, 1);
    });
  });
});

describe("x-autoreflection save-reflection", async () => {
  it("writes E00 into a fresh run folder and reports the path", async () => {
    await withTmpDir("autoref-save", async (dir) => {
      const res = await run(SAVE, ["--slug", "my-topic", "--session", "My Session"], { cwd: dir });
      assert.equal(res.code, 0, res.stderr);
      const { path: file, created } = JSON.parse(res.stdout);
      assert.equal(created, true);
      assert.match(file, /2026-\d\d-\d\d-\d{4}-R01-my-topic\/E00-reflection\.md$/);
      assert.match(fs.readFileSync(file, "utf8"), /# Reflection — My Session/);
    });
  });

  it("numbers the next artifact in the same run, and honours --new-run and --run", async () => {
    await withTmpDir("autoref-runs", async (dir) => {
      const first = JSON.parse((await run(SAVE, ["--slug", "t", "--session", "S"], { cwd: dir })).stdout);
      const second = JSON.parse((await run(SAVE, ["--slug", "t", "--session", "S"], { cwd: dir })).stdout);
      assert.match(first.path, /E00-reflection\.md$/);
      assert.match(second.path, /E01-reflection\.md$/);
      const fresh = JSON.parse((await run(SAVE, ["--slug", "t", "--session", "S", "--new-run"], { cwd: dir })).stdout);
      assert.match(fresh.path, /-R02-t\/E00-reflection\.md$/);
      const joined = JSON.parse((await run(SAVE, ["--slug", "t", "--session", "S", "--run", "01"], { cwd: dir })).stdout);
      assert.match(joined.path, /-R01-t\/E02-reflection\.md$/);
    });
  });

  it("refuses to guess between two runs of the same slug", async () => {
    await withTmpDir("autoref-ambiguous", async (dir) => {
      await run(SAVE, ["--slug", "t", "--session", "S"], { cwd: dir });
      await run(SAVE, ["--slug", "t", "--session", "S", "--new-run"], { cwd: dir });
      const res = await run(SAVE, ["--slug", "t", "--session", "S"], { cwd: dir });
      assert.equal(res.code, 2);
      assert.match(JSON.parse(res.stderr).error, /2 runs match "t"; pass --run <nn> to pick one, or --new-run/);
    });
  });

  it("requires a session title", async () => {
    await withTmpDir("autoref-nosession", async (dir) => {
      const res = await run(SAVE, ["--slug", "t"], { cwd: dir });
      assert.equal(res.code, 2);
      assert.match(JSON.parse(res.stderr).error, /--session <title> is required/);
    });
  });
});

describe("x-autoreflection check-reflection", async () => {
  const mod = await import(CHECK);

  const SCAN_JSON = {
    source: { host: "crush", id: "abc123", title: "Test Session" },
    stats: { messages: 12, toolCalls: 5, toolFailures: 1 },
    signals: [
      { id: "S1", severity: "high", kind: "tool-failure" },
      { id: "S2", severity: "low", kind: "expected-exit" },
    ],
  };

  function filled(overrides = {}) {
    return [
      "# Reflection — Test Session",
      "",
      "**Session:** abc123 · 2026-01-01 00:00 → 2026-01-01 01:00",
      "**Messages:** 20 · **Tool calls:** 9 · **Tool failures:** 1 · **Panels asked:** 1",
      "",
      "## Signals",
      "",
      "```json",
      '{"signals":[{"id":"S1","severity":"high"}]}',
      "```",
      "",
      "## Gaps",
      "",
      "- **S1 (high, kept)** — the skill documents a flag the script rejects. `x-example/SKILL.md:64`",
      "- **S2 (low, dropped)** — diff exited 1 because the files differ",
      "",
      "## Proposals",
      "",
      "### P1 — doc-command-drift: teach the SKILL.md the flag the script has",
      "**Signal:** S1",
      "**Target:** `skills/x-example/SKILL.md:64`",
      "**Change:** replace `--topic` with `--slug`.",
      "**Check:** `node skills/x-skill-lint/scripts/lint.mjs` exits 0.",
      "",
      "## Routes",
      "",
      "- P1 → direct edit, then `x-skill-lint`",
      "",
      ...(overrides.extra ?? []),
    ].join("\n");
  }

  const REPO = path.join(__dirname, "..");
  const QUALITY_SCAN = {
    source: { host: "crush", id: "908228ee", title: "research" },
    stats: { messages: 140, toolCalls: 76 },
    signals: [{ id: "S2", severity: "high", kind: "user-redo" }],
  };
  const QUALITY_TRANSCRIPT = {
    messages: [{ index: 119, role: "user", parts: [{ type: "text", text: "Do another full round for that analysis - read internet sources, again check the article" }] }],
  };

  function qualityReflection({ quote = "read internet sources, again check the article", ref = "`skills/x-research/SKILL.md:1` \"name: x-research\"", watch = true, line = true } = {}) {
    return [
      "# Reflection — research",
      "",
      "**Session:** 908228ee · 2026-09-18 18:04 → 18:24",
      "",
      "## Signals",
      "",
      "```json",
      '{"signals":[{"id":"S2","severity":"high","kind":"user-redo"}]}',
      "```",
      "",
      "## Gaps",
      "",
      "- **S2 (high, kept)** — the user asked for the research again; the loop read abstracts only.",
      "",
      "## Quality",
      "",
      ...(line ? [`- **S2** — user: "${quote}" — skill: ${ref}`] : []),
      "",
      "## Proposals",
      "",
      "### P1 — depth-floor: every loop adds a source read in full",
      "**Signal:** S2",
      "**Target:** `skills/x-research/SKILL.md:1`",
      "**Change:** add the depth rule.",
      "**Check:** `node --test test/x-research.test.cjs` exits 0.",
      ...(watch ? ["**Watch:** x-research user-redo per session on deepseek-v4-pro, next 14 days"] : []),
      "",
      "## Routes",
      "",
      "- P1 → direct edit",
      "",
    ].join("\n");
  }

  it("passes a quality gap whose quote is in the transcript and whose skill line is where it says", () => {
    const result = mod.lintReflection(qualityReflection(), QUALITY_SCAN, { transcript: QUALITY_TRANSCRIPT, root: REPO });
    assert.deepEqual(result.violations, []);
  });

  it("wants a Quality line for every kept quality anchor", () => {
    const rules = mod.lintReflection(qualityReflection({ line: false }), QUALITY_SCAN, { transcript: QUALITY_TRANSCRIPT, root: REPO }).violations.map((v) => v.rule);
    assert.ok(rules.includes("quality-unanchored"), rules.join(", "));
  });

  it("refuses a quote the transcript does not contain", () => {
    const rules = mod.lintReflection(qualityReflection({ quote: "this is too shallow" }), QUALITY_SCAN, { transcript: QUALITY_TRANSCRIPT, root: REPO }).violations.map((v) => v.rule);
    assert.ok(rules.includes("quality-quote"), rules.join(", "));
  });

  it("refuses a skill line that is not where the reflection says", () => {
    const missing = mod.lintReflection(qualityReflection({ ref: "`skills/x-research/NOPE.md:3` \"x\"" }), QUALITY_SCAN, { transcript: QUALITY_TRANSCRIPT, root: REPO });
    assert.ok(missing.violations.some((v) => v.rule === "quality-skill-line"));
    const wrong = mod.lintReflection(qualityReflection({ ref: "`skills/x-research/SKILL.md:1` \"never written there\"" }), QUALITY_SCAN, { transcript: QUALITY_TRANSCRIPT, root: REPO });
    assert.ok(wrong.violations.some((v) => v.rule === "quality-skill-line"));
  });

  it("asks a quality proposal what number it expects to move", () => {
    const rules = mod.lintReflection(qualityReflection({ watch: false }), QUALITY_SCAN, { transcript: QUALITY_TRANSCRIPT, root: REPO }).violations.map((v) => v.rule);
    assert.ok(rules.includes("quality-watch"), rules.join(", "));
  });

  it("checks quotes against the transcript given on the command line", async () => {
    await withTmpDir("autoref-quality", async (dir) => {
      const file = path.join(dir, "E00-reflection.md");
      const scan = path.join(dir, "signals.json");
      const transcriptFile = path.join(dir, "session.json");
      fs.writeFileSync(file, qualityReflection({ quote: "this is too shallow" }));
      fs.writeFileSync(scan, JSON.stringify(QUALITY_SCAN));
      fs.writeFileSync(transcriptFile, JSON.stringify(QUALITY_TRANSCRIPT));
      const res = await run(CHECK, ["--file", file, "--scan", scan, "--transcript", transcriptFile], { cwd: REPO });
      assert.equal(res.code, 1);
      assert.ok(JSON.parse(res.stdout).violations.some((v) => v.rule === "quality-quote"));
    });
  });

  it("passes a filled reflection against its scan", () => {
    const result = mod.lintReflection(filled(), SCAN_JSON);
    assert.deepEqual(result.violations, []);
    assert.equal(result.checked, true);
    assert.deepEqual(result.highSignals, ["S1"]);
  });

  it("fails every rule on the generated template", () => {
    const result = mod.lintReflection(
      [
        "# Reflection — Test Session",
        "",
        "**Session:** <id> · <created> → <modified>",
        "<!-- fill me -->",
        "",
        "## Signals",
        "",
        "## Gaps",
        "",
        "## Proposals",
        "",
        "## Routes",
        "",
      ].join("\n"),
      SCAN_JSON
    );
    const rules = result.violations.map((violation) => violation.rule);
    for (const rule of ["template-comment", "no-source", "no-signals", "empty-gaps", "empty-proposals", "empty-routes"]) {
      assert.ok(rules.includes(rule), `expected ${rule}, got ${rules.join(", ")}`);
    }
  });

  it("accepts a finding no signal covers, marked manual", () => {
    const text = filled()
      .replace(
        "- **S2 (low, dropped)** — diff exited 1 because the files differ",
        "- **S2 (low, dropped)** — diff exited 1 because the files differ\n- **manual (medium, kept)** — a command succeeded and returned a wrong scope"
      )
      .replace("**Signal:** S1", "**Signal:** S1, manual");
    const result = mod.lintReflection(text, SCAN_JSON);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.proposals[0].signals, ["S1", "manual"]);
  });

  it("demands a scan, so the gate cannot pass vacuously", () => {
    const result = mod.lintReflection(filled(), null);
    assert.ok(result.violations.some((violation) => violation.rule === "missing-scan"));
    assert.equal(result.checked, false);
  });

  it("demands a verdict for every high signal", () => {
    const text = filled().replace(/^- \*\*S1 \(high, kept\)\*\*.*$/m, "- **S2 (low, dropped)** — nothing to do");
    const result = mod.lintReflection(text, SCAN_JSON);
    assert.ok(result.violations.some((violation) => violation.rule === "unanswered-high"));
  });

  it("demands a proposal for a signal that was kept", () => {
    const text = filled().replace("**Signal:** S1", "**Signal:** S2");
    const result = mod.lintReflection(text, SCAN_JSON);
    assert.ok(result.violations.some((violation) => violation.rule === "kept-without-proposal"));
  });

  it("lets low signals share a verdict, but never a high one", () => {
    const text = filled()
      .replace(
        "- **S2 (low, dropped)** — diff exited 1 because the files differ",
        "- **group (low, dropped)** — S2 and the repeats"
      )
      .replace("**Signal:** S1", "**Signal:** S1");
    const shared = mod.lintReflection(text, SCAN_JSON);
    assert.deepEqual(shared.violations, [], "a low signal may be answered in a group");
    assert.equal(shared.checked, true);

    const hidden = filled()
      .replace(/- \*\*S1 \(high, kept\)\*\*.*$/m, "- **group (high, dropped)** — S1 and others")
      .replace("**Signal:** S1", "**Signal:** S2");
    const caught = mod.lintReflection(hidden, SCAN_JSON);
    assert.ok(
      caught.violations.some((violation) => violation.rule === "unanswered-high"),
      "a high signal cannot be quietened by bundling it into a group"
    );
  });

  it("refuses a scan that is not evidence of a session", () => {
    const bare = { signals: [{ id: "S1", severity: "high", kind: "tool-failure" }] };
    const result = mod.lintReflection(filled(), bare);
    assert.ok(result.violations.some((violation) => violation.rule === "scan-not-evidence"));
    const emptySession = { stats: { messages: 0, toolCalls: 0 }, signals: [] };
    const silent = mod.lintReflection(filled(), emptySession);
    assert.ok(silent.violations.some((violation) => violation.rule === "scan-not-evidence"));
  });

  it("rejects a verdict outside the three allowed ones", () => {
    const text = filled().replace("(high, kept)", "(high, maybe)");
    const result = mod.lintReflection(text, SCAN_JSON);
    assert.ok(result.violations.some((violation) => violation.rule === "bad-verdict"));
  });

  it("rejects a proposal that is missing a field", () => {
    const text = filled().replace(/^\*\*Check:\*\*.*$/m, "**Check:**");
    const result = mod.lintReflection(text, SCAN_JSON);
    const violation = result.violations.find((entry) => entry.rule === "proposal-shape");
    assert.equal(violation.proposal, "P1");
    assert.match(violation.detail, /Check/);
  });

  it("rejects a proposal that cites a signal the scan does not have", () => {
    const text = filled().replace("**Signal:** S1", "**Signal:** S9");
    const result = mod.lintReflection(text, SCAN_JSON);
    assert.ok(result.violations.some((violation) => violation.rule === "unknown-signal"));
  });

  it("reads the scan from beside the reflection and exits 1 on a template", async () => {
    await withTmpDir("autoref-check", async (dir) => {
      const saved = JSON.parse((await run(SAVE, ["--slug", "t", "--session", "S"], { cwd: dir })).stdout);
      fs.writeFileSync(path.join(path.dirname(saved.path), "signals.json"), JSON.stringify(SCAN_JSON));
      const template = await run(CHECK, ["--file", saved.path], { cwd: dir });
      assert.equal(template.code, 1);
      assert.ok(JSON.parse(template.stdout).violations.length > 0);
      fs.writeFileSync(saved.path, filled());
      const good = await run(CHECK, ["--file", saved.path], { cwd: dir });
      assert.equal(good.code, 0, good.stdout);
    });
  });

  it("exits 2 when there is nothing to check", async () => {
    await withTmpDir("autoref-empty", async (dir) => {
      const res = await run(CHECK, ["--file", path.join(dir, "missing.md")], { cwd: dir });
      assert.equal(res.code, 2);
      assert.match(JSON.parse(res.stderr).error, /no reflection file found/);
    });
  });
});

describe("x-autoreflection registration", () => {
  it("ships a SKILL.md whose name matches its folder and the README table", () => {
    const skillMd = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
    assert.match(skillMd, /^name: x-autoreflection$/m);
    const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
    assert.ok(/^\|\s*`x-autoreflection`\s*\|/m.test(readme), "listed in the README skills table");
  });

  it("carries the shared question files byte-identical to the other skills", () => {
    for (const rel of ["scripts/check-questions.mjs", "references/questions.md"]) {
      const mine = fs.readFileSync(path.join(SKILL, rel), "utf8");
      const theirs = fs.readFileSync(path.join(__dirname, "..", "skills", "x-plan", rel), "utf8");
      assert.equal(mine, theirs, `${rel} must match x-plan's copy`);
    }
  });

  it("documents every script and reference it names", () => {
    const skillMd = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
    for (const rel of [
      "scripts/read-session.mjs",
      "scripts/scan-session.mjs",
      "scripts/save-reflection.mjs",
      "scripts/check-reflection.mjs",
      "scripts/check-questions.mjs",
      "references/gap-taxonomy.md",
      "references/questions.md",
    ]) {
      assert.ok(skillMd.includes(rel), `SKILL.md names ${rel}`);
      assert.ok(fs.existsSync(path.join(SKILL, rel)), `${rel} exists`);
    }
  });
});
