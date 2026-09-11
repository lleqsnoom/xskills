#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { detectUrl } from "./detect-url.mjs";

export const DEFAULT_DEBUG_PORT = 9222;

export function chromeCandidates(platform = process.platform) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  if (platform === "win32") {
    const pf = process.env["PROGRAMFILES"] || "C:/Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] || "";
    return [
      path.join(pf, "Google/Chrome/Application/chrome.exe"),
      path.join(pf86, "Google/Chrome/Application/chrome.exe"),
      path.join(local, "Google/Chrome/Application/chrome.exe"),
      path.join(pf, "Chromium/Application/chrome.exe"),
      path.join(pf, "Microsoft/Edge/Application/msedge.exe"),
      path.join(pf86, "Microsoft/Edge/Application/msedge.exe"),
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/brave-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
  ];
}

export function resolveChromePath(explicit, platform = process.platform) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN);
  candidates.push(...chromeCandidates(platform));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

export function buildChromeArgs({ debugPort, profileDir, url, headless = false }) {
  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
  ];
  if (headless) args.push("--headless=new");
  if (url) args.push(url);
  return args;
}

export function defaultProfileDir() {
  return path.join(os.homedir(), ".x-skills", "chrome-profile");
}

export async function cdpReachable(debugPort, timeoutMs = 800) {
  try {
    const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function appReachable(url, timeoutMs = 1200) {
  if (!url) return false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const opts = {
    url: null,
    debugPort: DEFAULT_DEBUG_PORT,
    profileDir: null,
    browser: null,
    headless: false,
    dryRun: false,
    detached: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url" && i + 1 < argv.length) opts.url = argv[++i];
    else if (arg === "--port" && i + 1 < argv.length) opts.debugPort = Number(argv[++i]);
    else if (arg === "--profile-dir" && i + 1 < argv.length) opts.profileDir = argv[++i];
    else if (arg === "--browser" && i + 1 < argv.length) opts.browser = argv[++i];
    else if (arg === "--headless") opts.headless = true;
    else if (arg === "--foreground") opts.detached = false;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
  }
  return opts;
}

const HELP = `Usage: node launch.mjs [options]

Launches Chrome/Chromium with a remote debugging port so the chrome-devtools MCP
server (configured with --browserUrl http://127.0.0.1:9222) can attach to it.

Options:
  --url <url>          App URL to open (default: auto-detect from project files)
  --port <n>           Remote debugging port (default: 9222, must match MCP config)
  --profile-dir <dir>  Chrome user-data-dir (default: ~/.x-skills/chrome-profile)
  --browser <path>     Explicit Chrome/Chromium executable path
  --headless           Launch without a visible window
  --foreground         Keep the launcher attached instead of detaching
  --dry-run            Print what would run without launching
  --help               Show this help
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  let url = opts.url;
  let urlSource = url ? "cli" : null;
  if (!url) {
    const detected = detectUrl(process.cwd());
    url = detected.url;
    urlSource = detected.source;
  }

  const profileDir = opts.profileDir || defaultProfileDir();
  const browser = resolveChromePath(opts.browser);
  const args = buildChromeArgs({
    debugPort: opts.debugPort,
    profileDir,
    url,
    headless: opts.headless,
  });

  if (opts.dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          launched: false,
          dryRun: true,
          browser,
          args,
          url,
          urlSource,
          debugPort: opts.debugPort,
          cdpUrl: `http://127.0.0.1:${opts.debugPort}`,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  if (await cdpReachable(opts.debugPort)) {
    process.stdout.write(
      JSON.stringify(
        {
          launched: false,
          reason: "already-running",
          debugPort: opts.debugPort,
          cdpUrl: `http://127.0.0.1:${opts.debugPort}`,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  if (!browser) {
    process.stderr.write(
      "No Chrome/Chromium executable found. Install Chrome or pass --browser <path> (or set CHROME_PATH).\n"
    );
    process.exit(1);
  }

  fs.mkdirSync(profileDir, { recursive: true });

  const child = spawn(browser, args, {
    detached: opts.detached,
    stdio: "ignore",
    windowsHide: false,
  });

  if (opts.detached) child.unref();

  const appUp = await appReachable(url);

  process.stdout.write(
    JSON.stringify(
      {
        launched: true,
        pid: child.pid,
        browser,
        debugPort: opts.debugPort,
        cdpUrl: `http://127.0.0.1:${opts.debugPort}`,
        url,
        urlSource,
        appReachable: appUp,
        profileDir,
      },
      null,
      2
    ) + "\n"
  );

  if (!appUp && url) {
    process.stderr.write(
      `Warning: ${url} is not reachable yet. Start the dev server before interacting with the page.\n`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
