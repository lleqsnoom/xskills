# API Draft Format Reference

## Full Example Template

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

## Design Document Format Rules

1. **No tables** — use bullet lists for everything (params, body fields, status codes).
2. **Endpoint-first structure** — each endpoint is its own section with `### METHOD /path` as heading.
3. **Minimal JSON examples** — show the shape of responses and bodies, not exhaustive schemas.
4. **Inline param/body details** — describe params and body directly under the endpoint, no separate reference tables.
5. **Simple error format** — one shared error block at the end, no per-endpoint error sections.
6. **Base URL and Auth at top** — always include in the header before endpoints.
7. **No verbose data models section** — fold entity descriptions into endpoint docs or keep minimal if needed.

## Output Guidelines

- Each endpoint is its own `### METHOD /path` section with a short description.
- Use bullet lists for params, body fields, and status codes — no tables.
- Include JSON examples inline in fenced code blocks.
- Keep responses minimal: only show the shape, not every possible field.
- Errors are documented once at the end under a single `## Errors` heading.
- No separate Data Models or Pagination sections — fold that info into the relevant endpoint descriptions.
