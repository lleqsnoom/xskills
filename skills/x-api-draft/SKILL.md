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

1. **Collect requirements** — Ask user for API requirements (existing docs, rough notes, or verbal description). Summarize back to confirm before proceeding.

2. **Clarify scope** (if incomplete) — Ask one question at a time covering: target audience, core entities, key use cases, auth model, pagination, rate limiting, versioning.

3. **Summarize** — Present concise summary of understood requirements. Confirm with user before designing.

4. **Design** — Produce API design document covering:
   - **Endpoints** — HTTP method + path + one-line description
   - **Request/Response schemas** — Key endpoints get full schema (field, type, required)
   - **Data models** — Entity definitions with relationships
   - **Auth & Authorization** — How each endpoint is secured; RBAC where applicable

5. **Gate** — Confirm design with user before handing off to implementation. Ask: *"Design looks good? Shall I proceed?"*

## Output Location

Save the design document using the script:

```bash
node <path-to-save-design.js> --topic <slug>
```

Output: `.x-skills/apis/DD-MM-YYYY-hh:mm-<topic>.md` (relative to CWD).

## Design Document Format

Use endpoint-first structure with bullet lists for params/body/status codes. Keep JSON examples minimal — show shape, not exhaustive schemas. Errors documented once at end under `## Errors`.

For full format rules and example template see `references/format.md`.
