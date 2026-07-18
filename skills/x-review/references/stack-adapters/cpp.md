# Stack Adapter: C/C++

## Language: C/C++

### Framework Detection

| Pattern | Framework | Route Style |
|---------|-----------|-------------|
| `#include <boost/` | Boost library | Header-only utilities |
| `Q_OBJECT` / `#include <Qt` | Qt framework | MOC-based signals/slots |
| `#include <gtest/gtest.h>` | Google Test | Unit testing patterns |
| `.hpp` extension | C++ header convention | Named to distinguish from .h |

### Thresholds (Default)

| Metric | Limit | Notes |
|--------|-------|-------|
| Max function length | 50 lines | Templates and macros add verbosity |
| Cyclomatic complexity | 12 | Higher threshold for systems code with explicit error paths |
| Parameter count warning | >5 params | C functions often pass multiple arguments explicitly |
| Template depth warning | >3 levels of template nesting | Deeply nested templates hurt readability and compile time |

### DRY Ignore Patterns

1. **RAII cleanup in destructors repeated across classes**: Necessary pattern in C++ — each class managing its own resources (file handles, memory, locks) requires its own destructor implementation. Not duplication; it's encapsulation.

2. **Template specializations for similar types**: Standard metaprogramming pattern where `template<>` specializations handle type-specific behavior. Each specialization is necessary and not candidates for extraction.

3. **Macro definitions for platform differences `#ifdef _WIN32`**: Necessary conditional compilation for cross-platform code. Repeated `#ifdef` blocks per platform are expected, not DRY violations.

4. **Getter/setter pairs in header files**: Common C++ pattern where inline accessors are defined directly in the class declaration. While verbose, they're idiomatic and often inlined by the compiler for performance.

5. **Operator overloading `operator==`, `operator<<` per type**: Each type requires its own operator overload implementation. Repeated patterns across types are necessary for polymorphic behavior with standard algorithms.

### Framework Overrides

#### Boost
- Max function length: 60 lines (header-only utilities can be longer)
- Additional ignore patterns: Template metaprogramming boilerplate, iterator adapter patterns

#### Qt
- Max function length: 45 lines (signals/slots add structure)
- Additional ignore patterns: Signal declarations in `Q_OBJECT` macros, slot method implementations
