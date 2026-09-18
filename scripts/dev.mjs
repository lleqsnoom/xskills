#!/usr/bin/env node
/**
 * `npm run dev` — the two processes a change needs, started together.
 *
 * The report server owns the packs and the `/api` routes; Vite owns the page. So this runs both: the server
 * under `node --watch`, so an edit to it or to anything it imports restarts it, and Vite's dev server, so an
 * edit to a component hot-reloads the page without a restart. Vite proxies `/api` and `/history.jsonl` to
 * the report server (see `tools/report-app/vite.config.ts`), which is why one URL answers with both.
 *
 * The panel is not baked here. The server bakes it by default, and a bake is a write to the committed
 * `tools/orca-plugin/panel.html` on every restart, which turns a dev loop into a dirty worktree. Pass
 * `--panel` to bake it anyway; `npm run report` still bakes it beside the built app.
 *
 * Flags:
 *   --port <n>   Port for the report server (default 8787). Vite is told where it moved to.
 *   --panel      Bake the Orca plugin's panel too (off by default here).
 *   --help       Show this help.
 *
 * Anything else is passed through to the report server: `--days`, `--root`, `--no-refresh`.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(REPO_ROOT, "tools", "report-app");

const INK = { server: "\x1b[36m", app: "\x1b[35m", dim: "\x1b[2m", reset: "\x1b[0m" };

const USAGE = [
  "xskills dev — the report server (restarting on change) and the app's dev server (hot reload).",
  "",
  "Usage:",
  "  npm run dev [-- --port 8787 --days 14]",
  "",
  "Flags:",
  "  --port <n>   Port for the report server (default 8787)",
  "  --panel      Bake the Orca plugin's panel on every restart (off by default in dev)",
  "  --no-watch   Do not restart the server when its own files change",
  "  --help       Show this help",
  "",
  "  --days, --root, --no-refresh … are passed through to the report server.",
  "",
].join("\n");

function parseArgs(args) {
  const out = { port: Number(process.env.PORT) || 8787, panel: false, watch: true, server: [], help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--port") {
      out.port = Number(args[i + 1]) || out.port;
      i++;
    } else if (arg.startsWith("--port=")) {
      out.port = Number(arg.slice("--port=".length)) || out.port;
    } else if (arg === "--panel") {
      out.panel = true;
    } else if (arg === "--no-watch") {
      out.watch = false;
    } else {
      out.server.push(arg);
    }
  }
  if (!out.panel) out.server.push("--no-panel");
  out.server.push("--port", String(out.port));
  return out;
}

/** One line at a time, tagged with which process said it, so two streams stay readable. */
function relay(name, stream, sink) {
  let rest = "";
  stream.on("data", (chunk) => {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop();
    for (const line of lines) {
      if (line.trim()) sink.write(`${INK[name]}${name.padEnd(6)}${INK.reset} ${INK.dim}|${INK.reset} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (rest.trim()) sink.write(`${INK[name]}${name.padEnd(6)}${INK.reset} ${INK.dim}|${INK.reset} ${rest}\n`);
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!fs.existsSync(path.join(APP_DIR, "node_modules"))) {
    process.stderr.write("The app's dependencies are not installed: npm run report:install\n");
    return 1;
  }

  const reportUrl = `http://127.0.0.1:${args.port}`;
  const children = [];
  let stopping = false;

  const launch = (name, command, commandArgs, options) => {
    const child = spawn(command, commandArgs, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], ...options });
    relay(name, child.stdout, process.stdout);
    relay(name, child.stderr, process.stderr);
    child.on("exit", (code, signal) => {
      if (stopping) return;
      process.stderr.write(`${name} stopped (${signal ?? code}); stopping the rest\n`);
      stop(code ?? 1);
    });
    children.push(child);
    return child;
  };

  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
    setTimeout(() => process.exit(code ?? 0), 200).unref();
  };

  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  process.stdout.write(
    [
      "",
      `  report   ${INK.server}server${INK.reset}  ${reportUrl}/`,
      `  report   ${INK.app}app${INK.reset}     http://127.0.0.1:5173/  (hot reload, proxies to the server)`,
      `  watching the server: ${args.watch ? "yes, restarting on change" : "no (--no-watch)"}`,
      "  ctrl-c to stop",
      "",
    ].join("\n")
  );

  launch("server", process.execPath, [...(args.watch ? ["--watch"] : []), path.join(REPO_ROOT, "scripts", "report-server.mjs"), ...args.server]);
  launch("app", "npm", ["--prefix", APP_DIR, "run", "dev"], { env: { ...process.env, REPORT_URL: reportUrl } });
  return null;
}

const code = main();
if (code !== null) process.exit(code);
