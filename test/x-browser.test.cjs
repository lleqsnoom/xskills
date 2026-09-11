"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..", "skills", "x-browser", "scripts");
const DETECT = path.join(SCRIPTS, "detect-url.mjs");
const LAUNCH = path.join(SCRIPTS, "launch.mjs");

function run(script, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options.cwd,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function withFixture(files, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-browser-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(dir, name);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content);
    }
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

describe("x-browser detect-url — pure helpers", async () => {
  const mod = await import(DETECT);

  it("normalizeUrl adds http to host:port", () => {
    assert.equal(mod.normalizeUrl("localhost:3000"), "http://localhost:3000");
  });

  it("normalizeUrl preserves existing scheme and strips trailing slash", () => {
    assert.equal(mod.normalizeUrl("https://localhost:8443/"), "https://localhost:8443");
  });

  it("normalizeUrl keeps any explicit http(s) URL", () => {
    assert.equal(mod.normalizeUrl("https://example.com"), "https://example.com");
  });

  it("normalizeUrl returns null for empty or non-URL values", () => {
    assert.equal(mod.normalizeUrl(""), null);
    assert.equal(mod.normalizeUrl("/just/a/path"), null);
    assert.equal(mod.normalizeUrl(null), null);
  });

  it("parseEnv reads keys, strips quotes, ignores comments", () => {
    const env = mod.parseEnv('# comment\nAPP_URL="http://localhost:1234"\nexport PORT=8080\n');
    assert.equal(env.APP_URL, "http://localhost:1234");
    assert.equal(env.PORT, "8080");
  });

  it("extractPort picks the first matching pattern", () => {
    assert.equal(mod.extractPort("vite --port 5173", [/--port[=\s]+(\d{2,5})/]), 5173);
    assert.equal(mod.extractPort("no port here", [/--port[=\s]+(\d{2,5})/]), null);
  });
});

describe("x-browser detect-url — ranking", async () => {
  it("prefers an explicit APP_URL over README and script ports", async () => {
    await withFixture(
      {
        "README.md": "Dev at http://localhost:4200\n",
        "package.json": JSON.stringify({ scripts: { dev: "vite --port 5173" } }),
        ".env": "APP_URL=http://localhost:9999\n",
      },
      async (dir) => {
        const res = await run(DETECT, ["--cwd", dir]);
        assert.equal(res.code, 0);
        const out = JSON.parse(res.stdout);
        assert.equal(out.url, "http://localhost:9999");
        assert.match(out.source, /APP_URL/);
      }
    );
  });

  it("falls back to PORT-only env when no explicit URL exists", async () => {
    await withFixture(
      { ".env": "PORT=4321\n", "package.json": JSON.stringify({ dependencies: { next: "14" } }) },
      async (dir) => {
        const out = JSON.parse((await run(DETECT, ["--cwd", dir])).stdout);
        assert.equal(out.url, "http://localhost:4321");
      }
    );
  });

  it("uses framework default port from package.json", async () => {
    await withFixture(
      { "package.json": JSON.stringify({ dependencies: { vite: "^5" } }) },
      async (dir) => {
        const out = JSON.parse((await run(DETECT, ["--cwd", dir])).stdout);
        assert.equal(out.url, "http://localhost:5173");
      }
    );
  });

  it("reads angular.json port", async () => {
    await withFixture(
      { "angular.json": JSON.stringify({ projects: { app: { architect: { serve: { options: { port: 4300 } } } } } }) },
      async (dir) => {
        const out = JSON.parse((await run(DETECT, ["--cwd", dir])).stdout);
        assert.equal(out.url, "http://localhost:4300");
      }
    );
  });

  it("reads docker-compose published ports", async () => {
    await withFixture(
      { "docker-compose.yml": 'services:\n  web:\n    ports:\n      - "8081:80"\n' },
      async (dir) => {
        const out = JSON.parse((await run(DETECT, ["--cwd", dir])).stdout);
        assert.equal(out.url, "http://localhost:8081");
      }
    );
  });

  it("returns null url when nothing is found", async () => {
    await withFixture({ "README.md": "no urls here\n" }, async (dir) => {
      const out = JSON.parse((await run(DETECT, ["--cwd", dir])).stdout);
      assert.equal(out.url, null);
      assert.deepEqual(out.candidates, []);
    });
  });
});

describe("x-browser launch — pure helpers", async () => {
  const mod = await import(LAUNCH);

  it("buildChromeArgs includes the debugging port and user-data-dir", () => {
    const args = mod.buildChromeArgs({ debugPort: 9222, profileDir: "/tmp/p", url: "http://localhost:3000" });
    assert.ok(args.includes("--remote-debugging-port=9222"));
    assert.ok(args.includes("--user-data-dir=/tmp/p"));
    assert.equal(args.at(-1), "http://localhost:3000");
  });

  it("buildChromeArgs adds headless when requested", () => {
    const args = mod.buildChromeArgs({ debugPort: 9222, profileDir: "/tmp/p", url: null, headless: true });
    assert.ok(args.includes("--headless=new"));
  });

  it("buildChromeArgs omits the url when not provided", () => {
    const args = mod.buildChromeArgs({ debugPort: 9222, profileDir: "/tmp/p", url: null });
    assert.ok(!args.some((a) => a.startsWith("http")));
  });

  it("chromeCandidates returns platform-specific paths", () => {
    assert.ok(mod.chromeCandidates("darwin").every((p) => p.includes("/Applications/")));
    assert.ok(mod.chromeCandidates("linux").some((p) => p.includes("chromium")));
    assert.ok(mod.chromeCandidates("win32").every((p) => p.endsWith(".exe")));
  });

  it("resolveChromePath honors an existing explicit path", () => {
    assert.equal(mod.resolveChromePath(process.execPath), process.execPath);
  });

  it("resolveChromePath ignores a non-existent explicit path and falls back", () => {
    assert.notEqual(mod.resolveChromePath("/definitely/not/a/real/chrome"), "/definitely/not/a/real/chrome");
  });
});

describe("x-browser launch — CLI", async () => {
  it("--help prints usage and exits 0", async () => {
    const res = await run(LAUNCH, ["--help"]);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /remote debugging port/);
  });

  it("--dry-run prints the command without launching", async () => {
    const res = await run(LAUNCH, ["--dry-run", "--url", "http://localhost:5173", "--port", "9333"]);
    assert.equal(res.code, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.dryRun, true);
    assert.equal(out.debugPort, 9333);
    assert.equal(out.cdpUrl, "http://127.0.0.1:9333");
    assert.ok(out.args.includes("--remote-debugging-port=9333"));
    assert.ok(out.args.includes("http://localhost:5173"));
  });

  it("--dry-run auto-detects the url when omitted", async () => {
    await withFixture({ "README.md": "open http://localhost:4321\n" }, async (dir) => {
      const res = await run(LAUNCH, ["--dry-run"], { cwd: dir });
      assert.equal(res.code, 0);
      const out = JSON.parse(res.stdout);
      assert.equal(out.url, "http://localhost:4321");
      assert.match(out.urlSource, /README/);
    });
  });

  it("--dry-run uses an explicit --browser path", async () => {
    const res = await run(LAUNCH, ["--dry-run", "--browser", process.execPath, "--url", "http://localhost:5173"]);
    assert.equal(res.code, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.browser, process.execPath);
  });
});
