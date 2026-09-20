import readline from "node:readline";
import process from "node:process";
import { EmbedderUnreachable } from "./embed.mjs";
import { countRows, countVectors, metaAll, openStore, storeExists } from "./store.mjs";
import { storePathFor } from "./roots.mjs";
import { runSearch } from "./search.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "x-search";

const searchTool = {
  name: "search",
  description: "Find where something is by meaning or by exact identifier; returns ranked file paths with line ranges.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", description: "What you are looking for, in words or as an identifier." },
      project: { type: "string", description: "Limit to one repository; omit to search every indexed repository." },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 8 },
      mode: { type: "string", enum: ["hybrid", "keyword", "vector"], default: "hybrid" },
      lang: { type: "string", description: "Restrict to one language, for example ts or python." },
    },
  },
};

const projectsTool = {
  name: "projects",
  description: "List the repositories that have an index, with their chunk counts and when they were built.",
  inputSchema: { type: "object", properties: {} },
};

const statsTool = {
  name: "stats",
  description: "Describe one index: chunks, vectors, engine, and when it was last built.",
  inputSchema: { type: "object", properties: { project: { type: "string" } } },
};

export const TOOLS = [searchTool, projectsTool, statsTool];

function storeSummary(repo) {
  const db = openStore(storePathFor(repo.root), { readOnly: true });
  try {
    const meta = metaAll(db);
    return {
      id: repo.id,
      name: repo.name,
      root: repo.root,
      chunks: countRows(db, "chunks"),
      vectors: countVectors(db),
      engine: meta.engine || "blob",
      embedder: meta.embedder || null,
      dims: meta.dims ? Number(meta.dims) : null,
      indexedAt: meta.built_at || null,
      builtAt: meta.built_at || null,
    };
  } finally {
    db.close();
  }
}

function listStores(roots) {
  return roots.filter((repo) => storeExists(repo.root)).map(storeSummary);
}

const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], isError: false });

export async function callTool(name, args = {}, { roots, env = process.env }) {
  if (name === "search") {
    if (!args.query) return { content: [{ type: "text", text: "search needs a query" }], isError: true };
    const payload = await runSearch({
      query: args.query,
      roots,
      limit: args.limit,
      mode: args.mode || "hybrid",
      lang: args.lang,
      project: args.project,
      env,
    });
    if (payload.index.missing) {
      return text({ ...payload, note: "no index yet — run: x-search index --all" });
    }
    return text(payload);
  }
  if (name === "projects") {
    return text(listStores(roots).map(({ builtAt, ...rest }) => rest));
  }
  if (name === "stats") {
    const stores = listStores(roots);
    const chosen = args.project ? stores.filter((store) => store.id === args.project || store.name === args.project) : stores;
    if (!chosen.length) return text(args.project ? `no index for ${args.project}` : "no index yet — run: x-search index --all");
    return text(chosen.length === 1 ? chosen[0] : chosen);
  }
  return null;
}

const RPC_ERRORS = {
  methodNotFound: (id) => ({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } }),
  invalidParams: (id, message) => ({ jsonrpc: "2.0", id, error: { code: -32602, message } }),
};

async function handleMessage(message, { roots, env, reply }) {
  const { id, method, params } = message;
  if (method === "initialize") return reply(initializeResult(id));
  if (method === "notifications/initialized" || method === "notifications/cancelled") return undefined;
  if (method === "tools/list") return reply({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "ping") return reply({ jsonrpc: "2.0", id, result: {} });
  if (method !== "tools/call") return reply(RPC_ERRORS.methodNotFound(id));
  const name = params?.name;
  if (!TOOLS.some((tool) => tool.name === name)) return reply(RPC_ERRORS.invalidParams(id, `unknown tool: ${name}`));
  return reply({ jsonrpc: "2.0", id, result: await callToolSafely(name, params?.arguments || {}, { roots, env }) });
}

const initializeResult = (id) => ({
  jsonrpc: "2.0",
  id,
  result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: "0.1.0" } },
});

async function callToolSafely(name, args, { roots, env }) {
  try {
    return await callTool(name, args, { roots, env });
  } catch (error) {
    const hint = error instanceof EmbedderUnreachable ? " — start it with: ollama serve" : "";
    return { content: [{ type: "text", text: `${error.message}${hint}` }], isError: true };
  }
}

export function createServer({ roots, env = process.env, input = process.stdin, output = process.stdout }) {
  const reply = (message) => output.write(`${JSON.stringify(message)}\n`);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const done = new Promise((resolve) => {
    lines.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const fail = (message) => reply(RPC_ERRORS.invalidParams(message?.id ?? null, String(message)));
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        reply(RPC_ERRORS.invalidParams(null, "parse error"));
        return;
      }
      Promise.resolve(handleMessage(message, { roots, env, reply })).catch((error) => fail({ id: message.id, message: error.message }));
    });
    lines.on("close", resolve);
  });
  return { done };
}

export async function runMcp({ roots, env = process.env }) {
  const server = createServer({ roots, env });
  await server.done;
  return 0;
}
