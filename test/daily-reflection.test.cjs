"use strict";

const { before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-autoreflection", "scripts");
const COLLECT = path.join(__dirname, "..", "automation", "daily-reflection", "collect-sessions.mjs");
const HOSTS = path.join(SKILL, "hosts", "index.mjs");

let mod;
let hosts;

before(async () => {
  mod = await import(COLLECT);
  hosts = await import(HOSTS);
});

async function withTmpDir(prefix, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function session(overrides = {}) {
  return {
    id: "aaaa1111",
    uuid: "uuid-a",
    title: "A session",
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fakeScan(overrides = {}) {
  return {
    stats: { toolCalls: 2, toolFailures: 0, corrections: 0 },
    skills: { loaded: [], used: [], unused: [] },
    signals: [],
    runFolders: [],
    artifacts: [],
    ...overrides,
  };
}

function signal(overrides = {}) {
  return {
    id: "S1",
    kind: "tool-failure",
    severity: "high",
    summary: "bash failed (exited 1)",
    count: 1,
    suspects: ["x-plan"],
    evidence: [{ message: 3, tool: "bash", excerpt: "boom" }],
    ...overrides,
  };
}

/** A `run` seam: every command an adapter issues, answered from a table so no CLI is needed. */
function stubRun(replies = {}) {
  const calls = [];
  const run = (command, args = [], { cwd = null } = {}) => {
    const key = [command, ...args].join(" ");
    calls.push({ key, cwd });
    const reply = replies[`${key} @${cwd}`] ?? replies[key];
    if (reply === undefined) throw new Error(`no stub for "${key}"`);
    return typeof reply === "function" ? reply({ command, args, cwd }) : reply;
  };
  run.calls = calls;
  return run;
}

function ctxFor(overrides = {}) {
  return {
    now: new Date("2026-01-02T12:00:00Z"),
    hours: 24,
    projectLookbackHours: 72,
    env: { HOME: "/home/nobody", XDG_DATA_HOME: "/home/nobody/.local/share" },
    run: stubRun(),
    hostOptions: {},
    ...overrides,
  };
}

function summaryInput({ scans, skillNames = [], hostStatuses = [] }) {
  return {
    results: scans.map(({ session: s, scan }) => ({ session: s, scan, transcriptPath: null, scanPath: null })),
    window: { hours: 24, since: new Date("2026-01-01T00:00:00Z"), until: new Date("2026-01-02T00:00:00Z") },
    hostStatuses,
    warnings: [],
    skillUsage: mod.buildSkillUsage({ scans: scans.map(({ scan }) => scan), skillNames }),
    dirs: { out: path.join(mod.REPO_ROOT, ".x-skills", "daily", "2026-01-02"), write: false, transcripts: "/tmp/t" },
  };
}

describe("host registry", () => {
  it("registers the CLIs it ships adapters for", () => {
    assert.deepEqual(
      hosts.HOSTS.map((host) => host.id),
      ["crush", "codex", "opencode"]
    );
    for (const host of hosts.HOSTS) {
      assert.equal(typeof host.detect, "function", host.id);
      assert.equal(typeof host.list, "function", host.id);
      assert.equal(typeof host.read, "function", host.id);
    }
    assert.equal(hosts.hostById("codex").label, "Codex");
    assert.equal(hosts.hostById("nope"), null);
  });

  it("reports a host whose store is missing as absent, not unreadable", () => {
    const ctx = ctxFor();
    assert.equal(hosts.hostStatus(hosts.hostById("crush"), ctx), "absent");
  });

  it("drops a session whose timestamp cannot be read, and keeps only the window", () => {
    const now = new Date("2026-01-02T12:00:00Z");
    const kept = hosts.withinWindow(
      [
        session({ uuid: "fresh", modified: "2026-01-02T06:00:00Z" }),
        session({ uuid: "edge", modified: "2026-01-01T12:30:00Z" }),
        session({ uuid: "stale", modified: "2026-01-01T11:00:00Z" }),
        session({ uuid: "broken", modified: "not a date" }),
      ],
      { hours: 24, now }
    );
    assert.deepEqual(
      kept.map((s) => s.uuid),
      ["fresh", "edge"]
    );
    assert.equal(kept[0].modifiedMs, Date.parse("2026-01-02T06:00:00Z"));
  });
});

describe("crush host adapter", () => {
  async function crushFixture(dir, projects) {
    const file = path.join(dir, "projects.json");
    fs.writeFileSync(file, JSON.stringify({ projects }));
    return file;
  }

  it("asks each live project for its sessions and unions them by uuid", async () => {
    await withTmpDir("crush", async (dir) => {
      const project = path.join(dir, "project");
      await fsp.mkdir(project);
      const projectsFile = await crushFixture(dir, [
        { path: project, last_accessed: "2026-01-02T11:00:00Z" },
        { path: path.join(dir, "gone"), last_accessed: "2026-01-02T11:00:00Z" },
      ]);
      const crush = hosts.hostById("crush");
      const ctx = ctxFor({
        hostOptions: { crush: { projectsFile } },
        run: stubRun({
          [`crush session list --json @${project}`]: JSON.stringify([
            session({ uuid: "shared", modified: "2026-01-02T09:00:00Z" }),
            session({ uuid: "old", modified: "2025-01-01T00:00:00Z" }),
          ]),
        }),
      });

      assert.equal(crush.detect(ctx), true);
      const { sessions, warnings } = crush.list(ctx);
      assert.deepEqual(
        sessions.map((s) => [s.uuid, s.project]),
        [
          ["shared", project],
          ["old", project],
        ]
      );
      assert.deepEqual(warnings, []);
      // Only the project that still exists was asked, so the vanished one cost no call.
      assert.equal(ctx.run.calls.length, 1);
    });
  });

  it("reports a project whose list command fails instead of dropping it silently", async () => {
    await withTmpDir("crush-warn", async (dir) => {
      const projectsFile = await crushFixture(dir, [{ path: dir, last_accessed: "2026-01-02T11:00:00Z" }]);
      const crush = hosts.hostById("crush");
      const ctx = ctxFor({
        hostOptions: { crush: { projectsFile } },
        run: stubRun({
          [`crush session list --json @${dir}`]: () => {
            throw new Error("Exit code 7\nboom");
          },
        }),
      });

      const { sessions, warnings } = crush.list(ctx);
      assert.deepEqual(sessions, []);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].reason, "crush session list failed: Exit code 7");
    });
  });

  it("reads a session in the directory it belongs to", async () => {
    const crush = hosts.hostById("crush");
    const ctx = ctxFor({
      run: stubRun({
        "crush session show aaaa1111 --json @/p": JSON.stringify({ meta: { id: "aaaa1111" }, messages: [] }),
      }),
    });
    const raw = crush.read({ id: "aaaa1111", project: "/p" }, ctx);
    assert.equal(raw.meta.host, "crush");
    assert.deepEqual(ctx.run.calls[0], { key: "crush session show aaaa1111 --json", cwd: "/p" });
  });
});

describe("codex host adapter", () => {
  const UUID = "01234567-89ab-cdef-0123-456789abcdef";

  async function codexFixture(dir, { index = true } = {}) {
    const day = path.join(dir, "sessions", "2026", "09", "16");
    await fsp.mkdir(day, { recursive: true });
    const file = path.join(day, `rollout-2026-09-16T09-00-00-${UUID}.jsonl`);
    const records = [
      {
        timestamp: "2026-09-16T07:00:00.000Z",
        type: "session_meta",
        payload: { session_id: UUID, cwd: "/work", cli_version: "0.1", timestamp: "2026-09-16T07:00:00.000Z" },
      },
      {
        timestamp: "2026-09-16T07:00:01.000Z",
        type: "response_item",
        payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "permissions" }] },
      },
      {
        timestamp: "2026-09-16T07:00:02.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "read skills/x-fake/SKILL.md" }] },
      },
      {
        timestamp: "2026-09-16T07:00:03.000Z",
        type: "response_item",
        payload: { type: "custom_tool_call", name: "exec", call_id: "call_1", input: "const r = await tools.exec_command({})" },
      },
      {
        timestamp: "2026-09-16T07:00:04.000Z",
        type: "response_item",
        payload: { type: "custom_tool_call_output", call_id: "call_1", output: [{ type: "input_text", text: "Exit code 2\nmissing" }] },
      },
      { timestamp: "2026-09-16T07:00:05.000Z", type: "response_item", payload: { type: "reasoning", summary: [{ text: "thinking" }] } },
      { timestamp: "2026-09-16T07:00:06.000Z", type: "event_msg", payload: { type: "agent_message", message: "done" } },
    ];
    fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    if (index) fs.writeFileSync(path.join(dir, "session_index.jsonl"), `${JSON.stringify({ id: UUID, thread_name: "Named thread", updated_at: "2026-09-16T07:30:00.000Z" })}\n`);
    return { file, day };
  }

  it("lists rollouts of the window, named by the session index", async () => {
    await withTmpDir("codex", async (dir) => {
      await codexFixture(dir);
      const codex = hosts.hostById("codex");
      const ctx = ctxFor({ env: { CODEX_HOME: dir } });

      assert.equal(codex.detect(ctx), true);
      const { sessions, warnings } = codex.list(ctx);
      assert.deepEqual(warnings, []);
      assert.equal(sessions.length, 1);
      assert.deepEqual(sessions[0], {
        id: UUID,
        uuid: UUID,
        title: "Named thread",
        created: "2026-09-16T07:00:00.000Z",
        modified: "2026-09-16T07:30:00.000Z",
        project: "/work",
        file: path.join(dir, "sessions", "2026", "09", "16", `rollout-2026-09-16T09-00-00-${UUID}.jsonl`),
      });
    });
  });

  it("maps a rollout onto the normalized transcript, both tool-call spellings included", async () => {
    await withTmpDir("codex-read", async (dir) => {
      await codexFixture(dir);
      const codex = hosts.hostById("codex");
      const ctx = ctxFor({ env: { CODEX_HOME: dir } });
      const listed = codex.list(ctx).sessions[0];
      const raw = codex.read(listed, ctx);

      assert.equal(raw.meta.host, "codex");
      assert.equal(raw.meta.title, "Named thread");
      assert.deepEqual(
        raw.messages.map((message) => message.role),
        ["system", "user", "assistant", "assistant", "assistant"]
      );
      const parts = raw.messages.flatMap((message) => message.parts);
      assert.deepEqual(parts.map((part) => part.type), ["text", "text", "tool_call", "tool_result", "reasoning"]);
      assert.equal(parts[2].tool_call_id, "call_1");
      assert.equal(parts[3].name, "exec", "the result inherits the name of the call it answers");
      assert.match(parts[3].content, /Exit code 2/);
      assert.equal(parts[4].thinking, "thinking");
    });
  });

  it("is absent when the sessions directory does not exist", async () => {
    await withTmpDir("codex-absent", async (dir) => {
      const ctx = ctxFor({ env: { CODEX_HOME: path.join(dir, "nope") } });
      assert.equal(hosts.hostStatus(hosts.hostById("codex"), ctx), "absent");
    });
  });
});

describe("opencode host adapter", () => {
  const ROW = { id: "ses_1", title: "A chat", directory: "/work", time_created: 1783776941511, time_updated: 1783776946155 };

  it("lists sessions from `opencode db` and maps an export onto the normalized transcript", async () => {
    const opencode = hosts.hostById("opencode");
    const ctx = ctxFor({
      run: stubRun({
        "opencode db path": "/tmp/opencode.db\n",
        "opencode db select id, title, directory, time_created, time_updated from session --format json": JSON.stringify([ROW]),
        "opencode export ses_1": JSON.stringify({
          info: { id: "ses_1", title: "A chat", directory: "/work", time: { created: 1783776941511, updated: 1783776946155 } },
          messages: [
            { info: { role: "user", time: { created: 1783776941520 } }, parts: [{ type: "text", text: "hello" }] },
            { info: { role: "assistant" }, parts: [{ type: "step-start" }, { type: "reasoning", text: "hmm" }] },
            { info: { role: "assistant" }, parts: [{ type: "tool", tool: "read", callID: "call_9", state: { status: "completed", input: { path: "a" }, output: "boom" } }] },
          ],
        }),
      }),
    });

    assert.equal(opencode.detect(ctx), true);
    const { sessions } = opencode.list(ctx);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].project, "/work");
    assert.equal(sessions[0].modified, new Date(1783776946155).toISOString());

    const raw = opencode.read(sessions[0], ctx);
    assert.equal(raw.meta.host, "opencode");
    assert.equal(raw.meta.title, "A chat");
    const parts = raw.messages.flatMap((message) => message.parts);
    assert.deepEqual(parts.map((part) => part.type), ["text", "reasoning", "tool_call", "tool_result"]);
    assert.deepEqual(parts[2], { type: "tool_call", tool_call_id: "call_9", name: "read", input: '{"path":"a"}' });
    assert.equal(parts[3].content, "boom");
  });

  it("is absent when the CLI cannot be run", () => {
    const ctx = ctxFor({
      run: stubRun({
        "opencode db path": () => {
          throw new Error("spawnSync opencode ENOENT");
        },
      }),
    });
    assert.equal(hosts.hostStatus(hosts.hostById("opencode"), ctx), "absent");
  });
});

describe("session discovery", () => {
  /** `session()` defaults to a year before the context window, so the fresh ones are spelled out. */
  const inWindow = (uuid) => session({ uuid, modified: "2026-01-02T11:00:00Z" });

  function fakeHost(id, { sessions = [], fails = false } = {}) {
    return {
      id,
      label: id,
      store: `${id} store`,
      detect: () => true,
      list: () => {
        if (fails) throw new Error("Exit code 7\nboom");
        return { sessions, warnings: [] };
      },
      read: () => ({ meta: {}, messages: [] }),
    };
  }

  it("unions hosts by host and uuid and sorts newest first", () => {
    const now = new Date("2026-01-02T12:00:00Z");
    const found = mod.discoverSessions({
      hosts: [
        fakeHost("one", { sessions: [session({ uuid: "shared", modified: "2026-01-02T09:00:00Z" })] }),
        fakeHost("two", { sessions: [session({ uuid: "shared", modified: "2026-01-02T11:00:00Z" }), session({ uuid: "other", modified: "2026-01-02T10:00:00Z" })] }),
      ],
      ctx: ctxFor({ now }),
    });
    assert.deepEqual(
      found.sessions.map((s) => `${s.host}:${s.uuid}`),
      // The same uuid under two CLIs is two sessions, not a duplicate.
      ["two:shared", "two:other", "one:shared"]
    );
    assert.deepEqual(
      found.statuses.map((s) => `${s.id}=${s.status}/${s.sessions}`),
      ["one=ok/1", "two=ok/2"]
    );
    assert.deepEqual(found.warnings, []);
  });

  it("records a host that cannot list as unreadable, and keeps going", () => {
    const found = mod.discoverSessions({
      hosts: [fakeHost("broken", { fails: true }), fakeHost("fine", { sessions: [inWindow("u1")] })],
      ctx: ctxFor(),
    });
    assert.deepEqual(
      found.statuses.map((s) => `${s.id}=${s.status}`),
      ["broken=unreadable", "fine=ok"]
    );
    assert.equal(found.sessions.length, 1);
    assert.equal(found.warnings.length, 1);
    assert.match(found.warnings[0].reason, /could not list sessions/);
  });

  it("skips a host status that is not ok, and honors an explicit selection", () => {
    const absent = { ...fakeHost("absent"), detect: () => false };
    const found = mod.discoverSessions({
      hosts: [absent, fakeHost("fine", { sessions: [inWindow("u1")] })],
      ctx: ctxFor(),
    });
    assert.deepEqual(
      found.statuses.map((s) => `${s.id}=${s.status}/${s.sessions}`),
      ["absent=absent/0", "fine=ok/1"]
    );

    const only = mod.discoverSessions({ hosts: [absent, fakeHost("fine", { sessions: [inWindow("u1")] })], ctx: ctxFor(), only: new Set(["fine"]) });
    assert.deepEqual(
      only.statuses.map((s) => s.id),
      ["fine"]
    );
  });
});

describe("daily-reflection aggregation", () => {
  it("counts loaded, used and loaded-but-unused per skill, and names the idle ones", () => {
    const scans = [
      {
        session: session({ uuid: "u1" }),
        scan: fakeScan({ skills: { loaded: ["x-plan", "x-fix"], used: ["x-plan"], unused: ["x-fix"] } }),
      },
      {
        session: session({ uuid: "u2" }),
        scan: fakeScan({
          skills: { loaded: [], used: ["x-plan"], unused: [] },
          signals: [signal({ suspects: ["x-plan"] }), signal({ id: "S2", severity: "medium", suspects: ["x-review"] })],
        }),
      },
    ];

    const usage = mod.buildSkillUsage({ scans: scans.map((s) => s.scan), skillNames: ["x-plan", "x-fix", "x-review", "x-idle"] });
    const plan = usage.touched.find((entry) => entry.name === "x-plan");
    assert.deepEqual(plan, { name: "x-plan", sessions: 2, loaded: 1, used: 2, unused: 0, high: 1, medium: 0, low: 0 });
    const fix = usage.touched.find((entry) => entry.name === "x-fix");
    assert.equal(fix.unused, 1);
    assert.equal(usage.touched.find((entry) => entry.name === "x-review").medium, 1);
    assert.deepEqual(usage.idle, ["x-idle"]);
  });

  it("orders signals by severity and keeps the session they came from", () => {
    const results = [
      { session: session({ uuid: "u1", id: "s1", title: "One" }), scan: fakeScan({ signals: [signal({ severity: "low", id: "S1" })] }) },
      { session: session({ uuid: "u2", id: "s2", title: "Two" }), scan: fakeScan({ signals: [signal({ severity: "high", id: "S2" })] }) },
    ];
    const signals = mod.buildSignals(results);
    assert.deepEqual(
      signals.map((s) => `${s.id}:${s.session}`),
      ["S2:s2", "S1:s1"]
    );
  });

  it("builds a summary whose counts match the scans and name each session's host", () => {
    const scans = [
      {
        session: session({ uuid: "u1", id: "s1", title: "One", host: "crush", project: "/p" }),
        scan: fakeScan({ stats: { toolCalls: 5, toolFailures: 2, corrections: 1 }, skills: { loaded: ["x-plan"], used: ["x-plan"], unused: [] }, signals: [signal()] }),
      },
      { session: session({ uuid: "u2", id: "s2", title: "Two", host: "codex", project: "/q" }), scan: fakeScan() },
    ];
    const withUsage = summaryInput({ scans, skillNames: ["x-plan"], hostStatuses: [{ id: "crush", label: "Crush", status: "ok", sessions: 2, store: "s" }] });
    const summary = mod.buildSummary({ ...withUsage, generatedAt: new Date("2026-01-02T05:00:00Z") });

    assert.equal(summary.counts.scanned, 2);
    assert.equal(summary.counts.touchedSkills, 1);
    assert.equal(summary.counts.highSignals, 1);
    assert.equal(summary.counts.toolFailures, 2);
    assert.equal(summary.counts.corrections, 1);
    assert.deepEqual(summary.sessions.map((s) => s.host), ["crush", "codex"]);
    assert.equal(summary.counts.discovered, summary.counts.scanned + summary.counts.dropped + summary.counts.failed);
    assert.equal(summary.sessions[0].scan, null);
    assert.equal(summary.window.hours, 24);
  });

  it("counts a session it could not read as discovered, and counts only productive hosts", () => {
    const withUsage = summaryInput({
      scans: [],
      skillNames: ["x-plan"],
      hostStatuses: [
        { id: "crush", label: "Crush", status: "ok", sessions: 3, store: "s" },
        { id: "codex", label: "Codex", status: "absent", sessions: 0, store: "s" },
      ],
    });
    const summary = mod.buildSummary({ ...withUsage, generatedAt: new Date("2026-01-02T05:00:00Z"), dropped: 1, failed: 2 });
    assert.deepEqual(
      [summary.counts.scanned, summary.counts.dropped, summary.counts.failed, summary.counts.discovered],
      [0, 1, 2, 3]
    );
    assert.equal(summary.counts.hosts, 1);
  });

  it("renders a markdown digest that survives a title full of pipes and newlines", () => {
    const scans = [
      {
        session: session({ uuid: "u1", id: "s1", title: "Fix | the\nthing", host: "crush", project: "/p" }),
        scan: fakeScan({ skills: { loaded: ["x-plan"], used: ["x-plan"], unused: [] }, signals: [signal()] }),
      },
    ];
    const summary = mod.buildSummary({
      ...summaryInput({
        scans,
        skillNames: ["x-plan", "x-idle"],
        hostStatuses: [{ id: "crush", label: "Crush", status: "ok", sessions: 1, store: "`a|b`" }],
      }),
      generatedAt: new Date("2026-01-02T05:00:00Z"),
    });
    const markdown = mod.renderSummaryMarkdown(summary);

    assert.match(markdown, /Fix \\\| the thing/);
    assert.doesNotMatch(markdown, /Fix \| the\n/);
    assert.equal(markdown.split("\n")[0], `# x-skills daily scan — ${path.basename(summary.pack)}`);
    assert.match(markdown, /## Sessions\n\n\| Host \| Session \|/);
    assert.match(markdown, /\| `crush` \| ok \| 1 \| `a\\\|b` \|/);
    assert.match(markdown, /\| Skill \| Sessions \| Loaded \| Used \| Loaded unused \| Signals h\/m\/l \|/);
    assert.match(markdown, /Never loaded or mentioned: `x-idle`/);
    assert.match(markdown, /\*\*high\*\* `S1` tool-failure \(x-plan\)/);
    assert.ok(markdown.indexOf("## Sessions") < markdown.indexOf("## Hosts"), "sessions come before the host table");
  });

  it("leaves no dangling pipe or blank table when nothing happened", () => {
    const summary = mod.buildSummary({ ...summaryInput({ scans: [], skillNames: ["x-plan"] }), generatedAt: new Date("2026-01-02T05:00:00Z") });
    const markdown = mod.renderSummaryMarkdown(summary);
    assert.match(markdown, /No session loaded or mentioned an x-skill in this window\./);
    assert.match(markdown, /No friction signals in this window\./);
    assert.doesNotMatch(markdown, /\| Skill \|/);
    assert.doesNotMatch(markdown, /## Hosts/, "no host section when no host was asked");
  });
});

describe("daily-reflection packs", () => {
  it("caps the scan and says how many were dropped", () => {
    const sessions = [1, 2, 3, 4].map((n) => session({ uuid: `u${n}` }));
    assert.deepEqual(
      mod.capSessions(sessions, 2).chosen.map((s) => s.uuid),
      ["u1", "u2"]
    );
    assert.equal(mod.capSessions(sessions, 2).dropped, 2);
    assert.equal(mod.capSessions(sessions, 0).dropped, 0);
  });

  it("prunes only dated folders older than the keep window", async () => {
    await withTmpDir("prune", async (dir) => {
      for (const name of ["2026-01-01", "2025-12-01", "2026-01-02", "notes"]) {
        await fsp.mkdir(path.join(dir, name));
      }
      const removed = mod.pruneDaily(dir, { keepDays: 7, now: new Date("2026-01-02T05:00:00Z") });
      assert.deepEqual(removed, ["2025-12-01"]);
      assert.deepEqual((await fsp.readdir(dir)).sort(), ["2026-01-01", "2026-01-02", "notes"]);
    });
  });

  it("keeps every folder when pruning is off", async () => {
    await withTmpDir("prune-off", async (dir) => {
      await fsp.mkdir(path.join(dir, "2020-01-01"));
      assert.deepEqual(mod.pruneDaily(dir, { keepDays: 0, now: new Date("2026-01-02T05:00:00Z") }), []);
    });
  });
});

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("daily-reflection CLI", () => {
  /**
   * A `crush` stand-in on PATH: two JSON fixtures, one per subcommand. It proves the CLI wires the
   * flags, the discovery, the scan and the pack together without touching the real session store.
   */
  async function withFakeHost({ sessions, shows }, fn) {
    await withTmpDir("crush-host", async (root) => {
      const bin = path.join(root, "bin");
      const project = path.join(root, "project");
      const skills = path.join(root, "skills");
      const out = path.join(root, "out");
      const fixtures = path.join(root, "fixtures");
      await fsp.mkdir(bin, { recursive: true });
      await fsp.mkdir(project, { recursive: true });
      await fsp.mkdir(path.join(skills, "x-fake"), { recursive: true });
      fs.writeFileSync(path.join(skills, "x-fake", "SKILL.md"), "---\nname: x-fake\n---\n");
      await fsp.mkdir(fixtures, { recursive: true });
      fs.writeFileSync(path.join(fixtures, "list.json"), JSON.stringify(sessions));
      for (const [id, payload] of Object.entries(shows)) {
        fs.writeFileSync(path.join(fixtures, `show-${id}.json`), JSON.stringify(payload));
      }
      const crush = path.join(bin, "crush");
      fs.writeFileSync(
        crush,
        ["#!/bin/sh", 'case "$2" in', '  list) cat "$FAKE_FIXTURES/list.json" ;;', '  show) cat "$FAKE_FIXTURES/show-$3.json" ;;', "esac", ""].join("\n")
      );
      await fsp.chmod(crush, 0o755);
      const projectsFile = path.join(root, "projects.json");
      fs.writeFileSync(projectsFile, JSON.stringify({ projects: [{ path: project, last_accessed: new Date().toISOString() }] }));
      await fn({ root, bin, out, skills, projectsFile });
    });
  }

  function runCollect(args, env) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [COLLECT, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...env },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
  }

  const rawSession = (id, title, text) => ({
    meta: { id, uuid: `uuid-${id}`, title, created: "2026-01-01T00:00:00Z", modified: "2026-01-02T04:00:00Z" },
    messages: [
      { role: "assistant", parts: [{ type: "text", text }] },
      { role: "assistant", parts: [{ type: "tool_call", tool_call_id: "c1", name: "bash", input: JSON.stringify({ command: "ls" }) }] },
      { role: "assistant", parts: [{ type: "tool_result", tool_call_id: "c1", name: "bash", content: "Exit code 2\nmissing" }] },
    ],
  });

  /** A Codex home holding one rollout that used a skill, so a second host has something to find. */
  async function withFakeCodexHome(root) {
    const home = path.join(root, "codex");
    const day = path.join(home, "sessions", "2026", "01", "02");
    await fsp.mkdir(day, { recursive: true });
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    const records = [
      {
        timestamp: new Date().toISOString(),
        type: "session_meta",
        payload: { session_id: uuid, cwd: path.join(root, "project"), timestamp: new Date().toISOString() },
      },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "follow skills/x-fake/SKILL.md" }] } },
      { type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "call_1", input: "await tools.exec_command({})" } },
      { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "call_1", output: [{ type: "input_text", text: "Exit code 2\nmissing" }] } },
    ];
    fs.writeFileSync(path.join(day, `rollout-2026-01-02T09-00-00-${uuid}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    fs.writeFileSync(path.join(home, "session_index.jsonl"), `${JSON.stringify({ id: uuid, thread_name: "Codex thread", updated_at: new Date().toISOString() })}\n`);
    return home;
  }

  it("writes a pack, scans every session and passes the probe when an x-skill was used", async () => {
    const now = new Date();
    await withFakeHost(
      {
        sessions: [
          { id: "aaaa1111", uuid: "uuid-aaaa1111", title: "Used a skill", created: "2026-01-01T00:00:00Z", modified: now.toISOString() },
          { id: "bbbb2222", uuid: "uuid-bbbb2222", title: "Plain chat", created: "2026-01-01T00:00:00Z", modified: now.toISOString() },
        ],
        shows: {
          aaaa1111: rawSession("aaaa1111", "Used a skill", "following skills/x-fake/SKILL.md"),
          bbbb2222: rawSession("bbbb2222", "Plain chat", "just chatting"),
        },
      },
      async ({ bin, out, skills, projectsFile }) => {
        const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_FIXTURES: path.join(bin, "..", "fixtures") };
        const run = await runCollect(
          ["--hours", "24", "--host", "crush", "--out", out, "--skills-dir", skills, "--projects-file", projectsFile, "--no-prune"],
          env
        );
        assert.equal(run.code, 0, run.stderr);
        const printed = JSON.parse(run.stdout);
        assert.equal(printed.sessions, 2);
        assert.equal(printed.touchedSkills, 1);
        assert.deepEqual(printed.hosts, [{ id: "crush", status: "ok", sessions: 2 }]);

        const summary = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
        assert.equal(summary.counts.scanned, 2);
        assert.equal(summary.counts.touchedSkills, 1);
        assert.equal(summary.skills.touched[0].name, "x-fake");
        assert.equal(summary.sessions[0].scan.endsWith(".signals.json"), true);
        assert.ok(summary.sessions.every((session) => session.host === "crush"));
        assert.match(fs.readFileSync(path.join(out, "summary.md"), "utf8"), /x-skills daily scan/);

        const scans = summary.sessions.map((session) => path.join(mod.REPO_ROOT, session.scan));
        for (const file of scans) assert.equal(fs.existsSync(file), true, file);

        const beforeProbe = fs.readdirSync(out).sort();
        const probe = await runCollect(["--hours", "24", "--host", "crush", "--skills-dir", skills, "--projects-file", projectsFile, "--check"], env);
        assert.equal(probe.code, 0, probe.stderr);
        assert.equal(JSON.parse(probe.stdout).check, "ok");
        assert.deepEqual(fs.readdirSync(out).sort(), beforeProbe);
      }
    );
  });

  it("reads a second host beside Crush, and tags each session with its host", async () => {
    const now = new Date();
    await withFakeHost(
      {
        sessions: [{ id: "aaaa1111", uuid: "uuid-aaaa1111", title: "Crush session", created: "2026-01-01T00:00:00Z", modified: now.toISOString() }],
        shows: { aaaa1111: rawSession("aaaa1111", "Crush session", "following skills/x-fake/SKILL.md") },
      },
      async ({ root, bin, out, skills, projectsFile }) => {
        const codexHome = await withFakeCodexHome(root);
        const env = {
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          FAKE_FIXTURES: path.join(bin, "..", "fixtures"),
          CODEX_HOME: codexHome,
        };
        const run = await runCollect(
          ["--hours", "24", "--host", "crush,codex", "--out", out, "--skills-dir", skills, "--projects-file", projectsFile, "--no-prune"],
          env
        );
        assert.equal(run.code, 0, run.stderr);
        const summary = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
        assert.deepEqual(
          summary.hosts.map((host) => `${host.id}=${host.status}/${host.sessions}`),
          ["crush=ok/1", "codex=ok/1"]
        );
        assert.deepEqual(summary.sessions.map((session) => session.host).sort(), ["codex", "crush"]);
        assert.equal(summary.counts.hosts, 2);
        assert.deepEqual(
          summary.skills.touched.map((entry) => entry.name),
          ["x-fake"],
          "both hosts' sessions were scanned"
        );
        assert.match(fs.readFileSync(path.join(out, "summary.md"), "utf8"), /\| `codex` \| ok \| 1 \|/);
      }
    );
  });

  it("fails the probe, writing nothing, when no session used an x-skill", async () => {
    const now = new Date();
    await withFakeHost(
      {
        sessions: [{ id: "cccc3333", uuid: "uuid-cccc3333", title: "Plain chat", created: "2026-01-01T00:00:00Z", modified: now.toISOString() }],
        shows: { cccc3333: rawSession("cccc3333", "Plain chat", "just chatting") },
      },
      async ({ bin, skills, projectsFile, root }) => {
        const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_FIXTURES: path.join(bin, "..", "fixtures") };
        const out = path.join(root, "probe-out");
        const probe = await runCollect(["--host", "crush", "--skills-dir", skills, "--projects-file", projectsFile, "--out", out, "--check"], env);
        assert.equal(probe.code, 1);
        assert.match(probe.stderr, /no-x-skill-usage/);
        assert.equal(fs.existsSync(out), false);
      }
    );
  });

  it("exits 3, not 1, when no host can be read at all", async () => {
    await withTmpDir("no-hosts", async (dir) => {
      const skills = path.join(dir, "skills");
      await fsp.mkdir(path.join(skills, "x-fake"), { recursive: true });
      fs.writeFileSync(path.join(skills, "x-fake", "SKILL.md"), "---\nname: x-fake\n---\n");
      const out = path.join(dir, "out");
      const probe = await runCollect([
        "--host",
        "crush",
        "--skills-dir",
        skills,
        "--projects-file",
        path.join(dir, "absent.json"),
        "--out",
        out,
        "--check",
      ]);
      assert.equal(probe.code, 3);
      const payload = JSON.parse(probe.stderr);
      assert.equal(payload.check, "collection-failed");
      assert.deepEqual(payload.hosts, [{ id: "crush", status: "absent", sessions: 0 }]);
      assert.equal(fs.existsSync(out), false);
    });
  });

  it("rejects an unknown host before touching any store", async () => {
    await withTmpDir("bad-host", async (dir) => {
      const run = await runCollect(["--host", "claude-code", "--out", path.join(dir, "out")]);
      assert.equal(run.code, 2);
      assert.equal(JSON.parse(run.stderr).error, 'Unknown host "claude-code"; known hosts: crush, codex, opencode');
    });
  });

  it("exits 2 with a message when the skills directory has nothing to attribute to", async () => {
    await withTmpDir("no-skills", async (empty) => {
      const run = await runCollect(["--skills-dir", empty, "--out", path.join(empty, "out"), "--check"]);
      assert.equal(run.code, 2);
      assert.match(run.stderr, /no x-\* skills found/);
    });
  });
});
