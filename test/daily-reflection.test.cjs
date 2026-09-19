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
const GOOSE = path.join(SKILL, "hosts", "goose.mjs");
const READ = path.join(SKILL, "read-session.mjs");

let mod;
let hosts;
let goose;

before(async () => {
  mod = await import(COLLECT);
  hosts = await import(HOSTS);
  goose = await import(GOOSE);
});

/** Goose keeps sessions in SQLite, so its tests need the Node built-in; older runtimes skip them. */
const hasSqlite = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

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

/** A home no CLI keeps a store in, so a host is only ever detected through what a test set up. */
function isolatedEnv(extra = {}) {
  return {
    HOME: "/home/nobody",
    XDG_DATA_HOME: "/home/nobody/.local/share",
    CODEX_HOME: "/home/nobody/.codex",
    GOOSE_DATA_DIR: "/home/nobody/goose",
    ...extra,
  };
}

function ctxFor(overrides = {}) {
  return {
    now: new Date("2026-01-02T12:00:00Z"),
    hours: 24,
    projectLookbackHours: 72,
    env: isolatedEnv(),
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
      ["opencode", "claude", "codex", "gemini", "cursor", "cline", "goose", "crush", "qwen", "kilo", "roo", "copilot"]
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

  it("never lists the turn classifier's own directory, so its runs are not scanned the next morning", async () => {
    await withTmpDir("crush-classifier", async (dir) => {
      const project = path.join(dir, "project");
      const classifier = path.join(dir, ".x-skills", "turn-classifier");
      await fsp.mkdir(project, { recursive: true });
      await fsp.mkdir(classifier, { recursive: true });
      const projectsFile = await crushFixture(dir, [
        { path: classifier, last_accessed: "2026-01-02T11:00:00Z" },
        { path: project, last_accessed: "2026-01-02T11:00:00Z" },
      ]);
      const ctx = ctxFor({
        hostOptions: { crush: { projectsFile } },
        run: stubRun({ [`crush session list --json @${project}`]: JSON.stringify([session({ uuid: "real" })]) }),
      });
      assert.deepEqual(hosts.hostById("crush").list(ctx).sessions.map((s) => s.uuid), ["real"]);
      assert.equal(ctx.run.calls.length, 1, "the classifier's directory was never asked");
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

/** Goose keeps sessions in SQLite, so its tests need the built-in driver; older Node skips them. */
const gooseOnly = hasSqlite ? describe : describe.skip;
gooseOnly("goose host adapter", () => {
  const text = (value) => JSON.stringify([{ type: "text", text: value }]);
  const tool = (id, name, args) =>
    JSON.stringify([{ type: "toolRequest", id, toolCall: { status: "success", value: { name, arguments: args } } }]);
  const toolResult = (id, value) =>
    JSON.stringify([{ type: "toolResponse", id, toolResult: { status: "success", value: { content: [{ type: "text", text: value }] } } }]);

  /** A store shaped like Goose's own: two tables, UTC timestamps, blocks as JSON text. */
  function gooseStore(dir, { sessions = [], messages = [], tables = true } = {}) {
    const file = path.join(dir, "sessions", "sessions.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(file);
    if (tables) {
      db.exec(
        "create table sessions (id text primary key, name text, working_dir text, created_at text, updated_at text, archived_at text)"
      );
      db.exec("create table messages (id integer primary key autoincrement, session_id text, role text, content_json text, created_timestamp integer)");
      const insertSession = db.prepare("insert into sessions (id, name, working_dir, created_at, updated_at, archived_at) values (?, ?, ?, ?, ?, ?)");
      for (const row of sessions) insertSession.run(row.id, row.name, row.working_dir, row.created_at, row.updated_at, row.archived_at ?? null);
      const insertMessage = db.prepare("insert into messages (session_id, role, content_json, created_timestamp) values (?, ?, ?, ?)");
      for (const row of messages) insertMessage.run(row.session_id, row.role, row.content_json, row.created_timestamp);
    } else {
      db.exec("create table unrelated (id text)");
    }
    db.close();
    return file;
  }

  it("reads the store's UTC timestamps as UTC, not as local time", () => {
    // Goose writes `YYYY-MM-DD HH:MM:SS` UTC; read as local, a 24h window is off by the offset.
    assert.equal(goose.parseUtc("2026-06-12 06:29:51"), "2026-06-12T06:29:51.000Z");
    assert.equal(goose.parseUtc(""), null);
    assert.equal(goose.parseUtc(null), null);
  });

  it("lists live sessions with their directory, and leaves archived ones out", async () => {
    await withTmpDir("goose", async (dir) => {
      gooseStore(dir, {
        sessions: [
          { id: "20260612_9", name: "Add Superpowers", working_dir: "/work/one", created_at: "2026-06-12 06:29:51", updated_at: "2026-06-12 06:44:00" },
          { id: "20260612_8", name: "Old chat", working_dir: "/work/two", created_at: "2026-06-11 06:00:00", updated_at: "2026-06-11 06:10:00", archived_at: "2026-06-11 06:20:00" },
        ],
      });
      const ctx = ctxFor({ env: isolatedEnv({ GOOSE_DATA_DIR: dir }) });
      assert.equal(hosts.hostById("goose").detect(ctx), true);

      const { sessions, warnings } = hosts.hostById("goose").list(ctx);
      assert.deepEqual(warnings, []);
      assert.deepEqual(sessions, [
        {
          id: "20260612_9",
          uuid: "20260612_9",
          title: "Add Superpowers",
          project: "/work/one",
          created: "2026-06-12T06:29:51.000Z",
          modified: "2026-06-12T06:44:00.000Z",
        },
      ]);
    });
  });

  it("maps text, thinking and a tool pair onto the normalized transcript", async () => {
    await withTmpDir("goose-read", async (dir) => {
      gooseStore(dir, {
        sessions: [{ id: "s1", name: "A chat", working_dir: "/work", created_at: "2026-06-12 06:00:00", updated_at: "2026-06-12 06:30:00" }],
        messages: [
          { session_id: "s1", role: "user", content_json: text("read skills/x-fake/SKILL.md"), created_timestamp: 1781245791 },
          { session_id: "s1", role: "assistant", content_json: JSON.stringify([{ type: "thinking", thinking: "checking" }]), created_timestamp: 1781245792 },
          { session_id: "s1", role: "assistant", content_json: tool("call-1", "tree", { path: "/work", depth: 3 }), created_timestamp: 1781245793 },
          { session_id: "s1", role: "assistant", content_json: toolResult("call-1", "Error: Source not found."), created_timestamp: 1781245794 },
          { session_id: "s1", role: "assistant", content_json: JSON.stringify([{ type: "systemNotification", msg: "Conversation cleared" }]), created_timestamp: 1781245795 },
          { session_id: "s1", role: "assistant", content_json: "{not json", created_timestamp: 1781245796 },
        ],
      });
      const ctx = ctxFor({ env: isolatedEnv({ GOOSE_DATA_DIR: dir }) });
      const listed = hosts.hostById("goose").list(ctx).sessions[0];
      const raw = hosts.hostById("goose").read(listed, ctx);

      assert.equal(raw.meta.host, "goose");
      assert.equal(raw.meta.title, "A chat");
      assert.equal(raw.meta.created, "2026-06-12T06:00:00.000Z");
      assert.deepEqual(
        raw.messages.map((message) => message.role),
        ["user", "assistant", "assistant", "assistant"],
        "the notification and the unparsable row yield no parts, so they are skipped"
      );
      const parts = raw.messages.flatMap((message) => message.parts);
      assert.deepEqual(parts.map((part) => part.type), ["text", "reasoning", "tool_call", "tool_result"]);
      assert.deepEqual(parts[2], { type: "tool_call", tool_call_id: "call-1", name: "tree", input: '{"path":"/work","depth":3}' });
      assert.equal(parts[3].name, "tree", "the result inherits the name of the call it answers");
      assert.match(parts[3].content, /^Error: /, "which is what the scanner reads a failure from");
      assert.equal(raw.messages[0].created, "2026-06-12T06:29:51.000Z");
    });
  });

  it("reports a store with no sessions table instead of returning a clean zero", async () => {
    await withTmpDir("goose-shape", async (dir) => {
      gooseStore(dir, { tables: false });
      const ctx = ctxFor({ env: isolatedEnv({ GOOSE_DATA_DIR: dir }) });
      const { sessions, warnings } = hosts.hostById("goose").list(ctx);
      assert.deepEqual(sessions, []);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0].reason, /no sessions table/);
    });
  });

  it("explains itself when the store is absent rather than throwing", async () => {
    await withTmpDir("goose-missing", async (dir) => {
      const ctx = ctxFor({ env: isolatedEnv({ GOOSE_DATA_DIR: path.join(dir, "nope") }) });
      assert.equal(hosts.hostStatus(hosts.hostById("goose"), ctx), "absent");
    });
  });

  it("finds a session by id even when it sits outside the listing window", async () => {
    await withTmpDir("goose-find", async (dir) => {
      gooseStore(dir, {
        sessions: [{ id: "old_1", name: "Last spring", working_dir: "/w", created_at: "2025-06-12 06:00:00", updated_at: "2025-06-12 06:30:00" }],
      });
      const read = await import(READ);
      const ctx = ctxFor({ env: isolatedEnv({ GOOSE_DATA_DIR: dir }) });

      assert.equal(hosts.hostById("goose").list(ctx).sessions.length, 1, "the adapter reports it");
      assert.deepEqual(read.listHostSessions({ ctx }).sessions, [], "the window leaves it out");
      // Asking for one session by name is not a listing, so the window must not hide it.
      assert.equal(read.findSession("old_1", { ctx }).id, "old_1");
      assert.throws(() => read.findSession("nope", { ctx }), /no session "nope"/);
    });
  });
});

/**
 * The file-based hosts are built from their published specs, not against a live install, so these
 * fixtures are the spec restated: if a real store stops matching, the adapter reports it in `warnings`
 * instead of passing the session through as an empty one.
 */
describe("spec-built file hosts", () => {
  const jsonl = (file, records) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    return file;
  };

  function hostFor(id) {
    const adapter = hosts.hostById(id);
    assert.ok(adapter, `no adapter registered for ${id}`);
    return adapter;
  }

  it("claude reads a transcript's text, thinking and tool pair", async () => {
    await withTmpDir("claude", async (dir) => {
      const project = path.join(dir, "projects", "-home-nobody-work");
      const file = jsonl(path.join(project, "11111111-2222-3333-4444-555555555555.jsonl"), [
        { type: "summary", summary: "Fix the login bug", timestamp: "2026-01-02T10:00:00.000Z" },
        { type: "user", timestamp: "2026-01-02T10:00:01.000Z", sessionId: "11111111-2222-3333-4444-555555555555", cwd: "/home/nobody/work", message: { role: "user", content: "read skills/x-fake/SKILL.md" } },
        { type: "assistant", timestamp: "2026-01-02T10:00:02.000Z", message: { role: "assistant", model: "claude", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "on it" }, { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "skills/x-fake/SKILL.md" } }] } },
        { type: "user", timestamp: "2026-01-02T10:00:03.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Exit code 2\nmissing" }] } },
        { type: "queue-operation", timestamp: "2026-01-02T10:00:04.000Z" },
      ]);
      const claude = hostFor("claude");
      const ctx = ctxFor({ env: isolatedEnv({ CLAUDE_CONFIG_DIR: dir }) });
      assert.equal(claude.detect(ctx), true);

      const { sessions, warnings } = claude.list(ctx);
      assert.deepEqual(warnings, []);
      assert.deepEqual(sessions.map((s) => [s.id, s.title, s.project]), [["11111111-2222-3333-4444-555555555555", "Fix the login bug", "/home/nobody/work"]]);

      const raw = claude.read({ ...sessions[0], file }, ctx);
      assert.equal(raw.meta.host, "claude");
      assert.deepEqual(
        raw.messages.map((message) => message.role),
        ["user", "assistant", "user"]
      );
      const parts = raw.messages.flatMap((message) => message.parts);
      assert.deepEqual(parts.map((part) => part.type), ["text", "reasoning", "text", "tool_call", "tool_result"]);
      assert.equal(parts[4].name, "Read", "the result inherits the name of the call it answers");
      assert.match(parts[4].content, /Exit code 2/);
    });
  });

  it("claude keeps each reply's model and records the skills the session loaded", async () => {
    await withTmpDir("claude-skills", async (dir) => {
      const project = path.join(dir, "projects", "-home-nobody-work");
      const file = jsonl(path.join(project, "22222222-2222-3333-4444-555555555555.jsonl"), [
        { type: "user", timestamp: "2026-01-02T10:00:01.000Z", sessionId: "22222222-2222-3333-4444-555555555555", cwd: "/home/nobody/work", message: { role: "user", content: "analyse it" } },
        { type: "assistant", timestamp: "2026-01-02T10:00:02.000Z", message: { role: "assistant", model: "claude-opus-5", content: [{ type: "tool_use", id: "toolu_1", name: "Skill", input: { skill: "x-anal" } }] } },
        { type: "user", timestamp: "2026-01-02T10:00:03.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Launching skill: x-anal" }] } },
        { type: "user", timestamp: "2026-01-02T10:00:04.000Z", message: { role: "user", content: [{ type: "text", text: "Base directory for this skill: /home/nobody/.claude/skills/x-anal\n\n# X-Anal" }] } },
        { type: "user", timestamp: "2026-01-02T10:00:05.000Z", message: { role: "user", content: [{ type: "text", text: "Base directory for this skill: /home/nobody/.claude/skills/x-plan\n\n# X-Plan" }] } },
        { type: "assistant", timestamp: "2026-01-02T10:00:06.000Z", message: { role: "assistant", model: "claude-opus-5", content: [{ type: "text", text: "done" }] } },
      ]);
      const claude = hostFor("claude");
      const ctx = ctxFor({ env: isolatedEnv({ CLAUDE_CONFIG_DIR: dir }) });
      const [listed] = claude.list(ctx).sessions;
      const raw = claude.read({ ...listed, file }, ctx);
      assert.deepEqual(raw.meta.skills, [
        { name: "x-anal", loaded_at: "2026-01-02T10:00:02.000Z" },
        { name: "x-plan", loaded_at: "2026-01-02T10:00:05.000Z" },
      ]);
      assert.equal(raw.meta.headless, false, "an interactive session");
      const headless = jsonl(path.join(project, "33333333-2222-3333-4444-555555555555.jsonl"), [
        { type: "user", entrypoint: "sdk-cli", timestamp: "2026-01-02T11:00:00.000Z", sessionId: "33333333-2222-3333-4444-555555555555", cwd: "/home/nobody/work", message: { role: "user", content: "classify these" } },
      ]);
      assert.equal(claude.read({ id: "33333333-2222-3333-4444-555555555555", file: headless }, ctx).meta.headless, true, "claude -p writes entrypoint sdk-cli");
      assert.equal(raw.messages[1].model, "claude-opus-5");
      assert.equal("model" in raw.messages[0], false, "a user turn names no model");
    });
  });

  it("cursor reads its agent transcripts in both observed layouts", async () => {
    await withTmpDir("cursor", async (dir) => {
      const projects = path.join(dir, ".cursor", "projects", "home-nobody-work", "agent-transcripts");
      const flat = jsonl(path.join(projects, "aaaaaaaa-1111-2222-3333-444444444444.jsonl"), [
        { role: "user", message: { content: [{ type: "text", text: "hello" }] } },
        { role: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
      ]);
      jsonl(path.join(projects, "bbbbbbbb-1111-2222-3333-444444444444", "transcript.jsonl"), [
        { role: "assistant", message: { content: [{ type: "text", text: "nested" }] } },
      ]);
      const cursor = hostFor("cursor");
      const ctx = ctxFor({ env: isolatedEnv({ HOME: dir }) });
      assert.equal(cursor.detect(ctx), true);

      const { sessions } = cursor.list(ctx);
      assert.deepEqual(
        sessions.map((s) => s.id).sort(),
        ["aaaaaaaa-1111-2222-3333-444444444444", "bbbbbbbb-1111-2222-3333-444444444444"]
      );
      const raw = cursor.read({ ...sessions.find((s) => s.file === flat), file: flat }, ctx);
      assert.equal(raw.meta.host, "cursor");
      assert.deepEqual(
        raw.messages.map((message) => [message.role, message.parts[0].text]),
        [
          ["user", "hello"],
          ["assistant", "hi"],
        ]
      );
    });
  });

  it("gemini reads both the JSONL record stream and the legacy single JSON", async () => {
    await withTmpDir("gemini", async (dir) => {
      const chats = path.join(dir, "tmp", "8f14e45f", "chats");
      jsonl(path.join(chats, "session-2026-01-02T10-00-00000000.jsonl"), [
        { sessionId: "sess-1", projectHash: "8f14e45f", startTime: "2026-01-02T10:00:00.000Z", lastUpdated: "2026-01-02T10:05:00.000Z" },
        { id: "m1", timestamp: "2026-01-02T10:00:01.000Z", type: "user", content: [{ text: "run the tests" }] },
        { id: "m2", timestamp: "2026-01-02T10:00:02.000Z", type: "gemini", content: [{ text: "running" }], thoughts: [{ subject: "Plan", description: "call the runner" }], toolCalls: [{ id: "c1", name: "run_shell_command", args: { command: "npm test" }, result: [{ text: "Exit code 1\nfailed" }], status: "error" }] },
        { $set: { summary: "Test run", lastUpdated: "2026-01-02T10:06:00.000Z" } },
      ]);
      const legacy = path.join(chats, "session-2026-01-01T09-00-00000000.json");
      fs.writeFileSync(
        legacy,
        JSON.stringify({
          sessionId: "sess-2",
          projectHash: "8f14e45f",
          startTime: "2026-01-01T09:00:00.000Z",
          lastUpdated: "2026-01-01T09:10:00.000Z",
          summary: "Older chat",
          messages: [
            { id: "m1", timestamp: "2026-01-01T09:00:01.000Z", type: "user", content: "hello" },
            { id: "m2", timestamp: "2026-01-01T09:00:02.000Z", type: "gemini", content: "hi" },
          ],
        })
      );
      fs.writeFileSync(path.join(dir, "projects.json"), JSON.stringify({ projects: { "/home/nobody/work": "8f14e45f" } }));
      const gemini = hostFor("gemini");
      const ctx = ctxFor({ env: isolatedEnv({ GEMINI_CLI_HOME: dir }) });
      assert.equal(gemini.detect(ctx), true);

      const { sessions, warnings } = gemini.list(ctx);
      assert.deepEqual(warnings, []);
      const current = sessions.find((s) => s.id === "sess-1");
      assert.equal(current.title, "Test run", "the $set record updates the session");
      assert.equal(current.project, "/home/nobody/work", "projects.json names the project");
      assert.equal(current.modified, "2026-01-02T10:06:00.000Z");

      const raw = gemini.read(current, ctx);
      assert.deepEqual(
        raw.messages.map((message) => message.role),
        ["user", "assistant"]
      );
      const parts = raw.messages.flatMap((message) => message.parts);
      assert.deepEqual(parts.map((part) => part.type), ["text", "reasoning", "text", "tool_call", "tool_result"]);
      assert.equal(parts[3].input, '{"command":"npm test"}');
      assert.match(parts[4].content, /Exit code 1/);

      const old = sessions.find((s) => s.id === "sess-2");
      assert.equal(old.title, "Older chat");
      assert.equal(gemini.read(old, ctx).messages.length, 2);
    });
  });

  it("qwen maps its model parts, including function calls and responses", async () => {
    await withTmpDir("qwen", async (dir) => {
      const chats = path.join(dir, "tmp", "abc123", "chats");
      jsonl(path.join(chats, "session-1.jsonl"), [
        { uuid: "u1", parentUuid: null, sessionId: "qwen-1", timestamp: "2026-01-02T10:00:00.000Z", type: "user", cwd: "/home/nobody/work", message: { role: "user", parts: [{ text: "read it" }] } },
        { uuid: "u2", parentUuid: "u1", sessionId: "qwen-1", timestamp: "2026-01-02T10:00:01.000Z", type: "assistant", message: { role: "model", parts: [{ thought: true, text: "thinking" }, { functionCall: { id: "fc1", name: "read_file", args: { path: "a" } } }] } },
        { uuid: "u3", parentUuid: "u2", sessionId: "qwen-1", timestamp: "2026-01-02T10:00:02.000Z", type: "tool_result", message: { role: "user", parts: [{ functionResponse: { id: "fc1", name: "read_file", response: { error: "boom" } } }] } },
        { uuid: "u4", parentUuid: "u3", sessionId: "qwen-1", timestamp: "2026-01-02T10:00:03.000Z", type: "system", message: { parts: [{ text: "chat_compression" }] } },
      ]);
      const qwen = hostFor("qwen");
      const ctx = ctxFor({ env: isolatedEnv({ QWEN_HOME: dir }) });
      assert.equal(qwen.detect(ctx), true);

      const listed = qwen.list(ctx).sessions;
      assert.equal(listed.length, 1);
      assert.equal(listed[0].project, "/home/nobody/work");

      const raw = qwen.read(listed[0], ctx);
      const parts = raw.messages.flatMap((message) => message.parts);
      assert.deepEqual(parts.map((part) => part.type), ["text", "reasoning", "tool_call", "tool_result"]);
      assert.deepEqual(parts[2], { type: "tool_call", tool_call_id: "fc1", name: "read_file", input: '{"path":"a"}' });
      assert.equal(parts[3].name, "read_file");
      assert.match(parts[3].content, /boom/);
    });
  });

  it("copilot reads its event stream and the workspace's cwd", async () => {
    await withTmpDir("copilot", async (dir) => {
      const session = path.join(dir, "session-state", "005a2626-fdd3-4393-85ab-1a4050afb71d");
      jsonl(path.join(session, "events.jsonl"), [
        { type: "user.message", timestamp: "2026-01-02T10:00:00.000Z", data: { content: "run the tests" } },
        { type: "assistant.turn_start", timestamp: "2026-01-02T10:00:01.000Z", data: {} },
        { type: "assistant.message", timestamp: "2026-01-02T10:00:02.000Z", data: { content: "on it", reasoningText: "call bash", toolRequests: [{ toolCallId: "call_1", name: "bash", arguments: { command: "npm test" } }] } },
        { type: "tool.execution_start", timestamp: "2026-01-02T10:00:03.000Z", data: { toolCallId: "call_1", toolName: "bash", arguments: { command: "npm test" } } },
        { type: "tool.execution_complete", timestamp: "2026-01-02T10:00:04.000Z", data: { toolCallId: "call_1", result: { text: "Exit code 1" } } },
      ]);
      fs.writeFileSync(path.join(session, "workspace.yaml"), "cwd: /home/nobody/work\nother: 1\n");
      const copilot = hostFor("copilot");
      const ctx = ctxFor({ env: isolatedEnv({ COPILOT_HOME: dir }) });
      assert.equal(copilot.detect(ctx), true);

      const listed = copilot.list(ctx).sessions[0];
      assert.equal(listed.id, "005a2626-fdd3-4393-85ab-1a4050afb71d");
      assert.equal(listed.project, "/home/nobody/work");

      const raw = copilot.read(listed, ctx);
      const parts = raw.messages.flatMap((message) => message.parts);
      assert.deepEqual(parts.map((part) => part.type), ["text", "reasoning", "text", "tool_call", "tool_call", "tool_result"]);
      assert.deepEqual(parts[3], { type: "tool_call", tool_call_id: "call_1", name: "bash", input: '{"command":"npm test"}' });
      assert.equal(parts[5].tool_call_id, "call_1", "a completion is paired with the call it closes");
      assert.match(parts[5].content, /Exit code 1/);
    });
  });

  it("cline prefers its Anthropic history, and merges the UI stream when that is all there is", async () => {
    await withTmpDir("cline", async (dir) => {
      const tasks = path.join(dir, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "tasks");
      fs.mkdirSync(path.join(tasks, "task-with-history"), { recursive: true });
      fs.writeFileSync(
        path.join(tasks, "task-with-history", "api_conversation_history.json"),
        JSON.stringify([
          { role: "user", content: "run the tests" },
          { role: "assistant", content: [{ type: "text", text: "running" }, { type: "tool_use", id: "t1", name: "execute_command", input: { command: "npm test" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Exit code 1\nfailed" }] },
        ])
      );
      fs.mkdirSync(path.join(tasks, "task-ui-only"), { recursive: true });
      fs.writeFileSync(
        path.join(tasks, "task-ui-only", "ui_messages.json"),
        JSON.stringify([
          { ts: 1783776941000, type: "say", say: "text", text: "hello ", partial: true },
          { ts: 1783776942000, type: "say", say: "text", text: "there", partial: true },
          { ts: 1783776943000, type: "say", ask: "followup", text: "do it again" },
          { ts: 1783776944000, type: "say", say: "completion_result", text: "done" },
        ])
      );
      const cline = hostFor("cline");
      const ctx = ctxFor({ env: isolatedEnv({ XDG_CONFIG_HOME: dir }) });
      assert.equal(cline.detect(ctx), true);

      const { sessions } = cline.list(ctx);
      assert.deepEqual(sessions.map((s) => s.id).sort(), ["task-ui-only", "task-with-history"]);

      const anthropic = sessions.find((s) => s.id === "task-with-history");
      const parts = cline.read(anthropic, ctx).messages.flatMap((message) => message.parts);
      assert.deepEqual(parts.map((part) => part.type), ["text", "text", "tool_call", "tool_result"]);
      assert.equal(parts[3].name, "execute_command");
      assert.match(parts[3].content, /Exit code 1/);

      const ui = cline.read(sessions.find((s) => s.id === "task-ui-only"), ctx).messages;
      assert.deepEqual(
        ui.map((message) => [message.role, message.parts[0].text]),
        [
          ["assistant", "hello there"],
          ["user", "do it again"],
          ["assistant", "done"],
        ],
        "streamed partial chunks merge into one turn"
      );
    });
  });

  it("says a store is missing rather than pretending a host was read", async () => {
    const ctx = ctxFor();
    assert.deepEqual(hostFor("claude").list(ctx).warnings, [{ scope: "/home/nobody/.claude/projects", reason: "no store at /home/nobody/.claude/projects" }]);
    assert.equal(hosts.hostStatus(hostFor("claude"), ctx), "absent");
  });
});

describe("session discovery", () => {  /** `session()` defaults to a year before the context window, so the fresh ones are spelled out. */
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

describe("daily-reflection turn classification", () => {
  const raw = {
    meta: { id: "aaaa1111", uuid: "uuid-a", title: "T", created: "2026-01-02T09:00:00Z", modified: "2026-01-02T10:00:00Z", skills: [] },
    messages: [
      { role: "user", parts: [{ type: "text", text: "write the report for the skills with every detail please" }] },
      { role: "assistant", parts: [{ type: "text", text: "Report written, 4 pages." }] },
      { role: "user", parts: [{ type: "text", text: "that is TOO long, ten seconds to scan is the max" }] },
    ],
  };
  const adapters = new Map([["crush", { id: "crush", read: () => raw }]]);
  const input = (classifier) => ({
    sessions: [session({ uuid: "uuid-a", host: "crush" })],
    adapters,
    ctx: ctxFor(),
    skills: { names: [], dir: null },
    dirs: { write: false },
    clip: 600,
    classifier,
  });

  it("asks the classifier about the user's turns in batches and scans with its answers", () => {
    const prompts = [];
    const out = mod.scanSessions(input((prompt) => (prompts.push(prompt), "1 pushback\n")));
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /USER: that is TOO long/);
    assert.ok(out.results[0].scan.signals.some((signal) => signal.kind === "user-pushback"));
    assert.deepEqual(out.classification, { asked: 1, answered: 1, batches: 1, failed: 0 });
  });

  it("keeps collecting when the classifier fails, and says so", () => {
    const out = mod.scanSessions(
      input(() => {
        throw new Error("payment required");
      })
    );
    assert.equal(out.results.length, 1, "the session is still scanned");
    assert.equal(out.results[0].scan.signals.some((signal) => signal.kind === "user-pushback"), false);
    assert.equal(out.classification.failed, 1);
    assert.ok(out.warnings.some((warning) => warning.scope === "classifier" && /payment required/.test(warning.reason)));
  });

  it("hands the command its prompt as a readable file, which a CLI that ignores sockets still reads", async () => {
    await withTmpDir("classifier-stdin", async (dir) => {
      // A stand-in for `crush run`: it refuses stdin that is a socket, the way the real CLI does.
      const tool = path.join(dir, "strict.sh");
      fs.writeFileSync(tool, '#!/bin/sh\nif [ -S /dev/stdin ]; then echo "No prompt provided." >&2; exit 1; fi\ngrep -c "USER:"\n');
      await fsp.chmod(tool, 0o755);
      const classify = mod.commandClassifier({ command: tool, cwd: dir });
      assert.equal(classify("1. x\n   USER: a\n2. y\n   USER: b\n").trim(), "2");
    });
  });

  it("asks nothing when no classifier is configured", () => {
    assert.deepEqual(mod.scanSessions(input(null)).classification, { asked: 0, answered: 0, batches: 0, failed: 0 });
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

  it("ranks the sessions to read by their anchors, links a retry, and prints the verdict lines", () => {
    const request = (created) => ({ message: 0, created, text: "Do a deep research on the reflection skills with online sources and loops" });
    const scans = [
      {
        session: session({ uuid: "uuid-a", id: "aaaa1111", host: "crush", modified: "2026-01-01T11:00:00Z" }),
        scan: fakeScan({
          source: { model: "deepseek-v4-pro" },
          request: request("2026-01-01T10:00:00Z"),
          lastOwner: "x-research",
          stats: { toolCalls: 9, userMessages: 3 },
          signals: [signal({ kind: "user-redo", suspects: ["x-research"], evidence: [{ message: 8 }] })],
        }),
      },
      {
        session: session({ uuid: "uuid-b", id: "bbbb2222", host: "claude", modified: "2026-01-01T12:00:00Z" }),
        scan: fakeScan({ source: { model: "claude-opus-5" }, request: request("2026-01-01T10:30:00Z"), stats: { toolCalls: 2, userMessages: 3 } }),
      },
    ];
    const summary = mod.buildSummary({ ...summaryInput({ scans }), generatedAt: new Date("2026-01-02T05:00:00Z") });

    assert.equal(summary.sessions[0].model, "deepseek-v4-pro");
    assert.equal(summary.sessions[0].request.message, 0);
    assert.deepEqual(summary.retries.map((retry) => [retry.earlier, retry.later]), [["crush:uuid-a", "claude:uuid-b"]]);
    assert.equal(summary.select[0].session, "crush:uuid-a");
    assert.equal(summary.select[0].reason, "cross-session-retry", "asked again elsewhere outranks a redo in the same session");
    assert.deepEqual(summary.select[0].anchors.map((anchor) => anchor.kind), ["cross-session-retry", "user-redo"]);
    assert.equal(summary.audit.session, "claude:uuid-b", "the quiet interactive session is the day's audit");
    assert.deepEqual(summary.verdictLines, [
      "- [ ] `aaaa1111` · cross-session-retry msg 0 · x-research · deepseek-v4-pro — good / below / not-a-skill-problem — note:",
      "- [ ] audit `bbbb2222` · no anchor · no owner · claude-opus-5 — good / below / not-a-skill-problem — note:",
    ]);
    const markdown = mod.renderSummaryMarkdown(summary);
    assert.match(markdown, /## Read today/);
    assert.match(markdown, /## Verdicts \(copy into DIGEST\.md\)/);
    assert.match(markdown, /## Asked again in a later session/);
  });

  it("adds a hand-edit signal when a file outlives its session with a later mtime", () => {
    const scans = [
      {
        session: session({ uuid: "uuid-w", id: "wwww3333", modified: "2026-01-01T10:00:00Z" }),
        scan: fakeScan({
          request: { message: 0, created: "2026-01-01T09:00:00Z", text: "Rename the setting in the config file and update the docs" },
          lastOwner: "x-implement",
          stats: { toolCalls: 4, userMessages: 2 },
          writes: [{ path: "/repo/config.json", message: 3 }],
        }),
      },
    ];
    const stale = mod.buildSummary({ ...summaryInput({ scans }), generatedAt: new Date("2026-01-02T05:00:00Z"), mtime: () => null });
    assert.equal(stale.select.length, 0, "a missing file says nothing");
    const touched = mod.buildSummary({
      ...summaryInput({ scans }),
      generatedAt: new Date("2026-01-02T05:00:00Z"),
      mtime: () => Date.parse("2026-01-01T10:30:00Z"),
    });
    assert.equal(touched.select[0].reason, "user-handedit");
    assert.equal(touched.select[0].owner, "x-implement");
    assert.match(touched.verdictLines[0], /user-handedit/);
  });

  it("reads the newest earlier pack beside today's, and nothing when there is none", async () => {    await withTmpDir("previous", async (dir) => {
      for (const [day, id] of [["2025-12-30", "old"], ["2026-01-01", "yesterday"]]) {
        await fsp.mkdir(path.join(dir, day), { recursive: true });
        fs.writeFileSync(path.join(dir, day, "summary.json"), JSON.stringify({ sessions: [{ id }] }));
      }
      assert.deepEqual(mod.previousSessions(path.join(dir, "2026-01-02")).map((entry) => entry.id), ["yesterday"]);
      assert.deepEqual(mod.previousSessions(path.join(dir, "2025-12-30")), []);
    });
  });

  it("keeps a headless run out of the reading list, the retries and the audit", () => {
    const request = (created) => ({ message: 0, created, text: "Do a deep research on the reflection skills with online sources and loops" });
    const scans = [
      {
        session: session({ uuid: "uuid-a", id: "aaaa1111", host: "claude" }),
        scan: fakeScan({ source: { headless: true }, request: request("2026-01-01T10:00:00Z"), stats: { toolCalls: 1, userMessages: 3 }, signals: [signal({ kind: "user-redo", suspects: ["x-plan"] })] }),
      },
      {
        session: session({ uuid: "uuid-b", id: "bbbb2222", host: "claude" }),
        scan: fakeScan({ source: { headless: true }, request: request("2026-01-01T10:10:00Z"), stats: { toolCalls: 1, userMessages: 3 } }),
      },
    ];
    const summary = mod.buildSummary({ ...summaryInput({ scans }), generatedAt: new Date("2026-01-02T05:00:00Z") });
    assert.deepEqual([summary.select, summary.retries, summary.audit], [[], [], null]);
  });

  it("lets model-read pushback choose a session once the labels validate it", () => {
    const scans = [
      {
        session: session({ uuid: "uuid-p", id: "pppp1111", host: "crush" }),
        scan: fakeScan({ stats: { toolCalls: 1, userMessages: 3 }, signals: [signal({ kind: "user-pushback", severity: "medium", suspects: ["x-ui"] })] }),
      },
    ];
    const unvalidated = mod.buildSummary({ ...summaryInput({ scans }), generatedAt: new Date("2026-01-02T05:00:00Z") });
    assert.deepEqual(unvalidated.select, []);
    const validated = mod.buildSummary({ ...summaryInput({ scans }), validated: new Set(["user-pushback"]), generatedAt: new Date("2026-01-02T05:00:00Z") });
    assert.deepEqual(validated.select.map((choice) => choice.reason), ["user-pushback"]);
  });

  it("finds a retry whose first ask sits in yesterday's pack", () => {
    const request = (created) => ({ message: 0, created, text: "Do a deep research on the reflection skills with online sources and loops" });
    const scans = [
      {
        session: session({ uuid: "uuid-b", id: "bbbb2222", host: "claude" }),
        scan: fakeScan({ request: request("2026-01-02T01:00:00Z"), stats: { toolCalls: 2, userMessages: 3 } }),
      },
    ];
    const previous = [{ id: "aaaa1111", host: "crush", uuid: "uuid-a", model: "deepseek-v4-pro", request: request("2026-01-01T23:30:00Z"), lastOwner: "x-research" }];
    const summary = mod.buildSummary({ ...summaryInput({ scans }), previous, generatedAt: new Date("2026-01-02T05:00:00Z") });
    assert.deepEqual(summary.retries.map((retry) => [retry.earlier, retry.later, retry.hours]), [["crush:uuid-a", "claude:uuid-b", 1.5]]);
    assert.deepEqual(summary.select, [], "yesterday's session was reviewed yesterday; today only records the retry");
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

  it("reads user turns through the configured classifier command and records what it answered", async () => {
    const now = new Date();
    const talk = {
      meta: { id: "cccc3333", uuid: "uuid-cccc3333", title: "Talk", created: "2026-01-01T00:00:00Z", modified: now.toISOString() },
      messages: [
        { role: "user", parts: [{ type: "text", text: "follow skills/x-fake/SKILL.md and write the whole report for me" }] },
        { role: "assistant", parts: [{ type: "text", text: "Report written." }] },
        { role: "user", parts: [{ type: "text", text: "that is TOO long, ten seconds to scan is the max" }] },
      ],
    };
    await withFakeHost(
      { sessions: [{ id: "cccc3333", uuid: "uuid-cccc3333", title: "Talk", created: "2026-01-01T00:00:00Z", modified: now.toISOString() }], shows: { cccc3333: talk } },
      async ({ bin, out, skills, projectsFile }) => {
        const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_FIXTURES: path.join(bin, "..", "fixtures") };
        const run = await runCollect(
          ["--host", "crush", "--out", out, "--skills-dir", skills, "--projects-file", projectsFile, "--no-prune", "--classifier", "cat >/dev/null; echo 1 pushback"],
          env
        );
        assert.equal(run.code, 0, run.stderr);
        const summary = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
        assert.deepEqual(summary.classifier, { command: "cat >/dev/null; echo 1 pushback", asked: 1, answered: 1, batches: 1, failed: 0 });
        assert.ok(summary.signals.some((signal) => signal.kind === "user-pushback"));
        assert.ok(fs.existsSync(path.join(out, "sessions", "uuid-cccc3333.turns.json")));
      }
    );
  });

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
          summary.hosts.map((host) => `${host.id}=${host.status}/${host.sessions}`).sort(),
          ["codex=ok/1", "crush=ok/1"]
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
      assert.equal(
        JSON.parse(run.stderr).error,
        'Unknown host "claude-code"; known hosts: opencode, claude, codex, gemini, cursor, cline, goose, crush, qwen, kilo, roo, copilot'
      );
    });
  });

  it("exits 2 with a message when the skills directory has nothing to attribute to", async () => {
    await withTmpDir("no-skills", async (empty) => {
      const run = await runCollect(["--skills-dir", empty, "--out", path.join(empty, "out"), "--check"]);
      assert.equal(run.code, 2);
      assert.match(run.stderr, /no x-\* skills found/);
    });
  });

  it("records the day under --out, never into the repository", async () => {
    await withTmpDir("record", async (dir) => {
      const out = path.join(dir, "2026-01-02");
      await fsp.mkdir(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, "summary.json"),
        JSON.stringify({ pack: "2026-01-02", window: { hours: 24 }, counts: {}, sessions: [], signals: [], skills: { touched: [], idle: [] } })
      );
      const repoHistory = path.join(mod.REPO_ROOT, ".x-skills", "daily", "history.jsonl");
      const before = fs.existsSync(repoHistory) ? fs.readFileSync(repoHistory, "utf8") : null;

      const summary = { warnings: [], sessions: [] };
      mod.writePages(summary, { out });

      assert.ok(fs.existsSync(path.join(dir, "history.jsonl")), "the record lands in the pack's parent");
      assert.equal(summary.pages.days, 1, "and the day is counted");
      assert.equal(fs.existsSync(path.join(out, "report.html")), false, "no HTML: the app renders");
      const after = fs.existsSync(repoHistory) ? fs.readFileSync(repoHistory, "utf8") : null;
      assert.equal(after, before, "a run pointed elsewhere writes nothing into the repository");
    });
  });

  it("reads the ticked verdicts of earlier digests into labels.jsonl beside the record", async () => {
    await withTmpDir("labels", async (dir) => {
      const yesterday = path.join(dir, "2026-01-01");
      await fsp.mkdir(yesterday, { recursive: true });
      fs.writeFileSync(
        path.join(yesterday, "DIGEST.md"),
        "## Verdicts\n\n- [x] `aaaa1111` · user-redo msg 4 · x-plan · deepseek-v4-flash — below — note: shallow\n"
      );
      const out = path.join(dir, "2026-01-02");
      await fsp.mkdir(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, "summary.json"),
        JSON.stringify({ pack: "2026-01-02", window: { hours: 24 }, counts: {}, sessions: [], signals: [], skills: { touched: [], idle: [] } })
      );
      const summary = { warnings: [], sessions: [] };
      mod.writePages(summary, { out });

      const labels = fs
        .readFileSync(path.join(dir, "labels.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(labels.map((label) => [label.date, label.session, label.verdict, label.note]), [["2026-01-01", "aaaa1111", "below", "shallow"]]);
      assert.equal(summary.labels.labels, 1);
    });
  });
});
