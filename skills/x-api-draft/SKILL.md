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

1. **Collect requirements** — Ask the user for their API requirements (existing docs, rough notes, or verbal description). Summarize back to confirm understanding before proceeding.

2. **Clarify scope** — If the requirements are incomplete or ambiguous, ask one clarifying question at a time. Cover these areas as needed:
   - Target audience (internal service, public API, partner integrations)
   - Core domain entities and their relationships
   - Key use cases / user stories driving endpoint design
   - Authentication model (API key, OAuth 2.0, Bearer token, mTLS, etc.)
   - Data volume expectations and pagination strategy
   - Rate limiting or throttling requirements
   - Versioning strategy (URL path `/v1/`, header, content negotiation)

3. **Summarize** — Present a concise summary of what you understood from the user's requirements and answers. Confirm with the user before proceeding to design.

4. **Analyze & design** — Produce the API design document covering:
   - **Endpoints** — HTTP method + path + one-line description for each endpoint
   - **Request/Response schemas** — Key endpoints get full request body and response schema descriptions (field name, type, required/optional, description)
   - **Data models** — Entity definitions with relationships (one-to-one, one-to-many, many-to-many)
   - **Authentication & Authorization** — How each endpoint is secured; role-based access where applicable
   - **Pagination Strategy** — Cursor-based, offset, or page-based for list endpoints
   - **Error Handling** — Standard error response envelope and common status codes
   - **Versioning** — API version strategy

5. **Gate** — Confirm the design with the user before handing off to implementation. `</gate>` Ask: *"Design looks good? Shall I proceed?"*

## Output Location

Save the design document using the script:

```bash
node <path-to-save-design.js> --topic <slug>
```

**Auto-discovery**: The script resolves its own location via `__dirname`, so it works from any directory regardless of install method (global or local). Pass any path to the script and it will work.

Output: `.x-skills/apis/DD-MM-YYYY-hh:mm-<topic>.md` (relative to CWD).

## Design Document Format

```markdown
# [API Name] — v1

Brief description.

**Base URL:** `https://api.example.com/v1`
**Auth:** Bearer token (JWT)

---

## Endpoints

### GET /resources

List resources with optional filters.

- **Params:** `page` (int), `limit` (int, max 100)
- **200 OK:**
```json
{ "items": [...], "total": 42 }
```

---

### GET /resources/{id}

Get a single resource by ID.

- **Path param:** `id` (uuid)
- **200 OK:**
```json
{ "id": "...", "name": "..." }
```

---

### POST /resources

Create a new resource.

- **Body:**
```json
{
  "name": "string (required)",
  "description": "string (optional)"
}
```
- **201 Created:** returns the created resource

---

## Errors

All errors return:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

---
```

### Output Guidelines

- Each endpoint is its own `### METHOD /path` section with a short description.
- Use bullet lists for params, body fields, and status codes — no tables.
- Include JSON examples inline in fenced code blocks.
- Keep responses minimal: only show the shape, not every possible field.
- Errors are documented once at the end under a single `## Errors` heading.
- No separate Data Models or Pagination sections — fold that info into the relevant endpoint descriptions.

### Design Document Format Rules

1. **No tables** — use bullet lists for everything (params, body fields, status codes).
2. **Endpoint-first structure** — each endpoint is its own section with `### METHOD /path` as heading.
3. **Minimal JSON examples** — show the shape of responses and bodies, not exhaustive schemas.
4. **Inline param/body details** — describe params and body directly under the endpoint, no separate reference tables.
5. **Simple error format** — one shared error block at the end, no per-endpoint error sections.
6. **Base URL and Auth at top** — always include in the header before endpoints.
7. **No verbose data models section** — fold entity descriptions into endpoint docs or keep minimal if needed.
