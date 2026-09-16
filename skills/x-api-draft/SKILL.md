---
name: x-api-draft
description: Draft API design from requirements — clarify scope, analyze endpoints and data models, produce a human-reviewable API design in markdown
version: 1.0.0
author: Community
tags: [api-design, draft, endpoints, data-models, openapi, swagger]
user-invocable: true
---

# X-API-Draft — API Design from Requirements

Produce a clean, human-reviewable API design document before implementation begins. No code yet — just scope, contracts, and structure.

## Workflow

Ask through panels, never in prose. A panel is the host's question UI in one of four shapes: `single` (one of 2-5 options + free answer), `multi` (several + open form), `open` (free text only), `confirm` (yes/no).

1. **Collect requirements** — Ask for API requirements with an `open` panel (existing docs, rough notes, or a verbal description). Summarize back to confirm before proceeding.

2. **Clarify scope** (if incomplete) — Ask one panel at a time (`single`, `multi`, or `open`) covering: target audience, core entities, key use cases, auth model, pagination, rate limiting, versioning. Never ask in prose.

3. **Summarize** — Present concise summary of understood requirements. Confirm with a `confirm` panel before designing.

4. **Design** — Produce API design document covering:
   - **Endpoints** — HTTP method + path + one-line description
   - **Request/Response schemas** — Key endpoints get full schema (field, type, required)
   - **Data models** — Entity definitions with relationships
   - **Auth & Authorization** — How each endpoint is secured; RBAC where applicable

5. **Gate** — Confirm the design with a `confirm` panel before handing off to implementation.

## Output Location

Save the design document using the script:

```bash
node <path-to-save-design.js> --topic <slug>
```

Output: `<run folder>/E<nn>-api-design.md` (relative to CWD).

## Design Document Format

Use endpoint-first structure with bullet lists for params/body/status codes. Keep JSON examples minimal — show shape, not exhaustive schemas. Errors documented once at end under `## Errors`.

For full format rules and example template see `references/format.md`.

## Errors & Limits

`save-design.js` only creates the file and prints its absolute path on stdout; the agent fills in the body afterwards.

- Exits **1** with a usage message on stderr when `--topic` is missing (stdout stays empty).
- Writes a **new timestamped file every run** — it never overwrites an existing draft, so re-running the same topic produces a second file.
- Timestamps are always JS-generated; there is no `--date` flag. Use `--branch <name>` when git is unavailable (otherwise the branch is auto-detected via `git rev-parse`).
