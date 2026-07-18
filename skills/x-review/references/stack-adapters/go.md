# Stack Adapter: Go

## Language: Go

### Framework Detection

| Pattern | Framework | Route Style |
|---------|-----------|-------------|
| `github.com/gin-gonic/gin` | Gin | `r.GET("/path", handler)` |
| `github.com/go-chi/chi/v5` | Chi 5.x | `r.Get("/path", handler)` |
| `github.com/labstack/echo/v4` | Echo 4.x | `e.GET("/path", handler)` |
| `go.uber.org/zap` | Zap logger | Structured logging idiomatic |

### Thresholds (Default)

| Metric | Limit | Notes |
|--------|-------|-------|
| Max function length | 50 lines | Error handling adds verbosity in Go |
| Cyclomatic complexity | 10 | Higher threshold due to explicit error handling |
| Parameter count warning | >4 params | Excluding context.Context and error returns |

### DRY Ignore Patterns

1. **Table-driven tests**: Identical test setup across multiple cases is idiomatic Go, not a violation. Test tables with varying inputs but same assertion structure are expected.

2. **Error wrapping `fmt.Errorf("context: %w", err)`**: Standard pattern for adding context to errors. Repeated error wrapping in call stacks is acceptable and encouraged.

3. **Deferred cleanup (`defer file.Close()`)**: Repeated defer statements across methods for resource cleanup is idiomatic Go, not a violation of DRY.

4. **Interface satisfaction blocks**: Explicit interface assertion patterns like `_ = MyInterface((*ConcreteType)(nil))` are necessary boilerplate, not duplication.

### Framework Overrides

#### Gin
- Max function length: 55 lines (middleware-heavy)
- Additional ignore patterns: `c.JSON()` repeated response formatting is standard

#### Chi
- Max function length: 50 lines
- Additional ignore patterns: Route registration blocks with multiple middleware chains

#### Echo
- Max function length: 50 lines
- Additional ignore patterns: Group-based route organization with shared middleware
