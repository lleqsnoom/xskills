"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
const SKILL = path.join(REPO, "skills", "x-search", "SKILL.md");
const messages = () => import(new URL("../tools/x-search/src/messages.mjs", `file://${__filename}`).href);

function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, "the frontmatter block parses");
  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.match(/^([a-zA-Z-]+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim()]),
  );
}

test("skill: the frontmatter parses and the name matches its folder", () => {
  const text = fs.readFileSync(SKILL, "utf8");
  const meta = frontmatter(text);
  assert.equal(meta.name, path.basename(path.dirname(SKILL)));
  assert.ok(meta.description.length > 40, "the description says when to use it");
  assert.ok(!meta.description.includes("\n"), "description must be a single line for the regex parser");
  assert.equal(meta["user-invocable"], "true");
  assert.ok(text.includes("# X-Search"), "the body has a title");
});

test("skill: the host lists it with the frontmatter description", () => {
  const result = spawnSync(process.execPath, [path.join(REPO, "bin", "install.js"), "list"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find((entry) => entry.includes("x-search"));
  assert.ok(line, "x-search appears in the list");
  assert.match(line, /semantic|Search every indexed repository/i);
});

test("skill: every failure sentence in the code is quoted in the skill", async () => {
  const { MESSAGES } = await messages();
  const text = fs.readFileSync(SKILL, "utf8");
  const fragments = [
    MESSAGES.noIndex(),
    MESSAGES.embedderUnreachable("http://127.0.0.1:11434").split(" at ")[0],
    MESSAGES.engineUnavailable("vec0").split(", which")[0],
    MESSAGES.storeTooNew("/code/app/.x-skills/.index/index.db", 99).split(" (schema")[0],
    MESSAGES.refusingToIndex("/code/app", "not ignored by git in /code/app, so the index would show as untracked", "fix")
      .split("\n")[0]
      .split(" /code/app")[0],
    MESSAGES.pendingBuild("/code/app").split(" — resume")[0],
  ];
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `the skill quotes the code's sentence: ${fragment}`);
  }
});

test("docs: AGENTS.md no longer claims the project ships no MCP server, and names the one it does", () => {
  const agents = fs.readFileSync(path.join(REPO, "AGENTS.md"), "utf8");
  assert.doesNotMatch(agents, /ships no MCP server/);
  assert.match(agents, /x-search/);
  assert.match(agents, /tools\/x-search/);
});

test("docs: the README lists the skill and the three install commands", () => {
  const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  assert.match(readme, /^\| `x-search` \|/m, "the skills table has a row");
  assert.match(readme, /install --cli crush,claude,codex,opencode/);
  assert.match(readme, /index --all/);
  assert.match(readme, /\.x-skills\/\.index\/index\.db/);
});

test("docs: the tool README documents the store path and the engine choice", () => {
  const readme = fs.readFileSync(path.join(REPO, "tools", "x-search", "README.md"), "utf8");
  assert.match(readme, /\.x-skills\/\.index\/index\.db/);
  assert.match(readme, /vec0/);
  assert.match(readme, /ollama pull nomic-embed-text/);
  assert.match(readme, /refusing to index/);
});

test("docs: the skill is installable through the repository's own installer", (t) => {
  const target = path.join(REPO, ".agents", "skills", "x-search");
  const existed = fs.existsSync(target);
  t.after(() => {
    if (!existed) fs.rmSync(target, { recursive: true, force: true });
  });
  const result = spawnSync(process.execPath, [path.join(REPO, "bin", "install.js"), "install", "x-search"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(target, "SKILL.md")), true);
});
