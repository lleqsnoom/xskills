# Engineering Principles Reference

## 1. Single Responsibility Principle (SRP)

A function or class should have **one, and only one, reason to change**.

### How to identify violations

| Signal | Example |
|--------|---------|
| Function does 2+ distinct things | `validateAndSendEmail()` — validates input AND sends email |
| Function name is compound | `loadProcessAndSaveData()` |
| Multiple return points with different semantics | Returns `null` on error, `data` on success, `true` on skip |
| Can't describe what it does in one sentence | "It fetches the user, checks if they're active, then updates the cache..." |

### The "extract test"

Ask: **Can this function be split into two smaller functions, each of which still makes sense on its own?**
If yes → it violates SRP.

### Good example

```javascript
// Each function has one clear responsibility
function validateUserInput(input) {
  if (!input.email) throw new Error("Email required");
  if (!isValidEmail(input.email)) throw new Error("Invalid email");
  return true;
}

function sendWelcomeEmail(user) {
  const template = renderTemplate("welcome", user);
  return emailService.send(user.email, template);
}

// Composition keeps things clean
function registerUser(input) {
  validateUserInput(input);
  const user = createUser(input);
  sendWelcomeEmail(user);
  return user;
}
```

## 2. SOLID Principles

### Single Responsibility (see above)

### Open/Closed Principle
Entities should be **open for extension, closed for modification**.

- Add new behavior by adding new code, not by modifying existing code.
- Use interfaces, abstract classes, or strategy patterns.

**Violation:** Adding `if (type === "premium")` blocks to an existing function instead of creating a new handler.

### Liskov Substitution Principle
Subtypes must be **substitutable** for their base types without breaking the program.

**Violation:** A `Square` class extending `Rectangle` that overrides `setWidth()` to also change height — breaks code expecting independent width/height.

### Interface Segregation Principle
No client should be forced to depend on methods it doesn't use.

**Violation:** A large `IWorker` interface with `work()`, `eat()`, `sleep()` — a robot only needs `work()`.

### Dependency Inversion Principle
Depend on **abstractions**, not concretions.

**Violation:** `class UserService { constructor(private db: MongoDB) {} }` — depends on concrete DB. Should depend on `Database` interface.

## 3. KISS — Keep It Simple, Stupid

The simplest solution that meets requirements is usually the best.

### Anti-patterns

| Pattern | Why it's bad | Simpler alternative |
|---------|-------------|---------------------|
| Factory pattern for 1 implementation | Unnecessary indirection | Just `new` or a factory function |
| Abstract class with one subclass | Over-engineering | Use the subclass directly |
| Configuration object for 2 values | Indirection overhead | Hardcode or use constants |
| Generic<T> when T is always one type | False generality | Use the concrete type |

### When complexity IS justified

- The abstraction handles **multiple** implementations
- The pattern solves a **proven** problem (not a hypothetical one)
- The cost of simplicity (copy-paste, duplication) exceeds the cost of abstraction

## 4. DRY — Don't Repeat Yourself

Eliminate duplicated **logic**, not just text.

### What counts as duplication

| Type | Example | Fix |
|------|---------|-----|
| Same logic in 2+ places | Two functions with identical validation | Extract to shared function |
| Copy-paste error handling | `try { ... } catch (e) { log(e); throw e; }` everywhere | Create error handler utility |
| Parallel conditional chains | `if (type === "a") doA() else if (type === "b") doB()` mirrored in 3 places | Strategy pattern or dispatch table |

### What is NOT duplication

- Same structure in different contexts (two forms with same layout)
- Repeated data/configuration
- Deliberate independence (copying code that may diverge later)

### The "Rule of Three"

- **Once** — just do it
- **Twice** — consider extracting, but don't force it
- **Thrice** — definitely extract
