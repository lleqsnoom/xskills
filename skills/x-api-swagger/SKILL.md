---
name: x-api-swagger
description: Convert an API design draft to OpenAPI YAML — generate a valid spec from markdown drafts with endpoints, schemas, and auth definitions
version: 1.0.0
author: Community
tags: [openapi, swagger, api-design, yaml, openapi-3]
user-invocable: true
---

# X-API-Swagger — API Design to OpenAPI YAML

Convert a markdown API design draft produced by `x-api-draft` into a valid OpenAPI 3.0.x YAML specification ready for tooling (Swagger UI, code generation, validation).

## Workflow

1. **Read the draft** — Read the approved API design from `.x-skills/apis/DD-MM-YYYY-hh:mm-<topic>.md` produced by `x-api-draft`. Confirm with the user which draft to convert if multiple exist.

2. **Parse endpoints & schemas** — Extract from the draft:
   - All endpoint paths with HTTP methods, descriptions, and auth requirements
   - Data model definitions (schemas) with field types, required/optional status, and descriptions
   - Relationship mappings between models
   - Auth scheme definitions referenced by endpoints

3. **Generate OpenAPI spec** — Produce a valid OpenAPI 3.0.x YAML specification covering:
   - `openapi` version (`3.0.3`)
   - `info` section (title, version, description from the draft)
   - `servers` array with base URL(s) extracted from the draft
   - `paths` object — one path item per unique endpoint path, each containing HTTP methods with:
     - `summary`, `operationId`, `tags` extracted from the draft
     - `parameters` for query/path/header params with name, in, required, schema
     - `requestBody` for endpoints that accept request bodies (with content and schema references)
     - `responses` object mapping status codes to responses with descriptions and schemas
   - `components/schemas` — all data model definitions as OpenAPI Schema Objects
   - `components/securitySchemes` — extracted from the draft's auth definitions
   - `security` array referencing which security schemes apply globally or per-operation

4. **Gate** — Confirm the generated YAML with the user before handing off to implementation. `</gate>` Ask: *"OpenAPI YAML looks good? Shall I proceed?"*

## Output Location

Generate the OpenAPI YAML file using the script (or manually):

```bash
# Global install:
node ~/.agents/skills/x-api-swagger/scripts/save-spec.js --topic <slug>

# Local install:
node ./.agents/skills/x-api-swagger/scripts/save-spec.js --topic <slug>

# Auto-discovery — pass any path to save-spec.js:
node /absolute/path/to/save-spec.js --topic <slug>
```

Output: `.x-skills/apis/<topic>-openapi.yaml` (relative to CWD).

## OpenAPI YAML Format

The generated YAML follows OpenAPI 3.0.x format, converted from the markdown draft:

```yaml
openapi: 3.0.3
info:
  title: <API Title>
  version: 1.0.0
  description: <description extracted from the draft>

servers:
  - url: https://api.example.com/v1
    description: Production

# All paths converted from the endpoints reference table in the draft:
paths: {}

components:
  schemas: {}

components/securitySchemes: {}
```

## Open Questions

- List any unresolved design decisions or deferred topics here.
- These should be resolved before moving to implementation.
