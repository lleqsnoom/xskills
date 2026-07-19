# Directory Organization

Separate concerns into distinct directories before writing any code. Never dump everything into a single folder or `src/`.

1. **Identify responsibilities** — data models, business logic, I/O boundaries, API routes, utilities, tests.
2. **Assign each responsibility to its own directory** — e.g., `models/`, `services/`, `controllers/`, `utils/`, `tests/`.
3. **One file per concern** — a model file contains only model logic; a service file contains only business logic; never mix them.
4. **Import across boundaries is fine**, but imports should flow top-down (models → services → controllers) and never cycle.

If the task spec or epic defines an architecture section, follow it. If not, infer from the codebase's existing structure — match what's already there before inventing new conventions.