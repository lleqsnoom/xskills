# What Orca would have to add for the report to live in a pane

The plugin puts the report in Orca three ways: a **browser tab** (`Open`, live and writable), a **terminal pane**
running `scripts/report-console.mjs` (`Console`, live and writable), and its **right-sidebar panel**, which is a
*copy* — the record rendered into the panel file by `scripts/report-panel.mjs`, because a panel cannot fetch and
cannot read a file. This file is the request that would let the panel itself be the live one: it is written to be
filed on `github.com/stablyai/orca/issues` as it stands, and nothing here is speculation about the host.

**Two shapes would do it**, and either is enough:

- **A. a declared origin** — `contributes.panels[]` gains an optional `src` (mutually exclusive with `entry`), or
  `capabilities[]` gains a scoped `net:fetch` (`{ "kind": "net:fetch", "hosts": ["http://127.0.0.1:8787"] })`:
  the panel loads the live report and can write to it.
- **B. a declared directory to read** — a scoped `fs:read` (for example the workspace's `.x-skills/daily`), so a
  panel can answer from the record itself with no server anywhere in the path.

Verified against Orca 1.4.199 (`/usr/lib/orca-ide/app.asar`) and `github.com/stablyai/orca`
(`src/shared/plugins/`, `src/main/plugins/`) on 2026-09-17. The panel's isolation was then *measured*, not only
read: in a copy of the host's own shell (its CSP meta plus its guard prelude), a panel loading `fetch`, `XHR`,
`navigator.sendBeacon`, `<img>`, `<iframe>`, `<script src>`, `<object>`, `location.assign`/`href`/`replace`, a
`<meta http-equiv="refresh">`, a form submit and an `<a href>` click made **zero** requests — every one was
refused by the policy or cancelled by the guard.

## Why a pane is not possible today

A panel is a document, not a browsing context. Orca injects this policy into every panel:

```
Content-Security-Policy: default-src 'none'; connect-src 'none'; script-src 'unsafe-inline';
style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'
```

| What blocks it | Where it is |
|---|---|
| The policy above | the panel shell builder in the packaged main bundle (`buildPluginPanelShellHtml`) |
| `<iframe sandbox="allow-scripts" srcDoc={…} name="orca-plugin-panel:<tabKey>">`, with navigations, links, forms and `window.open` cancelled by the host | the panel host component in the same bundle |
| Four bridge message types only — `orca-panel-action`, `orca-panel-action-result`, `orca-panel-ping`, `orca-panel-pong` — so there is no host-to-panel data channel either | `src/shared/plugins/plugin-panel-bridge.ts` |
| `PLUGIN_PANEL_ACTIONS` is exactly `workspace.readContext`, `terminal.sendText`, `notifications.show`; `storage.*`, `secrets.*`, `settings.*` and `events.subscribe` are `panel: false` | `src/shared/plugins/plugin-host-api.ts` |
| Capabilities are a closed set, and the file says: *"Scoped kinds (net:fetch hosts, process:exec globs) arrive in later phases."* | `src/shared/plugins/plugin-capabilities.ts` |
| Panels mount in the right sidebar (`isPluginPanelTabKey`, `auto.components.right.sidebar.PluginPanel.*`); `contributes` accepts `panels`, `commands`, `events`, `languagePacks`, `keybindings`, `vmRecipes`, `agents` | `src/main/plugins/`, renderer strings |

## The request, ready to file

**Title:** Plugin panels cannot reach a `127.0.0.1` service, so a local dashboard cannot be shown in a pane

**Body:**

> ### What I am asking for
>
> A way for a plugin panel to show a page served by a loopback-only local process — either
>
> **A.** `contributes.panels[]` gains an optional `src` (mutually exclusive with `entry`), loaded in the panel
> frame with a policy that allows that one origin, or
>
> **B.** `capabilities[]` gains a scoped `net:fetch`
> (`{ "kind": "net:fetch", "hosts": ["http://127.0.0.1:8787"] }`), which narrows the panel's `connect-src` to
> the consented hosts.
>
> Either one is enough, and both keep what the current design protects.
>
> ### The use case
>
> `lleqsnoom.x-skills-report`, a plugin in `github.com/lleqsnoom/xskills`, puts a local daily-metrics report in
> front of a developer. The report is a read-only HTTP server bound to `127.0.0.1:8787`, holding nothing but
> the developer's own session metrics, with no remote access of any kind. The plugin opens it as a browser tab
> today, which works; what it cannot do is make the report a pane the reader can put beside their terminals.
>
> ### The evidence
>
> The table above: the injected policy (`connect-src 'none'`), the sandboxed `srcDoc` frame, the four bridge
> message types, the three panel-callable actions, the closed capability set, and the sidebar-only mounting.
>
> ### How the consent should read
>
> In the install dialog, beside `terminal:send` and `workspace:read`:
>
> > **Show a page from http://127.0.0.1:8787** — the plugin may load that address in its panel.
>
> Declared in the manifest, approved by name, and nothing else reachable. That is why the ask is a *scoped*
> kind rather than an open `net:fetch`.
>
> ### What stays as it is
>
> Navigations, links, form submissions and `window.open` stay cancelled inside the panel. The panel stays a
> document; it becomes a document that can read one declared origin.
>
> ### What I will do when it lands
>
> Ship it behind a probe: the panel loads the report from the declared origin and falls back to what it shows
> today — the rendered record, or the signpost when there is none — naming the two possible causes (blocked, or
> not running) when the request fails. Because the loaded page is the app the server serves, the pane then reads
> *and writes*: `+ to-do`, `remove` and `clear` work in the panel, and the baker, the snapshot and the read-only
> states all go. The commands, the notifications and the browser-tab path stay, so an Orca without it is
> unaffected.
>
> ### If the answer is no
>
> That is a fine answer, and the plugin will say so in one sentence: the report opens as a browser tab, and a
> live pane is not a thing a plugin can have yet. If "no" comes with a preferred shape, I will build to that
> instead.

## Filing it

Nothing here needs editing to be posted. File it as an issue on `stablyai/orca`, or comment on an existing one
asking for a webview panel or a URL panel — the evidence above is what makes it checkable rather than
aspirational. When it is filed, replace this section with the URL so the plugin's README can point at a live
discussion instead of a file.

**Status: not filed yet.** No issue has been opened on another repository from this checkout. To file it:

```bash
gh issue create --repo stablyai/orca \
  --title "Plugin panels cannot reach a loopback service or read a file, so a local dashboard cannot live in a pane" \
  --body-file tools/orca-plugin/PANE-REQUEST.md
```

What the plugin does meanwhile, so this is a request rather than a blocker: the worker resolves the focused
worktree's record and starts the report server itself when the port is quiet; `Open` shows the live, writable
report as a tab; `Console` puts the same record, live and writable, in a terminal pane; the sidebar panel stays
the copy it can only be today.
