#!/usr/bin/env node
/**
 * OpenCode — sessions live in SQLite, and the CLI is the only supported way in: `opencode db` runs a
 * query and prints it as JSON, `opencode export <id>` prints one session as JSON. Reading the database
 * file directly would need a driver, and the package has no dependencies.
 *
 * `opencode db` has no schema command, so the columns below are the ones `select * from session`
 * returned when this adapter was written:
 *   id, title, directory, time_created (ms), time_updated (ms), time_archived, agent, model, …
 * and an export is { info: { id, title, directory, time }, messages: [{ info: { role, time }, parts }] }
 * with parts: text | reasoning | tool { callID, tool, state { status, input, output } } | step-start | step-finish.
 */
const SESSION_COLUMNS = "id, title, directory, time_created, time_updated";

function iso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function partOf(part) {
  if (part?.type === "text") return [{ type: "text", text: String(part.text ?? "") }];
  if (part?.type === "reasoning") return [{ type: "reasoning", thinking: String(part.text ?? "") }];
  if (part?.type !== "tool") return [];
  // One tool part carries both halves, and the scanner pairs them by id: emit the call and its result.
  const id = part.callID ?? null;
  const name = part.tool ?? "?";
  const input = part.state?.input === undefined ? "" : JSON.stringify(part.state.input);
  return [
    { type: "tool_call", tool_call_id: id, name, input },
    { type: "tool_result", tool_call_id: id, name, content: String(part.state?.output ?? "") },
  ];
}

function toMessages(messages) {
  const out = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const parts = (Array.isArray(message?.parts) ? message.parts : []).flatMap(partOf);
    if (!parts.length) continue;
    out.push({ role: message?.info?.role ?? "assistant", created: iso(message?.info?.time?.created), parts });
  }
  return out;
}

/** A session row from `opencode db`: every key except the two timestamps is already a string. */
export function sessionFromRow(row) {
  return {
    id: String(row.id),
    uuid: String(row.id),
    title: row.title ?? null,
    project: row.directory ?? null,
    created: iso(row.time_created),
    modified: iso(row.time_updated),
  };
}

export function rowsOf(stdout) {
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [];
}

export const opencode = {
  id: "opencode",
  label: "OpenCode",
  store: '`opencode db "select … from session" --format json` for the list, `opencode export <id>` for a transcript',

  detect({ run }) {
    try {
      run("opencode", ["db", "path"]);
      return true;
    } catch {
      return false;
    }
  },

  list({ run }) {
    const rows = rowsOf(run("opencode", ["db", `select ${SESSION_COLUMNS} from session`, "--format", "json"], {}));
    return { sessions: rows.map(sessionFromRow), warnings: [] };
  },

  read(session, { run }) {
    const raw = JSON.parse(run("opencode", ["export", String(session.id)], {}));
    const info = raw?.info ?? {};
    const id = info.id ?? session.id;
    return {
      meta: {
        host: "opencode",
        id,
        uuid: id,
        title: info.title ?? session.title ?? null,
        created: iso(info.time?.created) ?? session.created ?? null,
        modified: iso(info.time?.updated) ?? session.modified ?? null,
        skills: [],
      },
      messages: toMessages(raw?.messages),
    };
  },
};
