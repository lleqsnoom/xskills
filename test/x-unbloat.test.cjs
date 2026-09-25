"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MEASURE = path.join(__dirname, "..", "skills", "x-unbloat", "scripts", "measure.mjs");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
const write = (cwd, file, text) => fs.writeFileSync(path.join(cwd, file), text);
const measure = (cwd, ...args) => {
  const result = spawnSync("node", [MEASURE, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
};

describe("x-unbloat measure.mjs", () => {
  let repo;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "x-unbloat-"));
    git(repo, "init", "-q");
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "root");
    write(repo, "a.js", "one\ntwo\nthree\n");
    write(repo, "package.json", JSON.stringify({ dependencies: { left: "1" } }));
    git(repo, "add", ".");
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
  });

  it("counts lines removed, lines added and untracked files against HEAD", () => {
    write(repo, "a.js", "one\n");
    write(repo, "b.js", "new\nfile\n");
    const { code, json } = measure(repo);
    assert.equal(code, 0);
    assert.equal(json.filesTouched, 2);
    assert.equal(json.linesRemoved, 2);
    assert.equal(json.linesAdded, 2);
    assert.equal(json.netLines, 0);
    assert.deepEqual(json.depsAdded, []);
  });

  it("exits 1 and names a dependency that was added", () => {
    write(repo, "package.json", JSON.stringify({ dependencies: { left: "1" }, devDependencies: { pad: "1" } }));
    const { code, json } = measure(repo);
    assert.equal(code, 1);
    assert.deepEqual(json.depsAdded, ["package.json: pad"]);
  });

  it("reports a removed dependency without failing", () => {
    write(repo, "package.json", JSON.stringify({ dependencies: {} }));
    const { code, json } = measure(repo);
    assert.equal(code, 0);
    assert.deepEqual(json.depsRemoved, ["package.json: left"]);
  });

  it("exits 2 on a base ref that does not exist", () => {
    const { code, stderr } = measure(repo, "--base", "no-such-ref");
    assert.equal(code, 2);
    assert.match(stderr, /measure\.mjs:/);
  });
});

const VERDICTS = path.join(__dirname, "..", "skills", "x-unbloat", "scripts", "verdicts.mjs");
const verdicts = (cwd, ...args) => {
  const result = spawnSync("node", [VERDICTS, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
};

const FILLED = `# Unbloat — demo

**Base:** abc1234

## Verdicts

| Unit | Verdict | Why | Call sites |
|------|---------|-----|------------|
| UserRepoFactory | cut | one implementation, not a test seam | src/app.js:12 |
| validateInput | keep | Never Cut: trust boundary | — |

## Measure

\`\`\`json
{ "netLines": -14, "depsAdded": [] }
\`\`\`

## Left for the user

nothing
`;

describe("x-unbloat verdicts.mjs", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-unbloat-v-")); });

  const initRepo = () => {
    git(dir, "init", "-q");
    git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "root");
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  };

  it("creates E00-unbloat.md in a run folder with the base commit, and the empty template fails the check", () => {
    const head = initRepo();
    const created = verdicts(dir, "new", "--slug", "Tidy Services");
    assert.equal(created.code, 0);
    assert.equal(created.json.base, head);
    assert.match(fs.readFileSync(created.json.path, "utf8"), new RegExp(`^\\*\\*Base:\\*\\* ${head}$`, "m"));
    assert.match(created.json.path, /\.x-skills\/runs\/[^/]+-R01-tidy-services\/E00-unbloat\.md$/);
    const checked = verdicts(dir, "check", "--file", created.json.path);
    assert.equal(checked.code, 1);
    assert.ok(checked.json.violations.some((v) => v.startsWith("no verdict rows")));
    assert.ok(checked.json.violations.some((v) => v.startsWith("Measure")));
  });

  // A repository whose base commit holds UserRepoFactory, deleted in the working tree.
  const cutFactory = () => {
    initRepo();
    write(dir, "factory.js", "export class UserRepoFactory {}\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    fs.rmSync(path.join(dir, "factory.js"));
    return base;
  };

  it("passes a filled record whose cut shows in the diff, and counts its verdicts", () => {
    const file = path.join(dir, "E00-unbloat.md");
    fs.writeFileSync(file, FILLED.replace("abc1234", cutFactory()).replace("| UserRepoFactory |", "| `UserRepoFactory()` |"));
    const { code, json } = verdicts(dir, "check", "--file", file);
    assert.equal(code, 0, JSON.stringify(json.violations));
    assert.deepEqual([json.units, json.cut, json.kept, json.netLines], [2, 1, 1, -14]);
  });

  it("fails a cut that no removed line names", () => {
    const file = path.join(dir, "E00-unbloat.md");
    fs.writeFileSync(file, FILLED.replace("abc1234", cutFactory()).replace("| UserRepoFactory |", "| OrderService |"));
    const { code, json } = verdicts(dir, "check", "--file", file);
    assert.equal(code, 1);
    assert.deepEqual(json.violations, ["OrderService: marked cut, but no line removed since the base names it"]);
  });

  it("matches whole identifiers: a removed width does not confirm a cut id, a deleted file confirms its path", async () => {
    const { checkVerdicts } = await import(pathToFileURL(VERDICTS).href);
    const record = (unit) => FILLED.replace("| UserRepoFactory |", `| ${unit} |`).replace(/\| validateInput .*\n/, "");
    assert.deepEqual(checkVerdicts(record("id"), "-  const width = 1;").violations,
      ["id: marked cut, but no line removed since the base names it"]);
    assert.deepEqual(checkVerdicts(record("id"), "-  return user.id;").violations, []);
    assert.deepEqual(checkVerdicts(record("src/old.js"), "--- a/src/old.js").violations, []);
  });

  it("fails a cut it cannot confirm outside the repository", () => {
    const file = path.join(dir, "E00-unbloat.md");
    fs.writeFileSync(file, FILLED);
    const { code, json } = verdicts(dir, "check", "--file", file);
    assert.equal(code, 1);
    assert.ok(json.violations.some((v) => v.startsWith("cannot read the diff since the base")));
  });

  it("fails a cut with no call sites and a verdict that is neither keep nor cut", () => {
    const file = path.join(dir, "E00-unbloat.md");
    fs.writeFileSync(file, FILLED
      .replace("| src/app.js:12 |", "|  |")
      .replace("| keep |", "| maybe |"));
    const { code, json } = verdicts(dir, "check", "--file", file);
    assert.equal(code, 1);
    assert.ok(json.violations.some((v) => v.includes("UserRepoFactory: a cut must list its call sites")));
    assert.ok(json.violations.some((v) => v.includes('validateInput: verdict must be keep or cut, got "maybe"')));
  });

  it("fails a record whose base is not a commit hash", () => {
    const file = path.join(dir, "E00-unbloat.md");
    fs.writeFileSync(file, FILLED.replace("abc1234", "TODO"));
    const { code, json } = verdicts(dir, "check", "--file", file);
    assert.equal(code, 1);
    assert.ok(json.violations.some((v) => v.startsWith("Base is not a commit hash")));
  });

  it("refuses to create a record outside a git repository", () => {
    const { code, stderr } = verdicts(dir, "new", "--slug", "x");
    assert.equal(code, 2);
    assert.match(stderr, /not a git repository/i);
  });

  it("measure --record reads the base from the record, writes Measure, and the record then passes", () => {
    initRepo();
    write(dir, "a.js", "one\ntwo\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
    const created = verdicts(dir, "new", "--slug", "trim");
    write(dir, "a.js", "one\n");
    const text = fs.readFileSync(created.json.path, "utf8")
      .replace("|------------|\n", "|------------|\n| two | cut | rung 1: not needed | none |\n")
      .replace(/## Left for the user\n\n.*\n/, "## Left for the user\n\nnothing\n");
    fs.writeFileSync(created.json.path, text);
    const measured = measure(dir, "--record", created.json.path);
    assert.equal(measured.code, 0, measured.stderr);
    assert.equal(measured.json.netLines, -1);
    assert.equal(measured.json.filesTouched, 1, "the record itself is not counted");
    const checked = verdicts(dir, "check", "--file", created.json.path);
    assert.equal(checked.code, 0, JSON.stringify(checked.json.violations));
    assert.equal(checked.json.netLines, -1);
  });

  it("exits 2 on a missing file", () => {
    assert.equal(verdicts(dir, "check", "--file", "nope.md").code, 2);
  });
});

describe("x-unbloat dependency manifests", () => {
  const load = import(pathToFileURL(MEASURE).href);
  const added = async (file, text) => (await load).dependencyDelta(file, "", text).added;

  it("reads PEP 621 lists, optional groups and Poetry tables, not python itself", async () => {
    const text = '[project]\nname = "x"\ndependencies = [\n  "requests>=2",\n  "Rich[jupyter] ~= 13",\n]\n'
      + '[project.optional-dependencies]\ndev = ["pytest"]\n[tool.poetry.dependencies]\npython = "^3.11"\nhttpx = "*"\n';
    assert.deepEqual((await added("pyproject.toml", text)).sort(),
      ["pyproject.toml: httpx", "pyproject.toml: pytest", "pyproject.toml: requests", "pyproject.toml: rich"]);
  });

  it("reads Gemfile gems, pom.xml coordinates and Gradle configurations", async () => {
    assert.deepEqual(await added("Gemfile", 'gem "rails", "~> 7"\n  gem \'pg\'\n'), ["Gemfile: rails", "Gemfile: pg"]);
    assert.deepEqual(await added("pom.xml", "<dependency><groupId>org.junit</groupId><artifactId>junit</artifactId></dependency>"),
      ["pom.xml: org.junit:junit"]);
    assert.deepEqual(await added("app/build.gradle.kts", 'implementation("com.squareup:okhttp:4")\ntestImplementation \'junit:junit:4\'\n'),
      ["app/build.gradle.kts: com.squareup:okhttp", "app/build.gradle.kts: junit:junit"]);
  });
});
