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

  it("collects the run folders and artifacts the session touched", () => {
    const session = read.normalizeSession(
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
