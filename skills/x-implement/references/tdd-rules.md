# TDD Anti-Patterns

## Don't

- Test passes without the impl (tests nothing).
- Mock the unit under test (tests the mock).
- Assert many behaviors in one test (split).
- Skip "watch it fail" — if the test doesn't fail, you don't know what it tests.
- Edit the test to match buggy code (tests the bug).
- Add abstractions not required by the current test (GREEN phase — not refactor).
- Edit files outside the failing test's scope.
- Create ad-hoc summary, notes, or analysis files not defined in the plan or required by a loaded skill.