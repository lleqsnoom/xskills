---
name: x-search
description: Search every indexed repository by meaning or exact identifier through the x-search MCP server — use before grepping for a symbol, when the file that owns a behaviour is unknown, or when the question spans repositories.
version: 0.1.0
author: Community
tags: [search, semantic, vector, mcp, code-search, embeddings, sqlite]
user-invocable: true
---

# X-Search — Ask where something is, in one repository or all of them

Reach for this before `grep` when you do not know the file, before `glob` when you do not know the
name, and whenever the question is "where does X happen" rather than "where is the string X".

## Prerequisite

The `x-search` MCP server must be wired into the CLI you are running in, and the repository must have
an index. If a call comes back with `index.missing` or "no index yet", say so and offer:

```
x-search install --cli crush,claude,codex,opencode   # once per machine
x-search index --all                                 # build the stores
x-search watch                                       # keep them current
```

Do not fall back to grepping silently: a repository with no index is missing context, not a negative
result.

## The three tools

| Tool | Answers |
|------|---------|
| `search(query, project?, limit?, mode?, lang?)` | Where something is. Ranked hits: `path`, `lineStart`, `lineEnd`, `symbol`, `chunkKind`, `score`, `snippet`. |
| `projects()` | Which repositories have an index, and how big each one is. |
| `stats(project?)` | One store's chunks, vectors, engine and build time. |

## Which mode

- `keyword` — you already know the identifier, the file name or a distinctive string. Works with the
  embedding daemon stopped. This is the fastest way to find `resolveRunDir`, `installSkill`, a config
  key.
- `vector` — you can describe the behaviour but not the name ("where does a run folder get created").
- `hybrid` — the default, and the right choice when you are unsure: it fuses both rankings, so an
  exact identifier and a paraphrase each win their own query.

Omit `project` to search every indexed repository; pass it when a hit from another repository would be
noise. `lang` narrows to one language, `path` (CLI) to a subtree.

## Reading a hit

- `path` + `lineStart..lineEnd` is the definition — read that range before quoting it.
- `symbol` is the name of the function, method, class or interface the chunk came from, when the
  chunker found one.
- `chunkKind` says how the chunk was cut: `symbol` means a syntax boundary, `window` means a fixed
  1.5 KB slice. A `window` hit in a code file means the grammar for that language was not installed,
  so the boundaries are approximate.
- `sides` is how many rankers found it (2 = keyword and vector), which is a hint that it is the thing
  you are looking for.

## Staleness

`index.stale` on the response, and `stale` on a hit, mean the file changed after it was embedded. The
server never blocks a query on re-embedding, so: re-run the query, or start `x-search watch` and it
will catch up within a couple of seconds. Do not treat a stale snippet as the current text.

## Failure modes, and what each means

| What you see | What to do |
|--------------|------------|
| `no index yet — run: x-search index --all` | No store for this repository. Offer the command; do not grep silently. |
| `embedder unreachable at <url> — start it with: ollama serve` | Indexing needs Ollama. Searching in `keyword` mode still works. |
| `this store needs vec0, which is not available here — searches fall back to keyword` | `sqlite-vec` is missing; keyword results are still real. |
| `store built by a newer x-search (schema N)` | The tool is older than the store. Upgrade it, or delete the store path named. |
| `refusing to index <repo> ... not ignored by git` | The store would dirty the tree. Add the printed `.gitignore` line, or pass `--allow-dirty`. |
| `an earlier build stopped — resume: x-search index --root <repo>` | A build was interrupted; re-running the index resumes it. |

## What it does not do

It does not read files for you: a hit is a pointer, so open the range. It does not search the web, and
it does not search a repository that was never indexed. It indexes text files and `.x-skills`
artifacts — no PDFs, no images, no session transcripts.
