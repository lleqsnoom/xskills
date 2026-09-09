#!/usr/bin/env node
/**
 * X-Parallel — Parallel Background Coding Agents
 *
 * Dispatches independent markdown tasks to full background agent processes,
 * each in an isolated git worktree. Merges committed results back into the
 * current branch. Zero dependencies (node built-ins only).
 *
 * Usage: node parallel.mjs --tasks <dir> [--parallel N] [--timeout-min N]
 *                          [--agent crush] [--keep-worktrees] [--dry-run]
 *                          [--prompt "<text>"]
 */

import { spawn, execSync } from "node:child_process";
import { readdir, readFile, writeFile, mkdir, rm, appendFile } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { join, basename, dirname } from "node:path";

function arg(name, def) {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  return def;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const TASK_DIR = arg("tasks", "");
const PARALLEL = parseInt(arg("parallel", "4"), 10);
const TIMEOUT_MIN = parseInt(arg("timeout-min", "30"), 10);
const AGENT = arg("agent", "crush");
const KEEP_WORKTREES = hasFlag("keep-worktrees");
const DRY_RUN = hasFlag("dry-run");
const RETRIES = parseInt(arg("retries", "1"), 10); // extra attempts after the first failure

const DEFAULT_PROMPT = `You are one parallel coding agent working in an isolated copy of the repository. Read TASK.md at the repository root: it contains your complete task. Implement it fully. Follow the task's own workflow (TDD if it names tests). Do not modify files outside the task's scope. When finished, run the project tests. Then commit all changes with one conventional commit message (type(scope): description). Leave the working tree clean, with no uncommitted changes. If you cannot complete the task, still leave the tree clean and state what is missing in your final answer.`;
const PROMPT = arg("prompt", DEFAULT_PROMPT);

const run = (cmd) =>
  execSync(cmd, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();

if (!TASK_DIR) {
  console.error("ERROR: --tasks <dir> is required.");
  process.exit(2);
}
if (!existsSync(TASK_DIR)) {
  console.error(`ERROR: task directory not found: ${TASK_DIR}`);
  process.exit(2);
}

// --- Repo sanity -----------------------------------------------------------
let repoRoot;
try {
  repoRoot = run("git rev-parse --show-toplevel");
} catch {
  console.error("ERROR: not inside a git repository.");
  process.exit(2);
}
const curBranch = run("git branch --show-current");
if (!curBranch) {
  console.error("ERROR: run from a normal branch, not detached HEAD.");
  process.exit(2);
}
const dirty = run("git status --porcelain");
if (dirty && !DRY_RUN) {
  console.error("ERROR: working tree is not clean. Commit or stash first.");
  process.exit(2);
}

const WT_BASE = join(repoRoot, ".x-skills", "worktrees");
const LOG_DIR = join(repoRoot, ".x-skills", "parallel-logs");

// --- Task discovery --------------------------------------------------------
async function collectMarkdown(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(p, out);
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function parseFiles(content) {
  const m = content.match(/(?:^|\n)\*\*Files?\*\*:\s*(.+)$/m);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/\s*\((new|mod)\)/, ""))
    .filter((s) => s.includes("."));
}

async function loadTasks() {
  const paths = await collectMarkdown(TASK_DIR);
  paths.sort();
  const tasks = [];
  for (const p of paths) {
    const content = await readFile(p, "utf8");
    const id = basename(p, ".md");
    const title = content.match(/^#\s*.{0,80}/m)?.[0].slice(2).trim() || id;
    tasks.push({ id, title, path: p, content, files: parseFiles(content), deps: [], wave: -1, status: "pending" });
  }
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    // A task depends on any sibling task basename appearing in its body.
    for (const other of tasks) {
      if (other.id === t.id) continue;
      if (new RegExp(`\\b${escapeRegExp(other.id)}\\b`).test(t.content)) t.deps.push(other.id);
    }
  }
  return tasks;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Wave scheduling -------------------------------------------------------
function buildWaves(tasks, limit) {
  const waves = [];
  const done = new Set();
  const remaining = [...tasks];
  let guard = 0;
  while (remaining.length > 0 && guard++ < tasks.length + 1) {
    const wave = [];
    const waveFiles = new Set();
    const deferred = [];
    for (const t of remaining) {
      const depsOk = t.deps.every((d) => done.has(d));
      const fileOk = t.files.every((f) => !waveFiles.has(f));
      if (depsOk && fileOk && wave.length < limit) {
        wave.push(t);
        t.files.forEach((f) => waveFiles.add(f));
      } else {
        deferred.push(t);
      }
    }
    if (wave.length === 0) {
      // Deadlock (cycle) or forced serialization: run the first eligible task alone.
      const solo = deferred.find((t) => t.deps.every((d) => done.has(d))) ?? deferred[0];
      wave.push(solo);
      deferred.splice(deferred.indexOf(solo), 1);
    }
    waves.push(wave);
    wave.forEach((t) => done.add(t.id));
    remaining.splice(0, remaining.length, ...deferred);
  }
  return waves;
}

// --- Worktree lifecycle ----------------------------------------------------
const slugOf = (id) => id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);

async function createWorktree(task) {
  const slug = slugOf(task.id);
  const branch = `xp/${slug}`;
  const wt = join(WT_BASE, slug);
  await mkdir(WT_BASE, { recursive: true });
  if (existsSync(wt)) {
    console.error(`  ✗ worktree exists: ${wt}`);
    return null;
  }
  try {
    try {
      run(`git worktree add ${quote(wt)} -b ${quote(branch)}`);
    } catch {
      // Rerun after a failed attempt: branch already exists, reuse it.
      run(`git worktree add ${quote(wt)} ${quote(branch)}`);
    }
    await writeFile(join(wt, "TASK.md"), `# Task: ${task.title}\n\nSource: ${task.id}\n\n---\n\n${task.content}\n`);
    // Never treat the dispatcher's own TASK.md as agent work.
    await appendFile(join(repoRoot, ".git", "info", "exclude"), `\nTASK.md\n`);
  } catch (err) {
    console.error(`  ✗ worktree creation failed for ${task.id}: ${err.message.split("\n")[0]}`);
    return null;
  }
  return { slug, branch, wt };
}

// --- Agent spawn -----------------------------------------------------------
function runAgent(task, wt) {
  return new Promise((resolve) => {
    const logPath = join(LOG_DIR, `${slugOf(task.id)}.log`);
    const commitWork = () => {
      // Auto-commit anything the agent left behind (never TASK.md).
      try {
        run(`git -C ${quote(wt)} add -A && git -C ${quote(wt)} commit -m ${quote(`feat: ${slugOf(task.id)} (auto)`)} --quiet`);
        return true;
      } catch {
        return false;
      }
    };
    mkdir(LOG_DIR, { recursive: true }).then(() => {
      const log = createWriteStream(logPath);
      const child = spawn(AGENT, ["run", PROMPT], {
        cwd: wt,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true, // own process group so the timeout can kill children too
      });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
        resolve({ ok: false, code: null, reason: `timeout after ${TIMEOUT_MIN}m`, log: logPath });
      }, TIMEOUT_MIN * 60_000);
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, code: null, reason: err.message, log: logPath });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const status = () => {
          try { return run(`git -C ${quote(wt)} status --porcelain`); } catch { return "?"; }
        };
        if (code === 0) {
          if (status() !== "") commitWork(); // agent forgot to commit
          const clean = status() === "";
          resolve({ ok: clean, code, clean, reason: clean ? "done" : "uncommitted changes remain", log: logPath });
        } else {
          commitWork(); // preserve partial work on the branch
          resolve({ ok: false, code, clean: false, reason: `exit ${code}`, log: logPath });
        }
      });
    });
  });
}

// --- Merge back ------------------------------------------------------------
function mergeBranch(slug) {
  try {
    run(`git merge --no-ff xp/${quote(slug)} -m "xp: ${slug.replace(/-+$/, "")}"`);
    return true;
  } catch {
    try { run("git merge --abort"); } catch {}
    return false;
  }
}

// --- Worktree removal (register + dir) -------------------------------------
async function removeWorktree(wt) {
  try {
    run(`git worktree remove --force ${quote(wt)}`);
  } catch {
    await rm(wt, { recursive: true, force: true }).catch(() => {});
    try { run(`git worktree prune`); } catch {}
  }
}

// --- Retry handling --------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Drop any leftover worktree + branch so the next attempt starts from main.
async function resetTask(task) {
  const slug = slugOf(task.id);
  const wt = join(WT_BASE, slug);
  if (existsSync(wt)) await removeWorktree(wt);
  try { run(`git branch -D xp/${quote(slug)} 2>/dev/null`); } catch {}
}

const totalAttempts = RETRIES + 1;

async function runWithRetries(task, cleanup) {
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (attempt > 1) {
      console.log(`  ↻ ${task.id}: retry ${attempt - 1}/${RETRIES} (backoff ${5 * attempt}s)`);
      await sleep(5_000 * attempt);
    }
    await resetTask(task);
    const info = await createWorktree(task);
    if (!info) {
      task.status = "failed";
      return { task, outcome: "failed", note: "no worktree", attempts: attempt };
    }
    if (KEEP_WORKTREES) cleanup.push(info);
    const res = await runAgent(task, info.wt);
    if (res.ok) {
      task.status = "merged";
      console.log(`  ✓ ${task.id}: done (attempt ${attempt})`);
      return { task, info, outcome: "done", attempts: attempt };
    }
    if (!KEEP_WORKTREES) await removeWorktree(info.wt);
    if (attempt === totalAttempts) {
      task.status = "failed";
      console.log(`  ✗ ${task.id}: ${res.reason} (log: ${res.log})`);
      return { task, outcome: "failed", note: res.reason, attempts: attempt };
    }
  }
}

// --- Main ------------------------------------------------------------------
async function main() {
  console.log(`\nX-Parallel — ${AGENT} workers, limit ${PARALLEL}, timeout ${TIMEOUT_MIN}m`);
  const tasks = await loadTasks();
  if (tasks.length === 0) {
    console.error("No *.md task files found under", TASK_DIR);
    process.exit(1);
  }
  const waves = buildWaves(tasks, PARALLEL);
  console.log(`Tasks: ${tasks.length} | Waves: ${waves.length}\n`);

  if (DRY_RUN) {
    waves.forEach((w, i) => {
      console.log(`Wave ${i + 1}: ${w.map((t) => t.id).join(", ")}`);
      for (const t of w) if (t.deps.length) console.log(`   deps(${t.id}): ${t.deps.join(", ")}`);
    });
    process.exit(0);
  }

  let failed = 0;
  let conflicted = 0;
  let merged = 0;
  const cleanup = [];

  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    console.log(`Wave ${i + 1}/${waves.length} (${wave.length} task${wave.length > 1 ? "s" : ""})`);
    const results = await Promise.all(
      wave.map(async (task) => {
        const r = await runWithRetries(task, cleanup);
        if (r.outcome !== "done") failed++;
        return r;
      }),
    );

    for (const r of results) {
      if (r.outcome !== "done" || !r.info) continue;
      if (mergeBranch(r.info.slug)) {
        merged++;
        console.log(`  ↔ merged ${r.info.slug} into ${curBranch}`);
        if (!KEEP_WORKTREES) {
          await removeWorktree(r.info.wt);
          run(`git branch -d xp/${quote(r.info.slug)}`);
        }
      } else {
        conflicted++;
        console.log(`  ⚠ ${r.info.slug}: merge conflict, left for manual resolution`);
      }
    }
  }

  console.log("\n=============================================");
  console.log(`Summary: ${merged} merged, ${conflicted} conflicted, ${failed} failed`);
  console.log(`Logs: ${LOG_DIR}`);
  if (conflicted > 0 || failed > 0) {
    console.log("Inspect failed tasks' branches (xp/<slug>) or resolve conflicts manually.");
    process.exit(1);
  }
  console.log("=============================================\n");
}

const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

main().catch((err) => {
  console.error("X-Parallel failed:", err);
  process.exit(1);
});
