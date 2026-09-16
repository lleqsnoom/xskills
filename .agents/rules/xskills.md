# xskills Pipeline Rules

## Pipeline Order (mandatory)
`x-plan → x-epic → x-decompose → x-implement`. Never skip a phase.

## Artifact Convention
All artifacts live in one folder per run, relative to CWD:
`.x-skills/runs/<YYYY-MM-DD-hhmm>-R<nn>-<slug>/`

- The folder holds `state.json`, `memory.md`, and every artifact of that run.
- Artifacts are `E<nn>-<kind>.md` or `E<nn>-<kind>/`, numbered in execution order (`E00` plan, `E01` epic, `E02` tasks, and so on).
- Both counters are exactly two digits: `E100` would sort before `E99`.
- The stamp has leading zeros and no colon, so a plain name sort runs oldest to newest on every OS.
- `R<nn>` counts runs of **that slug only**, so `R02` reads as "the second run of this topic" and `R01` elsewhere is unrelated.
- A skill writes into the folder that holds the artifact it read; only the first skill of a run mints `R<nn>`.

### Choosing a run

A slug reuses its existing run, so returning to a topic months later joins the original folder unless you say otherwise. Two flags control that, and they work on the pipeline skills (`x-plan`, `x-epic`, `x-decompose`, `x-implement`):

| Flag | Effect |
|------|--------|
| `--new-run` | Mint a fresh `R<nn>` for this slug instead of joining. Use it to start a second run of a topic. |
| `--run <nn>` | Join the run with that number. Needed once a slug has more than one, so a phase lands in the run you mean. |

With two runs and neither flag, the skill fails loudly rather than picking one:

```
2 runs match "my-topic"; pass --run <nn> to pick one, or --new-run to start another
```

### Changing the helpers

`resolveRunDir` and `nextE` are duplicated into every skill that needs them, because skills cannot import from one another. Edit them once in `scripts/sync-run-folders.js` and run `npm run sync:run-folders`. `npm run check:run-folders` fails when a copy diverges — never edit a `// #region run-folder` block by hand.

## Phase Boundaries
- **x-plan**: No code. Only spec files and working notes.
- **x-epic**: No tasks, no implementation. Only user stories + DOD.
- **x-decompose**: No code, no epic changes. Only task files.
- **x-implement**: Follow task files. TDD only. Commit via x-commit.

## Handoff Requirement
Before declaring a phase complete: confirm artifact file exists at expected path, spec contains required declarations (contract, invariant, test), and next-phase skill can locate it by topic slug.

---

## Skill Access Patterns

**Skills ≠ MCP servers.** Never use `Read Mcp Resource` with a skill name as the server — there is no MCP server named `x-implement`, `x-commit`, etc.

| What to do | Correct approach |
|------------|-----------------|
| Read a user-installed skill's SKILL.md | `view $HOME/.agents/skills/<name>/SKILL.md` |
| Access builtin skill docs (jq, omarchy) | `view crush://skills/<name>/SKILL.md` |

xskills ships no MCP server. Some skills drive *external* MCP servers the client may configure (e.g. `chrome-devtools` via `x-browser`) — those belong to the environment, not to xskills.
