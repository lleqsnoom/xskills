export const MESSAGES = {
  noIndex: () => "no index yet — run: x-search index --all",
  embedderUnreachable: (url) => `embedder unreachable at ${url} — start it with: ollama serve`,
  refusingToIndex: (root, reason, fix) => [`refusing to index ${root}`, `  ${reason}`, `  fix: ${fix}`, `  or: x-search index --root ${root} --allow-dirty`].join("\n"),
  storeTooNew: (path, schema) => `store built by a newer x-search (schema ${schema}) — upgrade, or delete ${path}`,
  engineUnavailable: (engine) => `this store needs ${engine}, which is not available here — searches fall back to keyword`,
  pendingBuild: (root) => `an earlier build stopped — resume: x-search index --root ${root}`,
  noRoots: () => "no repository to index — add --root <path>, or list one in the Orca IDE",
  notInstalled: (root) => `${root} has no index — run: x-search index --root ${root}`,
};

export const FAILURE_KEYS = Object.keys(MESSAGES);
