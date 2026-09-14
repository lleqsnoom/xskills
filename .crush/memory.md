# Session Memory — xskills

## Skill Access (CRITICAL)

Skills are NOT MCP servers. Never use `Read Mcp Resource` with a skill name as server (`mcp_name: "x-implement"`).

**Correct pattern:**
- Read user-installed skill SKILL.md → `view $HOME/.agents/skills/<name>/SKILL.md`
- Read source repo skill → `view skills/<name>/SKILL.md` (relative to project root)

xskills ships no MCP server. The connected MCP servers are whatever the client configures (e.g. `chrome-devtools`, `github`, `sentry`) — none of them is `xskills`.
