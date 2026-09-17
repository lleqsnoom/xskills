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
| `x-skills report: Status` | Says whether it is answering, where the plugin is looking, which day is newest, and how many days the record holds |
| `x-skills report: Record the newest day` | Asks the server to record the newest pack into the day-by-day history, and repeats what it said |
| `x-skills report: Start the server here` | Types `npm run report` into a terminal in the focused worktree, and names the terminal it used |

A command that finds nothing answering says so, and says what to run. `Record` never retries: it writes
`history.jsonl`, and a retry loop would rewrite it.

## The panel

`panel.html` is a right-sidebar panel tab, titled `x-skills report` after the manifest. It shows the focused
worktree (`name · branch`) and names the two ways to open the report: **Ctrl+J** (⌘J on macOS) →
"x-skills report: Open", and the `Mod+Alt+X` keybinding.

It has no button, deliberately. The only thing a panel can do to a terminal is type into one, and
`workspace.readContext` returns terminal **ids only** — no titles, no marker for an agent session — so
typing `npm run report:open` picked whichever terminal Orca listed first, which on this machine was the Crush
session's TUI rather than a shell. A panel that cannot tell a shell from an agent is not allowed to type.

It cannot show the report either: an Orca panel is a sandboxed document with `connect-src 'none'` and no
host-to-panel data channel, so it can neither fetch the report nor read the plugin's own storage. What it can
call is exactly `workspace.readContext`, `terminal.sendText` and `notifications.show`.

## Keybinding

`Mod+Alt+X` opens the report. The bundled `orca-navigation-shortcuts` plugin holds `Mod+Alt+T` (tasks),
`Mod+Alt+F` (search) and `Mod+Alt+G` (source control), so `X` is outside the set that ships with Orca. If
Orca ever reports a clash in this plugin's log, the key is one line of `orca-plugin.json` — change it and
change this section with it.

## Settings

The plugin reads the report's address from its own settings first, then from its own storage, then falls back
to `http://127.0.0.1:8787` — the port `npm run report` uses. Only `127.0.0.1` and `localhost` are accepted; a
value pointing anywhere else is refused, with the reason written to the plugin's log, and the default is used
instead. **Status** names which of the three the address came from (`from settings`, `from storage`, `from
default`), so a server on another port is a visible fact rather than a mystery.

## What it may not do

- **It never starts, stops or daemonises a server.** There is no `spawn`, no `exec`, no background process
  anywhere in `main.mjs`. `npm run report` is the reader's command, and the plugin's job is to report what it
  finds.
- **It never talks to another machine.** Every request goes to a `127.0.0.1` or `localhost` origin, checked
  before the request rather than after. `https`, a remote host, credentials in the URL, or a URL with a path is
  refused with the reason, and no request is made.
- **It reads before it trusts.** A 200 is not evidence: the payload must be the report's own `GET /api/days`
  shape, so a stranger holding port 8787 reads as *not the report* rather than as a working report.
- **The panel is a control, not a view.** `panel.html` is a right-sidebar panel tab named after the plugin. An
  Orca panel is a sandboxed document (`default-src 'none'; connect-src 'none'`) with three callable host
  actions and no data channel, so it cannot fetch the report or read the plugin's own storage. It shows the
  focused worktree and one button, which types `npm run report:open` into a terminal there; the report itself
  opens as a full-area **browser tab** — the same pane type a terminal uses. A live *pane* is a request to
  Orca rather than something this plugin can do today: see [PANE-REQUEST.md](PANE-REQUEST.md), which quotes the
  host lines that block it and the two designs that would unblock it.

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
| `orca-plugin.json` | The manifest: identity, the four commands, the panel, the keybinding, the events, the capabilities |
| `main.mjs` | The worker: the probe, the commands, the new-day check, and the rules they obey |
| `panel.html` | The right-sidebar panel: the focused worktree, and how to open the report |
| `PANE-REQUEST.md` | What Orca would have to add for the report to live in a pane, and why it cannot today |
| `../../test/orca-plugin.test.cjs` | The tests: the worker against a stubbed host, the panel and manifest as source audits |
