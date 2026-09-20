import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { grammarFor, loadParser, SYMBOL_NODES } from "./grammars.mjs";

const CODE_EXTENSIONS = new Set([
  ".cjs", ".jsx", ".go", ".rs", ".java", ".rb", ".php", ".cs", ".c", ".h", ".cpp", ".css", ".html", ".vue", ".svelte", ".sql", ".ex", ".exs",
]);
const LINE_EXTENSIONS = new Set([
  ".md", ".markdown", ".json", ".txt", ".yml", ".yaml", ".sh", ".py", ".js", ".mjs", ".ts", ".tsx", ".mmd", ".csv", ".toml",
]);
export const TEXT_EXTENSIONS = new Set([...LINE_EXTENSIONS, ...CODE_EXTENSIONS]);

const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "build", ".venv", "vendor", ".index", ".astro", ".next", "target", "__pycache__",
]);
const SKIP_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "bun.lockb"]);

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_CHUNK_BYTES = 8192;
export const WINDOW_BYTES = 1536;
export const WINDOW_OVERLAP = 230;
export const MIN_GAP_BYTES = 400;

const LANGUAGE_BY_EXTENSION = {
  ".md": "markdown", ".markdown": "markdown", ".mmd": "mermaid",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
  ".ts": "typescript", ".tsx": "tsx", ".json": "json", ".yml": "yaml", ".yaml": "yaml",
  ".toml": "toml", ".sh": "shell", ".py": "python", ".go": "go", ".rs": "rust",
  ".java": "java", ".rb": "ruby", ".php": "php", ".cs": "csharp", ".c": "c", ".h": "c",
  ".cpp": "cpp", ".css": "css", ".html": "html", ".vue": "vue", ".svelte": "svelte",
  ".sql": "sql", ".csv": "csv", ".txt": "text", ".ex": "elixir", ".exs": "elixir",
};

export function languageOf(relPath) {
  return LANGUAGE_BY_EXTENSION[path.extname(relPath).toLowerCase()] || "text";
}

export function isTextFile(relPath) {
  const name = path.basename(relPath);
  if (SKIP_FILES.has(name) || name.endsWith(".min.js")) return false;
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export function walkFiles(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (entry.isFile()) found.push(path.relative(root, abs));
    }
  };
  walk(root);
  return found.sort();
}

function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function makeChunk({ relPath, lang, text, kind, symbol, startLine, endLine }) {
  return {
    path: relPath,
    lang,
    symbol,
    kind,
    startLine,
    endLine,
    text,
    hash: crypto.createHash("sha256").update(text).digest("hex"),
  };
}

function sliceRange(text, starts, { relPath, lang, symbol, kind }, from, to) {
  const chunks = [];
  let cursor = from;
  while (cursor < to) {
    let end = Math.min(cursor + WINDOW_BYTES, to);
    if (end < to) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > cursor + WINDOW_BYTES / 2) end = newline + 1;
    }
    const body = text.slice(cursor, end);
    if (body.trim().length) {
      chunks.push(makeChunk({ relPath, lang, text: body, kind, symbol, startLine: lineAt(starts, cursor), endLine: lineAt(starts, Math.max(cursor, end - 1)) }));
    }
    if (end >= to) break;
    cursor = Math.max(end - WINDOW_OVERLAP, cursor + 1);
  }
  return chunks;
}

export function windowChunks(text, { relPath, lang, symbol = null, kind = "window" }) {
  return sliceRange(text, lineStarts(text), { relPath, lang, symbol, kind }, 0, text.length);
}

const FUNCTION_VALUES = new Set(["arrow_function", "function_expression", "function", "generator_function"]);

function isFunctionDeclaration(node) {
  if (node.type !== "variable_declarator") return true;
  const value = node.childForFieldName("value");
  return Boolean(value && FUNCTION_VALUES.has(value.type));
}

function declaredName(node) {
  const named = node.childForFieldName("name");
  if (named) return named.text;
  const definition = node.childForFieldName("definition");
  if (definition) return declaredName(definition);
  const identifier = node.namedChildren?.find((child) => child.type === "identifier" || child.type === "type_identifier" || child.type === "constant");
  return identifier?.text ?? null;
}

const WRAPPER_TYPES = new Set(["export_statement", "ambient_declaration"]);

function statementAnchor(node) {
  let anchor = node;
  while (anchor.parent && WRAPPER_TYPES.has(anchor.parent.type)) anchor = anchor.parent;
  return anchor;
}

function docStart(node, source) {
  const anchor = statementAnchor(node);
  const previous = anchor.previousSibling;
  if (!previous || !previous.type.includes("comment")) return anchor.startIndex;
  const between = source.slice(previous.endIndex, anchor.startIndex);
  return between.trim().length === 0 ? previous.startIndex : anchor.startIndex;
}

export function symbolChunks(root, source, { relPath, lang }) {
  const starts = lineStarts(source);
  const wanted = SYMBOL_NODES[lang] || new Set();
  const ranges = [];
  const walk = (node) => {
    if (wanted.has(node.type) && isFunctionDeclaration(node)) {
      const name = declaredName(node);
      if (name) {
        const from = docStart(node, source);
        ranges.push({ from, to: node.endIndex, symbol: name });
        return;
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(root);

  const chunks = [];
  for (const range of ranges) {
    const body = source.slice(range.from, range.to);
    if (body.length > MAX_CHUNK_BYTES) {
      chunks.push(...sliceRange(source, starts, { relPath, lang, symbol: range.symbol, kind: "symbol" }, range.from, range.to));
    } else if (body.trim().length) {
      chunks.push(
        makeChunk({
          relPath,
          lang,
          text: body,
          kind: "symbol",
          symbol: range.symbol,
          startLine: lineAt(starts, range.from),
          endLine: lineAt(starts, Math.max(range.from, range.to - 1)),
        }),
      );
    }
  }
  return { chunks, ranges };
}

function gapWindows(source, starts, ranges, { relPath, lang }) {
  const ordered = [...ranges].sort((a, b) => a.from - b.from);
  const gaps = [];
  let cursor = 0;
  for (const range of ordered) {
    if (range.from - cursor >= MIN_GAP_BYTES) gaps.push([cursor, range.from]);
    cursor = Math.max(cursor, range.to);
  }
  if (source.length - cursor >= MIN_GAP_BYTES) gaps.push([cursor, source.length]);
  return gaps.flatMap(([from, to]) => sliceRange(source, starts, { relPath, lang, symbol: null, kind: "window" }, from, to));
}

export async function chunkSource(text, { relPath, lang, log = () => {} }) {
  if (!grammarFor(lang)) {
    log(`no grammar for ${lang}, windows used`);
    return windowChunks(text, { relPath, lang });
  }
  const parser = await loadParser(lang);
  if (!parser) {
    log(`no grammar for ${lang}, windows used`);
    return windowChunks(text, { relPath, lang });
  }
  const tree = parser.parse(text);
  if (tree.rootNode.hasError) {
    log(`parse failed for ${relPath}, windows used`);
    return windowChunks(text, { relPath, lang });
  }
  const starts = lineStarts(text);
  const { chunks, ranges } = symbolChunks(tree.rootNode, text, { relPath, lang });
  return [...chunks, ...gapWindows(text, starts, ranges, { relPath, lang })].sort((a, b) => a.startLine - b.startLine);
}

export function readChunkableFile(root, relPath) {
  const abs = path.join(root, relPath);
  const stat = fs.statSync(abs);
  if (stat.size > MAX_FILE_BYTES) return null;
  return { text: fs.readFileSync(abs, "utf8"), stat };
}

export async function chunkFile(root, relPath, { log = () => {} } = {}) {
  const read = readChunkableFile(root, relPath);
  if (!read) return [];
  const lang = languageOf(relPath);
  const chunks = await chunkSource(read.text, { relPath, lang, log });
  return chunks.map((chunk) => ({ ...chunk, mtime: Math.floor(read.stat.mtimeMs), size: read.stat.size }));
}
