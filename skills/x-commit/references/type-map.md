# Conventional Commits — Type Map

## Types

| Type       | Meaning                                                         |
|------------|-----------------------------------------------------------------|
| `feat`     | New feature                                                     |
| `fix`      | Bug fix                                                         |
| `docs`     | Documentation only changes                                      |
| `style`    | Formatting, whitespace, linting — no logic change               |
| `refactor` | Code restructuring that neither fixes a bug nor adds a feature  |
| `perf`     | Performance improvement                                         |
| `test`     | Adding or fixing tests                                          |
| `build`    | Build system, external dependencies, packaging                  |
| `ci`       | CI/CD configuration changes                                     |
| `chore`    | Other (tooling, config, maintenance)                            |
| `revert`   | Reverts a previous commit                                       |

## Format

```
type[(scope)][!]: description
```

- **Type** — required, must be one of the values above.
- **Scope** — optional, in parentheses. Use a short identifier for the affected module (`auth`, `api`, `ui`, `db`).
- **`!`** — optional, before the colon to indicate a breaking change.
- **Description** — single line, imperative mood, no period.

## Examples

```
feat(auth): add OAuth2 login flow
fix(api): handle null response in user endpoint
docs(readme): update installation instructions
refactor(core): extract token validation into helper
perf(query): cache parsed JSON responses
test(parser): add coverage for nested object parsing
build(deps): upgrade react to 18.2
ci(github): add PR label auto-assign workflow
chore: remove unused webpack alias
revert: revert "feat(ui): change button colors"
feat!: drop Node 14 support
```
