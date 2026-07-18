# Stack Adapter: Java

## Language: Java

### Framework Detection

| Pattern | Framework | Route Style |
|---------|-----------|-------------|
| `org.springframework.boot` imports | Spring Boot | `@RestController`, `@GetMapping` |
| `jakarta.ws.rs` / `javax.ws.rs` | JAX-RS | `@Path()`, `@GET` annotations |
| `io.quarkus` | Quarkus | Similar to Spring, native compilation |
| `org.hibernate` / `jakarta.persistence` | Hibernate/JPA | `@Entity`, `@Table` annotations |

### Thresholds (Default)

| Metric | Limit | Notes |
|--------|-------|-------|
| Max function length | 40 lines | Verbose getters/setters inflate counts |
| Cyclomatic complexity | 10 | Higher due to explicit type checking patterns |
| Parameter count warning | >4 params | Builder pattern preferred for complex construction |
| Method count warning per class | >15 methods | Large classes often violate SRP in Java |

### DRY Ignore Patterns

1. **Lombok `@Getter`, `@Setter` repeated on fields**: Acceptable boilerplate — Lombok annotations generate methods at compile time, not actual code duplication. Each field requires its own annotation for clarity.

2. **Builder pattern with fluent API**: Standard Java pattern where method chaining (`obj.setA(1).setB(2).build()`) is intentional design, not repetition. Builder classes naturally have many similarly-structured setter methods.

3. **Checked exception declarations across interface implementations**: Necessary when implementing interfaces that declare checked exceptions. Each implementation must redeclare the throws clause even if the body doesn't throw.

4. **`equals()` and `hashCode()` boilerplate**: Generated method pairs required for proper collection behavior (HashMap, HashSet). While verbose, they're contractually required and rarely candidates for extraction.

### Framework Overrides

#### Spring Boot
- Max function length: 45 lines (service methods with validation can be longer)
- Additional ignore patterns: `@Autowired` constructor injection in multi-dependency constructors, repository interface method declarations

#### Quarkus
- Max function length: 40 lines
- Additional ignore patterns: Extension configuration classes with repeated annotation patterns

#### Hibernate/JPA
- Max function length: 50 lines (entity classes with many mapped fields)
- Additional ignore patterns: Entity field declarations with `@Column`, `@OneToMany`, etc. annotations per field
