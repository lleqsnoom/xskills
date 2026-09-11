#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LOCAL_RE =
  /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?/i;

const URL_KEYS = [
  ["APP_URL", 100],
  ["APP_BASE_URL", 100],
  ["FRONTEND_URL", 98],
  ["CLIENT_URL", 96],
  ["BASE_URL", 95],
  ["VITE_APP_URL", 95],
  ["NUXT_PUBLIC_APP_URL", 95],
  ["PUBLIC_URL", 92],
  ["REACT_APP_BASE_URL", 92],
  ["VITE_BASE_URL", 90],
  ["APP_ORIGIN", 90],
  ["VITE_DEV_SERVER_URL", 90],
];

const PORT_KEYS = ["VITE_PORT", "APP_PORT", "DEV_PORT", "VITE_DEV_PORT", "PORT"];

const FRAMEWORK_DEFAULTS = [
  { dep: "vite", port: 5173 },
  { dep: "@sveltejs/kit", port: 5173 },
  { dep: "svelte-kit", port: 5173 },
  { dep: "next", port: 3000 },
  { dep: "@remix-run/dev", port: 3000 },
  { dep: "nuxt", port: 3000 },
  { dep: "react-scripts", port: 3000 },
  { dep: "@nestjs/cli", port: 3000 },
  { dep: "@angular/cli", port: 4200 },
  { dep: "astro", port: 4321 },
  { dep: "parcel", port: 1234 },
  { dep: "@vue/cli-service", port: 8080 },
  { dep: "webpack-dev-server", port: 8080 },
];

const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.dev",
  ".env.development.local",
];

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function normalizeUrl(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  if (LOCAL_RE.test(trimmed)) {
    return ("http://" + trimmed.replace(/^\/+/, "")).replace(/\/+$/, "");
  }
  return null;
}

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

export function extractPort(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
    }
  }
  return null;
}

function projectDirs(root) {
  const dirs = [root];
  const known = ["client", "frontend", "web", "app", "ui", "www", "public"];
  for (const name of known) {
    const p = path.join(root, name);
    if (isDir(p)) dirs.push(p);
  }
  for (const parent of ["apps", "packages"]) {
    const base = path.join(root, parent);
    if (!isDir(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const p = path.join(base, name);
      if (isDir(p)) dirs.push(p);
    }
  }
  return dirs;
}

function collectEnvCandidates(dir, cwd, add) {
  for (const envFile of ENV_FILES) {
    const content = readIfExists(path.join(dir, envFile));
    if (!content) continue;
    const env = parseEnv(content);
    const label = path.relative(cwd, path.join(dir, envFile)) || envFile;

    for (const [key, weight] of URL_KEYS) {
      const url = normalizeUrl(env[key]);
      if (url) add(url, `${label}:${key}`, weight);
    }

    const hasExplicitUrl = URL_KEYS.some(([key]) => normalizeUrl(env[key]));
    if (!hasExplicitUrl) {
      const portKey = PORT_KEYS.find((key) => env[key] && /^\d{2,5}$/.test(env[key]));
      if (portKey) add(`http://localhost:${env[portKey]}`, `${label}:${portKey}`, 78);
    }
    break;
  }
}

function collectPackageJsonCandidates(dir, cwd, add) {
  const file = path.join(dir, "package.json");
  const content = readIfExists(file);
  if (!content) return;
  let pkg;
  try {
    pkg = JSON.parse(content);
  } catch {
    return;
  }
  const label = path.relative(cwd, file) || "package.json";

  const scripts = Object.values(pkg.scripts || {}).join(" ");
  const port = extractPort(scripts, [
    /--port[=\s]+(\d{2,5})/,
    /-p[=\s]+(\d{2,5})/,
    /PORT[=\s:]+(\d{2,5})/,
  ]);
  if (port) add(`http://localhost:${port}`, `${label}:scripts`, 80);

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const { dep, port: defaultPort } of FRAMEWORK_DEFAULTS) {
    if (deps[dep]) {
      add(`http://localhost:${defaultPort}`, `${label}:${dep}`, 20);
      break;
    }
  }
}

function collectConfigCandidates(dir, cwd, add) {
  const configs = [
    ["vite.config.js", /(?:^|[^a-zA-Z])port\s*:\s*(\d{2,5})/m],
    ["vite.config.ts", /(?:^|[^a-zA-Z])port\s*:\s*(\d{2,5})/m],
    ["vite.config.mjs", /(?:^|[^a-zA-Z])port\s*:\s*(\d{2,5})/m],
    ["nuxt.config.js", /(?:^|[^a-zA-Z])port\s*:\s*(\d{2,5})/m],
    ["nuxt.config.ts", /(?:^|[^a-zA-Z])port\s*:\s*(\d{2,5})/m],
    ["next.config.js", /(?:^|[^a-zA-Z])port\s*:\s*(\d{2,5})/m],
    ["angular.json", /"port"\s*:\s*(\d{2,5})/m],
  ];
  for (const [name, pattern] of configs) {
    const content = readIfExists(path.join(dir, name));
    if (!content) continue;
    const port = extractPort(content, [pattern]);
    const label = path.relative(cwd, path.join(dir, name)) || name;
    if (port) add(`http://localhost:${port}`, label, 70);
  }
}

function collectComposeCandidates(dir, cwd, add) {
  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    const content = readIfExists(path.join(dir, name));
    if (!content) continue;
    const label = path.relative(cwd, path.join(dir, name)) || name;
    for (const match of content.matchAll(/["']?(\d{2,5}):(\d{2,5})["']?/g)) {
      const hostPort = Number(match[1]);
      if (hostPort >= 1024 && hostPort <= 65535) {
        add(`http://localhost:${hostPort}`, label, 50);
      }
    }
  }
}

function collectReadmeCandidates(dir, cwd, add) {
  for (const name of ["README.md", "readme.md", "README.MD"]) {
    const content = readIfExists(path.join(dir, name));
    if (!content) continue;
    const label = path.relative(cwd, path.join(dir, name)) || name;
    const seen = new Set();
    for (const match of content.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?/gi)) {
      const url = normalizeUrl(match[0]);
      if (url && !seen.has(url)) {
        seen.add(url);
        add(url, label, 62);
      }
    }
    for (const match of content.matchAll(/(?:localhost|127\.0\.0\.1)(?::\d{2,5})/gi)) {
      const url = normalizeUrl(match[0]);
      if (url && !seen.has(url)) {
        seen.add(url);
        add(url, label, 60);
      }
    }
  }
}

export function detectUrl(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const byUrl = new Map();

  const add = (url, source, score) => {
    const existing = byUrl.get(url);
    if (!existing || score > existing.score) {
      byUrl.set(url, { url, source, score });
    }
  };

  for (const dir of projectDirs(root)) {
    const rel = path.relative(root, dir);
    try {
      collectEnvCandidates(dir, root, add);
      collectPackageJsonCandidates(dir, root, add);
      collectConfigCandidates(dir, root, add);
      collectComposeCandidates(dir, root, add);
      collectReadmeCandidates(dir, root, add);
    } catch {
      // ignore unreadable directories
    }
    void rel;
  }

  const candidates = [...byUrl.values()].sort((a, b) => b.score - a.score);
  return {
    url: candidates.length ? candidates[0].url : null,
    source: candidates.length ? candidates[0].source : null,
    candidates,
  };
}

function main() {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--cwd" || args[i] === "-C") && i + 1 < args.length) {
      cwd = args[++i];
    }
  }
  const result = detectUrl(cwd);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
