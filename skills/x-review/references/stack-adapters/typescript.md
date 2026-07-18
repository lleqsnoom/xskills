# Stack Adapter: TypeScript

## Language: TypeScript

### Framework Detection

| Pattern | Framework | Route Style |
|---------|-----------|-------------|
| `@nestjs/common` imports | NestJS | `@Controller()`, `@Get()` decorators |
| `from "express"` or `import express` | Express | `app.get("/path", handler)` |
| `"next/router"` / `useRouter` from next | Next.js | Pages router API |
| React.Component / useState hooks | React functional component | JSX with hooks |

### Thresholds (Default)

| Metric | Limit | Notes |
|--------|-------|-------|
| Max function length | 30 lines | Generics add overhead, brevity preferred |
| Cyclomatic complexity | 8 | Standard for typed codebases |
| Parameter count warning | >4 params | Including generic type parameters in count |

### DRY Ignore Patterns

1. **Generic type constraints `T extends SomeInterface` repeated**: Standard TypeScript pattern where multiple functions or classes use the same generic constraint. Not a violation — constraints are necessary for type safety.

2. **React prop interfaces with shared fields across components**: Components sharing common props (e.g., className, style, id) in their interface definitions is standard React pattern, not duplication. Extract to shared types when >3 components share identical props.

3. **Decorator metadata `@Column()`, `@Input()` repeated on DTOs**: Necessary boilerplate for ORM mapping and Angular component configuration. Decorators encode structural information that can't be inferred from type signatures alone.

4. **Type alias/re-export patterns (`type X = Y`)**: Re-exporting types from barrel files or creating type aliases is standard TypeScript organization, not DRY violation.

### Framework Overrides

#### NestJS
- Max function length: 35 lines (decorator-heavy controllers)
- Additional ignore patterns: Module registration with repeated `@Module()` declarations, service constructor injection of multiple dependencies

#### Express
- Max function length: 30 lines
- Additional ignore patterns: Middleware composition chains, route handler type definitions

#### Next.js
- Max function length: 40 lines (pages can include data fetching logic)
- Additional ignore patterns: `getServerSideProps` / `getStaticProps` with repeated data transformation patterns
