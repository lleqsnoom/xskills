# xskills Pipeline Rules

## Pipeline Order (mandatory)
`x-plan → x-epic → x-decompose → x-implement`. Never skip a phase.

## Artifact Convention
All artifacts under `.x-skills/` relative to CWD:
- Design specs:    `.x-skills/plan/DD-MM-YYYY-hh:mm-<topic>.md`
- Epics:           `.x-skills/epics/DD-MM-YYYY-hh:mm-<topic>.md`
- Tasks:           `.x-skills/tasks/DD-MM-YYYY-hh:mm-<epic>/US*-*.md`

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
