#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Put the report in front of the reader: one command that starts the server if it is not already up and then
 * asks for a surface to read it in.
 *
 * Two surfaces, because they answer two different wishes:
 *   - an Orca browser tab (`orca tab create`) is where this app belongs — it is the reader's IDE, and the tab
 *     can be focused again later instead of stacking a second copy. Orca draws its own browser toolbar there.
 *   - an application window (`chrome --app=`) has no tabs, no address bar and no back button at all, which is
 *     the only way to read a page with no browser controls. Nothing inside a browser tab can hide that tab's
 *     own chrome, so this is not an either/or we can collapse.
 *
 * The decision of *which* surface belongs to the machine (is `orca` here? is a Chromium installed?), so this
 * module also answers `isUp` and `findBrowser` for the server's `POST /api/open`, and the CLI below is only
 * the same functions plus argument parsing.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(REPO_ROOT, "scripts", "report-server.mjs");
const DEFAULT_PORT = 8787;
const ORCA = process.env.ORCA_CLI ?? "orca";

export function reportUrl({ port = DEFAULT_PORT, path: route = "/" } = {}) {
  return `http://127.0.0.1:${port}${route}`;
}

/** The seam every caller can replace in a test: run a command, hand back what it printed. */
export function run(command, args, { cwd = process.cwd(), timeout = 20_000 } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: (result.stderr ?? "").trim() || result.error?.message || "",
  };
}

const firstLine = (text) => (text ?? "").trim().split("\n")[0] ?? "";

/** What a failed CLI call has to say: its own words, or the fact that it exited without any. */
const complained = (result) => firstLine(result.stderr || result.stdout) || `it exited ${result.code} without saying why`;

/** Is something already answering the report's API at this URL? */
export async function isUp(url, { timeoutMs = 1500 } = {}) {
  try {
    const response = await fetch(new URL("/api/movement", url), { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The Orca tabs, as the CLI reports them. `/orca tab list --json` wraps its payload in `result.tabs`, and a
 * tab without a page id cannot be focused — so it is dropped rather than reported as a tab we own.
 */
export function parseTabs(stdout) {
  try {
    const payload = JSON.parse(stdout);
    const tabs = payload?.result?.tabs ?? payload?.tabs ?? [];
    return tabs
      .map((tab) => ({ pageId: tab.pageId ?? tab.browserPageId ?? tab.id ?? null, url: tab.url ?? "", title: tab.title ?? "" }))
      .filter((tab) => tab.pageId);
  } catch {
    return [];
  }
}

/**
 * Open the report in an Orca tab, or focus the one that already has it. The origin is what is matched, so a
 * reader parked on `/skill/x-analyze` gets their own tab back rather than a second one at the root.
 *
 * Every call runs from the repository root: Orca resolves *which worktree* a tab belongs to from the working
 * directory, so a tab asked for from anywhere else would land in the wrong worktree of this same repo.
 */
export function openInOrca({ url, exec = run, cli = ORCA, cwd = REPO_ROOT }) {
  const origin = new URL(url).origin;
  const listed = exec(cli, ["tab", "list", "--json"], { cwd });
  if (listed.code === 0) {
    const existing = parseTabs(listed.stdout).find((tab) => tab.url.startsWith(origin));
    if (existing) {
      const focused = exec(cli, ["tab", "switch", "--page", existing.pageId, "--focus"], { cwd });
      return focused.code === 0
        ? { ok: true, surface: "orca", how: "focused", url, message: `focused the Orca tab already showing the report` }
        : { ok: false, surface: "orca", how: "focus-failed", url, message: `Orca would not focus its tab: ${complained(focused)}` };
    }
  }
  const created = exec(cli, ["tab", "create", "--url", url], { cwd });
  if (created.code !== 0) {
    return { ok: false, surface: "orca", how: "create-failed", url, message: `Orca would not open a tab: ${complained(created)}` };
  }
  return { ok: true, surface: "orca", how: "created", url, message: "opened the report in an Orca tab" };
}

/** The Chromium-family browsers worth trying, in the order a Linux desktop usually has them. */
const BROWSERS = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "brave", "brave-browser", "microsoft-edge"];

export function findBrowser({ env = process.env, exists = fs.existsSync } = {}) {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const name of BROWSERS) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * An application window: `--app` is Chromium's own "no browser controls" mode — no tab strip, no address bar —
 * and `--class` gives the window its own identity so a window manager does not file it under the browser.
 */
export function openInWindow({ url, browser = findBrowser(), launch = spawn }) {
  if (!browser) {
    return { ok: false, surface: "window", how: "no-browser", url, message: "no Chromium-family browser is installed, so there is no window to open" };
  }
  try {
    const child = launch(browser, [`--app=${url}`, "--class=x-skills-report"], { detached: true, stdio: "ignore" });
    child.unref();
  } catch (err) {
    return { ok: false, surface: "window", how: "launch-failed", url, message: `could not start ${path.basename(browser)}: ${err.message}` };
  }
  return { ok: true, surface: "window", how: "app-window", url, message: `opened a window with no browser controls (${path.basename(browser)})` };
}

/** Whatever this desktop opens a URL with. The last resort, and the one that keeps browser controls. */
export function openInDefaultBrowser({ url, launch = spawn }) {
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = launch(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch (err) {
    return { ok: false, surface: "default", how: "launch-failed", url, message: `could not open a browser: ${err.message}` };
  }
  return { ok: true, surface: "default", how: "xdg-open", url, message: "opened the report in the desktop browser" };
}

/**
 * Ask for a surface, falling back down the chain when the machine cannot provide the one that was wanted: an
 * Orca tab needs the CLI *and* a running Orca, a window needs a Chromium. The answer always says which one
 * was used, because "it opened" is not an answer when the window is not the one the reader expected.
 */
export function openReport({ url, surface = "orca", exec = run, browser = undefined, launch = spawn } = {}) {
  const wanted = surface === "window" ? ["window", "orca"] : ["orca", "window"];
  const attempts = [];
  for (const candidate of wanted) {
    const result =
      candidate === "orca" ? openInOrca({ url, exec }) : openInWindow({ url, browser: browser ?? findBrowser(), launch });
    if (result.ok) return { ...result, tried: attempts };
    attempts.push(result.message);
  }
  const last = openInDefaultBrowser({ url, launch });
  return { ...last, tried: attempts };
}

/**
 * Start the server if it is not answering, and wait for it to answer. Detached on purpose: this command
 * returns while the server keeps serving, which is what a quick-command button needs.
 */
export async function ensureServer({ port = DEFAULT_PORT, root, days, spawnFn = spawn, probe = isUp, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const url = reportUrl({ port });
  if (await probe(url)) return { started: false, url };
  const args = [SERVER, "--port", String(port)];
  if (root) args.push("--root", root);
  if (days) args.push("--days", String(days));
  const child = spawnFn(process.execPath, args, { detached: true, stdio: "ignore", cwd: REPO_ROOT });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(250);
    if (await probe(url)) return { started: true, pid: child.pid ?? null, url };
  }
  return { started: true, pid: child.pid ?? null, url, ready: false };
}

/** The page a request came from, as a path this server owns. Anything that could address another origin is refused. */
export function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[:\\@]/.test(value)) return "/";
  return value;
}

function usage() {
  return [
    "xskills report:open — start the report if it is not running, then open it.",
    "",
    "Usage:",
    "  npm run report:open [-- --window --port 8787]",
    "",
    "Flags:",
    "  --port <n>       Port the report runs on (default 8787)",
    "  --root <dir>     The daily root to serve (default .x-skills/daily)",
    "  --days <n>       How many days of history the API reads (default 14)",
    "  --window         Open a window with no browser controls (chrome --app), not an Orca tab",
    "  --orca           Ask for an Orca tab (the default; the window is tried if Orca cannot oblige)",
    "  --print          Say what would be opened, without opening anything",
    "  --json           Print the answer as JSON",
    "  --help           Show this help",
    "",
    "Surfaces:",
    "  orca     a browser tab inside Orca — focused, not duplicated, when it is already open",
    "  window   chrome --app: no tabs and no address bar, which is the only way to hide browser controls",
    "",
  ].join("\n");
}

function parseArgs(args) {
  const out = { _: [], unknown: [] };
  const known = ["port", "root", "days", "window", "orca", "print", "json", "help"];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (!known.includes(key)) {
      out.unknown.push(key);
      continue;
    }
    out[key] = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (args.unknown.length) {
    process.stderr.write(`Unknown argument "${args.unknown[0]}"\n\n${usage()}`);
    return 2;
  }
  const port = Number(typeof args.port === "string" ? args.port : process.env.PORT ?? DEFAULT_PORT) || DEFAULT_PORT;
  const surface = args.window === true ? "window" : "orca";

  if (args.print === true) {
    const plan = { surface, url: reportUrl({ port }), port, running: await isUp(reportUrl({ port })), browser: findBrowser() };
    process.stdout.write(args.json === true ? `${JSON.stringify(plan)}\n` : `would start ${plan.running ? "nothing (already up)" : SERVER} and open ${plan.url} as ${surface}\n`);
    return 0;
  }

  const server = await ensureServer({
    port,
    root: typeof args.root === "string" ? path.resolve(args.root) : undefined,
    days: typeof args.days === "string" ? Number(args.days) : undefined,
  });
  if (server.ready === false) {
    process.stderr.write(`started the report server (pid ${server.pid}) but ${server.url} never answered\n`);
    return 1;
  }
  const result = openReport({ url: server.url, surface });
  const line = [
    server.started ? `started the report server (pid ${server.pid}) on ${server.url}` : `the report was already up on ${server.url}`,
    result.message,
    ...(result.tried ?? []).map((note) => `  skipped: ${note}`),
  ].join("\n");
  if (args.json === true) process.stdout.write(`${JSON.stringify({ ...result, server })}\n`);
  else process.stdout.write(`${line}\n`);
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exitCode = await main();
}

export { DEFAULT_PORT, ORCA, REPO_ROOT, SERVER };
