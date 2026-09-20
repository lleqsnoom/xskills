import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);

export const GRAMMARS = {
  javascript: { pkg: "tree-sitter-javascript", wasm: "tree-sitter-javascript.wasm" },
  typescript: { pkg: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  tsx: { pkg: "tree-sitter-typescript", wasm: "tree-sitter-tsx.wasm" },
  python: { pkg: "tree-sitter-python" },
  go: { pkg: "tree-sitter-go" },
  rust: { pkg: "tree-sitter-rust" },
};

export const SYMBOL_NODES = {
  javascript: new Set(["function_declaration", "generator_function_declaration", "method_definition", "class_declaration", "class", "variable_declarator"]),
  typescript: new Set(["function_declaration", "method_definition", "class_declaration", "interface_declaration", "type_alias_declaration", "enum_declaration", "abstract_class_declaration", "variable_declarator"]),
  tsx: new Set(["function_declaration", "method_definition", "class_declaration", "interface_declaration", "type_alias_declaration", "enum_declaration", "variable_declarator"]),
  python: new Set(["function_definition", "class_definition", "decorated_definition"]),
  go: new Set(["function_declaration", "method_declaration", "type_declaration"]),
  rust: new Set(["function_item", "impl_item", "struct_item", "enum_item", "trait_item"]),
};

export function grammarFor(lang) {
  return GRAMMARS[lang] || null;
}

function globalModuleDirs() {
  const dirs = [];
  try {
    const root = execFileSync("npm", ["root", "-g"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (root) dirs.push(root);
  } catch {
    /* a machine without npm still resolves from the global tree below */
  }
  try {
    const prefix = execFileSync("npm", ["config", "get", "prefix"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    dirs.push(path.join(prefix, "lib", "node_modules"), path.join(prefix, "node_modules"));
  } catch {
    /* the two candidates below cover the common layouts */
  }
  return dirs;
}

export function moduleSearchDirs() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return [...new Set([here, path.join(here, ".."), path.join(here, "..", ".."), process.cwd(), ...globalModuleDirs()])];
}

function resolveFromPackageDirs(pkg, dirs) {
  for (const dir of dirs) {
    try {
      return require.resolve(pkg, { paths: [dir] });
    } catch {
      continue;
    }
  }
  return null;
}

export function findWasm(lang) {
  const grammar = grammarFor(lang);
  if (!grammar) return null;
  const manifest = resolveFromPackageDirs(`${grammar.pkg}/package.json`, moduleSearchDirs());
  if (!manifest) return null;
  const packageDir = path.dirname(manifest);
  const files = fs.readdirSync(packageDir).filter((name) => name.endsWith(".wasm"));
  if (!files.length) return null;
  return path.join(packageDir, grammar.wasm && files.includes(grammar.wasm) ? grammar.wasm : files[0]);
}

export function hasParser() {
  return Boolean(resolveFromPackageDirs("web-tree-sitter", moduleSearchDirs()));
}

export function installGrammars(langs, { log = () => {} } = {}) {
  const packages = [`tree-sitter-javascript`, ...[...new Set(langs.map((lang) => grammarFor(lang)?.pkg).filter(Boolean))]];
  log(`installing grammars: ${packages.join(", ")}`);
  try {
    execFileSync("npm", ["install", "-g", "--no-audit", "--no-fund", "web-tree-sitter", ...packages], { stdio: "pipe" });
    return true;
  } catch {
    log(`could not install grammars; install manually: npm install -g web-tree-sitter ${packages.join(" ")}`);
    return false;
  }
}

let parserModule = null;
const languageCache = new Map();
const parserCache = new Map();

function loadParserModule() {
  if (parserModule) return parserModule;
  const resolved = resolveFromPackageDirs("web-tree-sitter", moduleSearchDirs());
  if (!resolved) return null;
  parserModule = require(resolved);
  return parserModule;
}

export async function loadParser(lang) {
  if (parserCache.has(lang)) return parserCache.get(lang);
  const module = loadParserModule();
  const wasm = findWasm(lang);
  if (!module || !wasm) return null;
  try {
    await module.Parser.init();
    let language = languageCache.get(lang);
    if (!language) {
      language = await module.Language.load(fs.readFileSync(wasm));
      languageCache.set(lang, language);
    }
    const parser = new module.Parser();
    parser.setLanguage(language);
    parserCache.set(lang, parser);
    return parser;
  } catch {
    return null;
  }
}

export function resetGrammarCache() {
  languageCache.clear();
  parserCache.clear();
}
