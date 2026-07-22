# Session Memory — xskills

## Skill Access (CRITICAL)

Skills are NOT MCP servers. Never use `Read Mcp Resource` with a skill name as server (`mcp_name: "x-implement"`).

**Correct pattern:**
- Read user-installed skill SKILL.md → `view $HOME/.agents/skills/<name>/SKILL.md`
- Read source repo skill → `view skills/<name>/SKILL.md` (relative to project root)
- Call MCP tools → use tool name directly: `mcp_xskills_dispatch_dispatch()`, NOT via resource reading

**Connected MCP servers:** chrome-devtools, github, sentry, xskills. Nothing else.
