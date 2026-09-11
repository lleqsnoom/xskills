---
name: x-browser
description: Launch the real Chrome/Chromium with remote debugging and attach the chrome-devtools MCP to the project's app URL — detects the URL from README/config/env, verifies the dev server, and opens the browser so you can drive it without manual setup.
version: 1.0.0
author: Community
tags: [browser, chrome, chromium, devtools, mcp, frontend, testing, automation, debugging]
user-invocable: true
---

# X-Browser — Launch Chrome for DevTools MCP

Start a real (headed) Chrome/Chromium with the remote debugging port open, open the project's app URL, and let the `chrome-devtools` MCP server attach. This replaces the manual "launch chrome with `--remote-debugging-port`, then ask the agent to connect" prompt.

## When to use

- You need to inspect, test, or drive a running web app in a real browser.
- A `chrome-devtools` MCP server is configured but has nothing to attach to.
- You want the app URL discovered automatically instead of typed by hand.

## Prerequisite: the MCP must point at the same port

The launch script opens remote debugging on `9222` by default. The `chrome-devtools` MCP server must be configured to connect to that port. In Crush (`crush.json`):

```json
{
  "mcp": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp", "--browserUrl", "http://127.0.0.1:9222"]
    }
  }
}
```

If your config uses a different `--browserUrl` port, pass the same value to `--port`. The ports must match or the MCP will not attach.

## Procedure

### 1. Detect the app URL

Run the detector; it scans `.env*`, `package.json` scripts, framework configs (`vite.config`, `angular.json`, `nuxt.config`, ...), `docker-compose.yml`, and `README.md`, then prints ranked candidates:

```bash
node skills/x-browser/scripts/detect-url.mjs
```

Output:

```json
{ "url": "http://localhost:5173", "source": "README.md", "candidates": [ ... ] }
```

If `url` is `null`, read `README.md` and `package.json` yourself and pick the dev-server URL. If still unknown, ask the user once — do not guess a wrong port.

### 2. Make sure the dev server is running

The browser can open before the server is up, but pages will fail to load. Check the URL is reachable; if not, start the dev server in the background using the project's own script (do not invent one):

```bash
node -e "fetch('http://localhost:5173').then(r=>console.log('up',r.status)).catch(()=>console.log('down'))"
```

Pick the command from `package.json` (`dev`, `start`, or `serve`) and run it in the background before continuing.

### 3. Launch the browser

```bash
node skills/x-browser/scripts/launch.mjs --url http://localhost:5173
```

Omit `--url` to let it auto-detect. The script:

- refuses to double-launch if CDP is already answering on the port;
- uses a dedicated profile at `~/.x-skills/chrome-profile` (never your default Chrome profile, so a running Chrome does not block debugging);
- opens a real, visible browser window at the app URL.

It prints JSON with `cdpUrl`, `pid`, `url`, and `appReachable`.

### 4. Attach with chrome-devtools MCP

Verify the connection, then drive the page:

- `list_pages` — confirms the browser is attached and shows the open tab.
- `navigate_page` — go to the app URL (or another route).
- `take_snapshot` / `take_screenshot` — inspect the current UI.
- `click`, `fill`, `fill_form`, `type_text`, `press_key` — interact.
- `list_console_messages`, `list_network_requests` — inspect logs and traffic.
- `performance_start_trace` / `take_heapsnapshot` — profile.

If `list_pages` returns no browser, the MCP is not pointed at the debug port — fix the `--browserUrl` config (see prerequisite) and retry.

## Flags

| Flag | Purpose |
|------|---------|
| `--url <url>` | App URL to open (default: auto-detect) |
| `--port <n>` | Remote debugging port (default `9222`; must match MCP config) |
| `--profile-dir <dir>` | Chrome `--user-data-dir` (default `~/.x-skills/chrome-profile`) |
| `--browser <path>` | Explicit Chrome/Chromium executable |
| `--headless` | Launch without a visible window |
| `--foreground` | Keep the launcher attached instead of detaching |
| `--dry-run` | Print the command without launching |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `No Chrome/Chromium executable found` | Install Chrome, or pass `--browser <path>` / set `CHROME_PATH`. |
| `list_pages` shows nothing | MCP `--browserUrl` port differs from `--port`; align them. |
| A Chrome window is already open and debugging will not start | The script already isolates the profile; if you launched Chrome manually, close it or use a distinct `--port`. |
| Wrong URL detected | Pass `--url` explicitly. |
| Page loads blank | The dev server is not running — do step 2. |

## Rules

- Never point `--profile-dir` at the user's real Chrome profile.
- Never kill the user's existing browser processes.
- Report the detected URL and its source so the user can correct it.
