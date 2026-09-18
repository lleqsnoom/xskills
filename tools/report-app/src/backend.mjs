/**
 * Where the app's data comes from, and whether this copy of it can change anything.
 *
 * The app is one app; where its answers arrive from is the only difference between the two ways it runs, so
 * that is what lives here. Two backends today, one interface (`backend.d.mts`):
 *
 *   - `http` — the served app: one `fetch` per route, `POST /api/todos` to write, and the bundle name the
 *     server is serving so a stale tab can reload itself. This is the report as it is meant to be read.
 *   - `snapshot` — an Orca plugin panel: the same app, with the payloads the report's *worker* rendered into
 *     the panel file. Reads answer from them; there is no `canWrite`, because a pane has no channel to write
 *     through.
 *
 * The snapshot backend is not a missing feature of the app, and the worker is not a service the pane forgot to
 * call. A plugin panel is a sandboxed document: `connect-src 'none'`, no navigation, and exactly three
 * callable host methods (`workspace.readContext`, `terminal.sendText`, `notifications.show`). Measured inside
 * a copy of Orca's own shell, `window.api` is `undefined`, the origin is opaque, and `fetch` to a loopback
 * address fails. So a pane can be handed nothing — it can only *read what was rendered into it* — and the
 * worker, a plain Node process outside that sandbox, is the thing that renders it in
 * (`scripts/report-panel.mjs`). See `tools/orca-plugin/PANE-REQUEST.md`: a host-granted origin would add a
 * third backend here and change nothing above this file.
 *
 * `.mjs` rather than `.ts`, like `brief.mjs` and `resource.mjs`: the rules are not bundled, so a test can call
 * them without a build step.
 */

import { bakedAt, bakedReport, missingSentence, writeRefused } from "./baked.mjs";

/**
 * The served app: one request per URL, shared by whichever screens ask for it — the rail, the movement table
 * and the calendar all want the same movement payload, and three identical requests on first paint is three
 * chances to disagree.
 */
export function httpBackend({ fetchImpl = fetch } = {}) {
  const cache = new Map();

  const read = (path) => {
    const cached = cache.get(path);
    if (cached) return cached;
    const request = (async () => {
      const response = await fetchImpl(path);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `${response.status} ${response.statusText}` }));
        throw new Error(body.error ?? `failed: ${path}`);
      }
      return await response.json();
    })();
    cache.set(path, request);
    request.catch(() => cache.delete(path)); // a failure is not worth remembering
    return request;
  };

  return {
    kind: "http",
    canWrite: true,
    read,
    write: async (path, body) => {
      const response = await fetchImpl(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`could not save: ${response.status}`);
      cache.clear();
      return await response.json();
    },
    // Asked afresh, because a cached answer is the wrong answer to "is this page older than the app".
    bundleName: async () => {
      const response = await fetchImpl("/api/version", { cache: "no-store" });
      if (!response.ok) throw new Error(`could not ask for the version: ${response.status}`);
      return (await response.json()).build;
    },
    invalidate: () => cache.clear(),
  };
}

/** A panel: the payloads the worker rendered into this file, and no way at all to write one back. */
export function snapshotBackend({ report = bakedReport() } = {}) {
  return {
    kind: "snapshot",
    canWrite: false,
    read: async (path) => {
      const payload = bakedAt(report, path);
      if (payload === null) throw new Error(missingSentence(report, path));
      return payload;
    },
    write: async (path) => {
      throw new Error(writeRefused(report, path));
    },
    bundleName: async () => null,
    invalidate: () => {},
  };
}

/** Which backend this document is: the one thing the app decides about itself at startup. */
export function createBackend({ report = bakedReport(), ...options } = {}) {
  return report ? snapshotBackend({ report }) : httpBackend(options);
}
