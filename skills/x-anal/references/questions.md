# Asking questions (B2)

Keep asking until the user is sure. There is no cap on how many questions you may ask, but every
question must be one research could not answer.

## Before you ask

Run the research pass first (see `references/research-first.md`). A question whose answer is already
in the project, in the docs, or in a reference repo is not a question, it is a search you skipped.

## Rules

- **One idea per question.** No "X and Y" and no second question mark.
- **Under 20 words.** Plain words a non-expert reads once.
- **Say what it changes.** The reader must know what decision the answer unlocks.
- **Offer 2-3 example answers** they can pick from.
- **Record it.** Every question and answer goes into `memory.md`; recheck the open list after each
  answer and stop when the list is empty or the user says "you decide".

## Format

```markdown
## Q1: Which database stores sessions?
**Why:** this decides the schema and the migration plan.
**Examples:** Postgres | SQLite | Redis
```

## Check it

The style is enforced by `scripts/check-questions.mjs`:

```bash
node <skill>/scripts/check-questions.mjs --dir <run-dir>
```

Exit 0 means every question follows the rules. Exit 1 lists each violation by name
(`too-long`, `multi-idea`, `no-why`, `no-examples`, `empty`). Fix and re-run before asking.
