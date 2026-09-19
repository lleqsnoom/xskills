/**
 * Where the app's data comes from: the local report server over http.
 *
 * One `fetch` per route, `POST /api/todos` to write, and the bundle name the server is serving so a stale
 * tab can reload itself.
 *
 * `.mjs` rather than `.ts`, like `brief.mjs` and `resource.mjs`: the rules are not bundled, so a test can call
 * them without a build step.
 */

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