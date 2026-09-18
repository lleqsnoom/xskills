# x-skills report — an Orca plugin

The [x-skills daily report](../../README.md) as a full-area Orca tab: one command opens it, and soon a
notification says when a new day has landed.

The report itself is the standalone server in `scripts/report-server.mjs`. This plugin is an adapter over it:
it asks the server to show itself, and it reads the server's API. Nothing in this folder renders the report.

## Install (development)

1. Orca → **Settings** → **Plugins** → **development plugin paths**, pointing at this folder
   (`tools/orca-plugin`) — the one holding `orca-plugin.json`. Each entry is read as a plugin directory,
   not as a folder to search, so the parent `tools/` lists nothing.
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
| `x-skills report: Start the server here` | Brings the report up itself: resolves the focused worktree's record, starts the server detached at most once, and says the pid |
| `x-skills report: Console` | The same record in a pane you can type at: `j`/`k` move, `t` keep, `d` drop, `r` refresh, `q` quit |

A command that finds nothing answering says so, and says what to run. `Record` never retries: it writes
`history.jsonl`, and a retry loop would rewrite it.

## Three surfaces, one record

| Surface | Is it live? | How it is read |
|---|---|---|
| **the report tab** | yes — revalidates on focus and every 30 s, and the to-do buttons work | `x-skills report: Open` (palette): the server reads `.x-skills/daily/`, the page writes through `POST /api/todos` |
| **the console pane** | yes — redraws on a timer, and `t`/`d` write | `x-skills report: Console` (palette): a terminal running `scripts/report-console.mjs`, a *client* of the same API |
| **the sidebar panel** | no — a copy, rendered by the worker | `scripts/report-panel.mjs` reads the record and writes `panel.html`; the pane shows it on its next mount |

Nothing about this is a matter of taste: a plugin panel is a sandboxed document with no network, no file access
and three callable host methods (measured — see [PANE-REQUEST.md](PANE-REQUEST.md)), so a *live* surface has to be
a real page or a real process. The panel is the copy; the tab and the console are the live ones, and both are
started by the plugin rather than by the reader.

**The plugin owns the report's process, silently.** `report-open`/`report-console` resolve the record root from
the focused worktree (`workspace.readContext` → `orca worktree show --worktree active --json` → path), start
`scripts/report-server.mjs` detached when the port is quiet — once per activation, logged with its pid — and
never adopt a port that something else is holding. A worktree with no `.x-skills/daily` gets a sentence naming
the directory it looked for.

## The panel

`panel.html` is a right-sidebar panel tab, titled `x-skills report` after the manifest — and it is **the
report's own UI**: the same Solid app the server serves, built to one file with the API payloads baked in.

```bash
npm run report:panel   # build the panel bundle, then bake the snapshot into tools/orca-plugin/panel.html
```

A panel is a sandboxed document with `connect-src 'none'`, so it cannot fetch — and it cannot read a file
either (measured: `fetch`, `XHR`, `sendBeacon`, `<img>`, `<iframe>`, `<script src>`, `<object>` and every way to
navigate itself are all refused by the host's policy and its guard). What it *can* do is run inline script and
style, and Orca re-reads its entry file on every open — so what the record holds is written into the file, and
the app answers from `window.__REPORT__` (the movement page, days, todos, every day the rail and the calendar can
reach — each with its sessions — and the skills in use) instead of from the network.

**Two callers keep that snapshot current, and they share one baker** (`scripts/report-panel.mjs`, the same
module the standalone report uses):

| Caller | When it bakes |
|---|---|
| the report server, while it runs | on start, after every `/api/refresh`, and whenever the record changes (a five-second comparison of every file under it) |
| this plugin's worker, while Orca keeps it alive | on activation, on every command, on any event, and every two seconds — so a pack landing on disk shows up on its own |

Both ask the baker first whether the panel *would show something else*: it hashes the payloads the app reads,
so a change the app does not read (a markdown nobody renders) is not a repaint, and a reader in the middle of
the panel keeps their place. The write itself is atomic, so a panel read while a bake is running never sees half
a file.

So the panel works with no server running at all, it follows the record while either caller is alive, and it
reflects anything added, edited or deleted under `.x-skills/daily` — every day, score, proposal and to-do. Two
bounds worth knowing: a running report server is the more durable of the two watchers, because it is a plain
process with nobody to reap it, while Orca reaps an idle plugin worker after five minutes (`idleReapMs ?? 3e5`)
and the worker is only idle if no command, no event and no bake has happened in that time — the next Orca event
or command forks it again, and the follow resumes. The worker finds the checkout by asking rather than guessing:
`workspace.readContext` says whether a worktree is
focused, and `orca worktree show --worktree active --json` names its path. Matching a branch would not do —
every repository on main shares one. A `reportRoot` setting wins over that, and the answer
is remembered in the plugin's own storage, so a wake with nothing to bake costs one stat.

**An open panel takes the new snapshot by itself.** Orca watches a development plugin's directory and re-reads
the entry file when it changes (the watcher debounces 300 ms), and the panel swaps the document when the bytes
differ — so a bake is what a reader sees, without switching the sidebar away and back.

The panel is still **read-only**: a sandboxed document with `connect-src 'none'` cannot write the record, so
keeping and dropping a proposal happens in the tab or the console, which the panel names.

**Re-rendering the panel never asks the reader to approve the plugin again, and that is why this manifest
contributes no keybinding.** Orca's consent fingerprint is
`sha256(capabilities + trusted-worker + instructional-content:treeHash)`, where *instructional* means
keybindings, VM recipes and agents (`plugin-consent-fingerprint.ts`); a plugin that contributes none of those is
approved on its **capabilities**, and its files may change under it. Every bake rewrites `panel.html`, so with a
keybinding here, every new day would have been a plugin whose content no longer matched the reader's approval —
the "install it again" this panel used to ask for. The shortcut this gives up is Orca's palette: **Ctrl+J**, then
*"x-skills report: Open"*, which is also what the panel and its signpost name. If you would rather have the key
back, put the `keybindings` entry in `orca-plugin.json` and expect a re-approval whenever the panel is re-baked.

**Before the first bake the panel shows a signpost.** `panel.html` is committed as the signpost document — where
the report is, how to open it, and what a bake will do — because Orca validates every declared artifact when it
loads the plugin: it realpaths the panel entry, and a file it cannot resolve is *"A declared worker or panel file
is missing or unsafe"*, with the plugin not loading at all. So the declared entry is in every checkout, baked or
not, and the first bake replaces it with the app.

That makes the panel a tracked file the baker rewrites, so a bake shows as a modified `panel.html`;
`npm run dev` bakes only when asked (`--panel`), and `git checkout -- tools/orca-plugin/panel.html` puts the
signpost back. `panel-fallback.html` stays beside it as the repair for a copy of the plugin whose panel went
missing anyway: a directory that is not a git checkout, or one whose panel was deleted by hand. It is written
only when there is no panel, so a bake that fails cannot take the last good one away.

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

- **It cannot write.** `+ to-do`, `remove` and `clear` are hidden, and the line under the tabs says when the
snapshot was taken, because a panel cannot reach `/api/todos` or `/api/open`.
- **It holds every recorded day, up to a byte budget.** Days are baked newest first until the payloads reach
  6 MB (Orca refuses a panel entry over 10 MB), so the newest day is always there and a record far heavier than
  this one's loses its oldest days rather than its newest. A day that is not in the snapshot says which days
  are, instead of spinning.
- **It is a dashboard in a side panel.** Measured at 360px: the page does not overflow, and a skill's row folds
  its line under the score and the name — a 306px canvas in a 319px list — rather than scrolling sideways.
- **A live pane still needs Orca.** See [PANE-REQUEST.md](PANE-REQUEST.md): a panel cannot be a full-area tab
  and cannot fetch, so live-and-wide is a request to the host.
- **An installed copy is frozen.** Installed plugins are content-hash verified, so the bake only refreshes a
  development copy; a marketplace build would carry the snapshot it was published with.

## Opening it

`Ctrl+J` (⌘J on macOS) opens Orca's palette; **x-skills report: Open** probes the report and shows it in a
full-area browser tab, focusing the tab that already has it rather than opening a second one. There is
deliberately no keybinding: see the panel section — a keybinding would bind the reader's approval to the panel's
bytes, and the panel is re-rendered whenever the record changes.

The bundled `orca-navigation-shortcuts` plugin holds `Mod+Alt+T`, `Mod+Alt+F` and `Mod+Alt+G`, so a key would
also have to dodge those; the palette names the command, which is one hop and no clash.

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
| `orca-plugin.json` | The manifest: identity, the four commands, the panel, the events, the capabilities — and no keybinding, so the panel may be re-rendered freely |
| `main.mjs` | The worker: the probe, the commands, the new-day check, the bake, and the rules they obey |
| `panel.html` | The manifest's panel entry: the report's own UI, baked with a snapshot, and the signpost until the first bake — rewritten by `npm run report:panel`, the worker and the server |
| `panel-fallback.html` | The signpost the panel starts as, and the document the baker restores a missing `panel.html` from |
| `PANE-REQUEST.md` | What Orca would have to add for the report to live in a pane, and why it cannot today |
| `../../scripts/report-console.mjs` | The console pane: the report as text, with keys, as a client of the same API |
| `../../test/orca-plugin.test.cjs` | The tests: the worker against a stubbed host, the panel and manifest as source audits |
