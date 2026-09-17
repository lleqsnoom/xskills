# x-skills report — an Orca plugin

The [x-skills daily report](../../README.md) as a full-area Orca tab: one command opens it, and soon a
notification says when a new day has landed.

The report itself is the standalone server in `scripts/report-server.mjs`. This plugin is an adapter over it:
it asks the server to show itself, and it reads the server's API. Nothing in this folder renders the report.

## Install (development)

1. Orca → **Settings** → **Plugins** → **development plugin paths**, pointing at this folder's parent
   (`tools/`).
2. Orca lists **x-skills report** and asks for consent for the capabilities the manifest declares. Consent is
   per capability, and it is asked again when the manifest adds one.
3. The command is then in the palette: **x-skills report: Open**.

A development plugin is mutable and Orca watches it for changes; an *installed* plugin is content-hash verified
and immutable, which is why development is done from a path. There is no `orca` CLI command for plugins — this
step is a human one.

Start the report first, in a terminal in the repository:

```bash
npm run report
```

## Commands

| Command | Does |
|---|---|
| `x-skills report: Open` | Probes the report and asks the server to show or focus it in a full-area Orca tab |

A command with no report answering says so, and says what to run.

## What it may not do

- **It never starts, stops or daemonises a server.** There is no `spawn`, no `exec`, no background process
  anywhere in `main.mjs`. `npm run report` is the reader's command, and the plugin's job is to report what it
  finds.
- **It never talks to another machine.** Every request goes to a `127.0.0.1` or `localhost` origin, checked
  before the request rather than after. `https`, a remote host, credentials in the URL, or a URL with a path is
  refused with the reason, and no request is made.
- **It reads before it trusts.** A 200 is not evidence: the payload must be the report's own `GET /api/days`
  shape, so a stranger holding port 8787 reads as *not the report* rather than as a working report.
- **It cannot render itself in a pane.** An Orca plugin panel is a sandboxed document
  (`default-src 'none'; connect-src 'none'`), mounted in the right sidebar, with no host-to-panel data channel;
  it cannot be a full-area tab and it cannot reach a loopback server. So the report opens as an Orca **browser
  tab** — the same pane type a terminal uses — and the live pane is a request to Orca rather than something
  this plugin can do today.

## What the worker sees

Orca forks this worker with no `cwd` (`fork(entryPath, [], { env, execArgv, serialization, stdio })` in the
host), so the process inherits Orca's own working directory, which is not a checkout. The plugin is written for
that: it never resolves a path from the working directory, and the tab is opened by the *server*, from the
directory the server was started in.

The worker logs `process.cwd()` on activation so the fact stays visible:

```
x-skills report: worker cwd <the directory Orca was launched from>
```

Read it in Orca → **Settings** → **Plugins** → the plugin's logs. The value has not been observed on this
machine yet; the line exists so that the first run records it rather than leaving it to be guessed.

## Files

| File | What it is |
|---|---|
| `orca-plugin.json` | The manifest: identity, the command, the capabilities, and the engine range |
| `main.mjs` | The worker: the probe, the open request, and the rules both obey |
| `../../test/orca-plugin.test.cjs` | The tests, driven with a stubbed Orca host and a stubbed `fetch` |
