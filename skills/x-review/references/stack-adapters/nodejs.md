# Stack Adapter: Node.js

## Language: JavaScript (Node.js Runtime)

### Framework Detection

| Pattern | Framework | Route Style |
|---------|-----------|-------------|
| `const express = require("express")` | Express | app.get("/", handler) |
| `import Koa from "koa"` | Koa | ctx.body response |
| `require("fs").promises` | Node stdlib async | fs.promises API |

### Thresholds (Default)

| Metric | Limit | Notes |
|--------|-------|-------|
| Max function length | 35 lines | Server code handles I/O — keep handlers thin |
| Cyclomatic complexity | 7 | Lower than browser JS due to security implications |
| Parameter count warning | >4 params | Express middleware signature `(req, res, next)` counts as 3 |

### DRY Ignore Patterns

1. **Error-handling middleware with `(req, res, next)` signature repeated**: Express convention where every error handler follows the 4-parameter pattern `(err, req, res, next)`. This is framework-mandated structure, not duplication. Each handler contains unique error processing logic.

2. **Async IIFE patterns for top-level await**: Necessary workaround in CommonJS modules before native top-level await support. Repeated `;(async () => { ... })()` wrappers are boilerplate, not DRY violations.

3. **Route definition blocks with middleware chains**: Express/Koa route registration `(app|router).get('/path', middleware1, handler)` naturally has repeated structure. Middleware composition is intentional design for separation of concerns.

4. **Configuration objects spread across files**: Server apps often split config (database, auth, logging) across multiple modules. Similar configuration shapes in different files serve distinct environments or services — not duplication unless values are identical and centralized config would work better.

### Framework Overrides

#### Express
- Max function length: 30 lines (route handlers should be thin)
- Additional ignore patterns: Middleware registration with `app.use()`, error handler blocks following `(err, req, res, next)` signature

#### Koa
- Max function length: 35 lines (koa middleware is naturally composable)
- Additional ignore patterns: Context manipulation patterns (`ctx.state`, `ctx.cookies`) repeated across middleware
