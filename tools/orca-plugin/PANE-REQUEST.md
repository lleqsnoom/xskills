# What Orca would have to add for the report to live in a pane

The plugin opens the report as a full-area Orca **browser tab**, and that is as far as it can go. A plugin
**panel** cannot show a page from a local server, and this file is the request that would change that: it is
written to be filed on `github.com/stablyai/orca/issues` as it stands, and nothing here is speculation about
the host.

Verified against Orca 1.4.199 (`/usr/lib/orca-ide/app.asar`) and `github.com/stablyai/orca`
(`src/shared/plugins/`, `src/main/plugins/`) on 2026-09-17.

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
> Ship the pane behind a probe: the panel tries the request and falls back to a card naming the two possible
> causes (blocked, or not running) when it cannot. The commands, the keybinding, the notifications and the
> browser-tab path all stay, so an Orca without it is unaffected.
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
