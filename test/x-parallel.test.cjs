"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "x-parallel", "scripts", "parallel.mjs");
const MOD = pathToFileURL(SCRIPT).href;

function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCRIPT, ...args], { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("x-parallel pure scheduling", async () => {
  const mod = await import(MOD);

  it("parseFiles extracts declared file paths and ignores prose", () => {
    const files = mod.parseFiles("**Files:** src/a.js (new), tests/a.test.js (mod)");
    assert.deepEqual(files, ["src/a.js", "tests/a.test.js"]);
    assert.deepEqual(mod.parseFiles("no files declared here"), []);
  });

  it("escapeRegExp escapes regex metacharacters", () => {
    assert.equal(mod.escapeRegExp("a.b(c)"), "a\\.b\\(c\\)");
  });

  it("slugOf sanitizes and truncates to 60 chars", () => {
    assert.equal(mod.slugOf("Task 0.1: setup"), "Task-0.1--setup");
    assert.ok(mod.slugOf("x".repeat(100)).length <= 60);
  });

  it("detectDependencies links a task to the siblings it names", () => {
    const tasks = [
      { id: "a", content: "does a" },
      { id: "b", content: "depends on a first" },
    ];
    const deps = mod.detectDependencies(tasks);
    assert.deepEqual(deps.a, []);
    assert.deepEqual(deps.b, ["a"]);
  });

  it("buildWaves puts dependent tasks in a later wave", () => {
    const tasks = [
      { id: "a", deps: [], files: [] },
      { id: "b", deps: ["a"], files: [] },
    ];
    const waves = mod.buildWaves(tasks, 4);
    assert.equal(waves.length, 2);
    assert.deepEqual(waves[0].map((t) => t.id), ["a"]);
    assert.deepEqual(waves[1].map((t) => t.id), ["b"]);
  });

  it("buildWaves serializes tasks that share a file", () => {
    const tasks = [
      { id: "a", deps: [], files: ["src/x.js"] },
      { id: "b", deps: [], files: ["src/x.js"] },
    ];
    const waves = mod.buildWaves(tasks, 4);
    const waveOf = (id) => waves.findIndex((w) => w.some((t) => t.id === id));
    assert.notEqual(waveOf("a"), waveOf("b"), "shared-file tasks must not run in the same wave");
  });

  it("buildWaves respects the concurrency limit", () => {
    const tasks = ["a", "b", "c"].map((id) => ({ id, deps: [], files: [] }));
    const waves = mod.buildWaves(tasks, 2);
    assert.ok(waves.every((w) => w.length <= 2));
    assert.equal(waves.flat().length, 3);
  });
});

describe("x-parallel CLI", () => {
  it("exits 2 when --tasks is missing", async () => {
    const res = await run([]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--tasks/);
  });

  it("exits 2 when the task directory does not exist", async () => {
    const res = await run(["--tasks", path.join(__dirname, "no-such-task-dir-xyz")]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /not found/);
  });

  it("exits 2 on an unknown --rights mode", async () => {
    const res = await run(["--tasks", __dirname, "--rights", "yolo"]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--rights/);
  });
});

describe("x-parallel rights inheritance", async () => {
  const mod = await import(MOD);

  it("configSearchDirs walks from cwd up to the repo root", () => {
    assert.deepEqual(mod.configSearchDirs("/repo/a/b", "/repo"), ["/repo/a/b", "/repo/a", "/repo"]);
  });

  it("findProjectConfigs keeps the nearest file per name", () => {
    const root = tmpDir("xp-rights-");
    try {
      fs.mkdirSync(path.join(root, "sub"));
      fs.writeFileSync(path.join(root, ".crushrc"), "outer\n");
      fs.writeFileSync(path.join(root, "crush.json"), "{}\n");
      fs.writeFileSync(path.join(root, "sub", ".crushrc"), "inner\n");
      assert.deepEqual(mod.findProjectConfigs(path.join(root, "sub"), root), [
        path.join(root, "sub", ".crushrc"),
        path.join(root, "crush.json"),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("inheritProjectRights copies the config into the worktree and excludes it", async () => {
    const root = tmpDir("xp-rights-");
    try {
      const wt = path.join(root, ".x-skills", "worktrees", "task-a");
      const exclude = path.join(root, "exclude");
      fs.mkdirSync(wt, { recursive: true });
      fs.writeFileSync(path.join(root, ".crushrc"), "permissions allow bash\n");
      fs.writeFileSync(exclude, "# git info/exclude\n");
      const inherited = await mod.inheritProjectRights({ worktree: wt, cwd: root, root, excludePath: exclude });
      assert.deepEqual(inherited, [".crushrc"]);
      assert.equal(fs.readFileSync(path.join(wt, ".crushrc"), "utf8"), "permissions allow bash\n");
      const excluded = fs.readFileSync(exclude, "utf8").split("\n").map((line) => line.trim());
      assert.ok(excluded.includes("TASK.md"), "the task file must stay untracked");
      assert.ok(excluded.includes(".crushrc"), "inherited config must never be committed");
      const again = await mod.inheritProjectRights({ worktree: wt, cwd: root, root, excludePath: exclude });
      assert.deepEqual(again, [".crushrc"]);
      assert.equal(fs.readFileSync(exclude, "utf8"), "# git info/exclude\nTASK.md\n.crushrc\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("inheritProjectRights in none mode copies nothing but still excludes the task file", async () => {
    const root = tmpDir("xp-rights-");
    try {
      const wt = path.join(root, "wt");
      const exclude = path.join(root, "exclude");
      fs.mkdirSync(wt, { recursive: true });
      fs.writeFileSync(path.join(root, ".crushrc"), "permissions allow bash\n");
      fs.writeFileSync(exclude, "# git info/exclude\n");
      const inherited = await mod.inheritProjectRights({
        worktree: wt,
        cwd: root,
        root,
        mode: "none",
        excludePath: exclude,
      });
      assert.deepEqual(inherited, []);
      assert.equal(fs.existsSync(path.join(wt, ".crushrc")), false);
      assert.equal(fs.readFileSync(exclude, "utf8"), "# git info/exclude\nTASK.md\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("x-parallel worker rights (end to end)", () => {
  const hasGit = (() => {
    if (process.platform === "win32") return false;
    try {
      execSync("git --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it("runs the worker with the parent's project config", { skip: !hasGit }, async () => {
    const repo = tmpDir("xp-e2e-");
    const git = (args) => execSync(`git -C "${repo}" ${args}`, { encoding: "utf8" }).trim();
    try {
      git("init -q");
      git("config user.email xp@test");
      git("config user.name xp");
      fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
      fs.writeFileSync(path.join(repo, ".gitignore"), ".crushrc\ntasks/\nstub-agent.sh\n.x-skills/\n");
      git("add a.txt .gitignore");
      git("commit -qm init");
      fs.writeFileSync(path.join(repo, ".crushrc"), "permissions allow bash\n");
      const tasks = path.join(repo, "tasks");
      fs.mkdirSync(tasks);
      fs.writeFileSync(path.join(tasks, "task-a.md"), "# Task A\n\n**Files:** a.txt (mod)\n");

      // Stand-in for `crush run`: proves the config travelled, then commits work.
      const stub = path.join(repo, "stub-agent.sh");
      fs.writeFileSync(
        stub,
        `#!/bin/sh\n[ -f .crushrc ] || exit 4\necho done > worker-ran.txt\ngit add -A\ngit commit -qm "feat: stub worker"\n`,
      );
      fs.chmodSync(stub, 0o755);

      const res = await run(["--tasks", tasks, "--agent", stub, "--keep-worktrees"], { cwd: repo });
      assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
      assert.match(res.stdout, /Rights: inherit \(\.crushrc\)/);
      assert.equal(
        fs.readFileSync(path.join(repo, ".x-skills", "worktrees", "task-a", ".crushrc"), "utf8"),
        "permissions allow bash\n",
      );
      assert.equal(fs.readFileSync(path.join(repo, "worker-ran.txt"), "utf8").trim(), "done");
      assert.equal(git("ls-files").split("\n").includes(".crushrc"), false, "inherited config must not be committed");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
