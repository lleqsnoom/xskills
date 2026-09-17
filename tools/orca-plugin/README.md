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

`panel.html` is a right-sidebar panel tab, titled `x-skills report` after the manifest — and it is **the
report's own UI**: the same Solid app the server serves, built to one file with the API payloads baked in.

```bash
npm run report:panel   # build the panel bundle, then bake the snapshot into tools/orca-plugin/panel.html
```

A panel is a sandboxed document with `connect-src 'none'`, so it cannot fetch. What it can do is run inline
script and style, and Orca re-reads its entry file on every open — so the app answers from `window.__REPORT__`
(a snapshot of movement, days, todos, the newest day, its sessions and the skills in use) instead of from the
network.

**Two callers keep that snapshot current, and they share one baker** (`scripts/report-panel.mjs`, the same
module the standalone report uses):

| Caller | When it bakes |
|---|---|
| the report server, while it runs | on start, after every `/api/refresh`, and whenever the packs change (a five-second comparison of the newest pack's fingerprint) |
| this plugin's worker, whenever Orca wakes it | on activation, on every command, and on any event, each time asking the baker first whether the panel is behind the record |

So the panel works with no server running at all, and it stays current when the server is running. The worker
finds the checkout by asking rather than guessing: `workspace.readContext` gives the focused branch, and
`orca worktree list --json` turns a branch into a path. A `reportRoot` setting wins over that, and the answer
is remembered in the plugin's own storage, so a wake with nothing to bake costs one stat.

**A panel that is already open keeps the snapshot it was opened with.** The host reads the entry file when the
panel opens (its effect depends only on the plugin and panel identity), and nothing in a panel can reload
itself — so a new day arrives when the panel is next mounted, which switching the sidebar away and back does.

The panel is generated and not committed (`panel.html` is gitignored): a clone that has not baked has no
entry file, which shows as an empty panel rather than a broken plugin.

### What the panel's own host does to it

Orca injects a guard into every panel, and it is worth knowing because it shapes the app:

- **A click on an `<a href>` is cancelled in the capture phase** (`preventDefault` +
  `stopImmediatePropagation`), before any handler of the page runs. An anchor *without* an href is left alone.
  So a snapshot renders the same links without an href — `navProps` in `tools/report-app/src/baked.mjs` —
  and supplies `role="link"` and a tab stop instead, with Enter and Space activating them.
- **Navigations are cancelled** (`window.navigation`), so the router keeps its view in memory.
- **Forms and `window.open` are cancelled**; the app has neither.

The symptom of getting this wrong is "the panel's buttons do nothing": every rail item and every row in the
report is a link, so all of them were dead until the href came out.

### What the panel cannot do

- **It cannot write.** `+ to-do`, `remove` and `clear` are hidden, and `Run` is replaced by the snapshot's
timestamp, because a panel cannot reach `/api/todos` or `/api/open`.
- **It holds the newest day only.** An older day is a click away in the calendar, and the app says so instead
  of spinning.
- **It is a dashboard in a side panel.** Measured at 360px: the page does not overflow, and the movement table
  scrolls inside its own wrapper — usable, not roomy.
- **A live pane still needs Orca.** See [PANE-REQUEST.md](PANE-REQUEST.md): a panel cannot be a full-area tab
  and cannot fetch, so live-and-wide is a request to the host.
- **An installed copy is frozen.** Installed plugins are content-hash verified, so the bake only refreshes a
  development copy; a marketplace build would carry the snapshot it was published with.

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
| `panel.html` | The report's own UI, baked with a snapshot (generated: `npm run report:panel`) |
| `PANE-REQUEST.md` | What Orca would have to add for the report to live in a pane, and why it cannot today |
| `../../test/orca-plugin.test.cjs` | The tests: the worker against a stubbed host, the panel and manifest as source audits |
