# Stack Adapter: Python

## Language: Python

### Framework Detection

| Pattern | Framework | Route Style |
|---------|-----------|-------------|
| `from flask import Flask` | Flask | `@app.route("/path")` |
| `from django.http import` | Django | `def view(request)` class-based views |
| `import fastapi` or `FastAPI()` | FastAPI | `@app.get("/path")` async |
| `from sqlalchemy import` + `Base = declarative_base()` | SQLAlchemy ORM | Model declarative |
| `import redis` / `import Redis` | Redis client | Key-value patterns |

### Thresholds (Default)

| Metric | Limit | Notes |
|--------|-------|-------|
| Max function length | 40 lines | Python more readable at shorter lengths |
| Cyclomatic complexity | 8 | Lower threshold due to readability focus |
| Parameter count warning | >5 params | Including *args and **kwargs in count |

### DRY Ignore Patterns

1. **`@property` decorators on related getters**: Repeated `@property` patterns across a class for computed attributes are standard Python, not a violation of DRY.

2. **Django `class Meta:` with field definitions across models**: Standard Django ORM pattern where each model defines its own Meta inner class with ordering, indexes, and permissions.

3. **Context manager (`with`) patterns repeated**: Repeated `with open(...) as f:` or `with lock:` patterns are idiomatic Python for resource management, not duplication.

4. **List/dict comprehensions with similar structure**: Comprehensions that follow the same pattern across a file (e.g., filtering and mapping operations) are Pythonic, not DRY violations.

### Framework Overrides

#### Flask
- Max function length: 35 lines (view functions should be concise)
- Additional ignore patterns: Blueprint registration with repeated route decorators

#### Django
- Max function length: 45 lines (model methods can be longer)
- Additional ignore patterns: `class Meta:` blocks across models, form field definitions

#### FastAPI
- Max function length: 40 lines
- Additional ignore patterns: Pydantic model field definitions with repeated type annotations
