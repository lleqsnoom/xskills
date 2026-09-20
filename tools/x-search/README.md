# x-search

Local semantic search over a repository's artifacts and source code, served to agent CLIs as an
MCP server. It indexes once per repository, keeps the index current with a watcher, and answers
both "where is `resolveRunDir`" and "where does a run get written".

Nothing leaves the machine: embeddings come from a local [Ollama](https://ollama.com) daemon.

## Install

```bash
# once, per machine
ollama pull nomic-embed-text

# wire the tool into the CLIs you use
npx -y @lleqsnoom/x-search install --cli crush,claude,codex,opencode

# build an index for every repository the Orca IDE knows about
npx -y @lleqsnoom/x-search index --all

# keep it current while you work
npx -y @lleqsnoom/x-search watch
```

## What it writes

`<repo>/.x-skills/.index/index.db`, one file per repository, holding the chunks, an FTS5 keyword
index and the vectors. Nothing else is written, and the tool refuses to create the store when
`.x-skills` is neither ignored by git nor safe to ignore:

```
refusing to index /code/app
  .x-skills is not ignored by git in /code/app, so the index would show as untracked
  fix: echo '/.x-skills' >> /code/app/.gitignore
  or: x-search index --root /code/app --allow-dirty
```

The check asks git, so a machine-wide `core.excludesFile` that already hides `.x-skills` counts.

## Commands

| Command | What it does |
|---------|--------------|
| `x-search index [--all] [--root <path>]... [--force] [--allow-dirty]` | Builds or refreshes the stores. Resumes an interrupted build. |
| `x-search watch [--root <path>]...` | Indexes every known repository, then re-indexes changed files after a 2 s debounce. |
| `x-search search <query> [--mode hybrid\|keyword\|vector] [--project <id>] [--limit 8] [--lang ts] [--path src/]` | Answers from every store, or one. |
| `x-search mcp [--root <path>]...` | The stdio MCP server: `search`, `projects`, `stats`. |
| `x-search status [--json]` | Per repository: chunks, engine, when it was built, whether it is still wanted. |
| `x-search install --cli <list> [--print] [--remove]` | Wires or unwires the CLIs. |

## The MCP tools

- **`search(query, project?, limit?, mode?, lang?)`** — ranked hits with `path`, `lineStart`,
  `lineEnd`, `symbol`, `chunkKind`, `score` and a `snippet`. Omit `project` to search everything.
  `mode=keyword` works with the embedder down; `hybrid` (default) fuses both rankings.
- **`projects()`** — the indexed repositories with their chunk counts.
- **`stats(project?)`** — one store's chunks, vectors, engine and build time.

A hit also carries `stale: true` when the file changed after it was embedded: the query is never
blocked on re-embedding, so the reader is told instead.

## How it is built

- **Chunking**: tree-sitter where a grammar is installed (one chunk per function, method, class or
  interface, docstrings included), fixed 1.5 KB windows otherwise. Every chunk says which it was.
- **Fusion**: reciprocal rank fusion (`k = 60`) over FTS5 BM25 and cosine similarity, so an exact
  identifier and a paraphrase each win their own query without a tuned weight.
- **Freshness**: an `mtime` + size check first, a content hash only when that differs, and one
  embedding request at a time in batches of 32.

## Numbers from the machine it was built on

| Measurement | Value |
|-------------|-------|
| Embedding throughput | 9.0 chunks/s, CPU only (`nomic-embed-text`, 768 dims) |
| Full build, 10 repositories | 8 882 text files, ~100 MB, ~70 000 chunks ⇒ ~2.2 h |
| Incremental build | seconds (only changed files are re-embedded) |
| Query, `vec0` engine | 71 ms at 70 000 × 768, disk-backed, 209 MB store |
| Query, `blob` engine | 33 ms after a 212 ms load, 274 MB store, ~524 MB resident |

`sqlite-vec` is an optional dependency: with it, vectors live in a `vec0` table and queries stay
disk-backed; without it, they live in BLOBs and a JS cosine scan answers. Repositories above ~50 000
chunks want `vec0`. `x-search status` says which engine a store uses.

## Requirements

- Node >= 22.5 (`node:sqlite`).
- Ollama with an embedding model — `nomic-embed-text` by default; `X_SEARCH_EMBED_MODEL` and
  `OLLAMA_URL` override it. Indexing needs the daemon; searching in `keyword` mode does not.
- `git` on `PATH` for the store guard.

## Environment

| Variable | Meaning |
|----------|---------|
| `OLLAMA_URL` | Embedder endpoint, default `http://127.0.0.1:11434`. |
| `X_SEARCH_EMBED_MODEL` | Embedding model, default `nomic-embed-text`. |
| `X_SEARCH_VEC0` | Path to a `vec0` binary to use instead of the platform package. |
| `X_SEARCH_NO_VEC0=1` | Force the BLOB engine even when `sqlite-vec` is installed. |
| `X_SEARCH_BATCH_SIZE` | Chunks per embedding request, default 32. |
| `X_SEARCH_DEBOUNCE` | Watcher debounce in ms, default 2000. |
| `X_SEARCH_SCAN_INTERVAL` | Watcher's full stat pass in ms, default 60000. |
| `X_SEARCH_INSTALL_GRAMMARS=1` | Let `index` install missing tree-sitter grammars globally. |
