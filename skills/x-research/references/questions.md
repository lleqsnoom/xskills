# Asking questions (panel, B2)

Keep asking until the user is sure. There is no cap on how many questions you may ask, but every
question must be one research could not answer.

## Before you ask

Run the research pass first (see `references/research-first.md`). A question whose answer is already
in the project, in the docs, or in a reference repo is not a question, it is a search you skipped.

## Always use the panel

Never ask in prose, and never bury a question in a discussion paragraph. Render every question as a
**panel** — the host's structured question UI (a `question` / `ask` tool). Pick one of exactly four
shapes:

| Panel | Shape | Options |
|-------|-------|---------|
| `single` | single select with multiple options, plus a free-answer field | 2-5 required |
| `multi` | multi select with options, plus an open form | 2-5 required |
| `open` | open form only (free text) | none |
| `confirm` | yes/no | none |

If the host has no structured question tool, print the same four shapes as a short numbered prompt.
Never fall back to a question hidden inside a paragraph.

**Render it.** The turn must actually carry the panel — the host's question call, or, with no such
tool, the numbered prompt. A sentence that only states the question is a violation. There is no
runtime check for this: `check-questions.mjs` reads your questions file, not the session, so this
rule is on you.

## Rules

- **One idea per question.** No "X and Y" and no second question mark.
- **Under 20 words.** Plain words a non-expert reads once.
- **Say what it changes.** The reader must know what decision the answer unlocks.
- **Pick the panel.** `single` to choose one of several, `multi` to choose several at once, `open`
  when only free text fits, `confirm` for a yes/no.
- **Record it.** Every question and answer goes into `memory.md`; recheck the open list after each
  answer and stop when the list is empty or the user says "you decide".

## Format

```markdown
## Q1: Which database stores sessions?
**Why:** this decides the schema and the migration plan.
**Panel:** single
**Options:** Postgres | SQLite | Redis
```

```markdown
## Q2: Should we keep the legacy endpoint?
**Why:** this decides the migration path.
**Panel:** confirm
```

## Check it

The style is enforced by `scripts/check-questions.mjs`:

```bash
node <skill>/scripts/check-questions.mjs --dir <run-dir>
```

Exit 0 means every question follows the rules. Exit 1 lists each violation by name
(`too-long`, `multi-idea`, `no-why`, `no-panel`, `bad-panel`, `no-options`, `unexpected-options`,
`empty`). Fix and re-run before asking.